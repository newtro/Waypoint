import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CURATED_CLAUDE_MODELS,
  CURATED_CODEX_MODELS,
  installedCliModelCatalog,
  parseCodexModelCatalog,
  parseGrokModelCatalog,
} from "./provider-model-catalog.js";
import {
  subscriptionFallbackModel,
  withLegacyModel,
} from "../../src/provider-model-choices.js";

describe("installed CLI model catalog", () => {
  it("accepts only visible bounded models from the installed Codex catalog", () => {
    expect(
      parseCodexModelCatalog(
        JSON.stringify({
          models: [
            {
              slug: "gpt-5.6-sol",
              display_name: "GPT-5.6-Sol",
              visibility: "list",
            },
            { slug: "hidden", display_name: "Hidden", visibility: "hide" },
            { slug: "../escape", display_name: "Bad", visibility: "list" },
          ],
        }),
      ),
    ).toEqual([{ id: "gpt-5.6-sol", label: "GPT-5.6-Sol" }]);
  });
  it("requires signed-in grok.com provenance for the installed Grok catalog", async () => {
    expect(
      parseGrokModelCatalog(
        "You are logged in with grok.com.\nDefault model: grok-4.6\n  * grok-4.6 (default)\n  - grok-4.5\n",
      ),
    ).toEqual([
      { id: "grok-4.6", label: "Grok 4.6" },
      { id: "grok-4.5", label: "Grok 4.5" },
    ]);
    expect(parseGrokModelCatalog("API key configured\n- grok-4.6")).toEqual([]);
    const catalogs = await installedCliModelCatalog(
      [
        { name: "codex", available: false },
        { name: "claude", available: false },
        {
          name: "grok",
          available: true,
          compatible: true,
          executable: "/safe/grok",
          version: "1.0.3",
        },
      ],
      async () =>
        "You are logged in with grok.com.\nDefault model: grok-4.6\n  * grok-4.6 (default)\n  - grok-4.5\n",
    );
    expect(catalogs[2]).toMatchObject({
      provider: "grok",
      version: "1.0.3",
      ready: true,
      models: [
        { id: "", label: "Grok default (CLI selected)" },
        { id: "grok-4.6", label: "Grok 4.6" },
        { id: "grok-4.5", label: "Grok 4.5" },
      ],
    });
  });
  it("uses the current installed executable and keeps Claude truthful without a live request", async () => {
    const calls: Array<[string, string[]]> = [],
      catalogs = await installedCliModelCatalog(
        [
          {
            name: "codex",
            available: true,
            compatible: true,
            executable: "/safe/codex",
            version: "0.146.0",
          },
          {
            name: "claude",
            available: true,
            compatible: true,
            executable: "/safe/claude",
            version: "2.1.220",
          },
        ],
        async (file, args) => {
          calls.push([file, args]);
          return JSON.stringify({
            models: [
              {
                slug: "gpt-5.6-sol",
                display_name: "GPT-5.6-Sol",
                visibility: "list",
              },
            ],
          });
        },
      );
    expect(calls).toEqual([["/safe/codex", ["debug", "models"]]]);
    expect(catalogs[0].models).toEqual([
      { id: "", label: "Codex default (CLI selected)" },
      { id: "gpt-5.6-sol", label: "GPT-5.6-Sol" },
    ]);
    expect(catalogs[1].models).toEqual([
      { id: "", label: "Claude default (CLI selected)" },
      ...CURATED_CLAUDE_MODELS,
    ]);
  });
  it("falls back to the curated current model list when the Codex CLI reports no catalog", async () => {
    const catalogs = await installedCliModelCatalog(
      [
        {
          name: "codex",
          available: true,
          compatible: true,
          executable: "/safe/codex",
          version: "0.146.0",
        },
        { name: "claude", available: false },
      ],
      async () => {
        throw new Error("debug models unsupported");
      },
    );
    expect(catalogs[0].models).toEqual([
      { id: "", label: "Codex default (CLI selected)" },
      ...CURATED_CODEX_MODELS,
    ]);
    expect(catalogs[0].reason).toContain("Current Codex models");
    expect(catalogs[1].models[0]).toEqual({
      id: "",
      label: "Claude default (CLI selected)",
    });
    expect(catalogs[1].models.length).toBe(1 + CURATED_CLAUDE_MODELS.length);
  });
  it("cancels a catalog sequence before a later provider inventory can start", async () => {
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve)),
      calls: string[] = [],
      pending = installedCliModelCatalog(
        [
          {
            name: "codex",
            available: true,
            compatible: true,
            executable: "/safe/codex",
          },
          {
            name: "grok",
            available: true,
            compatible: true,
            executable: "/safe/grok",
          },
        ],
        async (file, _args, signal) => {
          calls.push(file);
          markStarted();
          return new Promise<string>((_resolve, reject) =>
            signal?.addEventListener(
              "abort",
              () => reject(new Error("canceled")),
              { once: true },
            ),
          );
        },
        controller.signal,
      );
    await started;
    controller.abort();
    await pending;
    expect(calls).toEqual(["/safe/codex"]);
  });
  it("preserves an unknown selected model visibly rather than replacing it", () => {
    expect(
      withLegacyModel([{ id: "", label: "Default" }], "historic-model")[0],
    ).toEqual({
      id: "historic-model",
      label: "Legacy / custom saved model — historic-model",
      legacy: true,
    });
  });
  it("uses only the selected subscription model for hosted cap fallback", () => {
    expect(
      subscriptionFallbackModel("codex", {
        codex: "gpt-5.6-sol",
        claude: "sonnet",
        grok: "grok-4.6",
      }),
    ).toBe("gpt-5.6-sol");
    expect(
      subscriptionFallbackModel("claude", {
        codex: "gpt-5.6-sol",
        claude: "",
        grok: "grok-4.6",
      }),
    ).toBeUndefined();
    expect(
      subscriptionFallbackModel("grok", {
        codex: "gpt-5.6-sol",
        claude: "sonnet",
        grok: "grok-4.6",
      }),
    ).toBe("grok-4.6");
  });
  it("does not pass the hosted model through the subscription fallback path", () => {
    const source = readFileSync(
      new URL("../../src/main.tsx", import.meta.url),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(source).toContain(
      "subscriptionFallbackModel(hosted.fallbackProvider, chatModels)",
    );
    expect(source).not.toContain(
      "hosted.fallbackProvider, profile, prompt, model",
    );
  });
  it("renders synchronized accessible composer and Settings selects without freeform model entry", () => {
    const source = readFileSync(
      new URL("../../src/main.tsx", import.meta.url),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(source).toContain(
      'aria-label={`${chatCli}${chatCli === "openrouter" && queuedHasImage ? " image" : ""} model`}',
    );
    expect(source).toContain('aria-label="Codex model preference"');
    expect(source).toContain('aria-label="Claude model preference"');
    expect(source).toContain('aria-label="Grok Build model preference"');
    expect(source).toContain("refreshCliProviders()");
    expect(source).toContain("Refresh providers");
    expect(source).toContain("providerRefreshTaskRef.current");
    expect(source).toContain("await providerRefreshTaskRef.current");
    expect(source).toContain('aria-label="OpenRouter image model"');
    expect(source).not.toContain('placeholder="Optional model"');
    expect(source).not.toMatch(/<input[^>]+name="model"/);
  });
});
