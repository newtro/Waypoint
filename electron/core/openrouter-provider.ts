import { createHash, createHmac, randomUUID } from "node:crypto";
import { openRouterModelAcceptsImages } from "./openrouter-model-catalog.js";
import { imageDimensions, validateAttachment } from "./chat-attachments.js";

export const OPENROUTER_POLICY_VERSION = 1 as const;
export const OPENROUTER_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const OPENROUTER_MAX_AGENT_TURNS = 12;
export const OPENROUTER_MAX_AGENT_TOOL_CALLS = 32;
export type OpenRouterImageInput = {
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  dataBase64: string;
  sha256: string;
};
export type HostedRouteRole = "strategic" | "everyday";
export type SubscriptionProvider = "codex" | "claude" | "grok";
export type OpenRouterSettings = {
  enabled: boolean;
  liveRequestsEnabled: boolean;
  strategicModel: string;
  everydayModel: string;
  attachmentModel: string;
  fallbackProvider?: SubscriptionProvider;
  monthlyCapMicros: number;
  ytdCapMicros: number;
  perRequestCapMicros?: number;
  warningPercent: number;
};
export type OpenRouterCapability = {
  state:
    | "no_key"
    | "disabled"
    | "activation_required"
    | "model_required"
    | "ready_unverified"
    | "cap_reached";
  available: boolean;
  health: "not_configured" | "not_checked" | "verified" | "failed";
  reason: string;
};
export type ProviderUsageReceipt = {
  id: string;
  workspaceId: string;
  provider: "openrouter";
  model: string;
  role: HostedRouteRole;
  status: "completed" | "failed" | "canceled" | "blocked";
  costMicros: number;
  promptTokens: number;
  completionTokens: number;
  requestDigest: string;
  responseId?: string;
  errorCode?: string;
  fallbackProvider?: SubscriptionProvider;
  startedAt: string;
  finishedAt: string;
};
export type UsageSummary = {
  monthMicros: number;
  ytdMicros: number;
  remainingMonthMicros: number;
  remainingYtdMicros: number;
  warning: boolean;
  capReached: boolean;
  projectedMonthMicros: number;
  byProvider: Array<{ provider: string; costMicros: number }>;
  byModel: Array<{ model: string; costMicros: number }>;
  byWorkspace: Array<{ workspaceId: string; costMicros: number }>;
};

const modelPattern = /^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/;
export function validateOpenRouterSettings(
  value: OpenRouterSettings,
): OpenRouterSettings {
  if (
    value.fallbackProvider !== undefined &&
    !["codex", "claude", "grok"].includes(value.fallbackProvider)
  )
    throw new Error("Subscription fallback provider is invalid");
  if (value.strategicModel && !modelPattern.test(value.strategicModel))
    throw new Error(
      "Strategic model must be an exact provider/model identifier",
    );
  if (value.everydayModel && !modelPattern.test(value.everydayModel))
    throw new Error(
      "Everyday model must be an exact provider/model identifier",
    );
  if (value.attachmentModel && !modelPattern.test(value.attachmentModel))
    throw new Error("Image model must be an exact provider/model identifier");
  if (
    !Number.isSafeInteger(value.monthlyCapMicros) ||
    value.monthlyCapMicros < 0 ||
    value.monthlyCapMicros > 100_000_000_000
  )
    throw new Error("Monthly cap is invalid");
  if (
    !Number.isSafeInteger(value.ytdCapMicros) ||
    value.ytdCapMicros < 0 ||
    value.ytdCapMicros > 1_000_000_000_000
  )
    throw new Error("Year-to-date cap is invalid");
  const perRequestCapMicros = value.perRequestCapMicros ?? 100_000;
  if (
    !Number.isSafeInteger(perRequestCapMicros) ||
    perRequestCapMicros < 1 ||
    perRequestCapMicros > 10_000_000_000
  )
    throw new Error("Per-request cap is invalid");
  if (
    !Number.isInteger(value.warningPercent) ||
    value.warningPercent < 1 ||
    value.warningPercent > 100
  )
    throw new Error("Warning threshold must be between 1 and 100");
  if (value.liveRequestsEnabled && !value.enabled)
    throw new Error("Hosted requests require an enabled provider");
  return {
    ...value,
    perRequestCapMicros,
    strategicModel: value.strategicModel.trim(),
    everydayModel: value.everydayModel.trim(),
    attachmentModel: value.attachmentModel.trim(),
  };
}
export function openRouterCapability(
  settings: OpenRouterSettings,
  keyConfigured: boolean,
  summary?: UsageSummary,
): OpenRouterCapability {
  if (!keyConfigured)
    return {
      state: "no_key",
      available: false,
      health: "not_configured",
      reason: "No protected OpenRouter API key is stored.",
    };
  if (!settings.enabled)
    return {
      state: "disabled",
      available: false,
      health: "not_checked",
      reason: "OpenRouter is disabled.",
    };
  if (!settings.liveRequestsEnabled)
    return {
      state: "activation_required",
      available: false,
      health: "not_checked",
      reason: "Hosted requests require explicit user activation.",
    };
  if (!settings.strategicModel || !settings.everydayModel)
    return {
      state: "model_required",
      available: false,
      health: "not_checked",
      reason: "Exact strategic and everyday model identifiers are required.",
    };
  const requestCap = settings.perRequestCapMicros ?? 100_000;
  if (
    summary &&
    (summary.capReached ||
      (settings.monthlyCapMicros > 0 &&
        summary.remainingMonthMicros < requestCap) ||
      (settings.ytdCapMicros > 0 && summary.remainingYtdMicros < requestCap))
  )
    return {
      state: "cap_reached",
      available: false,
      health: "not_checked",
      reason:
        "The next bounded request cannot fit within the configured spending cap.",
    };
  return {
    state: "ready_unverified",
    available: true,
    health: "not_checked",
    reason:
      "Configured and eligible; API health is unverified until an authorized request completes.",
  };
}
function sumBy(
  receipts: ProviderUsageReceipt[],
  key: (value: ProviderUsageReceipt) => string,
) {
  const values = new Map<string, number>();
  for (const receipt of receipts)
    values.set(
      key(receipt),
      (values.get(key(receipt)) ?? 0) + receipt.costMicros,
    );
  return [...values]
    .map(([name, costMicros]) => ({ name, costMicros }))
    .sort(
      (a, b) => b.costMicros - a.costMicros || a.name.localeCompare(b.name),
    );
}
export function summarizeUsage(
  receipts: ProviderUsageReceipt[],
  settings: OpenRouterSettings,
  at = new Date(),
): UsageSummary {
  const year = at.getUTCFullYear(),
    month = at.getUTCMonth(),
    eligible = receipts.filter(
      (item) =>
        item.costMicros > 0 &&
        new Date(item.finishedAt).getUTCFullYear() === year,
    ),
    monthRows = eligible.filter(
      (item) => new Date(item.finishedAt).getUTCMonth() === month,
    ),
    monthMicros = monthRows.reduce((sum, item) => sum + item.costMicros, 0),
    ytdMicros = eligible.reduce((sum, item) => sum + item.costMicros, 0),
    days = Math.max(1, at.getUTCDate()),
    daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
    projectedMonthMicros = Math.round((monthMicros / days) * daysInMonth),
    monthHit =
      settings.monthlyCapMicros > 0 && monthMicros >= settings.monthlyCapMicros,
    ytdHit = settings.ytdCapMicros > 0 && ytdMicros >= settings.ytdCapMicros,
    warning =
      (settings.monthlyCapMicros > 0 &&
        monthMicros * 100 >=
          settings.monthlyCapMicros * settings.warningPercent) ||
      (settings.ytdCapMicros > 0 &&
        ytdMicros * 100 >= settings.ytdCapMicros * settings.warningPercent);
  const provider = sumBy(eligible, (item) => item.provider),
    model = sumBy(eligible, (item) => item.model),
    workspace = sumBy(eligible, (item) => item.workspaceId);
  return {
    monthMicros,
    ytdMicros,
    remainingMonthMicros: settings.monthlyCapMicros
      ? Math.max(0, settings.monthlyCapMicros - monthMicros)
      : 0,
    remainingYtdMicros: settings.ytdCapMicros
      ? Math.max(0, settings.ytdCapMicros - ytdMicros)
      : 0,
    warning,
    capReached: monthHit || ytdHit,
    projectedMonthMicros,
    byProvider: provider.map((item) => ({
      provider: item.name,
      costMicros: item.costMicros,
    })),
    byModel: model.map((item) => ({
      model: item.name,
      costMicros: item.costMicros,
    })),
    byWorkspace: workspace.map((item) => ({
      workspaceId: item.name,
      costMicros: item.costMicros,
    })),
  };
}
export function decideHostedRoute(input: {
  settings: OpenRouterSettings;
  keyConfigured: boolean;
  summary: UsageSummary;
  role: HostedRouteRole;
  availableSubscriptions: SubscriptionProvider[];
}): {
  provider: "openrouter" | SubscriptionProvider;
  model?: string;
  reason: string;
  fallback: boolean;
} {
  const capability = openRouterCapability(
    input.settings,
    input.keyConfigured,
    input.summary,
  );
  if (capability.available)
    return {
      provider: "openrouter",
      model:
        input.role === "strategic"
          ? input.settings.strategicModel
          : input.settings.everydayModel,
      reason: `OpenRouter ${input.role} route is explicitly configured.`,
      fallback: false,
    };
  const fallback = input.settings.fallbackProvider;
  if (
    capability.state === "cap_reached" &&
    fallback &&
    input.availableSubscriptions.includes(fallback)
  )
    return {
      provider: fallback,
      reason: `OpenRouter cap reached; using the pre-approved ${fallback} subscription route without changing workspace, device, or authority.`,
      fallback: true,
    };
  throw new Error(`No eligible hosted route: ${capability.reason}`);
}
export function selectOpenRouterModel(input: {
  settings: OpenRouterSettings;
  role: HostedRouteRole;
  hasImages: boolean;
}): { model: string; reason: string } {
  const ordinary =
    input.role === "strategic"
      ? input.settings.strategicModel
      : input.settings.everydayModel;
  if (!input.hasImages)
    return {
      model: ordinary,
      reason: `Using the configured OpenRouter ${input.role} model.`,
    };
  if (!input.settings.attachmentModel)
    throw new Error(
      "Choose a curated OpenRouter image model in Settings before sending images.",
    );
  if (!openRouterModelAcceptsImages(input.settings.attachmentModel))
    throw new Error(
      "The saved OpenRouter image model is not currently verified for image input. Choose Kimi K3 or Qwen 3.8 Max in Settings.",
    );
  return {
    model: input.settings.attachmentModel,
    reason: `Image input uses the explicit OpenRouter image model ${input.settings.attachmentModel}.`,
  };
}
export interface OpenRouterTransport {
  complete(input: {
    apiKey: string;
    model: string;
    prompt: string;
    images: OpenRouterImageInput[];
    signal: AbortSignal;
    requestCapMicros: number;
    onProgress?: (value: { bytes: number; textDelta?: string }) => void;
  }): Promise<{
    responseId: string;
    text: string;
    promptTokens: number;
    completionTokens: number;
    costMicros: number;
  }>;
}
export type OpenRouterToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};
export type OpenRouterToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};
export type OpenRouterAgentMessage = {
  role: "user" | "assistant" | "tool";
  content: string | Array<Record<string, unknown>>;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};
export interface OpenRouterAgentTransport {
  completeTurn(input: {
    apiKey: string;
    model: string;
    messages: OpenRouterAgentMessage[];
    tools: OpenRouterToolDefinition[];
    signal: AbortSignal;
    requestCapMicros: number;
    onProgress?: (value: { bytes: number; textDelta?: string }) => void;
  }): Promise<{
    responseId: string;
    text: string;
    toolCalls: OpenRouterToolCall[];
    assistantMessage: OpenRouterAgentMessage;
    promptTokens: number;
    completionTokens: number;
    costMicros: number;
  }>;
}
type OpenRouterPartialCharge = {
  responseId?: string;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
};
function partialChargeFromUsage(
  responseId: string | undefined,
  usage: Record<string, unknown> | undefined,
): OpenRouterPartialCharge | undefined {
  if (!usage) return;
  const promptTokens = Number(usage.prompt_tokens),
    completionTokens = Number(usage.completion_tokens),
    costDollars = Number(usage.cost);
  if (
    !Number.isSafeInteger(promptTokens) ||
    promptTokens < 0 ||
    !Number.isSafeInteger(completionTokens) ||
    completionTokens < 0 ||
    !Number.isFinite(costDollars) ||
    costDollars < 0
  )
    return;
  return {
    responseId,
    promptTokens,
    completionTokens,
    costMicros: Math.round(costDollars * 1_000_000),
  };
}
function withPartialCharge(
  error: unknown,
  responseId: string | undefined,
  usage: Record<string, unknown> | undefined,
): Error & { providerPartialCharge?: OpenRouterPartialCharge } {
  const normalized =
      error instanceof Error ? error : new Error("provider_response_invalid"),
    providerPartialCharge = partialChargeFromUsage(responseId, usage);
  return Object.assign(normalized, {
    ...(providerPartialCharge ? { providerPartialCharge } : {}),
    ...(responseId ? { providerResponseId: responseId } : {}),
  });
}
function partialChargeFromError(
  error: unknown,
): OpenRouterPartialCharge | undefined {
  if (!error || typeof error !== "object") return;
  const value = Reflect.get(error, "providerPartialCharge");
  if (!value || typeof value !== "object") return;
  const charge = value as Partial<OpenRouterPartialCharge>;
  if (
    !Number.isSafeInteger(charge.promptTokens) ||
    Number(charge.promptTokens) < 0 ||
    !Number.isSafeInteger(charge.completionTokens) ||
    Number(charge.completionTokens) < 0 ||
    !Number.isSafeInteger(charge.costMicros) ||
    Number(charge.costMicros) < 0
  )
    return;
  return charge as OpenRouterPartialCharge;
}
function responseIdFromError(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  const value = Reflect.get(error, "providerResponseId");
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value)
    ? value
    : undefined;
}
export class OpenRouterBudgetGate {
  private reserved = 0;
  reserve(settings: OpenRouterSettings, summary: UsageSummary) {
    const requestCap = settings.perRequestCapMicros ?? 100_000,
      capRemaining = Math.min(
        settings.monthlyCapMicros
          ? Math.max(0, settings.monthlyCapMicros - summary.monthMicros)
          : Number.MAX_SAFE_INTEGER,
        settings.ytdCapMicros
          ? Math.max(0, settings.ytdCapMicros - summary.ytdMicros)
          : Number.MAX_SAFE_INTEGER,
      );
    if (requestCap > capRemaining - this.reserved)
      throw new Error("provider_budget_reservation_denied");
    this.reserved += requestCap;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.reserved = Math.max(0, this.reserved - requestCap);
    };
  }
}

async function readOpenRouterPayload(
  response: Response,
  onProgress?: (value: { bytes: number; textDelta?: string }) => void,
): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  if (!response.body) throw new Error("provider_response_invalid");
  const reader = response.body.getReader(),
    decoder = new TextDecoder(),
    streaming = response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("text/event-stream");
  let bytes = 0,
    buffer = "",
    responseId: string | undefined,
    content = "",
    usage: Record<string, unknown> | undefined;
  const toolCalls = new Map<
    number,
    { id: string; type: string; name: string; arguments: string }
  >();
  const accept = (value: unknown) => {
    const body = value as Record<string, unknown>,
      providerError = body.error as Record<string, unknown> | undefined;
    if (providerError)
      throw new Error(
        typeof providerError.message === "string"
          ? `provider_error:${providerError.message}`
          : "provider_response_invalid",
      );
    if (typeof body.id === "string") responseId = body.id;
    if (body.usage && typeof body.usage === "object")
      usage = body.usage as Record<string, unknown>;
    const choice = Array.isArray(body.choices)
        ? (body.choices[0] as Record<string, unknown> | undefined)
        : undefined,
      fragment =
        (choice?.message as Record<string, unknown> | undefined) ??
        (choice?.delta as Record<string, unknown> | undefined);
    if (!fragment) return;
    if (typeof fragment.content === "string") {
      content += fragment.content;
      if (streaming && fragment.content)
        onProgress?.({ bytes, textDelta: fragment.content });
    }
    const rawCalls = fragment.tool_calls;
    if (rawCalls !== undefined && !Array.isArray(rawCalls))
      throw new Error("provider_response_invalid");
    for (const [position, raw] of (rawCalls ?? []).entries()) {
      const call = raw as Record<string, unknown>,
        index = Number.isSafeInteger(call.index)
          ? Number(call.index)
          : position,
        fn = call.function as Record<string, unknown> | undefined,
        prior = toolCalls.get(index) ?? {
          id: "",
          type: "function",
          name: "",
          arguments: "",
        };
      if (typeof call.id === "string") prior.id += call.id;
      if (typeof call.type === "string") prior.type = call.type;
      if (typeof fn?.name === "string") prior.name += fn.name;
      if (typeof fn?.arguments === "string") prior.arguments += fn.arguments;
      toolCalls.set(index, prior);
    }
  };
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      onProgress?.({ bytes });
      buffer += decoder.decode(next.value, { stream: true });
      if (!streaming) continue;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          accept(JSON.parse(data));
        } catch (error) {
          if (error instanceof SyntaxError)
            throw new Error("provider_response_invalid", { cause: error });
          throw error;
        }
      }
    }
    buffer += decoder.decode();
  } catch (error) {
    throw withPartialCharge(error, responseId, usage);
  } finally {
    reader.releaseLock();
  }
  if (!streaming) {
    try {
      const value = JSON.parse(buffer);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("provider_response_invalid");
      return value as Record<string, unknown>;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message !== "provider_response_invalid"
      )
        throw new Error("provider_response_invalid", { cause: error });
      throw error;
    }
  }
  try {
    for (const line of buffer.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data && data !== "[DONE]") {
        try {
          accept(JSON.parse(data));
        } catch (error) {
          if (error instanceof SyntaxError)
            throw new Error("provider_response_invalid", { cause: error });
          throw error;
        }
      }
    }
  } catch (error) {
    throw withPartialCharge(error, responseId, usage);
  }
  return {
    id: responseId,
    choices: [
      {
        message: {
          content,
          tool_calls: [...toolCalls.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, call]) => ({
              id: call.id,
              type: call.type,
              function: { name: call.name, arguments: call.arguments },
            })),
        },
      },
    ],
    usage,
  };
}

export class FetchOpenRouterTransport implements OpenRouterTransport {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async complete(input: {
    apiKey: string;
    model: string;
    prompt: string;
    images: OpenRouterImageInput[];
    signal: AbortSignal;
    requestCapMicros: number;
    onProgress?: (value: { bytes: number; textDelta?: string }) => void;
  }) {
    const content = input.images.length
      ? [
          { type: "text", text: input.prompt },
          ...input.images.map((image) => ({
            type: "image_url",
            image_url: {
              url: `data:${image.mediaType};base64,${image.dataBase64}`,
            },
          })),
        ]
      : input.prompt;
    const response = await this.fetcher(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        signal: input.signal,
        redirect: "error",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
          "x-title": "Waypoint",
        },
        body: JSON.stringify({
          model: input.model,
          messages: [{ role: "user", content }],
          stream: true,
          provider: {
            data_collection: "deny",
            zdr: true,
          },
          stream_options: { include_usage: true },
          usage: { include: true },
        }),
      },
    );
    const body = await readOpenRouterPayload(response, input.onProgress);
    try {
      const choices = body.choices,
        usage = body.usage as Record<string, unknown> | undefined,
        choice = Array.isArray(choices)
          ? (choices[0] as Record<string, unknown> | undefined)
          : undefined,
        message = choice?.message as Record<string, unknown> | undefined,
        text = message?.content;
      if (typeof body.id !== "string" || typeof text !== "string" || !usage)
        throw new Error("provider_response_invalid");
      const promptTokens = Number(usage.prompt_tokens),
        completionTokens = Number(usage.completion_tokens),
        costDollars = Number(usage.cost);
      if (!Number.isFinite(costDollars) || costDollars < 0)
        throw new Error("provider_cost_unavailable");
      return {
        responseId: body.id,
        text,
        promptTokens,
        completionTokens,
        costMicros: Math.round(costDollars * 1_000_000),
      };
    } catch (error) {
      throw withPartialCharge(
        error,
        typeof body.id === "string" ? body.id : undefined,
        body.usage as Record<string, unknown> | undefined,
      );
    }
  }
  async completeTurn(input: {
    apiKey: string;
    model: string;
    messages: OpenRouterAgentMessage[];
    tools: OpenRouterToolDefinition[];
    signal: AbortSignal;
    requestCapMicros: number;
    onProgress?: (value: { bytes: number; textDelta?: string }) => void;
  }) {
    const response = await this.fetcher(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        signal: input.signal,
        redirect: "error",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
          "x-title": "Waypoint",
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          tools: input.tools,
          tool_choice: "auto",
          parallel_tool_calls: false,
          stream: true,
          provider: {
            data_collection: "deny",
            zdr: true,
          },
          stream_options: { include_usage: true },
          usage: { include: true },
        }),
      },
    );
    const body = await readOpenRouterPayload(response, input.onProgress);
    try {
      const choices = body.choices,
        usage = body.usage as Record<string, unknown> | undefined,
        choice = Array.isArray(choices)
          ? (choices[0] as Record<string, unknown> | undefined)
          : undefined,
        message = choice?.message as Record<string, unknown> | undefined;
      if (typeof body.id !== "string" || !message || !usage)
        throw new Error("provider_response_invalid");
      const content = message.content == null ? "" : message.content;
      if (typeof content !== "string")
        throw new Error("provider_response_invalid");
      const rawCalls = message.tool_calls;
      if (rawCalls !== undefined && !Array.isArray(rawCalls))
        throw new Error("provider_response_invalid");
      const seen = new Set<string>(),
        toolCalls = (rawCalls ?? []).map((raw) => {
          const call = raw as Record<string, unknown>,
            fn = call.function as Record<string, unknown> | undefined;
          if (
            typeof call.id !== "string" ||
            !/^[A-Za-z0-9._:-]{1,200}$/.test(call.id) ||
            seen.has(call.id) ||
            call.type !== "function" ||
            !fn ||
            typeof fn.name !== "string" ||
            !/^[A-Za-z0-9_.-]{1,100}$/.test(fn.name) ||
            typeof fn.arguments !== "string"
          )
            throw new Error("provider_response_invalid");
          seen.add(call.id);
          let args: unknown;
          try {
            args = JSON.parse(fn.arguments);
          } catch {
            throw new Error("provider_response_invalid");
          }
          if (!args || typeof args !== "object" || Array.isArray(args))
            throw new Error("provider_response_invalid");
          return {
            id: call.id,
            name: fn.name,
            arguments: args as Record<string, unknown>,
          };
        });
      const promptTokens = Number(usage.prompt_tokens),
        completionTokens = Number(usage.completion_tokens),
        costDollars = Number(usage.cost);
      if (
        ![promptTokens, completionTokens].every(Number.isSafeInteger) ||
        promptTokens < 0 ||
        completionTokens < 0 ||
        !Number.isFinite(costDollars) ||
        costDollars < 0
      )
        throw new Error("provider_response_invalid");
      return {
        responseId: body.id,
        text: content,
        toolCalls,
        assistantMessage: {
          role: "assistant",
          content,
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments),
            },
          })),
        } satisfies OpenRouterAgentMessage,
        promptTokens,
        completionTokens,
        costMicros: Math.round(costDollars * 1_000_000),
      };
    } catch (error) {
      throw withPartialCharge(
        error,
        typeof body.id === "string" ? body.id : undefined,
        body.usage as Record<string, unknown> | undefined,
      );
    }
  }
}
export class OpenRouterClient {
  constructor(private readonly transport: OpenRouterTransport) {}
  async run(input: {
    workspaceId: string;
    role: HostedRouteRole;
    model: string;
    prompt: string;
    images?: OpenRouterImageInput[];
    apiKey: string;
    signal: AbortSignal;
    requestCapMicros?: number;
    now?: () => string;
  }): Promise<{ text: string; receipt: ProviderUsageReceipt }> {
    const images = input.images ?? [],
      clock = input.now ?? (() => new Date().toISOString()),
      startedAt = clock(),
      requestCapMicros = input.requestCapMicros ?? 100_000,
      attachmentDigest = images
        .map((image) => `${image.mediaType}:${image.sha256}`)
        .join("|"),
      requestDigest = createHmac("sha256", input.apiKey)
        .update(
          `${input.workspaceId}\0${input.role}\0${input.model}\0${input.prompt}\0${attachmentDigest}`,
        )
        .digest("hex");
    try {
      if (images.length > 20) throw new Error("provider_image_limit");
      let imageBytes = 0;
      for (const image of images) {
        const bytes = Buffer.from(image.dataBase64, "base64");
        imageBytes += bytes.byteLength;
        if (imageBytes > OPENROUTER_MAX_IMAGE_BYTES)
          throw new Error("provider_image_limit");
        const validated = validateAttachment(
          image.name,
          image.mediaType,
          bytes,
        );
        imageDimensions(image.mediaType, bytes);
        if (
          validated.sha256 !== image.sha256 ||
          createHash("sha256").update(bytes).digest("hex") !== image.sha256
        )
          throw new Error("provider_image_integrity");
      }
      if (images.length && !openRouterModelAcceptsImages(input.model))
        throw new Error("provider_model_not_image_capable");
      const result = await this.transport.complete({
        apiKey: input.apiKey,
        model: input.model,
        prompt: input.prompt,
        images,
        signal: input.signal,
        requestCapMicros,
      });
      const validResponseId = /^[A-Za-z0-9._:-]{1,200}$/.test(
          result.responseId,
        ),
        validUsage =
          [
            result.promptTokens,
            result.completionTokens,
            result.costMicros,
          ].every(Number.isSafeInteger) &&
          result.promptTokens >= 0 &&
          result.completionTokens >= 0 &&
          result.costMicros >= 0;
      if (!validResponseId || !validUsage)
        throw validUsage
          ? withPartialCharge(
              new Error("provider_response_invalid"),
              validResponseId ? result.responseId : undefined,
              {
                prompt_tokens: result.promptTokens,
                completion_tokens: result.completionTokens,
                cost: result.costMicros / 1_000_000,
              },
            )
          : new Error("provider_response_invalid");
      return {
        text: result.text,
        receipt: {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          provider: "openrouter",
          model: input.model,
          role: input.role,
          status: "completed",
          costMicros: result.costMicros,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          requestDigest,
          responseId: result.responseId,
          errorCode:
            result.costMicros > requestCapMicros
              ? "provider_cost_cap_exceeded"
              : undefined,
          startedAt,
          finishedAt: clock(),
        },
      };
    } catch (error) {
      if (error && typeof error === "object" && "receipt" in error) throw error;
      const canceled = input.signal.aborted,
        status = canceled ? "canceled" : "failed",
        partial = partialChargeFromError(error),
        unpricedResponseId = partial ? undefined : responseIdFromError(error);
      throw Object.assign(
        new Error(
          canceled
            ? "provider_canceled"
            : error instanceof Error
              ? error.message
              : "provider_failed",
        ),
        {
          receipt: {
            id: randomUUID(),
            workspaceId: input.workspaceId,
            provider: "openrouter",
            model: input.model,
            role: input.role,
            status,
            costMicros:
              partial?.costMicros ??
              (unpricedResponseId ? requestCapMicros : 0),
            promptTokens: partial?.promptTokens ?? 0,
            completionTokens: partial?.completionTokens ?? 0,
            requestDigest,
            responseId: partial?.responseId ?? unpricedResponseId,
            errorCode: unpricedResponseId
              ? "provider_usage_unavailable_reserved"
              : canceled
                ? "canceled"
                : "provider_failed",
            startedAt,
            finishedAt: clock(),
          } satisfies ProviderUsageReceipt,
        },
      );
    }
  }
}

export class OpenRouterAgentClient {
  constructor(private readonly transport: OpenRouterAgentTransport) {}
  async run(input: {
    workspaceId: string;
    role: HostedRouteRole;
    model: string;
    prompt: string;
    images?: OpenRouterImageInput[];
    apiKey: string;
    signal: AbortSignal;
    requestCapMicros: number;
    tools: OpenRouterToolDefinition[];
    executeTool: (call: OpenRouterToolCall) => Promise<string>;
    onToolCall?: (call: OpenRouterToolCall) => void;
    onTextDelta?: (text: string) => void;
    now?: () => string;
  }): Promise<{
    text: string;
    receipt: ProviderUsageReceipt;
    toolCalls: number;
  }> {
    const clock = input.now ?? (() => new Date().toISOString()),
      startedAt = clock(),
      images = input.images ?? [],
      attachmentDigest = images
        .map((image) => `${image.mediaType}:${image.sha256}`)
        .join("|"),
      requestDigest = createHmac("sha256", input.apiKey)
        .update(
          `${input.workspaceId}\0${input.role}\0${input.model}\0${input.prompt}\0${attachmentDigest}`,
        )
        .digest("hex");
    let costMicros = 0,
      promptTokens = 0,
      completionTokens = 0,
      responseId: string | undefined,
      toolCallCount = 0,
      turnCount = 0,
      assistantText = "";
    try {
      if (input.signal.aborted) throw new Error("provider_canceled");
      if (images.length > 20) throw new Error("provider_image_limit");
      let imageBytes = 0;
      for (const image of images) {
        const bytes = Buffer.from(image.dataBase64, "base64");
        imageBytes += bytes.byteLength;
        if (imageBytes > OPENROUTER_MAX_IMAGE_BYTES)
          throw new Error("provider_image_limit");
        const validated = validateAttachment(
          image.name,
          image.mediaType,
          bytes,
        );
        imageDimensions(image.mediaType, bytes);
        if (
          validated.sha256 !== image.sha256 ||
          createHash("sha256").update(bytes).digest("hex") !== image.sha256
        )
          throw new Error("provider_image_integrity");
      }
      if (images.length && !openRouterModelAcceptsImages(input.model))
        throw new Error("provider_model_not_image_capable");
      const content: OpenRouterAgentMessage["content"] = images.length
          ? [
              { type: "text", text: input.prompt },
              ...images.map((image) => ({
                type: "image_url",
                image_url: {
                  url: `data:${image.mediaType};base64,${image.dataBase64}`,
                },
              })),
            ]
          : input.prompt,
        messages: OpenRouterAgentMessage[] = [{ role: "user", content }];
      for (;;) {
        turnCount += 1;
        if (turnCount > OPENROUTER_MAX_AGENT_TURNS)
          throw new Error("provider_agent_turn_limit");
        const remaining = input.requestCapMicros - costMicros;
        if (remaining < 1) throw new Error("provider_cost_cap_exceeded");
        let streamedText = "";
        const result = await this.transport.completeTurn({
          apiKey: input.apiKey,
          model: input.model,
          messages,
          tools: input.tools,
          signal: input.signal,
          requestCapMicros: remaining,
          onProgress: (progress) => {
            if (progress.textDelta) {
              streamedText += progress.textDelta;
              input.onTextDelta?.(progress.textDelta);
            }
          },
        });
        if (!streamedText && result.text) input.onTextDelta?.(result.text);
        assistantText += streamedText || result.text;
        responseId = result.responseId;
        costMicros += result.costMicros;
        promptTokens += result.promptTokens;
        completionTokens += result.completionTokens;
        messages.push(result.assistantMessage);
        if (!result.toolCalls.length) {
          if (!result.text.trim()) throw new Error("provider_response_invalid");
          return {
            text: assistantText || result.text,
            toolCalls: toolCallCount,
            receipt: {
              id: randomUUID(),
              workspaceId: input.workspaceId,
              provider: "openrouter",
              model: input.model,
              role: input.role,
              status: "completed",
              costMicros,
              promptTokens,
              completionTokens,
              requestDigest,
              responseId,
              errorCode:
                costMicros > input.requestCapMicros
                  ? "provider_cost_cap_exceeded"
                  : undefined,
              startedAt,
              finishedAt: clock(),
            },
          };
        }
        if (costMicros > input.requestCapMicros)
          throw new Error("provider_cost_cap_exceeded");
        if (
          toolCallCount + result.toolCalls.length >
          OPENROUTER_MAX_AGENT_TOOL_CALLS
        )
          throw new Error("provider_agent_tool_call_limit");
        for (const call of result.toolCalls) {
          toolCallCount += 1;
          input.onToolCall?.(call);
          const output = await input.executeTool(call);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: output,
          });
        }
      }
    } catch (error) {
      const partial = partialChargeFromError(error);
      if (partial) {
        costMicros += partial.costMicros;
        promptTokens += partial.promptTokens;
        completionTokens += partial.completionTokens;
        responseId = partial.responseId ?? responseId;
      }
      const unpricedResponseId = partial
        ? undefined
        : responseIdFromError(error);
      if (unpricedResponseId) {
        costMicros += Math.max(0, input.requestCapMicros - costMicros);
        responseId = unpricedResponseId;
      }
      const canceled =
          input.signal.aborted ||
          (error instanceof Error && error.message === "provider_canceled"),
        errorCode = unpricedResponseId
          ? "provider_usage_unavailable_reserved"
          : canceled
            ? "canceled"
            : error instanceof Error
              ? error.message
              : "provider_failed",
        receipt: ProviderUsageReceipt = {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          provider: "openrouter",
          model: input.model,
          role: input.role,
          status: canceled ? "canceled" : "failed",
          costMicros,
          promptTokens,
          completionTokens,
          requestDigest,
          responseId,
          errorCode,
          startedAt,
          finishedAt: clock(),
        };
      throw Object.assign(
        new Error(canceled ? "provider_canceled" : errorCode),
        { receipt },
      );
    }
  }
}
