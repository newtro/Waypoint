import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  browserArguments,
  createBrowserNetworkGate,
  type BrowserAction,
  type BrowserProfileMode,
} from "./agent-browser.js";

export const TOOL_GATEWAY_VERSION = 1,
  MAX_OUTPUT_BYTES = 262_144,
  MAX_READ_BYTES = 262_144,
  MAX_WRITE_BYTES = 262_144,
  MAX_LIST_ENTRIES = 500,
  MAX_SEARCH_MATCHES = 200,
  MAX_SEARCH_VISITS = 5_000,
  MAX_SEARCH_BYTES = 10_485_760,
  MAX_SEARCH_DEPTH = 32,
  MAX_SEARCH_MS = 100;
export type ToolOrigin = "ui" | "ai";
export type ToolStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "timed_out"
  | "denied";
export interface ToolGatewayPolicy {
  profileName: string;
  roots: string[];
  denyPatterns: string[];
  stopped: boolean;
  secretNames: string[];
  maxDurationMs: number;
  maxConcurrency: number;
  suppressCommit: boolean;
  suppressPush: boolean;
  webFetchEnabled?: boolean;
  webSearchEnabled?: boolean;
  browserExecutable?: string;
  browserBrowserExecutable?: string;
  browserNetworkLockdownScript?: string;
  browserProfileMode?: BrowserProfileMode;
  browserProfileName?: string;
  browserAllowedDomains?: string[];
  browserSessionName?: string;
  browserHomeDir?: string;
}
export interface ToolRequest {
  version: 1;
  workspaceId: string;
  origin: ToolOrigin;
  tool:
    | "workspace.list_files"
    | "workspace.read_file"
    | "workspace.search"
    | "workspace.write_file"
    | "terminal.run"
    | "local_cli.run"
    | "web.search"
    | "web.fetch"
    | "agent_browser.run"
    | "waypoint.command";
  arguments: Record<string, unknown>;
}
export interface ToolReceipt {
  id: string;
  version: 1;
  workspaceId: string;
  chatId?: string;
  origin: ToolOrigin;
  tool: ToolRequest["tool"];
  capabilityVersion: string;
  device: "local";
  profileName: string;
  policyDigest: string;
  status: ToolStatus;
  summary: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  outputBytes: number;
  truncated: boolean;
  code?: string;
  notification?: string;
  rollbackRef?: string;
}
export interface ToolProgress {
  runId: string;
  workspaceId: string;
  chatId?: string;
  tool: ToolRequest["tool"];
  sequence: number;
  type: "started" | "progress" | "completed" | "failed" | "canceled";
  summary: string;
  output?: string;
  createdAt: string;
}
export interface ToolResult {
  receipt: ToolReceipt;
  output?: string;
  value?: unknown;
}
export interface ToolFailurePreflight {
  id: string;
  errorClass: string;
  remediation?: string;
  expiresAt: string;
}
export interface ToolGatewayHooks {
  domain(
    workspaceId: string,
    command: string,
    input: Record<string, unknown>,
    origin: ToolOrigin,
  ): Promise<{ value: unknown; summary: string; rollbackRef?: string }>;
  web?(
    request: ToolRequest,
    signal: AbortSignal,
  ): Promise<{ output: string; summary: string; value?: unknown }>;
  browser?(workspaceId:string,action:BrowserAction,workspaceRoot:string,signal:AbortSignal):Promise<{output?:string;summary:string;value?:unknown}>;
  progress(event: ToolProgress): void;
  complete(result: ToolResult): void;
  preflight?(request: ToolRequest): ToolFailurePreflight | undefined;
  learn?(
    request: ToolRequest,
    result: ToolResult,
    overrideReason?: string,
    remediation?: string,
  ): void;
}
type Spawn = (
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
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const TOOLS = [
  "workspace.list_files",
  "workspace.read_file",
  "workspace.search",
  "workspace.write_file",
  "terminal.run",
  "local_cli.run",
  "web.search",
  "web.fetch",
  "agent_browser.run",
  "waypoint.command",
] as const;
const BLOCKED: Array<[RegExp, string]> = [
  [/^(?:env|printenv|set)(?:\s|$)/i, "secret_environment"],
  [/\bsecurity\s+(?:find|dump|export)/i, "keychain_access"],
  [
    /\b(?:gh\s+(?:auth|pr\s+(?:create|edit))|az\s+(?:login|account\s+set|deployment|webapp|functionapp|containerapp)|git\s+credential|(?:kubectl|helm|terraform|pulumi)\s+(?:apply|destroy|deploy)|\bdeploy\b)/i,
    "explicit_authority_required",
  ],
  [
    /\b(?:curl|wget)\b[^\n]*(?:authorization|token|password|secret)/i,
    "secret_transport",
  ],
];
const SECRET_VALUE =
  /authorization\s*[:=]\s*(?:(?:bearer|basic)\s+)?[^\s,;]+|(?:bearer|basic)\s+[A-Za-z0-9._~+/-]+=*|(?:password|passwd|token|secret|api[_-]?key|private[_-]?key|cookie)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const JSON_SECRET_VALUE = /((?:"|')?(?:authorization|password|passwd|token|secret|api[_-]?key|private[_-]?key|cookie|basicAuthCredentials)(?:"|')?\s*:\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi;
const AUTHORIZATION_VALUE = /(authorization\s*[:=]\s*)(?:(?:bearer|basic)\s+)?[^\s,;}"']+/gi;
const PRIVATE_KEY =
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g;
const URL_AUTH = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
export function redactToolText(value: string, secretNames: string[] = []) {
  let result = value
    .replace(PRIVATE_KEY, "[REDACTED_PRIVATE_KEY]")
    .replace(URL_AUTH, "$1[REDACTED]@")
    .replace(AUTHORIZATION_VALUE, "$1[REDACTED]")
    .replace(JSON_SECRET_VALUE, '$1"[REDACTED]"')
    .replace(
      SECRET_VALUE,
      (match) => `${match.split(/[:=]/, 1)[0]}=[REDACTED]`,
    );
  for (const name of secretNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped)
      result = result.replace(
        new RegExp(
          `(${escaped}\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;]+)`,
          "gi",
        ),
        "$1[REDACTED]",
      );
    const secret = process.env[name];
    if (secret && secret.length >= 4)
      result = result.split(secret).join("[REDACTED]");
  }
  return [...result]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return (
        code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
      );
    })
    .join("")
    .slice(0, MAX_OUTPUT_BYTES);
}
export function policyDigest(policy: ToolGatewayPolicy) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        1,
        policy.profileName,
        policy.roots.map((root) => path.resolve(root)).sort(),
        policy.denyPatterns,
        policy.stopped,
        policy.maxDurationMs,
        policy.maxConcurrency,
        policy.suppressCommit,
        policy.suppressPush,
        policy.webFetchEnabled,
        policy.webSearchEnabled,
        policy.browserProfileMode,
        policy.browserProfileName,
        policy.browserAllowedDomains?.map((item) => item.toLowerCase()).sort(),
        policy.browserSessionName,
        policy.browserHomeDir && path.basename(policy.browserHomeDir),
        policy.browserExecutable && path.basename(policy.browserExecutable),
        policy.browserBrowserExecutable &&
          path.basename(policy.browserBrowserExecutable),
      ]),
    )
    .digest("hex");
}
function browserEnvironment(home: string): NodeJS.ProcessEnv {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_CACHE_HOME: path.join(home, "cache"),
  };
  for (const name of [
    "TMPDIR",
    "TEMP",
    "TMP",
    "PATH",
    "SystemRoot",
    "WINDIR",
    "LANG",
    "LC_ALL",
  ])
    if (process.env[name]) env[name] = process.env[name];
  return env;
}
export function validatePolicy(policy: ToolGatewayPolicy) {
  if (policy.profileName !== "Autonomous developer")
    throw new Error("tool_profile_unavailable");
  if (
    !policy.roots.length ||
    policy.roots.some((root) => !path.isAbsolute(root))
  )
    throw new Error("invalid_roots");
  if (policy.denyPatterns.length > 100) throw new Error("deny_list_too_large");
  for (const pattern of policy.denyPatterns) {
    if (!pattern || pattern.length > 300)
      throw new Error("invalid_deny_pattern");
    try {
      new RegExp(pattern, "i");
    } catch {
      throw new Error("invalid_deny_pattern");
    }
  }
  if (
    !Number.isSafeInteger(policy.maxDurationMs) ||
    policy.maxDurationMs < 100 ||
    policy.maxDurationMs > 120_000 ||
    !Number.isSafeInteger(policy.maxConcurrency) ||
    policy.maxConcurrency < 1 ||
    policy.maxConcurrency > 4
  )
    throw new Error("invalid_tool_budget");
}
function within(candidate: string, root: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
function resolveWorkspacePath(root: string, input: string, existing = true) {
  if (
    typeof input !== "string" ||
    input.length > 4096 ||
    [...input].some((character) => character.charCodeAt(0) === 0)
  )
    throw new Error("invalid_path");
  const canonicalRoot = realpathSync(root),
    candidate = path.resolve(canonicalRoot, input);
  if (!within(candidate, canonicalRoot))
    throw new Error("path_outside_workspace");
  if (existing) {
    const real = realpathSync(candidate);
    if (!within(real, canonicalRoot)) throw new Error("path_outside_workspace");
    return real;
  }
  return candidate;
}
function searchWorkspace(root: string, query: string) {
  if (!query || query.length > 500) throw new Error("invalid_search");
  const canonicalRoot = realpathSync(root),
    matches: Array<{ path: string; line: number; text: string }> = [],
    started = Date.now();
  let visits = 0,
    bytes = 0,
    truncated = false;
  const bounded = () =>
      visits >= MAX_SEARCH_VISITS ||
      bytes >= MAX_SEARCH_BYTES ||
      Date.now() - started >= MAX_SEARCH_MS,
    matchesFull = () => matches.length >= MAX_SEARCH_MATCHES,
    walk = (directory: string, depth: number) => {
      if (depth > MAX_SEARCH_DEPTH || bounded() || matchesFull()) {
        truncated = true;
        return;
      }
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        visits++;
        if (bounded() || matchesFull()) {
          truncated = true;
          return;
        }
        const candidate = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          walk(candidate, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const size = statSync(candidate).size;
        if (size > MAX_READ_BYTES || bytes + size > MAX_SEARCH_BYTES) {
          truncated = true;
          continue;
        }
        bytes += size;
        let body: string;
        try {
          body = readFileSync(candidate, "utf8");
        } catch {
          continue;
        }
        for (const [index, line] of body.split(/\r?\n/).entries())
          if (line.includes(query)) {
            matches.push({
              path: path.relative(canonicalRoot, candidate),
              line: index + 1,
              text: line.slice(0, 1000),
            });
            if (matchesFull()) {
              truncated = true;
              return;
            }
          }
      }
    };
  walk(canonicalRoot, 0);
  return { matches, truncated };
}
function commandPolicy(command: string, policy: ToolGatewayPolicy) {
  if (
    !command.trim() ||
    command.length > 32_768 ||
    [...command].some((character) => [0, 13].includes(character.charCodeAt(0)))
  )
    return "invalid_command";
  for (const [pattern, code] of BLOCKED) if (pattern.test(command)) return code;
  if (policy.suppressCommit && /\bgit\s+commit\b/i.test(command))
    return "task_suppressed_commit";
  if (policy.suppressPush && /\bgit\s+push\b/i.test(command))
    return "task_suppressed_push";
  for (const pattern of policy.denyPatterns)
    if (new RegExp(pattern, "i").test(command)) return "deny_list";
  return undefined;
}
function executableOnPath(name: string, env: NodeJS.ProcessEnv = process.env) {
  if (!/^[A-Za-z0-9_.+-]{1,80}$/.test(name)) return undefined;
  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const folder of (env.PATH ?? "").split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(folder, `${name}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return realpathSync(candidate);
      } catch {
        /* continue */
      }
    }
  }
  return undefined;
}
export function discoverLocalCli(name: "git" | "gh" | "az") {
  const executable = executableOnPath(name);
  return {
    name,
    available: Boolean(executable),
    executable,
    authentication: "existing-local-identity" as const,
  };
}

export class ToolGateway {
  private active = new Map<
    string,
    {
      workspaceId: string;
      child: ChildProcessWithoutNullStreams;
      requested?: "canceled" | "timed_out";
      forceTimer?: NodeJS.Timeout;
    }
  >();
  private webActive = new Map<
    string,
    {
      workspaceId: string;
      controller: AbortController;
      reason?: "canceled" | "timed_out";
    }
  >();
  private stopped = new Set<string>();
  private completedRuns = new Map<string, ToolResult>();
  private completionWaiters = new Map<string, (result: ToolResult) => void>();
  private browserGates = new Map<
    string,
    { url: string; close(): Promise<void> }
  >();
  constructor(
    private readonly hooks: ToolGatewayHooks,
    private readonly spawnProcess: Spawn = spawn as Spawn,
    private readonly createNetworkGate = createBrowserNetworkGate,
    private readonly discoverCli = discoverLocalCli,
  ) {}
  configureWeb(handler: NonNullable<ToolGatewayHooks["web"]>) {
    this.hooks.web = handler;
  }
  configureBrowser(handler:NonNullable<ToolGatewayHooks["browser"]>){this.hooks.browser=handler}
  descriptors() {
    return [
      { name: "workspace.list_files", version: "1.0.0", effect: "read" },
      { name: "workspace.read_file", version: "1.0.0", effect: "read" },
      { name: "workspace.search", version: "1.0.0", effect: "read" },
      { name: "workspace.write_file", version: "1.0.0", effect: "workspace" },
      { name: "terminal.run", version: "1.0.0", effect: "workspace" },
      { name: "local_cli.run", version: "1.0.0", effect: "workspace" },
      { name: "web.search", version: "1.0.0", effect: "external" },
      { name: "web.fetch", version: "1.0.0", effect: "external" },
      { name: "agent_browser.run", version: "0.33.2", effect: "external" },
      { name: "waypoint.command", version: "1.0.0", effect: "domain" },
    ] as const;
  }
  waitForCompletion(runId:string,timeoutMs=120_000):Promise<ToolResult>{const completed=this.completedRuns.get(runId);if(completed){this.completedRuns.delete(runId);return Promise.resolve(completed)}if(!/^[A-Za-z0-9_-]{16,128}$/.test(runId)||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>300_000)return Promise.reject(new Error('Invalid tool completion wait'));if(this.completionWaiters.has(runId))return Promise.reject(new Error('Tool completion already has a waiter'));return new Promise<ToolResult>((resolve,reject)=>{const timer=setTimeout(()=>{this.completionWaiters.delete(runId);reject(new Error('Tool completion wait timed out'))},timeoutMs);timer.unref?.();this.completionWaiters.set(runId,(result)=>{clearTimeout(timer);resolve(result)})})}
  stop(workspaceId: string) {
    this.stopped.add(workspaceId);
    for (const [id, item] of this.active)
      if (item.workspaceId === workspaceId)
        this.terminate(id, item, "canceled");
    for (const item of this.webActive.values())
      if (item.workspaceId === workspaceId) {
        item.reason = "canceled";
        item.controller.abort();
      }
  }
  async stopAndCloseBrowser(workspaceId: string, policy: ToolGatewayPolicy) {
    this.stop(workspaceId);
    if (!policy.browserExecutable || !policy.browserHomeDir) {
      await this.browserGates.get(workspaceId)?.close();
      this.browserGates.delete(workspaceId);
      return true;
    }
    const closed = await new Promise<boolean>((resolve) => {
      let settled = false;
      const child = this.spawnProcess(
          policy.browserExecutable!,
          ["--session", `waypoint-${workspaceId}`, "--json", "close"],
          {
            cwd: policy.roots[0],
            env: browserEnvironment(policy.browserHomeDir!),
            shell: false,
            windowsHide: true,
            detached: process.platform !== "win32",
          },
        ),
        finish = (value: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };
      child.once("error", () => finish(false));
      child.once("close", (code) => finish(code === 0));
      const timer = setTimeout(() => {
        this.signal(child, "SIGTERM");
        setTimeout(() => this.signal(child, "SIGKILL"), 500).unref?.();
        finish(false);
      }, 5_000);
      timer.unref?.();
    });
    await this.browserGates.get(workspaceId)?.close();
    this.browserGates.delete(workspaceId);
    return closed;
  }
  resume(workspaceId: string) {
    this.stopped.delete(workspaceId);
  }
  cancel(workspaceId: string, runId: string) {
    const web = this.webActive.get(runId);
    if (web?.workspaceId === workspaceId) {
      web.reason = "canceled";
      web.controller.abort();
      return true;
    }
    const item = this.active.get(runId);
    if (!item || item.workspaceId !== workspaceId) return false;
    this.terminate(runId, item, "canceled");
    return true;
  }
  async execute(
    request: ToolRequest,
    policy: ToolGatewayPolicy,
    runtimeSecretValues: readonly string[] = [],
  ): Promise<{ runId: string; result?: ToolResult }> {
    validatePolicy(policy);
    const redactRuntime=(value:string)=>runtimeSecretValues.reduce((result,secret)=>secret.length>=4?result.split(secret).join('[REDACTED]'):result,redactToolText(value,policy.secretNames));
    if (
      request.version !== 1 ||
      !ID.test(request.workspaceId) ||
      !["ui", "ai"].includes(request.origin) ||
      !TOOLS.includes(request.tool as (typeof TOOLS)[number]) ||
      !request.arguments ||
      typeof request.arguments !== "object" ||
      Array.isArray(request.arguments)
    )
      throw new Error("invalid_tool_request");
    const contextChatId =
      request.arguments.contextChatId === undefined
        ? undefined
        : String(request.arguments.contextChatId);
    if (contextChatId !== undefined && !ID.test(contextChatId))
      throw new Error("invalid_chat_context");
    const runId = randomUUID(),
      startedAt = new Date().toISOString(),
      base: ToolReceipt = {
        id: runId,
        version: 1,
        workspaceId: request.workspaceId,
        ...(contextChatId ? { chatId: contextChatId } : {}),
        origin: request.origin,
        tool: request.tool,
        capabilityVersion: "1.0.0",
        device: "local",
        profileName: policy.profileName,
        policyDigest: policyDigest(policy),
        status: "running",
        summary: request.tool,
        startedAt,
        outputBytes: 0,
        truncated: false,
      };
    if (policy.stopped || this.stopped.has(request.workspaceId))
      return { runId, result: this.denied(base, "workspace_stopped", policy) };
    this.hooks.complete({ receipt: { ...base } });
    let overrideReason: string | undefined,
      remediation: string | undefined,
      executed = false;
    try {
      overrideReason = this.failureNote(
        request.arguments.failureOverrideReason,
        policy.secretNames,
        20,
        300,
      );
      remediation = this.failureNote(
        request.arguments.failureRemediation,
        policy.secretNames,
        undefined,
        300,
      );
      const known = this.hooks.preflight?.(request);
      if (known && !overrideReason) {
        base.notification = known.remediation
          ? `Prior remedy: ${known.remediation}`
          : `Prior ${known.errorClass} failure remains active until ${known.expiresAt}`;
        return {
          runId,
          result: this.denied(base, "known_failure_preflight", policy),
        };
      }
      if (request.tool === "workspace.list_files") {
        const root = policy.roots[0],
          target = resolveWorkspacePath(
            root,
            String(request.arguments.path ?? "."),
          );
        executed = true;
        const entries = readdirSync(target, { withFileTypes: true })
            .slice(0, MAX_LIST_ENTRIES)
            .map((entry) => ({
              name: entry.name,
              type: entry.isDirectory()
                ? "directory"
                : entry.isFile()
                  ? "file"
                  : "other",
            })),
          result = this.finish(base, {
            value: entries,
            summary: `Listed ${entries.length} entries`,
            outputBytes: 0,
            truncated: entries.length === MAX_LIST_ENTRIES,
          });
        this.publish(request, result, overrideReason, remediation);
        return { runId, result };
      }
      if (request.tool === "workspace.read_file") {
        const target = resolveWorkspacePath(
            policy.roots[0],
            String(request.arguments.path ?? ""),
          ),
          size = statSync(target).size;
        if (size > MAX_READ_BYTES)
          return { runId, result: this.denied(base, "file_too_large", policy) };
        executed = true;
        const output = redactToolText(
            readFileSync(target, "utf8"),
            policy.secretNames,
          ),
          result = this.finish(base, {
            output,
            summary: `Read ${path.basename(target)}`,
            outputBytes: Buffer.byteLength(output),
            truncated: false,
          });
        this.publish(request, result, overrideReason, remediation);
        return { runId, result };
      }
      if (request.tool === "workspace.search") {
        executed = true;
        const search = searchWorkspace(
            policy.roots[0],
            String(request.arguments.query ?? ""),
          ),
          safe = search.matches.map((item) => ({
            ...item,
            text: redactToolText(item.text, policy.secretNames),
          })),
          result = this.finish(base, {
            value: safe,
            summary: `Found ${safe.length} bounded matches${search.truncated ? " (limit reached)" : ""}`,
            outputBytes: Buffer.byteLength(JSON.stringify(safe)),
            truncated: search.truncated,
          });
        this.publish(request, result, overrideReason, remediation);
        return { runId, result };
      }
      if (request.tool === "workspace.write_file") {
        const relative = String(request.arguments.path ?? ""),
          content = request.arguments.content;
        if (
          typeof content !== "string" ||
          Buffer.byteLength(content) > MAX_WRITE_BYTES
        )
          return {
            runId,
            result: this.denied(base, "invalid_file_content", policy),
          };
        const target = resolveWorkspacePath(policy.roots[0], relative, false),
          parent = path.dirname(target),
          canonicalRoot = realpathSync(policy.roots[0]);
        if (!within(parent, canonicalRoot))
          return {
            runId,
            result: this.denied(base, "path_outside_workspace", policy),
          };
        mkdirSync(parent, { recursive: true });
        const canonicalParent = realpathSync(parent);
        if (!within(canonicalParent, canonicalRoot))
          return {
            runId,
            result: this.denied(base, "path_outside_workspace", policy),
          };
        try {
          const existing = realpathSync(target);
          if (!within(existing, canonicalRoot))
            return {
              runId,
              result: this.denied(base, "path_outside_workspace", policy),
            };
        } catch {
          /* a new file is allowed */
        }
        const temp = path.join(
          canonicalParent,
          `.waypoint-${randomUUID()}.tmp`,
        );
        executed = true;
        try {
          writeFileSync(temp, content, {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
          renameSync(temp, target);
        } finally {
          try {
            unlinkSync(temp);
          } catch {
            /* rename or cleanup completed */
          }
        }
        const result = this.finish(base, {
          summary: `Wrote ${path.basename(target)} atomically; use Git or backup history for rollback`,
          outputBytes: Buffer.byteLength(content),
          truncated: false,
        });
        this.publish(request, result, overrideReason, remediation);
        return { runId, result };
      }
      if (request.tool === "waypoint.command") {
        const command = String(request.arguments.command ?? "");
        if (
          request.origin === "ai" &&
          /^(?:security\.|credentials\.|workspace\.roots|browser\.profile|external\.)/.test(
            command,
          )
        )
          return {
            runId,
            result: this.denied(base, "user_only_command", policy),
          };
        executed = true;
        const domain = await this.hooks.domain(
            request.workspaceId,
            command,
            (request.arguments.input ?? {}) as Record<string, unknown>,
            request.origin,
          ),
          result = this.finish(base, {
            value: domain.value,
            summary: domain.summary,
            rollbackRef: domain.rollbackRef,
            outputBytes: 0,
            truncated: false,
          });
        this.publish(request, result, overrideReason, remediation);
        return { runId, result };
      }
      if (request.tool === "web.search" || request.tool === "web.fetch") {
        if (
          !this.hooks.web ||
          (request.tool === "web.search"
            ? !policy.webSearchEnabled
            : !policy.webFetchEnabled)
        )
          return {
            runId,
            result: this.denied(
              base,
              request.tool === "web.search"
                ? "web_search_unavailable"
                : "web_fetch_unavailable",
              policy,
            ),
          };
        if (this.webActive.size >= policy.maxConcurrency)
          return {
            runId,
            result: this.denied(base, "concurrency_limit", policy),
          };
        executed = true;
        const controller = new AbortController(),
          active = { workspaceId: request.workspaceId, controller } as {
            workspaceId: string;
            controller: AbortController;
            reason?: "canceled" | "timed_out";
          };
        this.webActive.set(runId, active);
        this.hooks.progress({
          runId,
          workspaceId: request.workspaceId,
          chatId: base.chatId,
          tool: request.tool,
          sequence: 1,
          type: "started",
          summary: `${request.tool} started`,
          createdAt: startedAt,
        });
        const timer = setTimeout(() => {
          active.reason = "timed_out";
          controller.abort();
        }, policy.maxDurationMs);
        try {
          const web = await this.hooks.web(request, controller.signal),
            output = redactToolText(web.output, policy.secretNames),
            result = this.finish(base, {
              output,
              value: web.value,
              summary: web.summary,
              outputBytes: Buffer.byteLength(output),
              truncated:
                Buffer.byteLength(web.output) > Buffer.byteLength(output),
            });
          this.hooks.progress({
            runId,
            workspaceId: request.workspaceId,
            chatId: base.chatId,
            tool: request.tool,
            sequence: Number.MAX_SAFE_INTEGER,
            type: "completed",
            summary: web.summary,
            output,
            createdAt: result.receipt.finishedAt!,
          });
          this.publish(request, result, overrideReason, remediation);
          return { runId, result };
        } catch (error) {
          const status =
              active.reason ??
              (controller.signal.aborted ? "canceled" : "failed"),
            message = error instanceof Error ? error.message : "web_failed",
            result = this.finish(base, {
              status,
              summary:
                status === "canceled"
                  ? "Web tool canceled"
                  : status === "timed_out"
                    ? "Web tool timed out"
                    : `Web tool failed: ${redactToolText(message, policy.secretNames).slice(0, 160)}`,
              code: status === "failed" ? "web_failed" : undefined,
              outputBytes: 0,
              truncated: false,
            });
          this.hooks.progress({
            runId,
            workspaceId: request.workspaceId,
            chatId: base.chatId,
            tool: request.tool,
            sequence: Number.MAX_SAFE_INTEGER,
            type: status === "canceled" ? "canceled" : "failed",
            summary: result.receipt.summary,
            createdAt: result.receipt.finishedAt!,
          });
          this.publish(request, result, overrideReason, remediation);
          return { runId, result };
        } finally {
          clearTimeout(timer);
          this.webActive.delete(runId);
        }
      }
      const cwd = resolveWorkspacePath(
          policy.roots[0],
          String(request.arguments.cwd ?? "."),
        ),
        isCli = request.tool === "local_cli.run",
        isBrowser = request.tool === "agent_browser.run",
        cli = isCli ? String(request.arguments.cli ?? "") : "",
        browserAction = isBrowser
          ? (request.arguments.action as BrowserAction)
          : undefined,
        command = isBrowser
          ? `agent-browser ${browserAction?.command ?? "invalid"}`
          : isCli
            ? `${cli} ${Array.isArray(request.arguments.args) ? request.arguments.args.map(String).join(" ") : ""}`
            : String(request.arguments.command ?? ""),
        blocked = commandPolicy(command, policy);
      if (blocked) return { runId, result: this.denied(base, blocked, policy) };
      if (
        [...this.active.values()].filter(
          (item) => item.workspaceId === request.workspaceId,
        ).length >= policy.maxConcurrency
      )
        return {
          runId,
          result: this.denied(base, "concurrency_limit", policy),
        };
      let file: string,
        args: string[],
        environment: NodeJS.ProcessEnv = { ...process.env };
      if (isBrowser) {
        if (
          !policy.browserExecutable ||
          !policy.browserBrowserExecutable ||
          !policy.browserProfileMode ||
          !policy.browserAllowedDomains?.length ||
          !policy.browserHomeDir
        )
          return {
            runId,
            result: this.denied(base, "browser_unavailable", policy),
          };
        file = policy.browserExecutable;
        let gate = this.browserGates.get(request.workspaceId);
        if (!gate) {
          gate = await this.createNetworkGate(policy.browserAllowedDomains);
          this.browserGates.set(request.workspaceId, gate);
        }
        const screenshots = path.join(policy.browserHomeDir, "screenshots");
        mkdirSync(screenshots, { recursive: true, mode: 0o700 });
        args = browserArguments({
          action: request.arguments.action as BrowserAction,
          mode: policy.browserProfileMode,
          profileName: policy.browserProfileName,
          session: `waypoint-${request.workspaceId}`,
          allowedDomains: policy.browserAllowedDomains,
          proxyUrl: gate.url,
          browserExecutable: policy.browserBrowserExecutable,
          networkLockdownScript: policy.browserNetworkLockdownScript,
          screenshotDir: screenshots,
          workspaceRoot: policy.roots[0],
          uploadAuthorized: request.origin === "ui",
        });
        if (policy.browserProfileMode === "isolated" && this.hooks.browser) {
          executed = true;
          const controller = new AbortController(),
            active: {
              workspaceId: string;
              controller: AbortController;
              reason?: "canceled" | "timed_out";
            } = { workspaceId: request.workspaceId, controller };
          this.webActive.set(runId, active);
          const timer = setTimeout(() => {
            active.reason = "timed_out";
            controller.abort();
          }, policy.maxDurationMs);
          this.hooks.progress({
            runId,
            workspaceId: request.workspaceId,
            chatId: base.chatId,
            tool: request.tool,
            sequence: 1,
            type: "started",
            summary: `In-App Browser ${browserAction?.command ?? "action"} started`,
            createdAt: startedAt,
          });
          try {
            const browser = await this.hooks.browser(
                request.workspaceId,
                request.arguments.action as BrowserAction,
                policy.roots[0],
                controller.signal,
              ),
              output = redactToolText(browser.output ?? "", policy.secretNames),
              result = this.finish(base, {
                output,
                value: browser.value,
                summary: browser.summary,
                outputBytes: Buffer.byteLength(output),
                truncated: false,
              });
            this.hooks.progress({
              runId,
              workspaceId: request.workspaceId,
              chatId: base.chatId,
              tool: request.tool,
              sequence: Number.MAX_SAFE_INTEGER,
              type: "completed",
              summary: browser.summary,
              output,
              createdAt: result.receipt.finishedAt!,
            });
            this.publish(request, result, overrideReason, remediation);
            return { runId, result };
          } catch (error) {
            const canceled = controller.signal.aborted,
              status = active.reason === "timed_out" ? "timed_out" : "canceled",
              result = this.finish(base, {
                status: canceled ? status : "failed",
                summary: canceled
                  ? status === "timed_out"
                    ? "In-App Browser timed out"
                    : "In-App Browser canceled"
                  : `In-App Browser failed: ${redactToolText(error instanceof Error ? error.message : "browser_failed", policy.secretNames).slice(0, 160)}`,
                code: canceled ? status : "browser_failed",
                outputBytes: 0,
                truncated: false,
              });
            this.hooks.progress({
              runId,
              workspaceId: request.workspaceId,
              chatId: base.chatId,
              tool: request.tool,
              sequence: Number.MAX_SAFE_INTEGER,
              type: canceled ? "canceled" : "failed",
              summary: result.receipt.summary,
              createdAt: result.receipt.finishedAt!,
            });
            this.publish(request, result, overrideReason, remediation);
            return { runId, result };
          } finally {
            clearTimeout(timer);
            this.webActive.delete(runId);
          }
        }
        environment = browserEnvironment(policy.browserHomeDir);
      } else if (isCli) {
        if (!["git", "gh", "az"].includes(cli))
          return {
            runId,
            result: this.denied(base, "unsupported_cli", policy),
          };
        const found = this.discoverCli(cli as "git" | "gh" | "az");
        if (!found.executable)
          return {
            runId,
            result: this.denied(base, "cli_unavailable", policy),
          };
        file = found.executable;
        args = Array.isArray(request.arguments.args)
          ? request.arguments.args.map(String)
          : [];
        if (
          args.length > 100 ||
          args.some(
            (arg) =>
              arg.length > 4096 ||
              [...arg].some((character) =>
                [0, 10, 13].includes(character.charCodeAt(0)),
              ),
          )
        )
          return {
            runId,
            result: this.denied(base, "invalid_arguments", policy),
          };
      } else {
        file =
          process.platform === "win32"
            ? (process.env.ComSpec ?? "cmd.exe")
            : (process.env.SHELL ?? "/bin/zsh");
        args =
          process.platform === "win32"
            ? ["/d", "/s", "/c", command]
            : ["-lc", command];
      }
      base.summary = redactToolText(command, policy.secretNames).slice(0, 500);
      if (/\bgit\s+commit\b/i.test(command))
        base.notification = "Git commit permitted by trusted-workspace policy";
      if (/\bgit\s+push\b/i.test(command))
        base.notification = "Git push permitted by trusted-workspace policy";
      const requestedTimeout =
        request.arguments.timeoutMs === undefined
          ? policy.maxDurationMs
          : Number(request.arguments.timeoutMs);
      if (!Number.isSafeInteger(requestedTimeout) || requestedTimeout < 100)
        return { runId, result: this.denied(base, "invalid_timeout", policy) };
      const child = this.spawnProcess(file, args, {
        cwd,
        env: environment,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
      });
      const active = { workspaceId: request.workspaceId, child } as {
        workspaceId: string;
        child: ChildProcessWithoutNullStreams;
        requested?: "canceled" | "timed_out";
        forceTimer?: NodeJS.Timeout;
      };
      this.active.set(runId, active);
      this.hooks.progress({
        runId,
        workspaceId: request.workspaceId,
        chatId: base.chatId,
        tool: request.tool,
        sequence: 1,
        type: "started",
        summary: base.summary,
        createdAt: startedAt,
      });
      let raw = "",
        cliStdout = "",
        rawBytes = 0,
        truncated = false,
        sequence = 1,
        settled = false;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      const consume = (chunk: string, stdout: boolean) => {
        if (truncated) return;
        const buffer = Buffer.from(chunk),
          remaining = MAX_OUTPUT_BYTES - rawBytes,
          take = buffer.subarray(0, Math.max(0, remaining)).toString();
        rawBytes += Buffer.byteLength(take);
        raw += take;
        if (stdout) cliStdout += take;
        if (buffer.length > remaining) truncated = true;
        if (take.trim())
          this.hooks.progress({
            runId,
            workspaceId: request.workspaceId,
            chatId: base.chatId,
            tool: request.tool,
            sequence: ++sequence,
            type: "progress",
            summary: `Received ${rawBytes} bytes of bounded output`,
            createdAt: new Date().toISOString(),
          });
      };
      child.stdout.on("data", (chunk: string) => consume(chunk, true));
      child.stderr.on("data", (chunk: string) => consume(chunk, false));
      const timeout = setTimeout(
        () => this.terminate(runId, active, "timed_out"),
        Math.min(policy.maxDurationMs, requestedTimeout),
      );
      const settle = (status: ToolStatus, code?: string, error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (active.forceTimer) clearTimeout(active.forceTimer);
        this.active.delete(runId);
        const output = redactRuntime(request.tool === "local_cli.run" ? cliStdout : raw);
        this.complete(
          request,
          base,
          policy,
          status,
          output,
          Buffer.byteLength(output),
          truncated,
          overrideReason,
          remediation,
          code,
          error?redactRuntime(error):undefined,
        );
      };
      child.once("error", (error) =>
        settle("failed", "spawn_failed", error.message),
      );
      child.once("close", (code) => {
        const requested = active.requested;
        settle(
          requested ?? (code === 0 ? "completed" : "failed"),
          requested ? undefined : "nonzero_exit",
        );
      });
      return { runId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const result = this.finish(base, {
        status: "failed",
        summary: `Tool failed: ${redactToolText(message, policy.secretNames).slice(0, 200)}`,
        code: "tool_error",
        outputBytes: 0,
        truncated: false,
      });
      if (executed) this.publish(request, result, overrideReason, remediation);
      else this.hooks.complete(result);
      return { runId, result };
    }
  }
  private terminate(
    runId: string,
    item: {
      child: ChildProcessWithoutNullStreams;
      requested?: "canceled" | "timed_out";
      forceTimer?: NodeJS.Timeout;
    },
    reason: "canceled" | "timed_out",
  ) {
    if (item.requested) return;
    item.requested = reason;
    this.signal(item.child, "SIGTERM");
    item.forceTimer = setTimeout(() => {
      if (this.active.has(runId)) this.signal(item.child, "SIGKILL");
    }, 1_000);
    item.forceTimer.unref?.();
  }
  private signal(
    child: ChildProcessWithoutNullStreams,
    signal: "SIGTERM" | "SIGKILL",
  ) {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        /* child may have exited */
      }
    }
    child.kill(signal);
  }
  private complete(
    request: ToolRequest,
    base: ToolReceipt,
    policy: ToolGatewayPolicy,
    status: ToolStatus,
    output: string,
    bytes: number,
    truncated: boolean,
    overrideReason?: string,
    remediation?: string,
    code?: string,
    error?: string,
  ) {
    const result = this.finish(base, {
      status,
      output: redactToolText(output, policy.secretNames),
      summary:
        status === "completed"
          ? "Command completed"
          : status === "canceled"
            ? "Command canceled"
            : status === "timed_out"
              ? "Command timed out"
              : `Command failed${error ? `: ${redactToolText(error, policy.secretNames).slice(0, 200)}` : ""}`,
      outputBytes: bytes,
      truncated,
      code,
    });
    this.hooks.progress({
      runId: base.id,
      workspaceId: base.workspaceId,
      chatId: base.chatId,
      tool: request.tool,
      sequence: Number.MAX_SAFE_INTEGER,
      type:
        status === "completed"
          ? "completed"
          : status === "canceled"
            ? "canceled"
            : "failed",
      summary: result.receipt.summary,
      output: result.output,
      createdAt: result.receipt.finishedAt!,
    });
    this.publish(request, result, overrideReason, remediation);
  }
  private publish(
    request: ToolRequest,
    result: ToolResult,
    overrideReason?: string,
    remediation?: string,
  ) {
    this.hooks.complete(result);
    this.hooks.learn?.(request, result, overrideReason, remediation);
    const waiter=this.completionWaiters.get(result.receipt.id);
    if(waiter){this.completionWaiters.delete(result.receipt.id);waiter(result)}else{this.completedRuns.set(result.receipt.id,result);while(this.completedRuns.size>200)this.completedRuns.delete(this.completedRuns.keys().next().value!)}
  }
  private failureNote(
    value: unknown,
    secretNames: string[],
    min = 1,
    max = 300,
  ) {
    if (value === undefined) return undefined;
    if (
      typeof value !== "string" ||
      value.trim().length < min ||
      value.length > max
    )
      throw new Error("invalid_failure_override");
    return redactToolText(value, secretNames).replace(/\s+/g, " ").trim();
  }
  private finish(
    base: ToolReceipt,
    values: Partial<ToolResult["receipt"]> & {
      output?: string;
      value?: unknown;
    },
  ): ToolResult {
    const finishedAt = new Date().toISOString(),
      receipt: { [K in keyof ToolReceipt]: ToolReceipt[K] } = {
        ...base,
        status: values.status ?? "completed",
        summary: values.summary ?? base.summary,
        finishedAt,
        durationMs: Math.max(
          0,
          Date.parse(finishedAt) - Date.parse(base.startedAt),
        ),
        outputBytes: values.outputBytes ?? 0,
        truncated: values.truncated ?? false,
        code: values.code,
        notification: values.notification ?? base.notification,
        rollbackRef: values.rollbackRef ?? base.rollbackRef,
      };
    return { receipt, output: values.output, value: values.value };
  }
  private denied(base: ToolReceipt, code: string, policy: ToolGatewayPolicy) {
    void policy;
    const result = this.finish(base, {
      status: "denied",
      summary: `Denied: ${code}`,
      code,
      outputBytes: 0,
      truncated: false,
    });
    this.hooks.complete(result);
    return result;
  }
}

/** Trusted-main-process entry point for provider adapters. Security-critical domain
 * commands still fail closed in the gateway; all tools share the same workspace policy. */
export class AiWaypointControlBridge {
  constructor(
    private readonly gateway: ToolGateway,
    private readonly policyFor: (workspaceId: string) => ToolGatewayPolicy,
  ) {}
  execute(
    workspaceId: string,
    command: string,
    input: Record<string, unknown> = {},
  ) {
    return this.gateway.execute(
      {
        version: 1,
        workspaceId,
        origin: "ai",
        tool: "waypoint.command",
        arguments: { command, input },
      },
      this.policyFor(workspaceId),
    );
  }
  executeTool(
    workspaceId: string,
    tool: ToolRequest["tool"],
    arguments_: Record<string, unknown> = {},
  ) {
    return this.gateway.execute(
      { version: 1, workspaceId, origin: "ai", tool, arguments: arguments_ },
      this.policyFor(workspaceId),
    );
  }
}
