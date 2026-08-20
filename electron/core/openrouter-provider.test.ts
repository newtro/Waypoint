import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  FetchOpenRouterTransport,
  OpenRouterClient,
  decideHostedRoute,
  openRouterCapability,
  summarizeUsage,
  type OpenRouterSettings,
  type ProviderUsageReceipt,
} from "./openrouter-provider.js";
const settings: OpenRouterSettings = {
  enabled: true,
  liveRequestsEnabled: true,
  strategicModel: "moonshot/kimi-k3",
  everydayModel: "deepseek/v4-flash",
  attachmentModel: "moonshotai/kimi-k3",
  fallbackProvider: "codex",
  monthlyCapMicros: 1000,
  ytdCapMicros: 5000,
  perRequestCapMicros: 100,
  warningPercent: 80,
};
const receipt = (
  costMicros: number,
  finishedAt = "2026-08-03T12:00:00.000Z",
): ProviderUsageReceipt => ({
  id: `r${costMicros}`,
  workspaceId: "w1",
  provider: "openrouter",
  model: "deepseek/v4-flash",
  role: "everyday",
  status: "completed",
  costMicros,
  promptTokens: 2,
  completionTokens: 3,
  requestDigest: "a".repeat(64),
  startedAt: finishedAt,
  finishedAt,
});
describe("OpenRouter provider policy", () => {
  it("fails truthfully through no-key, activation, model, and cap states", () => {
    expect(openRouterCapability(settings, false).state).toBe("no_key");
    expect(
      openRouterCapability({ ...settings, liveRequestsEnabled: false }, true)
        .state,
    ).toBe("activation_required");
    expect(
      openRouterCapability({ ...settings, strategicModel: "" }, true).state,
    ).toBe("model_required");
    expect(
      openRouterCapability(
        settings,
        true,
        summarizeUsage(
          [receipt(1000)],
          settings,
          new Date("2026-08-03T12:00:00Z"),
        ),
      ).state,
    ).toBe("cap_reached");
  });
  it("aggregates integer cost and uses only an approved subscription fallback at cap", () => {
    const summary = summarizeUsage(
      [
        receipt(800),
        {
          ...receipt(200),
          id: "r2",
          workspaceId: "w2",
          model: "moonshot/kimi-k3",
        },
      ],
      settings,
      new Date("2026-08-03T12:00:00Z"),
    );
    expect(summary).toMatchObject({
      monthMicros: 1000,
      ytdMicros: 1000,
      capReached: true,
      warning: true,
    });
    expect(summary.byWorkspace).toHaveLength(2);
    expect(
      decideHostedRoute({
        settings,
        keyConfigured: true,
        summary,
        role: "strategic",
        availableSubscriptions: ["codex"],
      }),
    ).toMatchObject({ provider: "codex", fallback: true });
    expect(() =>
      decideHostedRoute({
        settings,
        keyConfigured: true,
        summary,
        role: "strategic",
        availableSubscriptions: ["claude"],
      }),
    ).toThrow("No eligible");
    expect(
      decideHostedRoute({
        settings: { ...settings, fallbackProvider: "grok" },
        keyConfigured: true,
        summary,
        role: "strategic",
        availableSubscriptions: ["grok"],
      }),
    ).toMatchObject({ provider: "grok", fallback: true });
  });
  it("uses fixture transport for bounded success and cancellation without a network call", async () => {
    const complete = vi.fn(async () => ({
        responseId: "fixture-1",
        text: "ok",
        promptTokens: 3,
        completionTokens: 1,
        costMicros: 25,
      })),
      client = new OpenRouterClient({ complete }),
      controller = new AbortController(),
      result = await client.run({
        workspaceId: "w1",
        role: "everyday",
        model: "deepseek/v4-flash",
        prompt: "fixture",
        apiKey: "not-a-real-key",
        signal: controller.signal,
        now: () => "2026-08-03T12:00:00.000Z",
      });
    expect(result.receipt).toMatchObject({
      status: "completed",
      costMicros: 25,
    });
    expect(complete).toHaveBeenCalledOnce();
    const canceled = new AbortController();
    canceled.abort();
    const failing = new OpenRouterClient({
      complete: async () => {
        throw new Error("stopped");
      },
    });
    await expect(
      failing.run({
        workspaceId: "w1",
        role: "strategic",
        model: "moonshot/kimi-k3",
        prompt: "fixture",
        apiKey: "x",
        signal: canceled.signal,
      }),
    ).rejects.toMatchObject({
      message: "provider_canceled",
      receipt: { status: "canceled" },
    });
  });
  it("streams without a Waypoint token or synthetic unit-price cap and requires provider cost", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          authorization: "Bearer protected-test-key",
        });
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          stream: true,
          stream_options: { include_usage: true },
          provider: { data_collection: "deny", zdr: true },
        });
        expect(body).not.toHaveProperty("max_completion_tokens");
        expect(body.provider).not.toHaveProperty("max_price");
        const sse = [
          "data: " +
            JSON.stringify({
              id: "gen-fixture",
              choices: [{ delta: { content: "ans" } }],
            }),
          "data: " +
            JSON.stringify({
              id: "gen-fixture",
              choices: [{ delta: { content: "wer" } }],
            }),
          "data: " +
            JSON.stringify({
              id: "gen-fixture",
              choices: [],
              usage: { prompt_tokens: 4, completion_tokens: 2, cost: 0.000123 },
            }),
          "data: [DONE]",
          "",
        ].join("\n");
        return new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }),
      transport = new FetchOpenRouterTransport(fetcher as typeof fetch),
      result = await transport.complete({
        apiKey: "protected-test-key",
        model: "fixture/model",
        prompt: "hello",
        images: [],
        signal: new AbortController().signal,
        requestCapMicros: 100_000,
      });
    expect(result).toMatchObject({ costMicros: 123, text: "answer" });
    expect(fetcher).toHaveBeenCalledOnce();
    const missing = new FetchOpenRouterTransport(
      (async () =>
        new Response(
          JSON.stringify({
            id: "x",
            choices: [{ message: { content: "x" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        )) as typeof fetch,
    );
    await expect(
      missing.complete({
        apiKey: "x",
        model: "fixture/model",
        prompt: "x",
        images: [],
        signal: new AbortController().signal,
        requestCapMicros: 100_000,
      }),
    ).rejects.toThrow("provider_cost_unavailable");
  });
  it("retains authoritative paid usage when a later streaming event is malformed", async () => {
    const sse = [
        "data: " +
          JSON.stringify({
            id: "paid-stream",
            choices: [{ delta: { content: "paid answer" } }],
          }),
        "data: " +
          JSON.stringify({
            id: "paid-stream",
            choices: [],
            usage: { prompt_tokens: 7, completion_tokens: 3, cost: 0.5 },
          }),
        "data: {malformed",
        "",
      ].join("\n"),
      transport = new FetchOpenRouterTransport(
        (async () =>
          new Response(sse, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })) as typeof fetch,
      ),
      client = new OpenRouterClient(transport);
    await expect(
      client.run({
        workspaceId: "w1",
        role: "everyday",
        model: "fixture/model",
        prompt: "x",
        apiKey: "fixture-key",
        signal: new AbortController().signal,
        requestCapMicros: 100_000,
      }),
    ).rejects.toMatchObject({
      message: "provider_response_invalid",
      receipt: {
        status: "failed",
        responseId: "paid-stream",
        promptTokens: 7,
        completionTokens: 3,
        costMicros: 500_000,
      },
    });
  });
  it("retains authoritative paid usage when client-side response identity validation fails", async () => {
    const client = new OpenRouterClient({
      complete: async () => ({
        responseId: "bad id",
        text: "paid answer",
        promptTokens: 7,
        completionTokens: 3,
        costMicros: 500_000,
      }),
    });
    await expect(
      client.run({
        workspaceId: "w1",
        role: "everyday",
        model: "fixture/model",
        prompt: "x",
        apiKey: "fixture-key",
        signal: new AbortController().signal,
        requestCapMicros: 100_000,
      }),
    ).rejects.toMatchObject({
      message: "provider_response_invalid",
      receipt: {
        status: "failed",
        promptTokens: 7,
        completionTokens: 3,
        costMicros: 500_000,
      },
    });
  });
  it("reserves the approved request amount and retains the response id when a stream ends before usage", async () => {
    const encoded = new TextEncoder().encode(
      "data: " +
        JSON.stringify({
          id: "usage-missing",
          choices: [{ delta: { content: "partial" } }],
        }) +
        "\n",
    );
    let pulls = 0;
    const transport = new FetchOpenRouterTransport(
        (async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                pulls += 1;
                if (pulls === 1) controller.enqueue(encoded);
                else controller.error(new Error("connection lost"));
              },
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          )) as typeof fetch,
      ),
      client = new OpenRouterClient(transport);
    await expect(
      client.run({
        workspaceId: "w1",
        role: "everyday",
        model: "fixture/model",
        prompt: "x",
        apiKey: "fixture-key",
        signal: new AbortController().signal,
        requestCapMicros: 100_000,
      }),
    ).rejects.toMatchObject({
      receipt: {
        status: "failed",
        responseId: "usage-missing",
        costMicros: 100_000,
        errorCode: "provider_usage_unavailable_reserved",
      },
    });
  });
  it("sends validated image pixels as a multimodal content block without exposing them in receipts", async () => {
    const bytes = readFileSync("build/icons/waypoint.png"),
      image = {
        name: "waypoint.png",
        mediaType: "image/png" as const,
        dataBase64: bytes.toString("base64"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.messages[0].content).toEqual([
          { type: "text", text: "inspect" },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${image.dataBase64}` },
          },
        ]);
        return new Response(
          JSON.stringify({
            id: "image-fixture",
            choices: [{ message: { content: "logo" } }],
            usage: { prompt_tokens: 4, completion_tokens: 2, cost: 0 },
          }),
        );
      }),
      client = new OpenRouterClient(
        new FetchOpenRouterTransport(fetcher as typeof fetch),
      ),
      result = await client.run({
        workspaceId: "w1",
        role: "everyday",
        model: "moonshotai/kimi-k3",
        prompt: "inspect",
        images: [image],
        apiKey: "fixture-key",
        signal: new AbortController().signal,
      });
    expect(result.text).toBe("logo");
    expect(JSON.stringify(result.receipt)).not.toContain(image.dataBase64);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("blocks image delivery to a text-only model before transport with a terminal receipt", async () => {
    const bytes = readFileSync("build/icons/waypoint.png"),
      image = {
        name: "waypoint.png",
        mediaType: "image/png" as const,
        dataBase64: bytes.toString("base64"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      complete = vi.fn(),
      client = new OpenRouterClient({ complete });
    await expect(
      client.run({
        workspaceId: "w1",
        role: "everyday",
        model: "deepseek/deepseek-v4-flash",
        prompt: "inspect",
        images: [image],
        apiKey: "fixture-key",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      message: "provider_model_not_image_capable",
      receipt: { status: "failed" },
    });
    expect(complete).not.toHaveBeenCalled();
  });
  it("preserves a paid answer when authoritative provider cost exceeds the reservation", async () => {
    const client = new OpenRouterClient({
      complete: async () => ({
        responseId: "over-cap",
        text: "answer",
        promptTokens: 1,
        completionTokens: 1,
        costMicros: 101,
      }),
    });
    await expect(
      client.run({
        workspaceId: "w1",
        role: "everyday",
        model: "deepseek/v4-flash",
        prompt: "fixture",
        apiKey: "fixture-key",
        signal: new AbortController().signal,
        requestCapMicros: 100,
      }),
    ).resolves.toMatchObject({
      text: "answer",
      receipt: {
        status: "completed",
        costMicros: 101,
        errorCode: "provider_cost_cap_exceeded",
      },
    });
  });
});
