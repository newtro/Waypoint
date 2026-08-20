import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as acp from "@agentclientprotocol/sdk";
import {
  cliExecutionEnvironment,
  cliCompatibility,
  cliProcessInvocation,
  parseCliVersion,
  resolveExecutable,
} from "../../spikes/cli-capabilities.js";
import {
  validateRequest,
  type ExecutionEvent,
  type RunningExecution,
  type RunRequest,
} from "./ai-workbench.js";
import type {
  CodexApprovalRequest,
  CodexProviderDecision,
} from "./codex-app-server.js";
import { terminateCodexProcessTree } from "./codex-app-server.js";
import { redactToolText } from "./tool-gateway.js";
import {
  automationProposalInputSchema,
  automationReceiverPrerequisite,
  automationReceiverQuestion,
} from "./automation-ai-tool.js";
import { runScopedOwnershipContent } from "./run-scoped-attachment-cleanup.js";

type JsonObject = Record<string, unknown>;
type AcpSchemaModule = Pick<
  typeof import("../../node_modules/@agentclientprotocol/sdk/dist/schema/zod.gen.js"),
  | "zCancelRequestNotification"
  | "zRequestPermissionRequest"
  | "zSessionNotification"
>;
const runtimeRequire = createRequire(import.meta.url),
  acpSchemaPath = path.join(
    path.dirname(runtimeRequire.resolve("@agentclientprotocol/sdk")),
    "schema",
    "zod.gen.js",
  ),
  {
    zCancelRequestNotification,
    zRequestPermissionRequest,
    zSessionNotification,
  } = runtimeRequire(acpSchemaPath) as AcpSchemaModule;
type SpawnProcess = (
  file: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    windowsHide: true;
    detached: boolean;
  },
) => ChildProcessWithoutNullStreams;
type InvocationResolver = typeof cliProcessInvocation;
type TreeTerminator = typeof terminateCodexProcessTree;
type SubscriptionVerifier = (
  executable: string,
  environment: NodeJS.ProcessEnv,
  signal: AbortSignal,
) => Promise<GrokSubscriptionStatus>;
type InventoryVerifier = (
  executable: string,
  environment: NodeJS.ProcessEnv,
  cwd: string,
  signal: AbortSignal,
) => Promise<GrokInventory>;

interface GrokInventory {
  skills: Array<{
    name: string;
    userInvocable: boolean;
    compatibilityStatus?: string;
  }>;
  mcpServerNames: string[];
}

interface GrokAutomationIsolation {
  home: string;
  root: string;
  authPath: string;
}

type IsolationFactory = (
  environment: NodeJS.ProcessEnv,
) => GrokAutomationIsolation;

const GROK_AUTOMATION_HOME_PREFIX = "waypoint-grok-automate-home-",
  GROK_AUTOMATION_ROOT_PREFIX = "waypoint-grok-automate-root-",
  GROK_AUTOMATION_SERVER_ID = "waypoint-automation",
  GROK_AUTOMATION_SERVER_NAME = "waypoint",
  GROK_AUTOMATION_TOOL = "waypoint__automation_proposal",
  GROK_AUTOMATION_SEARCH_TOOL = "waypoint__search_tool",
  GROK_AUTOMATION_MARKER = ".waypoint-grok-automation.json",
  GROK_MODEL_ID = /^[A-Za-z0-9._:-]{1,100}$/;

export interface GrokRunRequest extends Omit<RunRequest, "cli"> {
  cli: "grok";
  providerSessionId?: string;
  requiredSkillIdentifier?: string;
  isolatedNoTools?: boolean;
  loadProviderHistory?: boolean;
  onSession: (providerSessionId: string) => void;
  onApproval: (
    request: CodexApprovalRequest,
    signal: AbortSignal,
  ) => Promise<CodexProviderDecision>;
  beforeTurn?: () => void;
  onAutomationProposal?: (
    definition: Record<string, unknown>,
  ) => Promise<{ proposalId: string; status: string; summary?: string }>;
}

export interface GrokSubscriptionStatus {
  signedIn: true;
  defaultModel?: string;
  models: string[];
  rawSummary: string;
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value)
    throw new Error(`Grok ACP ${field} is invalid`);
}

function assertSafeProviderSessionId(value: unknown): asserts value is string {
  assertString(value, "provider session ID");
  if (
    value.length > 1_024 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    }) ||
    redactToolText(value) !== value
  )
    throw new Error("Grok ACP provider session ID is unsafe");
}

function assertAuditableShape(value: unknown, depth = 0): void {
  if (typeof value === "string" || value == null) return;
  if (depth >= 8)
    throw new Error("Grok ACP permission detail exceeds audit depth");
  if (Array.isArray(value)) {
    if (value.length > 200)
      throw new Error("Grok ACP permission detail exceeds audit size");
    for (const item of value) assertAuditableShape(item, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 200)
      throw new Error("Grok ACP permission detail exceeds audit size");
    for (const [, item] of entries) assertAuditableShape(item, depth + 1);
    return;
  }
  if (depth + 1 >= 8)
    throw new Error("Grok ACP permission detail exceeds audit depth");
}

function canonicalProtocolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalProtocolValue);
  if (value && typeof value === "object") {
    const result = Object.create(null) as JsonObject;
    for (const key of Object.keys(value as JsonObject).sort()) {
      const item = (value as JsonObject)[key];
      if (item !== undefined)
        Object.defineProperty(result, key, {
          value: canonicalProtocolValue(item),
          enumerable: true,
        });
    }
    return result;
  }
  return value;
}

function assertLosslessProtocolParse(original: unknown, parsed: unknown): void {
  if (
    JSON.stringify(canonicalProtocolValue(original)) !==
    JSON.stringify(canonicalProtocolValue(parsed))
  )
    throw new Error("Grok ACP schema normalization discarded protocol data");
}

function assertStrictToolCall(value: unknown): void {
  const call = object(value);
  if (call !== value)
    throw new Error("Grok ACP permission tool call is invalid");
  assertString(call.toolCallId, "permission tool call ID");
  for (const field of ["name", "title"])
    if (
      field in call &&
      call[field] !== null &&
      typeof call[field] !== "string"
    )
      throw new Error(`Grok ACP permission ${field} is invalid`);
  if (
    "kind" in call &&
    call.kind !== null &&
    ![
      "read",
      "edit",
      "delete",
      "move",
      "search",
      "execute",
      "think",
      "fetch",
      "switch_mode",
      "other",
    ].includes(String(call.kind))
  )
    throw new Error("Grok ACP permission tool kind is invalid");
  if (
    "status" in call &&
    call.status !== null &&
    !["pending", "in_progress", "completed", "failed"].includes(
      String(call.status),
    )
  )
    throw new Error("Grok ACP permission tool status is invalid");
  if (call.locations !== undefined && call.locations !== null) {
    if (!Array.isArray(call.locations))
      throw new Error("Grok ACP permission locations are invalid");
    for (const value of call.locations) {
      const location = object(value);
      if (location !== value)
        throw new Error("Grok ACP permission location is invalid");
      assertString(location.path, "permission location path");
      if (
        "line" in location &&
        location.line !== null &&
        (!Number.isInteger(location.line) || Number(location.line) < 0)
      )
        throw new Error("Grok ACP permission location line is invalid");
    }
  }
  if (call.content !== undefined && call.content !== null) {
    if (!Array.isArray(call.content))
      throw new Error("Grok ACP permission content is invalid");
    for (const value of call.content) {
      const content = object(value);
      if (content !== value)
        throw new Error("Grok ACP permission content item is invalid");
      if (content.type === "diff") {
        assertString(content.path, "permission diff path");
        if (typeof content.newText !== "string")
          throw new Error("Grok ACP permission diff content is invalid");
        if (
          "oldText" in content &&
          content.oldText !== null &&
          typeof content.oldText !== "string"
        )
          throw new Error("Grok ACP permission diff content is invalid");
      } else if (content.type === "terminal")
        assertString(content.terminalId, "permission terminal ID");
      else if (content.type === "content") {
        if (object(content.content) !== content.content)
          throw new Error("Grok ACP permission content block is invalid");
      } else throw new Error("Grok ACP permission content type is invalid");
    }
  }
}

function assertStrictSessionNotification(value: unknown): void {
  const params = object(value),
    update = object(params.update);
  if (params !== value || update !== params.update)
    throw new Error("Grok ACP session update is invalid");
  assertSafeProviderSessionId(params.sessionId);
  assertString(update.sessionUpdate, "session update type");
  if (
    update.sessionUpdate === "tool_call" ||
    update.sessionUpdate === "tool_call_update"
  )
    assertStrictToolCall(update);
  if (update.sessionUpdate === "available_commands_update") {
    if (!Array.isArray(update.availableCommands))
      throw new Error("Grok ACP available commands are invalid");
    for (const value of update.availableCommands) {
      const command = object(value);
      if (command !== value)
        throw new Error("Grok ACP available command is invalid");
      assertString(command.name, "available command name");
      if (typeof command.description !== "string")
        throw new Error("Grok ACP available command description is invalid");
      if (command.input !== undefined && command.input !== null) {
        const input = object(command.input);
        if (input !== command.input || typeof input.hint !== "string")
          throw new Error("Grok ACP available command input is invalid");
      }
    }
  }
}

function parseGrokMcpSdkCall(value: unknown): {
  serverId: string;
  message: JsonObject;
} {
  const params = object(value),
    message = object(params.message);
  assertString(params.serverId, "MCP server ID");
  if (
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string" ||
    !message.method
  )
    throw new Error("Grok ACP reverse MCP request is invalid");
  if ("id" in message) {
    const id = message.id;
    if (
      id !== null &&
      typeof id !== "string" &&
      (typeof id !== "number" || !Number.isFinite(id))
    )
      throw new Error("Grok ACP reverse MCP request ID is invalid");
  }
  if (
    ["initialize", "ping", "tools/list", "tools/call"].includes(
      message.method,
    ) &&
    !("id" in message)
  )
    throw new Error("Grok ACP reverse MCP request ID is missing");
  return { serverId: params.serverId, message };
}

export function validateGrokWireMessage(value: unknown): void {
  const message = object(value);
  if (message !== value || message.jsonrpc !== "2.0")
    throw new Error("Grok ACP emitted an invalid JSON-RPC message");
  if (
    "id" in message &&
    message.id !== null &&
    typeof message.id !== "string" &&
    (typeof message.id !== "number" || !Number.isFinite(message.id))
  )
    throw new Error("Grok ACP JSON-RPC ID is invalid");
  if ("method" in message) {
    assertString(message.method, "method");
    const params = object(message.params);
    if (message.method === "session/update") {
      if ("id" in message)
        throw new Error("Grok ACP session update must be a notification");
      try {
        assertStrictSessionNotification(message.params);
        const parsed = zSessionNotification.parse(params);
        assertLosslessProtocolParse(params, parsed);
      } catch (error) {
        throw new Error("Grok ACP session update schema is invalid", {
          cause: error,
        });
      }
      return;
    }
    if (message.method === "session/request_permission") {
      if (
        !("id" in message) ||
        message.id === null ||
        (typeof message.id !== "string" &&
          (typeof message.id !== "number" || !Number.isFinite(message.id)))
      )
        throw new Error("Grok ACP permission request ID is invalid");
      try {
        const rawParams = object(message.params);
        if (rawParams !== message.params)
          throw new Error("Grok ACP permission parameters are invalid");
        assertSafeProviderSessionId(rawParams.sessionId);
        assertStrictToolCall(rawParams.toolCall);
        const strictCall = object(rawParams.toolCall);
        assertAuditableShape(strictCall.rawInput);
        assertAuditableShape(strictCall.locations);
        assertAuditableShape(strictCall.content);
        if (!Array.isArray(rawParams.options) || !rawParams.options.length)
          throw new Error("Grok ACP permission options are invalid");
        const optionIds = new Set<string>();
        for (const value of rawParams.options) {
          const permissionOption = object(value);
          if (permissionOption !== value)
            throw new Error("Grok ACP permission option is invalid");
          assertString(permissionOption.optionId, "permission option ID");
          assertString(permissionOption.name, "permission option name");
          if (optionIds.has(permissionOption.optionId))
            throw new Error("Grok ACP permission option IDs are not unique");
          optionIds.add(permissionOption.optionId);
        }
        assertAuditableShape(rawParams.options);
        const parsed = zRequestPermissionRequest.parse(params);
        assertLosslessProtocolParse(params, parsed);
      } catch (error) {
        throw new Error("Grok ACP permission request schema is invalid", {
          cause: error,
        });
      }
      return;
    }
    if (message.method === "$/cancel_request") {
      if ("id" in message)
        throw new Error("Grok ACP cancellation must be a notification");
      try {
        const parsed = zCancelRequestNotification.parse(params);
        assertLosslessProtocolParse(params, parsed);
      } catch (error) {
        throw new Error("Grok ACP cancellation request schema is invalid", {
          cause: error,
        });
      }
      return;
    }
    if (message.method === "_x.ai/mcp/sdk_call") {
      if (!("id" in message) || message.id === null)
        throw new Error("Grok ACP reverse MCP request ID is missing");
      parseGrokMcpSdkCall(message.params);
      return;
    }
    if (
      message.method.startsWith("_x.ai/") ||
      [
        "x.ai/mcp/servers_updated",
        "x.ai/mcp/tools_changed",
        "x.ai/mcp/init_progress",
      ].includes(message.method)
    ) {
      if ("id" in message)
        throw new Error("Grok ACP extension request is unsupported");
      return;
    }
    throw new Error(`Grok ACP method ${message.method} is unsupported`);
  }
  if (!("id" in message) || "result" in message === "error" in message)
    throw new Error("Grok ACP response envelope is invalid");
}

function strictNdJsonStream(
  output: WritableStream<Uint8Array>,
  input: ReadableStream<Uint8Array>,
  onProtocolError: (error: Error) => void,
): acp.Stream {
  const decoder = new TextDecoder(),
    encoder = new TextEncoder();
  let buffer = "";
  const parseMessage = (line: string): unknown => {
    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(
        `Malformed Grok ACP JSON: ${error instanceof Error ? error.message : "parse failed"}`,
        { cause: error },
      );
    }
  };
  const readable = new ReadableStream({
      async start(controller) {
        const reader = input.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              const message = parseMessage(line);
              validateGrokWireMessage(message);
              controller.enqueue(message);
            }
          }
          buffer += decoder.decode();
          if (buffer.trim()) {
            const message = parseMessage(buffer);
            validateGrokWireMessage(message);
            controller.enqueue(message);
          }
          controller.close();
        } catch (error) {
          const protocolError =
            error instanceof Error
              ? error
              : new Error("Grok ACP stream validation failed");
          onProtocolError(protocolError);
          controller.error(protocolError);
        } finally {
          reader.releaseLock();
        }
      },
      cancel(reason) {
        return input.cancel(reason);
      },
    }),
    writable = new WritableStream({
      async write(message) {
        const writer = output.getWriter();
        try {
          await writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
        } finally {
          writer.releaseLock();
        }
      },
    });
  return { readable, writable } as acp.Stream;
}

function bounded(value: unknown, max = 16_000): string {
  const encoded = typeof value === "string" ? value : JSON.stringify(value),
    text = encoded ?? "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function auditValue(value: unknown, secretNames: string[], depth = 0): unknown {
  if (typeof value === "string") return redactToolText(value, secretNames);
  if (depth >= 8) return "[bounded]";
  if (Array.isArray(value))
    return value
      .slice(0, 200)
      .map((item) => auditValue(item, secretNames, depth + 1));
  if (value && typeof value === "object") {
    const result = Object.create(null) as JsonObject;
    for (const [index, [key, item]] of Object.entries(value as JsonObject)
      .slice(0, 200)
      .entries()) {
      const redacted = redactToolText(key, secretNames),
        auditableKey = Object.hasOwn(result, redacted)
          ? `${redacted}#${index}`
          : redacted;
      Object.defineProperty(result, auditableKey, {
        value: auditValue(item, secretNames, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  }
  return value;
}

function canonicalWithin(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root),
    resolvedCandidate = path.resolve(candidate),
    relative = path.relative(resolvedRoot, resolvedCandidate);
  if (
    relative !== "" &&
    (relative.startsWith("..") || path.isAbsolute(relative))
  )
    return false;
  try {
    const canonicalRoot = realpathSync.native(resolvedRoot);
    let ancestor = resolvedCandidate;
    while (!existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return false;
      ancestor = parent;
    }
    const canonicalAncestor = realpathSync.native(ancestor),
      canonicalRelative = path.relative(canonicalRoot, canonicalAncestor);
    return (
      canonicalRelative === "" ||
      (!canonicalRelative.startsWith("..") &&
        !path.isAbsolute(canonicalRelative))
    );
  } catch {
    return false;
  }
}

function declaresPathKey(key: string): boolean {
  return /^(?:paths?|files?|filepaths?|cwds?|director(?:y|ies)|destinations?|sources?|targets?|oldpaths?|newpaths?|inputpaths?|outputpaths?|roots?|workingdirector(?:y|ies))$/.test(
    key.replace(/[_ -]/g, "").toLowerCase(),
  );
}

function inputPaths(value: unknown, depth = 0): string[] {
  if (!value || typeof value !== "object") return [];
  if (depth > 6) throw new Error("Grok permission path nesting is too deep");
  if (Array.isArray(value))
    return value.flatMap((item) => inputPaths(item, depth + 1));
  const paths: string[] = [];
  for (const [key, item] of Object.entries(value as JsonObject)) {
    if (!declaresPathKey(key)) {
      if (item && typeof item === "object")
        paths.push(...inputPaths(item, depth + 1));
      continue;
    }
    if (typeof item === "string") {
      if (!item.trim()) throw new Error("Grok permission path is empty");
      paths.push(item);
      continue;
    }
    const values = Array.isArray(item) ? item : [item];
    for (const candidate of values) {
      if (typeof candidate === "string") {
        if (!candidate.trim()) throw new Error("Grok permission path is empty");
        paths.push(candidate);
      } else if (candidate && typeof candidate === "object") {
        const nested = inputPaths(candidate, depth + 1);
        if (!nested.length)
          throw new Error("Grok permission path container is invalid");
        paths.push(...nested);
      } else throw new Error("Grok permission path container is invalid");
    }
  }
  return paths;
}

function permissionToolNames(request: acp.RequestPermissionRequest): string[] {
  const input = object(request.toolCall.rawInput);
  return [
    request.toolCall.name,
    request.toolCall.title,
    input.tool_name,
    input.toolName,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function dynamicToolTarget(request: acp.RequestPermissionRequest): string {
  const input = object(request.toolCall.rawInput);
  return String(input.tool_name ?? input.toolName ?? "").trim();
}

function isDynamicToolWrapper(request: acp.RequestPermissionRequest): boolean {
  return [request.toolCall.name, request.toolCall.title].some(
    (value) => String(value ?? "").trim() === "use_tool",
  );
}

function hasClassifiableToolIdentity(
  request: acp.RequestPermissionRequest,
): boolean {
  if (isDynamicToolWrapper(request) && !dynamicToolTarget(request))
    return false;
  const named = permissionToolNames(request).length > 0,
    kind = String(request.toolCall.kind ?? "");
  return named || (kind.length > 0 && kind !== "other");
}

function isFileMutation(request: acp.RequestPermissionRequest): boolean {
  return (
    ["edit", "delete", "move"].includes(String(request.toolCall.kind)) ||
    permissionToolNames(request).some((name) =>
      /^(?:write|edit|delete|move|apply[_ -]?patch|notebook)/i.test(name),
    )
  );
}

function isNetworkTool(request: acp.RequestPermissionRequest): boolean {
  return (
    request.toolCall.kind === "fetch" ||
    permissionToolNames(request).some((name) => /web|fetch|search/i.test(name))
  );
}

function isCommandTool(request: acp.RequestPermissionRequest): boolean {
  return (
    request.toolCall.kind === "execute" ||
    permissionToolNames(request).some((name) =>
      /^(?:execute(?:[_ -]?cli[_ -]?code)?|run[_ -]?command|command|shell|terminal|bash|powershell|pwsh|cmd)$/i.test(
        name,
      ),
    )
  );
}

function hasConflictingCommandKind(
  request: acp.RequestPermissionRequest,
): boolean {
  return (
    isCommandTool(request) &&
    request.toolCall.kind !== undefined &&
    request.toolCall.kind !== null &&
    request.toolCall.kind !== "execute"
  );
}

function isMcpTool(request: acp.RequestPermissionRequest): boolean {
  return permissionToolNames(request).some(
    (name) =>
      /(?:^|[_:])mcp(?:[_:]|$)/i.test(name) ||
      /^[a-z0-9.-]+__[a-z0-9_.-]+$/i.test(name),
  );
}

function requestFingerprint(request: acp.RequestPermissionRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        toolCall: request.toolCall,
        options: request.options.map((option) => ({
          optionId: option.optionId,
          kind: option.kind,
        })),
      }),
    )
    .digest("hex");
}

function option(
  request: acp.RequestPermissionRequest,
  kinds: acp.PermissionOptionKind[],
): acp.PermissionOption | undefined {
  return request.options.find((candidate) => kinds.includes(candidate.kind));
}

function selected(optionId: string): acp.RequestPermissionResponse {
  return { outcome: { outcome: "selected", optionId } };
}

function canceled(): acp.RequestPermissionResponse {
  return { outcome: { outcome: "cancelled" } };
}

function reject(
  request: acp.RequestPermissionRequest,
): acp.RequestPermissionResponse {
  const rejected = option(request, ["reject_once", "reject_always"]);
  return rejected ? selected(rejected.optionId) : canceled();
}

function allowOnce(
  request: acp.RequestPermissionRequest,
): acp.RequestPermissionResponse {
  const allowed = option(request, ["allow_once"]);
  return allowed ? selected(allowed.optionId) : canceled();
}

export function grokExecutionEnvironment(
  executable: string,
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment = cliExecutionEnvironment(executable, source, platform),
    home = source.USERPROFILE ?? source.HOME;
  if (home) {
    environment.HOME = home;
    environment.GROK_HOME = source.GROK_HOME ?? path.join(home, ".grok");
  }
  environment.GROK_DISABLE_AUTOUPDATER = "1";
  for (const name of [
    "XAI_API_KEY",
    "GROK_API_KEY",
    "GROK_XAI_API_BASE_URL",
    "GROK_MODELS_BASE_URL",
    "GROK_MODELS_LIST_URL",
  ])
    delete environment[name];
  return environment;
}

export function grokAgentArgs(request: GrokRunRequest): string[] {
  const args: string[] = [];
  if (request.profile.approval === "never")
    args.push("--always-approve");
  else args.push("--permission-mode", "default");
  args.push(
    "--sandbox",
    request.isolatedNoTools || request.profile.filesystem === "read-only"
      ? "read-only"
      : "workspace",
  );
  if (
    request.isolatedNoTools ||
    request.profile.network !== "enabled"
  )
    args.push("--disable-web-search");
  if (!request.profile.tools.includes("subagents"))
    args.push("--no-subagents");
  if (request.isolatedNoTools) args.push("--no-memory");
  if (request.model) args.push("--model", request.model);
  args.push("agent", "--no-leader", "stdio");
  return args;
}

export function parseGrokSubscriptionStatus(
  output: string,
): GrokSubscriptionStatus {
  const normalized = output.replace(/\r/g, ""),
    signedIn = /^You are logged in with grok\.com\.$/m.test(normalized);
  if (!signedIn)
    throw new Error(
      "Grok Build is not using a signed-in grok.com subscription. Run `grok login` in a terminal, then retry.",
    );
  const defaultModel = /^Default model:\s*(\S+)\s*$/m.exec(normalized)?.[1],
    models = [
      ...normalized.matchAll(/^\s*[-*]\s+(\S+)(?:\s+\(default\))?\s*$/gm),
    ].map((match) => match[1]);
  if (!models.length || models.some((model) => !GROK_MODEL_ID.test(model)))
    throw new Error("Grok Build returned an invalid account model catalog");
  if (
    !defaultModel ||
    !GROK_MODEL_ID.test(defaultModel) ||
    !models.includes(defaultModel)
  )
    throw new Error("Grok Build returned an invalid default account model");
  return {
    signedIn: true,
    defaultModel,
    models: [...new Set(models)],
    rawSummary: normalized.trim(),
  };
}

async function verifyGrokSubscription(
  executable: string,
  environment: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<GrokSubscriptionStatus> {
  const child = spawn(executable, ["models"], {
    shell: false,
    windowsHide: true,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let output = "";
  child.stdout.on("data", (chunk: string) => (output += chunk));
  child.stderr.on("data", (chunk: string) => (output += chunk));
  const abort = () => void terminateCodexProcessTree(child, process.platform);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (signal.aborted) throw new Error("Grok subscription preflight canceled");
    if (code !== 0)
      throw new Error(output.trim() || `grok models exited with code ${code}`);
    return parseGrokSubscriptionStatus(output);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function inspectGrokConfiguration(
  executable: string,
  environment: NodeJS.ProcessEnv,
  cwd: string,
  signal: AbortSignal,
): Promise<GrokInventory> {
  const child = spawn(executable, ["inspect", "--json"], {
    cwd,
    shell: false,
    windowsHide: true,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let output = "";
  child.stdout.on("data", (chunk: string) => (output += chunk));
  child.stderr.on("data", (chunk: string) => (output += chunk));
  const abort = () => void terminateCodexProcessTree(child, process.platform);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (signal.aborted)
      throw new Error("Grok configuration preflight canceled");
    if (code !== 0)
      throw new Error(output.trim() || `grok inspect exited with code ${code}`);
    const parsed = object(JSON.parse(output) as unknown),
      skills = Array.isArray(parsed.skills) ? parsed.skills : undefined,
      mcpServers = Array.isArray(parsed.mcpServers)
        ? parsed.mcpServers
        : undefined;
    if (!skills)
      throw new Error("Grok configuration inventory omitted its skill catalog");
    if (!mcpServers)
      throw new Error("Grok configuration inventory omitted its MCP catalog");
    return {
      skills: skills.map((item) => {
        const skill = object(item);
        assertString(skill.name, "skill name");
        if (typeof skill.userInvocable !== "boolean")
          throw new Error("Grok skill inventory has invalid invocation state");
        if (
          skill.compatibilityStatus !== undefined &&
          typeof skill.compatibilityStatus !== "string"
        )
          throw new Error(
            "Grok skill inventory has invalid compatibility state",
          );
        return {
          name: skill.name,
          userInvocable: skill.userInvocable,
          ...(skill.compatibilityStatus
            ? { compatibilityStatus: skill.compatibilityStatus }
            : {}),
        };
      }),
      mcpServerNames: mcpServers.map((item) => {
        const server = object(item);
        assertString(server.name, "MCP server name");
        return server.name;
      }),
    };
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function createGrokAutomationIsolation(
  environment: NodeJS.ProcessEnv,
): GrokAutomationIsolation {
  const grokHome = environment.GROK_HOME,
    configuredAuth = environment.GROK_AUTH_PATH,
    authCandidate =
      configuredAuth ?? (grokHome ? path.join(grokHome, "auth.json") : "");
  if (!authCandidate || !existsSync(authCandidate))
    throw new Error(
      "Grok isolation could not bind the signed-in Grok authentication file",
    );
  const authPath = realpathSync.native(authCandidate),
    home = mkdtempSync(path.join(tmpdir(), GROK_AUTOMATION_HOME_PREFIX));
  try {
    const root = mkdtempSync(path.join(tmpdir(), GROK_AUTOMATION_ROOT_PREFIX));
    try {
      for (const candidate of [home, root])
        markGrokAutomationIsolationDirectory(candidate);
      return { home, root, authPath };
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  } catch (error) {
    rmSync(home, { recursive: true, force: true });
    throw error;
  }
}

function automationEnvironment(
  source: NodeJS.ProcessEnv,
  isolation: GrokAutomationIsolation,
): NodeJS.ProcessEnv {
  const root = path.parse(isolation.home).root,
    environment: NodeJS.ProcessEnv = {
      ...source,
      HOME: isolation.home,
      USERPROFILE: isolation.home,
      HOMEDRIVE: root.replace(/[\\/]$/, ""),
      HOMEPATH: isolation.home.slice(root.length - 1),
      APPDATA: path.join(isolation.home, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(isolation.home, "AppData", "Local"),
      GROK_HOME: isolation.home,
      GROK_AUTH_PATH: isolation.authPath,
      GROK_DISABLE_AUTOUPDATER: "1",
      GROK_CURSOR_SKILLS_ENABLED: "false",
      GROK_CURSOR_RULES_ENABLED: "false",
      GROK_CURSOR_AGENTS_ENABLED: "false",
      GROK_CURSOR_MCPS_ENABLED: "false",
      GROK_CURSOR_HOOKS_ENABLED: "false",
      GROK_CLAUDE_SKILLS_ENABLED: "false",
      GROK_CLAUDE_RULES_ENABLED: "false",
      GROK_CLAUDE_AGENTS_ENABLED: "false",
      GROK_CLAUDE_MCPS_ENABLED: "false",
      GROK_CLAUDE_HOOKS_ENABLED: "false",
    };
  for (const name of [
    "CLAUDE_CONFIG_DIR",
    "GROK_SKILLS_PATHS",
    "XAI_API_KEY",
    "GROK_API_KEY",
  ])
    delete environment[name];
  return environment;
}

function tomlStrings(values: Iterable<string>): string {
  return `[${[...new Set(values)]
    .sort()
    .map((value) => JSON.stringify(value))
    .join(", ")}]`;
}

function writeGrokAutomationConfig(
  isolation: GrokAutomationIsolation,
  disabledServers: Iterable<string>,
  disabledManagedConnectors: Iterable<string>,
  model?: string,
): void {
  writeFileSync(
    path.join(isolation.home, "config.toml"),
    [
      `disabled_mcp_servers = ${tomlStrings(disabledServers)}`,
      "[disabled_mcp_tools]",
      `__managed_gateway_connectors = ${tomlStrings(disabledManagedConnectors)}`,
      "[cli]",
      "auto_update=false",
      ...(model ? ["[models]", `default=${JSON.stringify(model)}`] : []),
      "[compat.claude]",
      "mcps=false",
      "hooks=false",
      "skills=false",
      "agents=false",
      "rules=false",
      "[compat.cursor]",
      "mcps=false",
      "hooks=false",
      "skills=false",
      "agents=false",
      "rules=false",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
}

function cleanupIsolation(isolation: GrokAutomationIsolation): void {
  for (const candidate of [isolation.home, isolation.root])
    try {
      rmSync(candidate, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    } catch {
      // Startup recovery removes a crash- or lock-stranded exact-prefix folder.
    }
}

export function cleanupStaleGrokAutomationDirectories(
  tempRoot = tmpdir(),
): string[] {
  const removed: string[] = [];
  let names: string[], canonicalTempRoot: string;
  try {
    canonicalTempRoot = realpathSync.native(tempRoot);
    names = readdirSync(canonicalTempRoot);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (
      !new RegExp(
        `^(?:${GROK_AUTOMATION_HOME_PREFIX}|${GROK_AUTOMATION_ROOT_PREFIX})[A-Za-z0-9_-]{6,}$`,
      ).test(name)
    )
      continue;
    const candidate = path.join(canonicalTempRoot, name);
    try {
      const stat = lstatSync(candidate);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      const resolved = realpathSync.native(candidate);
      if (path.dirname(resolved) !== canonicalTempRoot) continue;
      const marker = path.join(resolved, GROK_AUTOMATION_MARKER),
        markerStat = lstatSync(marker);
      if (
        !markerStat.isFile() ||
        markerStat.isSymbolicLink() ||
        path.dirname(realpathSync.native(marker)) !== resolved ||
        readFileSync(marker, "utf8") !==
          runScopedOwnershipContent(resolved, "grok-automation-isolation")
      )
        continue;
      rmSync(resolved, { recursive: true, force: true, maxRetries: 10 });
      removed.push(resolved);
    } catch {
      // A live foreign process or transient Windows lock may own the folder.
    }
  }
  return removed;
}

export function markGrokAutomationIsolationDirectory(directory: string): void {
  writeFileSync(
    path.join(directory, GROK_AUTOMATION_MARKER),
    runScopedOwnershipContent(directory, "grok-automation-isolation"),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

function grokNoToolsAgentProfile(): JsonObject {
  return {
    name: "waypoint-no-tools",
    description: "Isolated Waypoint metadata generation with no tools.",
    permissionMode: "default",
    toolConfig: { tools: [] },
    injectDefaultTools: false,
    discoverSkills: false,
    inheritSkills: false,
    agentsMd: false,
    skills: [],
    tools: [],
    disallowedTools: [],
    mcpServers: [],
    mcpInheritance: "none",
    hooks: {},
    userMessageTemplate: "default",
  };
}

export function grokApprovalRequest(
  request: acp.RequestPermissionRequest,
  secretNames: string[] = [],
): CodexApprovalRequest {
  const call = request.toolCall,
    kind = isFileMutation(request)
      ? "file_change"
      : isCommandTool(request)
        ? "command"
        : isNetworkTool(request)
          ? "network"
          : isMcpTool(request)
            ? "tool"
            : "permission";
  return {
    providerRequestId: `grok:${createHash("sha256").update(call.toolCallId).digest("hex")}`,
    kind,
    title: redactToolText(
      String(call.title ?? call.name ?? "Grok requests permission"),
      secretNames,
    ),
    detail: auditValue(
      {
        tool: call.name ?? call.kind ?? "unknown",
        input: call.rawInput,
        locations: call.locations ?? [],
        content: call.content ?? [],
      },
      secretNames,
    ) as JsonObject,
    options: auditValue(request.options, secretNames) as unknown[],
  };
}

export function grokUpdateEvents(
  update: acp.SessionUpdate,
  secretNames: string[] = [],
): ExecutionEvent[] {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return update.content.type === "text" && update.content.text
        ? [
            {
              type: "text",
              text: redactToolText(update.content.text, secretNames),
              rawType: "grok.agent_message_chunk",
            },
          ]
        : [];
    case "agent_thought_chunk":
      return update.content.type === "text" && update.content.text
        ? [
            {
              type: "agent",
              name: "Grok reasoning",
              text: redactToolText(update.content.text, secretNames),
              rawType: "grok.agent_thought_chunk",
            },
          ]
        : [];
    case "tool_call":
      return [
        {
          type: "tool",
          name: redactToolText(update.title, secretNames),
          text: bounded(auditValue(update.rawInput, secretNames), 8_000),
          rawType: "grok.tool_call",
          metadata: auditValue(
            {
              toolCallId: update.toolCallId,
              tool: update.name,
              kind: update.kind,
              status: update.status,
              locations: update.locations,
            },
            secretNames,
          ) as JsonObject,
        },
      ];
    case "tool_call_update":
      return [
        {
          type: "tool",
          name: redactToolText(
            update.title ?? `Grok tool ${update.status ?? "updated"}`,
            secretNames,
          ),
          text: bounded(
            auditValue(update.rawOutput ?? update.content ?? "", secretNames),
            8_000,
          ),
          rawType: "grok.tool_call_update",
          metadata: auditValue(
            {
              toolCallId: update.toolCallId,
              tool: update.name,
              kind: update.kind,
              status: update.status,
              locations: update.locations,
            },
            secretNames,
          ) as JsonObject,
        },
      ];
    case "plan":
    case "plan_update":
      return [
        {
          type: "agent",
          name: "Grok plan",
          text: bounded(auditValue(update, secretNames), 12_000),
          rawType: `grok.${update.sessionUpdate}`,
        },
      ];
    case "plan_removed":
      return [
        {
          type: "agent",
          name: "Grok plan removed",
          rawType: "grok.plan_removed",
        },
      ];
    case "available_commands_update":
      return [
        {
          type: "diagnostic",
          name: `Grok commands · ${update.availableCommands.length}`,
          rawType: "grok.available_commands_update",
          metadata: auditValue(
            { commands: update.availableCommands },
            secretNames,
          ) as JsonObject,
        },
      ];
    case "usage_update":
      return [
        {
          type: "diagnostic",
          name: `Grok context · ${update.used}/${update.size}`,
          rawType: "grok.usage_update",
          metadata: auditValue(update, secretNames) as JsonObject,
        },
      ];
    case "current_mode_update":
    case "config_option_update":
    case "session_info_update":
      return [
        {
          type: "diagnostic",
          name: `Grok ${update.sessionUpdate.replaceAll("_", " ")}`,
          rawType: `grok.${update.sessionUpdate}`,
          metadata: auditValue(update, secretNames) as JsonObject,
        },
      ];
    case "user_message_chunk":
      return [];
  }
}

export class GrokAgentWorkbench {
  private readonly active = new Map<string, RunningExecution>();
  private readonly starting = new Set<string>();

  constructor(
    private readonly spawnProcess: SpawnProcess = spawn as SpawnProcess,
    private readonly resolver = resolveExecutable,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly invocationResolver: InvocationResolver = cliProcessInvocation,
    private readonly treeTerminator: TreeTerminator = terminateCodexProcessTree,
    private readonly subscriptionVerifier: SubscriptionVerifier = verifyGrokSubscription,
    private readonly inventoryVerifier: InventoryVerifier = inspectGrokConfiguration,
    private readonly isolationFactory: IsolationFactory = createGrokAutomationIsolation,
  ) {}

  async start(
    runId: string,
    request: GrokRunRequest,
    onEvent: (event: ExecutionEvent) => void,
  ): Promise<RunningExecution> {
    validateRequest(request);
    if (request.providerSessionId)
      assertSafeProviderSessionId(request.providerSessionId);
    if (
      request.isolatedNoTools &&
      (request.onAutomationProposal ||
        request.providerSessionId ||
        request.requiredSkillIdentifier ||
        request.profile.filesystem !== "read-only" ||
        request.profile.network === "enabled" ||
        request.profile.tools.length > 0)
    )
      throw new Error(
        "Grok no-tools isolation requires a fresh read-only profile with no tools",
      );
    if (this.active.has(runId) || this.starting.has(runId))
      throw new Error("Execution is already active");
    if (this.active.size + this.starting.size >= request.profile.maxConcurrency)
      throw new Error("Execution concurrency limit reached");
    this.starting.add(runId);
    try {
      return await this.startReserved(runId, request, onEvent);
    } finally {
      this.starting.delete(runId);
    }
  }

  private async startReserved(
    runId: string,
    request: GrokRunRequest,
    onEvent: (event: ExecutionEvent) => void,
  ): Promise<RunningExecution> {
    const executable = request.executable ?? (await this.resolver("grok"));
    if (!executable)
      throw new Error(
        "Grok Build was not found in its standard install locations or PATH",
      );
    const isAbsolute =
      this.platform === "win32" ? path.win32.isAbsolute : path.isAbsolute;
    if (!isAbsolute(executable))
      throw new Error("Resolved Grok CLI path must be absolute");
    const compatibility = cliCompatibility("grok", request.version ?? "");
    if (!compatibility.compatible)
      throw new Error(
        compatibility.error ?? "Grok Build version is incompatible",
      );
    if (request.images?.length)
      throw new Error(
        "This Grok Build ACP release does not advertise image prompt support",
      );
    request.beforeSpawn?.();
    request.beforeTurn?.();
    const root = path.resolve(request.workspaceRoot),
      automationToolEnabled = Boolean(request.onAutomationProposal),
      normalEnvironment = grokExecutionEnvironment(
        executable,
        process.env,
        this.platform,
      );
    let isolation: GrokAutomationIsolation | undefined;
    if (request.isolatedNoTools) {
      isolation = this.isolationFactory(normalEnvironment);
      try {
        writeGrokAutomationConfig(isolation, [], [], request.model);
      } catch (error) {
        cleanupIsolation(isolation);
        throw error;
      }
    }
    const environment = isolation
      ? automationEnvironment(normalEnvironment, isolation)
      : normalEnvironment;
    if (request.profile.filesystem === "read-only")
      environment.GROK_WRITE_FILE = "0";
    if (request.profile.network !== "enabled")
      environment.GROK_WEB_FETCH = "0";
    const args = grokAgentArgs(request);
    let invocation: Awaited<ReturnType<InvocationResolver>>;
    try {
      invocation = await this.invocationResolver("grok", executable, args, {
        platform: this.platform,
      });
    } catch (error) {
      if (isolation) cleanupIsolation(isolation);
      throw error;
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(invocation.executable, invocation.args, {
        cwd: isolation?.root ?? root,
        env: environment,
        shell: false,
        windowsHide: true,
        detached: this.platform !== "win32",
      });
    } catch (error) {
      if (isolation) cleanupIsolation(isolation);
      throw error;
    }
    const controller = new AbortController();
    child.stderr.setEncoding("utf8");
    let stderr = "",
      canceledByUser = false,
      settled = false,
      sessionId = request.providerSessionId,
      suppressProviderHistory = false,
      automationProposalCalled = false,
      automationProposalInFlight = false,
      automationBoundaryViolation: Error | undefined,
      automationMcpReady = false,
      noToolsBoundaryViolation: Error | undefined,
      noToolsReady = false,
      automationMcpPhase: "new" | "initialized" | "listed" = "new",
      pendingNoToolsUpdates: Array<{ sessionId: string; tools: string[] }> = [],
      protocolError: Error | undefined,
      termination: Promise<void> | undefined,
      forceTimer: NodeJS.Timeout | undefined;
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });

    const processClosed = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const stream = strictNdJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
      (error) => {
        protocolError = error;
        controller.abort(error);
      },
    );
    const sessionApproved = new Set<string>();
    let resolveAutomationMcp: (() => void) | undefined,
      rejectAutomationMcp: ((error: Error) => void) | undefined,
      resolveNoTools: (() => void) | undefined,
      rejectNoTools: ((error: Error) => void) | undefined;
    const automationMcp = automationToolEnabled
      ? new Promise<void>((resolve, rejectPromise) => {
          resolveAutomationMcp = resolve;
          rejectAutomationMcp = rejectPromise;
        })
      : Promise.resolve();
    const noToolsBoundary = request.isolatedNoTools
      ? new Promise<void>((resolve, rejectPromise) => {
          resolveNoTools = resolve;
          rejectNoTools = rejectPromise;
        })
      : Promise.resolve();
    void automationMcp.catch(() => undefined);
    void noToolsBoundary.catch(() => undefined);
    const failAutomationBoundary = (error: Error) => {
      automationBoundaryViolation ??= error;
      rejectAutomationMcp?.(error);
      controller.abort(error);
    };
    const failNoToolsBoundary = (error: Error) => {
      noToolsBoundaryViolation ??= error;
      rejectNoTools?.(error);
      controller.abort(error);
    };
    controller.signal.addEventListener(
      "abort",
      () => {
        const error =
          automationBoundaryViolation ??
          new Error("Waypoint proposal bridge initialization canceled");
        rejectAutomationMcp?.(error);
        rejectNoTools?.(
          noToolsBoundaryViolation ??
            new Error("Grok no-tools boundary initialization canceled"),
        );
      },
      { once: true },
    );

    const permission = async (
      params: acp.RequestPermissionRequest,
    ): Promise<acp.RequestPermissionResponse> => {
      if (controller.signal.aborted) return canceled();
      if (!sessionId || params.sessionId !== sessionId) {
        onEvent({
          type: "diagnostic",
          name: "Grok permission denied for an unexpected session",
          rawType: "grok.permission.session_denied",
          metadata: auditValue(
            {
              expectedSessionId: sessionId,
              requestSessionId: params.sessionId,
              toolCallId: params.toolCall.toolCallId,
              name: params.toolCall.name,
              kind: params.toolCall.kind,
            },
            request.profile.secretNames,
          ) as JsonObject,
        });
        return reject(params);
      }
      try {
        request.beforeTurn?.();
      } catch {
        return reject(params);
      }
      if (automationToolEnabled) {
        const name = String(
            params.toolCall.name ?? params.toolCall.title ?? "",
          ),
          input = object(params.toolCall.rawInput),
          target = String(input.tool_name ?? input.toolName ?? "");
        if (
          name === GROK_AUTOMATION_TOOL ||
          name === GROK_AUTOMATION_SEARCH_TOOL ||
          (name === "use_tool" &&
            [GROK_AUTOMATION_TOOL, GROK_AUTOMATION_SEARCH_TOOL].includes(
              target,
            ))
        )
          return allowOnce(params);
      }
      const call = params.toolCall,
        structuredMutation = isFileMutation(params);
      let declaredPaths: string[];
      try {
        declaredPaths = [
          ...(call.locations ?? []).map((location) => location.path),
          ...(call.content ?? [])
            .filter(
              (
                content,
              ): content is Extract<acp.ToolCallContent, { type: "diff" }> =>
                content.type === "diff",
            )
            .map((content) => content.path),
          ...inputPaths(call.rawInput),
        ];
      } catch {
        onEvent({
          type: "diagnostic",
          name: "Grok permission denied by Waypoint",
          text: "The provider permission request declared an invalid structured path container.",
          rawType: "grok.permission.path_schema_denied",
          metadata: auditValue(
            { toolCallId: call.toolCallId },
            request.profile.secretNames,
          ) as JsonObject,
        });
        return reject(params);
      }
      const resolvedPaths = declaredPaths.map((candidate) =>
        path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate),
      );
      onEvent({
        type: "diagnostic",
        name: `Grok permission · ${redactToolText(String(call.name ?? call.title ?? call.kind ?? "unknown"), request.profile.secretNames)}`,
        rawType: "grok.permission.requested",
        metadata: auditValue(
          {
            toolCallId: call.toolCallId,
            name: call.name,
            kind: call.kind,
            structuredMutation,
            locations: call.locations,
            input: call.rawInput,
            options: params.options.map(({ optionId, kind }) => ({
              optionId,
              kind,
            })),
          },
          request.profile.secretNames,
        ) as JsonObject,
      });
      if (!hasClassifiableToolIdentity(params)) {
        onEvent({
          type: "diagnostic",
          name: "Grok permission denied by Waypoint",
          text: "The provider permission request did not identify a classifiable tool operation.",
          rawType: "grok.permission.identity_denied",
          metadata: auditValue(
            { toolCallId: call.toolCallId },
            request.profile.secretNames,
          ) as JsonObject,
        });
        return reject(params);
      }
      if (
        (structuredMutation && !resolvedPaths.length) ||
        resolvedPaths.some((candidate) => !canonicalWithin(candidate, root))
      ) {
        onEvent({
          type: "diagnostic",
          name: "Grok file operation denied by Waypoint",
          text: "The structured file operation did not prove an in-repository path.",
          rawType: "grok.permission.root_denied",
          metadata: auditValue(
            { toolCallId: call.toolCallId },
            request.profile.secretNames,
          ) as JsonObject,
        });
        return reject(params);
      }
      if (hasConflictingCommandKind(params)) return reject(params);
      if (
        request.profile.filesystem === "read-only" &&
        (structuredMutation || isCommandTool(params))
      )
        return reject(params);
      if (isCommandTool(params) && !request.profile.tools.includes("terminal"))
        return reject(params);
      if (request.profile.network !== "enabled" && isNetworkTool(params))
        return reject(params);
      if (!request.profile.tools.includes("mcp") && isMcpTool(params))
        return reject(params);
      const fingerprint = requestFingerprint(params);
      if (
        request.profile.approval === "never" ||
        sessionApproved.has(fingerprint)
      )
        return allowOnce(params);
      const outcome = await request.onApproval(
        grokApprovalRequest(params, request.profile.secretNames),
        controller.signal,
      );
      if (outcome.status === "canceled") return canceled();
      if (!["accepted", "accepted_session"].includes(outcome.status))
        return reject(params);
      try {
        request.beforeTurn?.();
      } catch {
        return reject(params);
      }
      if (resolvedPaths.some((candidate) => !canonicalWithin(candidate, root)))
        return reject(params);
      if (outcome.status === "accepted_session")
        sessionApproved.add(fingerprint);
      // Never return the provider's allow-always option. Waypoint session grants
      // remain bound to this exact normalized operation fingerprint.
      return allowOnce(params);
    };

    const handleAutomationMcp = async (messageValue: unknown) => {
      const message = object(messageValue),
        id = message.id ?? null,
        method = String(message.method ?? ""),
        params = object(message.params),
        response = (result: unknown): JsonObject => ({
          jsonrpc: "2.0",
          id,
          result,
        }),
        failure = (code: number, error: string): JsonObject => ({
          jsonrpc: "2.0",
          id,
          error: { code, message: error },
        });
      if (method === "initialize") {
        const version = String(params.protocolVersion ?? "");
        if (automationMcpPhase !== "new" || version !== "2025-11-25") {
          const message =
            automationMcpPhase !== "new"
              ? "Waypoint reverse MCP initialize was repeated"
              : `Unsupported Waypoint reverse MCP protocol ${version || "<missing>"}`;
          failAutomationBoundary(new Error(message));
          return failure(-32602, message);
        }
        automationMcpPhase = "initialized";
        return response({
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: "waypoint", version: "1.0.0" },
          instructions:
            "The only capability validates and prepares a pending Waypoint automation proposal. It never provisions or enables anything.",
        });
      }
      if (method === "notifications/initialized") {
        if (automationMcpPhase !== "initialized") {
          const message =
            "Waypoint reverse MCP initialized notification is out of order";
          failAutomationBoundary(new Error(message));
          return failure(-32600, message);
        }
        return response({});
      }
      if (method === "ping") {
        if (automationMcpPhase === "new") {
          const message = "Waypoint reverse MCP ping arrived before initialize";
          failAutomationBoundary(new Error(message));
          return failure(-32600, message);
        }
        return response({});
      }
      if (method === "tools/list") {
        if (automationMcpPhase !== "initialized") {
          const message = "Waypoint reverse MCP tools/list is out of order";
          failAutomationBoundary(new Error(message));
          return failure(-32600, message);
        }
        automationMcpPhase = "listed";
        automationMcpReady = true;
        resolveAutomationMcp?.();
        return response({
          tools: [
            {
              name: "search_tool",
              description:
                "Return the exact schema for the sole automation_proposal tool. This does not search any external catalog.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: { query: { type: "string" } },
              },
            },
            {
              name: "automation_proposal",
              description:
                "Validate an exact Waypoint webhook automation definition and prepare it for explicit user confirmation.",
              inputSchema: automationProposalInputSchema(),
            },
          ],
        });
      }
      if (method !== "tools/call")
        return failure(-32601, `Unsupported Waypoint MCP method ${method}`);
      if (
        automationMcpPhase !== "listed" ||
        !sessionId ||
        !automationMcpReady
      ) {
        const message =
          "Waypoint automation tool call arrived before the exact session boundary was ready";
        failAutomationBoundary(new Error(message));
        return failure(-32600, message);
      }
      if (params.name === "search_tool")
        return response({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                tools: [
                  {
                    tool_name: GROK_AUTOMATION_TOOL,
                    description:
                      "Prepare a pending Waypoint automation proposal for explicit confirmation.",
                    input_schema: automationProposalInputSchema(),
                  },
                ],
              }),
            },
          ],
        });
      if (params.name !== "automation_proposal")
        return failure(-32601, "Unknown Waypoint automation tool");
      const definition = object(object(params.arguments).definition);
      if (!Object.keys(definition).length)
        return failure(-32602, "definition must be a non-empty object");
      if (automationProposalCalled || automationProposalInFlight)
        return response({
          content: [
            {
              type: "text",
              text: "A pending Waypoint automation proposal was already prepared in this turn. No second proposal was created.",
            },
          ],
          isError: true,
        });
      automationProposalInFlight = true;
      try {
        const action = object(definition.action);
        if (action.kind === "ai_skill") {
          if (action.provider !== "grok")
            throw new Error("this Grok session can verify only Grok skills");
          const identifier = String(action.skillIdentifier ?? ""),
            inventory = await this.inventoryVerifier(
              executable,
              normalEnvironment,
              root,
              controller.signal,
            ),
            exact = inventory.skills.find((skill) => skill.name === identifier);
          if (
            !identifier ||
            !exact?.userInvocable ||
            (exact.compatibilityStatus &&
              exact.compatibilityStatus !== "enabled")
          )
            throw new Error(
              `exact Grok skill or slash command ${identifier || "<missing>"} is not in the refreshed provider inventory`,
            );
        }
        const result = await request.onAutomationProposal!(definition);
        automationProposalCalled = true;
        return response({
          content: [
            {
              type: "text",
              text:
                result.summary ??
                `Pending Waypoint automation proposal ${result.proposalId} was validated and prepared for explicit user confirmation. It is not provisioned or enabled.`,
            },
          ],
          structuredContent: result,
        });
      } catch (error) {
        const prerequisite = automationReceiverPrerequisite(error);
        if (prerequisite)
          await request.onApproval(
            automationReceiverQuestion(
              `grok-automation-receiver-${String(id)}`,
              prerequisite,
            ),
            controller.signal,
          );
        return response({
          content: [
            {
              type: "text",
              text: `Automation proposal rejected: ${redactToolText(error instanceof Error ? error.message : "validation failed", request.profile.secretNames)}. Correct the definition and call this tool again.`,
            },
          ],
          isError: true,
        });
      } finally {
        automationProposalInFlight = false;
      }
    };

    const observeNoTools = (updateSessionId: string, tools: string[]) => {
      if (!sessionId) {
        pendingNoToolsUpdates.push({ sessionId: updateSessionId, tools });
        return;
      }
      if (updateSessionId !== sessionId) {
        failNoToolsBoundary(
          new Error(
            "Grok no-tools inventory belongs to a different provider session",
          ),
        );
        return;
      }
      const exact = [...new Set(tools)].sort();
      if (exact.length === 0) {
        noToolsReady = true;
        resolveNoTools?.();
      } else
        failNoToolsBoundary(
          new Error(`Grok no-tools session exposed tools: ${exact.join(", ")}`),
        );
    };

    const app = acp
      .client({ name: "waypoint" })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) =>
        permission(params),
      )
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        if (request.isolatedNoTools) {
          const raw = object(params.update);
          if (raw.sessionUpdate === "available_commands_update") {
            const tools = object(raw._meta).tools;
            if (
              Array.isArray(tools) &&
              tools.every((tool) => typeof tool === "string")
            )
              observeNoTools(params.sessionId, tools);
          }
        }
        // Grok may publish initialization updates before session/new returns
        // the new ID. Ignore only that narrow ordering window; every update
        // after the session is bound must carry the exact durable ID.
        if (!sessionId) return;
        if (params.sessionId !== sessionId) {
          protocolError = new Error(
            "Grok emitted an update for a different provider session",
          );
          controller.abort(protocolError);
          return;
        }
        if (suppressProviderHistory) return;
        for (const event of grokUpdateEvents(
          params.update,
          request.profile.secretNames,
        ))
          onEvent(event);
      })
      .onRequest(
        "_x.ai/mcp/sdk_call",
        parseGrokMcpSdkCall,
        async ({ params }) => {
          if (
            !automationToolEnabled ||
            params.serverId !== GROK_AUTOMATION_SERVER_ID
          )
            throw new Error("Unexpected Grok reverse MCP server");
          return handleAutomationMcp(params.message);
        },
      );
    let ctx: acp.ClientContext | undefined;

    const terminate = (signal: "SIGTERM" | "SIGKILL") => {
      const next = () => this.treeTerminator(child, this.platform, signal);
      termination = termination ? termination.then(next, next) : next();
      return termination;
    };
    const stop = () => {
      if (settled) return;
      controller.abort(new Error("Grok execution canceled"));
      if (sessionId && ctx)
        void ctx
          .notify(acp.methods.agent.session.cancel, { sessionId })
          .catch(() => undefined);
      void terminate("SIGTERM");
      forceTimer ??= setTimeout(() => {
        if (!settled) void terminate("SIGKILL");
      }, 2_000);
    };

    const protocol = app.connectWith(stream, async (connected) => {
      ctx = connected;
      const initialized = await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientInfo: { name: "waypoint", title: "Waypoint", version: "0.0.9" },
        clientCapabilities: {},
      });
      const meta = object(initialized._meta),
        expectedVersion = parseCliVersion(request.version ?? "")?.join("."),
        agentVersion = String(meta.agentVersion ?? ""),
        availableModels = object(meta.modelState).availableModels,
        parsedAcpModelIds = Array.isArray(availableModels)
          ? availableModels.map((value) => object(value).modelId)
          : [];
      if (initialized.protocolVersion !== acp.PROTOCOL_VERSION)
        throw new Error(
          `Grok ACP protocol ${initialized.protocolVersion} is incompatible with Waypoint protocol ${acp.PROTOCOL_VERSION}`,
        );
      if (
        meta.grokShell !== true ||
        !expectedVersion ||
        agentVersion !== expectedVersion
      )
        throw new Error("Grok ACP executable/version provenance is invalid");
      if (
        !parsedAcpModelIds.length ||
        parsedAcpModelIds.some(
          (modelId) =>
            typeof modelId !== "string" || !GROK_MODEL_ID.test(modelId),
        )
      )
        throw new Error("Grok ACP model inventory provenance is invalid");
      const acpModelIds = parsedAcpModelIds as string[];
      if (
        !initialized.authMethods?.some((method) => method.id === "grok.com") ||
        !initialized.authMethods?.some(
          (method) => method.id === "cached_token",
        ) ||
        meta.defaultAuthMethodId !== "cached_token"
      )
        throw new Error(
          "Grok subscription authentication provenance is invalid",
        );
      const subscription = await this.subscriptionVerifier(
        executable,
        normalEnvironment,
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new Error("Grok subscription preflight canceled");
      const selectedModel = request.model ?? subscription.defaultModel;
      if (
        !selectedModel ||
        !subscription.models.includes(selectedModel) ||
        !acpModelIds.includes(selectedModel) ||
        acpModelIds.some((modelId) => !subscription.models.includes(modelId))
      )
        throw new Error(
          `Grok model ${selectedModel ?? "<default>"} is not available to both the signed-in grok.com subscription and ACP session`,
        );
      let inventory: GrokInventory | undefined;
      if (request.requiredSkillIdentifier)
        inventory = await this.inventoryVerifier(
          executable,
          normalEnvironment,
          root,
          controller.signal,
        );
      if (request.requiredSkillIdentifier) {
        const identifier = request.requiredSkillIdentifier,
          exact = inventory?.skills.find((skill) => skill.name === identifier),
          invoked = new RegExp(
            `^/${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
          ).test(request.prompt.trimStart());
        if (
          !invoked ||
          !exact?.userInvocable ||
          (exact.compatibilityStatus && exact.compatibilityStatus !== "enabled")
        )
          throw new Error(
            `Exact Grok skill or slash command ${identifier} is unavailable or was not invoked by this turn`,
          );
      }
      const sessionRoot = isolation?.root ?? root;
      if (automationToolEnabled) {
        if (meta["x.ai/mcp/sdk"] !== true)
          throw new Error(
            "The Waypoint automation proposal bridge is unavailable in this Grok release",
          );
      }
      const automationServerMeta = automationToolEnabled
        ? {
            _meta: {
              "x.ai/mcp/servers": [
                {
                  name: GROK_AUTOMATION_SERVER_NAME,
                  serverId: GROK_AUTOMATION_SERVER_ID,
                },
              ],
            },
          }
        : {};
      if (request.providerSessionId) {
        let cursor: string | undefined, exact: acp.SessionInfo | undefined;
        const seenCursors = new Set<string>();
        do {
          const listed = await ctx.request(acp.methods.agent.session.list, {
            cwd: sessionRoot,
            ...(cursor ? { cursor } : {}),
          });
          exact = listed.sessions.find(
            (candidate) => candidate.sessionId === request.providerSessionId,
          );
          if (exact) break;
          cursor = listed.nextCursor ?? undefined;
          if (cursor && seenCursors.has(cursor))
            throw new Error(
              "Grok session inventory pagination repeated a cursor",
            );
          if (cursor) seenCursors.add(cursor);
        } while (cursor);
        if (
          !exact ||
          realpathSync.native(exact.cwd) !== realpathSync.native(sessionRoot)
        )
          throw new Error(
            "Grok resume provenance is unavailable for the exact Waypoint session and repository",
          );
        if (request.loadProviderHistory) {
          suppressProviderHistory = true;
          try {
            await ctx.request(acp.methods.agent.session.load, {
              sessionId: request.providerSessionId,
              cwd: sessionRoot,
              mcpServers: [],
              ...automationServerMeta,
            });
          } finally {
            suppressProviderHistory = false;
          }
        } else
          await ctx.request(acp.methods.agent.session.resume, {
            sessionId: request.providerSessionId,
            cwd: sessionRoot,
            mcpServers: [],
            ...automationServerMeta,
          });
      } else {
        const created = await ctx.request(acp.methods.agent.session.new, {
          cwd: sessionRoot,
          mcpServers: [],
          ...(request.isolatedNoTools
            ? { _meta: { agentProfile: grokNoToolsAgentProfile() } }
            : automationServerMeta),
        });
        assertSafeProviderSessionId(created.sessionId);
        sessionId = created.sessionId;
        if (request.isolatedNoTools) {
          const pending = pendingNoToolsUpdates;
          pendingNoToolsUpdates = [];
          for (const update of pending)
            observeNoTools(update.sessionId, update.tools);
          if (noToolsBoundaryViolation) throw noToolsBoundaryViolation;
        }
        request.onSession(sessionId);
      }
      if (automationToolEnabled) {
        await automationMcp;
        if (!automationMcpReady)
          throw new Error(
            "The Waypoint automation proposal bridge did not become ready",
          );
      } else if (request.isolatedNoTools) {
        await noToolsBoundary;
        if (!noToolsReady)
          throw new Error("Grok no-tools boundary did not become ready");
      }
      request.beforeTurn?.();
      onEvent({
        type: "diagnostic",
        name: `Grok ${agentVersion} · ${request.model ?? subscription.defaultModel ?? "CLI default"}`,
        text: `${Array.isArray(availableModels) ? availableModels.length : subscription.models.length} signed-in models · ACP ${initialized.protocolVersion}`,
        rawType: "grok.system.init",
        metadata: {
          sessionId,
          resumed: Boolean(request.providerSessionId),
          model: request.model ?? subscription.defaultModel,
        },
      });
      if (!sessionId) throw new Error("Grok ACP session ID is unavailable");
      return ctx.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: request.prompt }],
      });
    });

    const completion: RunningExecution["completion"] = (async () => {
      try {
        const result = await Promise.race([
          protocol.then((response) => ({ kind: "prompt" as const, response })),
          processClosed.then((code) => ({ kind: "process" as const, code })),
        ]);
        if (result.kind === "process")
          throw new Error(
            redactToolText(
              stderr.trim() ||
                `Grok ACP agent exited before the turn completed (code ${result.code})`,
              request.profile.secretNames,
            ),
          );
        if (protocolError) throw protocolError;
        if (automationBoundaryViolation) throw automationBoundaryViolation;
        const providerCanceled = result.response.stopReason === "cancelled";
        if (!providerCanceled && result.response.stopReason !== "end_turn")
          throw new Error(`Grok stopped with ${result.response.stopReason}`);
        return {
          status:
            canceledByUser || providerCanceled
              ? ("canceled" as const)
              : ("completed" as const),
          exitCode: 0,
        };
      } catch (error) {
        return {
          status: canceledByUser ? ("canceled" as const) : ("failed" as const),
          exitCode: null,
          error:
            error instanceof Error
              ? redactToolText(error.message, request.profile.secretNames)
              : "Grok ACP execution failed",
        };
      } finally {
        settled = true;
        if (forceTimer) clearTimeout(forceTimer);
        controller.abort();
        this.active.delete(runId);
        try {
          if (termination) await termination;
          else if (!child.killed) await terminate("SIGTERM");
        } finally {
          if (isolation) cleanupIsolation(isolation);
        }
      }
    })();
    const running: RunningExecution = {
      executable,
      version: request.version,
      args,
      cancel: () => {
        canceledByUser = true;
        stop();
      },
      completion,
    };
    this.active.set(runId, running);
    return running;
  }

  cancel(runId: string): boolean {
    const running = this.active.get(runId);
    if (!running) return false;
    running.cancel();
    return true;
  }

  async cancelAndWait(runId: string): Promise<boolean> {
    const running = this.active.get(runId);
    if (!running) return false;
    running.cancel();
    await running.completion;
    return true;
  }

  cancelAll(): void {
    for (const running of this.active.values()) running.cancel();
  }

  async shutdown(graceMs = 2_500): Promise<void> {
    const completions = [...this.active.values()].map((run) => run.completion);
    this.cancelAll();
    if (completions.length)
      await Promise.race([
        Promise.allSettled(completions),
        new Promise<void>((resolve) => setTimeout(resolve, graceMs)),
      ]);
  }
}
