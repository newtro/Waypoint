import { createHash } from "node:crypto";

export const WEBHOOK_CONNECTOR_IDS = [
  "generic",
  "github",
  "azure_devops",
  "stripe",
  "resend",
] as const;
export type WebhookConnectorId = (typeof WEBHOOK_CONNECTOR_IDS)[number];
export type WebhookAuthMode =
  | "waypoint_hmac"
  | "basic"
  | "github_hmac"
  | "bearer"
  | "stripe_hmac"
  | "svix_hmac";
export type WebhookScalar = string | number | boolean | null;
export type NormalizedWebhookEvent = {
  version: 1;
  connectorId: WebhookConnectorId;
  sourceEventId: string;
  eventType: string;
  occurredAt: string;
  payload: Record<string, WebhookScalar>;
};

export const WEBHOOK_CONNECTORS: ReadonlyArray<{
  id: WebhookConnectorId;
  label: string;
  authMode: WebhookAuthMode;
  provisioning: "cli" | "api_or_manual" | "manual";
  publicHttpsRequired: boolean;
  available: boolean;
  readiness: string;
}> = [
  { id: "generic", label: "Generic signed HTTP", authMode: "waypoint_hmac", provisioning: "manual", publicHttpsRequired: false, available: true, readiness: "Use the generated Waypoint HMAC sender settings. Bearer authentication is not selectable in this build." },
  { id: "github", label: "GitHub", authMode: "github_hmac", provisioning: "cli", publicHttpsRequired: true, available: true, readiness: "Requires a public trusted HTTPS endpoint and an authenticated GitHub CLI for automatic setup." },
  { id: "azure_devops", label: "Azure DevOps", authMode: "basic", provisioning: "cli", publicHttpsRequired: true, available: true, readiness: "Requires a public trusted HTTPS endpoint and an authenticated Azure DevOps CLI context." },
  { id: "stripe", label: "Stripe", authMode: "stripe_hmac", provisioning: "api_or_manual", publicHttpsRequired: true, available: false, readiness: "Unavailable in this build: provider-issued signing-secret import is not implemented, so Waypoint will not create a misleading active endpoint." },
  { id: "resend", label: "Resend", authMode: "svix_hmac", provisioning: "api_or_manual", publicHttpsRequired: true, available: false, readiness: "Unavailable in this build: provider-issued signing-secret import is not implemented, so Waypoint will not create a misleading active endpoint." },
] as const;

const EVENT = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SECRET_KEY = /authorization|cookie|password|secret|token|signature|credential/i;

export function webhookConnector(value: unknown): WebhookConnectorId {
  const id = String(value ?? "generic");
  if (!(WEBHOOK_CONNECTOR_IDS as readonly string[]).includes(id))
    throw new Error("Unsupported webhook connector");
  return id as WebhookConnectorId;
}

export function defaultWebhookAuth(connectorId: WebhookConnectorId): WebhookAuthMode {
  return WEBHOOK_CONNECTORS.find((item) => item.id === connectorId)!.authMode;
}

function iso(value: unknown, fallback: Date): string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback.toISOString();
}

function flatten(value: unknown, prefix = "", output: Record<string, WebhookScalar> = {}): Record<string, WebhookScalar> {
  if (Object.keys(output).length >= 48) return output;
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    if (prefix && !SECRET_KEY.test(prefix)) {
      const scalar = typeof value === "string" ? value.slice(0, 512) : value;
      if (typeof scalar !== "number" || Number.isFinite(scalar)) output[prefix.slice(0, 120)] = scalar as WebhookScalar;
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < Math.min(value.length, 8); index++) flatten(value[index], `${prefix}.${index}`.replace(/^\./, ""), output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      if (SECRET_KEY.test(key)) continue;
      flatten(child, `${prefix}.${key}`.replace(/^\./, ""), output);
      if (Object.keys(output).length >= 48) break;
    }
  }
  return output;
}

function json(body: Uint8Array): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(body).toString("utf8")); } catch { throw new Error("Webhook body must be valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Webhook body must be a JSON object");
  return value as Record<string, unknown>;
}

function sourceId(value: unknown, body: Uint8Array): string {
  const candidate = String(value ?? "").trim();
  if (/^[A-Za-z0-9_.:-]{8,180}$/.test(candidate)) return candidate;
  return createHash("sha256").update(body).digest("hex");
}

function eventName(connectorId: WebhookConnectorId, raw: unknown): string {
  const cleaned = String(raw ?? "event").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^[^a-z]+/, "").slice(0, 60) || "event";
  const value = `${connectorId}.${cleaned}`;
  if (!EVENT.test(value) || value.length > 80) throw new Error("Webhook event type is invalid");
  return value;
}

export function normalizeNativeWebhook(input: {
  connectorId: WebhookConnectorId;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
  receivedAt?: Date;
}): NormalizedWebhookEvent {
  const value = json(input.body), received = input.receivedAt ?? new Date();
  let rawType: unknown, rawId: unknown, occurred: unknown;
  if (input.connectorId === "azure_devops") {
    rawType = value.eventType; rawId = value.id ?? value.notificationId; occurred = value.createdDate;
  } else if (input.connectorId === "github") {
    rawType = input.headers["x-github-event"]; rawId = input.headers["x-github-delivery"]; occurred = value.created_at ?? (value.pull_request as Record<string, unknown> | undefined)?.created_at;
  } else if (input.connectorId === "stripe") {
    rawType = value.type; rawId = value.id; occurred = typeof value.created === "number" ? new Date(value.created * 1_000).toISOString() : undefined;
  } else if (input.connectorId === "resend") {
    rawType = value.type; rawId = value.id ?? input.headers["svix-id"]; occurred = value.created_at;
  } else {
    rawType = input.headers["x-waypoint-event"] ?? value.eventType ?? value.type; rawId = input.headers["x-waypoint-delivery"] ?? value.id; occurred = value.occurredAt ?? value.createdAt;
  }
  return { version: 1, connectorId: input.connectorId, sourceEventId: sourceId(rawId, input.body), eventType: eventName(input.connectorId, rawType), occurredAt: iso(occurred, received), payload: flatten(value) };
}

export type AutomationProposalDefinition = {
  version: 1;
  title: string;
  trigger: { connectorId: WebhookConnectorId; eventType: string; filters: Record<string, WebhookScalar> };
  action: { kind: "ai_prompt"; provider: "codex" | "claude"; model?: string; securityProfileId: string; instruction: string; maxDurationMs: number };
  delivery: { channelId?: string; endpoint?: string; reachability: "public_relay" | "local_network" | "not_configured" };
  provisioning: { mode: "az_devops_invoke" | "gh_cli" | "provider_api" | "manual"; organization?: string; project?: string; repository?: string; targetBranch?: string; projectId?: string; repositoryId?: string; repositoryFullName?: string; commandPreview?: string };
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function validateAutomationProposal(value: unknown): AutomationProposalDefinition {
  const object = proposalObject(value, "Automation proposal");
  exactKeys(object, ["version", "title", "trigger", "action", "delivery", "provisioning"], "Automation proposal");
  if (object.version !== 1) throw new Error("Automation proposal version is invalid");
  const title = proposalString(object.title, "Automation proposal title", 160);
  const trigger = proposalObject(object.trigger, "Automation trigger");
  exactKeys(trigger, ["connectorId", "eventType", "filters"], "Automation trigger");
  const connectorId = webhookConnector(trigger.connectorId), eventType = proposalString(trigger.eventType, "Automation event type", 80);
  if (!EVENT.test(eventType) || !eventType.startsWith(`${connectorId}.`)) throw new Error("Automation trigger is invalid");
  const rawFilters = proposalObject(trigger.filters, "Automation filters");
  if (Object.keys(rawFilters).length > 20) throw new Error("Automation filters are invalid");
  const filters: Record<string, WebhookScalar> = {};
  for (const [key, scalar] of Object.entries(rawFilters)) {
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(key) || SECRET_KEY.test(key) || !(scalar === null || ["string", "number", "boolean"].includes(typeof scalar)) || typeof scalar === "string" && scalar.length > 512 || typeof scalar === "number" && !Number.isFinite(scalar)) throw new Error("Automation filters are invalid");
    filters[key] = scalar as WebhookScalar;
  }
  const action = proposalObject(object.action, "Automation action");
  exactKeys(action, ["kind", "provider", "model", "securityProfileId", "instruction", "maxDurationMs"], "Automation action", ["model"]);
  if (action.kind !== "ai_prompt" || !["codex", "claude"].includes(String(action.provider)) || !Number.isSafeInteger(action.maxDurationMs) || Number(action.maxDurationMs) < 5_000 || Number(action.maxDurationMs) > 120_000) throw new Error("Automation action is invalid");
  const provider = action.provider as "codex" | "claude", securityProfileId = proposalString(action.securityProfileId, "Automation security profile", 128), instruction = proposalString(action.instruction, "Automation instruction", 20_000), model = optionalProposalString(action.model, "Automation model", 160);
  const delivery = proposalObject(object.delivery, "Automation delivery");
  exactKeys(delivery, ["channelId", "endpoint", "reachability"], "Automation delivery", ["channelId", "endpoint"]);
  const reachability = String(delivery.reachability);
  if (!["public_relay", "local_network", "not_configured"].includes(reachability)) throw new Error("Automation delivery is invalid");
  const channelId = optionalProposalString(delivery.channelId, "Automation channel ID", 128), endpoint = optionalProposalString(delivery.endpoint, "Automation endpoint", 2_048);
  if (Boolean(channelId) !== Boolean(endpoint) || reachability === "not_configured" && (channelId || endpoint) || reachability !== "not_configured" && (!channelId || !endpoint) || channelId && !/^[A-Za-z0-9_-]{16,128}$/.test(channelId)) throw new Error("Automation delivery is invalid");
  if (endpoint) {
    let parsed: URL;
    try { parsed = new URL(endpoint); } catch { throw new Error("Automation endpoint is invalid"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.pathname.endsWith(`/${channelId}`) || !/^\/v1\/(?:hooks|native-hooks)\/[A-Za-z0-9_-]{16,128}$/.test(parsed.pathname)) throw new Error("Automation endpoint is invalid");
  }
  const provisioning = proposalObject(object.provisioning, "Automation provisioning");
  exactKeys(provisioning, ["mode", "organization", "project", "repository", "targetBranch", "projectId", "repositoryId", "repositoryFullName", "commandPreview"], "Automation provisioning", ["organization", "project", "repository", "targetBranch", "projectId", "repositoryId", "repositoryFullName", "commandPreview"]);
  const mode = String(provisioning.mode);
  if (!["az_devops_invoke", "gh_cli", "provider_api", "manual"].includes(mode) || connectorId === "azure_devops" && mode !== "az_devops_invoke" || connectorId === "github" && mode !== "gh_cli" || (connectorId === "stripe" || connectorId === "resend") && mode !== "provider_api" || connectorId === "generic" && mode !== "manual") throw new Error("Automation provisioning is invalid");
  const result: AutomationProposalDefinition = { version: 1, title, trigger: { connectorId, eventType, filters }, action: { kind: "ai_prompt", provider, securityProfileId, instruction, maxDurationMs: Number(action.maxDurationMs) }, delivery: { reachability: reachability as AutomationProposalDefinition["delivery"]["reachability"] }, provisioning: { mode: mode as AutomationProposalDefinition["provisioning"]["mode"] } };
  if (model) result.action.model = model;
  if (channelId && endpoint) { result.delivery.channelId = channelId; result.delivery.endpoint = endpoint; }
  for (const [key, maximum] of [["organization", 500], ["project", 300], ["repository", 500], ["targetBranch", 300], ["projectId", 160], ["repositoryId", 160], ["repositoryFullName", 500], ["commandPreview", 2_000]] as const) {
    const item = optionalProposalString(provisioning[key], `Automation ${key}`, maximum);
    if (item) result.provisioning[key] = item;
  }
  return result;
}

function proposalObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} is invalid`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], field: string, optional: string[] = []): void {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || allowed.some((key) => !optional.includes(key) && !keys.includes(key))) throw new Error(`${field} is invalid: unsupported fields`);
}

function proposalString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || Array.from(value).some((character) => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)))) throw new Error(`${field} is invalid`);
  return value.trim();
}

function optionalProposalString(value: unknown, field: string, maximum: number): string | undefined {
  return value === undefined ? undefined : proposalString(value, field, maximum);
}

export function automationProposalDigest(value: AutomationProposalDefinition): string {
  return createHash("sha256").update(canonical(validateAutomationProposal(value))).digest("hex");
}

export function proposalConfirmationPrompt(value: AutomationProposalDefinition): string {
  const model = value.action.model ? `${value.action.provider} / ${value.action.model}` : `${value.action.provider} default`;
  return `Approve “${value.title}”? ${value.trigger.connectorId} ${value.trigger.eventType} will start a bounded ${model} run using security profile ${value.action.securityProfileId}. External provisioning does not run until approval.`;
}
