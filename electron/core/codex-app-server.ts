import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  cliExecutionEnvironment,
  cliProcessInvocation,
  resolveExecutable,
} from "../../spikes/cli-capabilities.js";
import {
  validateRequest,
  type CliImageInput,
  type ExecutionEvent,
  type RunningExecution,
  type RunRequest,
} from "./ai-workbench.js";
import { redactToolText } from "./tool-gateway.js";
import { markRunScopedAttachmentDirectory } from "./run-scoped-attachment-cleanup.js";
import {
  automationProposalInputSchema,
  automationReceiverPrerequisite,
  automationReceiverQuestion,
} from "./automation-ai-tool.js";

type JsonObject = Record<string, unknown>;
type DecisionStatus = "accepted" | "accepted_session" | "declined" | "canceled";
type ServerRequest = { method: string; id: number | string; params: unknown };
type ThreadItem = JsonObject & { type: string; id?: string };
type Turn = {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error?: { message?: string } | null;
};

export interface CodexProviderDecision {
  status: DecisionStatus;
  decision: JsonObject;
}

export interface CodexApprovalRequest {
  providerRequestId: string;
  kind:
    | "command"
    | "file_change"
    | "network"
    | "permission"
    | "question"
    | "mcp_elicitation"
    | "tool";
  title: string;
  detail: JsonObject;
  options?: unknown[];
}

export interface CodexRunRequest extends Omit<RunRequest, "cli"> {
  cli: "codex";
  providerSessionId?: string;
  requiredSkillIdentifier?: string;
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

type SpawnProcess = (
  file: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    windowsHide: true;
    detached?: boolean;
  },
) => ChildProcessWithoutNullStreams;
type InvocationResolver = typeof cliProcessInvocation;
type TreeTerminator = (
  child: ChildProcessWithoutNullStreams,
  platform: NodeJS.Platform,
  signal: "SIGTERM" | "SIGKILL",
) => Promise<void>;
type RpcId = number | string;
type RpcResponse = {
  id: RpcId;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
function bounded(value: unknown, max = 16_000): string {
  const encoded = typeof value === "string" ? value : JSON.stringify(value),
    result = encoded === undefined ? "" : encoded;
  return result.length > max ? `${result.slice(0, max)}…` : result;
}
function auditValue(value: unknown, secretNames: string[], depth = 0): unknown {
  if (typeof value === "string") return redactToolText(value, secretNames);
  if (depth >= 8) return "[bounded]";
  if (Array.isArray(value))
    return value
      .slice(0, 200)
      .map((item) => auditValue(item, secretNames, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .slice(0, 200)
        .map(([key, item]) => [key, auditValue(item, secretNames, depth + 1)]),
    );
  return value;
}
function auditText(
  value: unknown,
  secretNames: string[],
  max = 16_000,
): string {
  return bounded(auditValue(value, secretNames), max);
}
function lexicalWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
function isWithinRoot(candidate: unknown, root: string): candidate is string {
  if (
    typeof candidate !== "string" ||
    !path.isAbsolute(candidate) ||
    !lexicalWithin(candidate, root)
  )
    return false;
  try {
    const canonicalRoot = realpathSync.native(root);
    let ancestor = path.resolve(candidate);
    while (!existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor || !lexicalWithin(parent, root)) return false;
      ancestor = parent;
    }
    return lexicalWithin(realpathSync.native(ancestor), canonicalRoot);
  } catch {
    return false;
  }
}

function grantedPermissions(
  request: CodexRunRequest,
  requested: unknown,
): JsonObject {
  const value = object(requested),
    network = object(value.network),
    fileSystem = object(value.fileSystem),
    root = path.resolve(request.workspaceRoot),
    result: JsonObject = {};
  if (request.profile.network === "enabled" && network.enabled === true)
    result.network = { enabled: true };
  const allowWrite = request.profile.filesystem === "workspace-write",
    read = Array.isArray(fileSystem.read)
      ? fileSystem.read.filter((candidate) => isWithinRoot(candidate, root))
      : [],
    write =
      allowWrite && Array.isArray(fileSystem.write)
        ? fileSystem.write.filter((candidate) => isWithinRoot(candidate, root))
        : [];
  const entries = Array.isArray(fileSystem.entries)
    ? fileSystem.entries.filter((candidate) => {
        const entry = object(candidate),
          access = entry.access,
          pathValue = object(entry.path);
        if (access !== "read" && access !== "write" && access !== "deny")
          return false;
        if (access === "write" && !allowWrite) return false;
        if (pathValue.type === "path")
          return isWithinRoot(pathValue.path, root);
        if (pathValue.type === "special") {
          const special = object(pathValue.value);
          if (special.kind !== "project_roots") return false;
          if (special.subpath == null) return true;
          if (
            typeof special.subpath !== "string" ||
            path.isAbsolute(special.subpath)
          )
            return false;
          return isWithinRoot(path.resolve(root, special.subpath), root);
        }
        return false;
      })
    : [];
  if (read.length || write.length || entries.length)
    result.fileSystem = {
      read: read.length ? read : null,
      write: write.length ? write : null,
      entries: entries.length ? entries : null,
      ...(Number.isSafeInteger(fileSystem.globScanMaxDepth)
        ? {
            globScanMaxDepth: Math.min(Number(fileSystem.globScanMaxDepth), 64),
          }
        : {}),
    };
  return result;
}

function commandEscalationAllowed(
  request: CodexRunRequest,
  params: JsonObject,
): boolean {
  if (params.cwd != null && !isWithinRoot(params.cwd, request.workspaceRoot))
    return false;
  const additional = object(params.additionalPermissions);
  if (!Object.keys(additional).length)
    return (
      !params.networkApprovalContext || request.profile.network === "enabled"
    );
  return (
    JSON.stringify(grantedPermissions(request, additional)) ===
    JSON.stringify(additional)
  );
}

export function codexSandboxPolicy(request: CodexRunRequest): JsonObject {
  if (request.profile.approval === "never") return { type: "dangerFullAccess" };
  if (
    request.profile.filesystem === "read-only" ||
    request.profile.approval === "on-write"
  )
    return {
      type: "readOnly",
      networkAccess: request.profile.network === "enabled",
    };
  return {
    type: "workspaceWrite",
    writableRoots: [path.resolve(request.workspaceRoot)],
    networkAccess: request.profile.network === "enabled",
    excludeTmpdirEnvVar: true,
    excludeSlashTmp: true,
  };
}

export function codexSandboxMode(
  request: CodexRunRequest,
): "read-only" | "workspace-write" | "danger-full-access" {
  if (request.profile.approval === "never") return "danger-full-access";
  return request.profile.filesystem === "read-only" ||
    request.profile.approval === "on-write"
    ? "read-only"
    : "workspace-write";
}

function providerRequest(
  request: ServerRequest,
  secretNames: string[],
): CodexApprovalRequest {
  const params = object(request.params),
    id = bounded(request.id, 512);
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return {
        providerRequestId: id,
        kind: params.networkApprovalContext ? "network" : "command",
        title: params.reason
          ? auditText(params.reason, secretNames, 300)
          : "Codex wants to run a command",
        detail: auditValue(
          {
            command: params.command ?? null,
            cwd: params.cwd ?? null,
            reason: params.reason ?? null,
            commandActions: params.commandActions ?? [],
            additionalPermissions: params.additionalPermissions ?? null,
          },
          secretNames,
        ) as JsonObject,
      };
    case "item/fileChange/requestApproval":
      return {
        providerRequestId: id,
        kind: "file_change",
        title: params.reason
          ? auditText(params.reason, secretNames, 300)
          : "Codex wants to change files",
        detail: auditValue(
          {
            reason: params.reason ?? null,
            grantRoot: params.grantRoot ?? null,
          },
          secretNames,
        ) as JsonObject,
      };
    case "item/tool/requestUserInput": {
      const questions = Array.isArray(params.questions)
        ? params.questions.map(object)
        : [];
      const options = questions.flatMap((question) =>
        Array.isArray(question.options)
          ? question.options.map((option) => ({
              ...object(option),
              questionId: question.id,
            }))
          : [],
      );
      return {
        providerRequestId: id,
        kind: "question",
        title:
          questions
            .map((question) => auditText(question.question, secretNames, 300))
            .join(" / ") || "Codex needs your input",
        detail: auditValue(
          { questions, autoResolutionMs: params.autoResolutionMs ?? null },
          secretNames,
        ) as JsonObject,
        options: auditValue(options, secretNames) as unknown[],
      };
    }
    case "mcpServer/elicitation/request":
      return {
        providerRequestId: id,
        kind: "mcp_elicitation",
        title: auditText(
          params.message ?? `MCP server ${params.serverName ?? ""} needs input`,
          secretNames,
          300,
        ),
        detail: auditValue(params, secretNames) as JsonObject,
      };
    case "item/permissions/requestApproval":
      return {
        providerRequestId: id,
        kind: "permission",
        title: params.reason
          ? auditText(params.reason, secretNames, 300)
          : "Codex requests additional permissions",
        detail: auditValue(
          {
            cwd: params.cwd ?? null,
            reason: params.reason ?? null,
            permissions: params.permissions ?? {},
          },
          secretNames,
        ) as JsonObject,
      };
    case "item/tool/call":
      return {
        providerRequestId: id,
        kind: "tool",
        title: `Codex wants to call ${auditText(params.tool ?? "a Waypoint tool", secretNames, 220)}`,
        detail: auditValue(
          {
            namespace: params.namespace ?? null,
            tool: params.tool ?? null,
            arguments: params.arguments ?? null,
          },
          secretNames,
        ) as JsonObject,
      };
    case "execCommandApproval":
      return {
        providerRequestId: id,
        kind: "command",
        title: params.reason
          ? auditText(params.reason, secretNames, 300)
          : "Codex wants to run a command",
        detail: auditValue(
          {
            command: params.command ?? null,
            cwd: params.cwd ?? null,
            reason: params.reason ?? null,
          },
          secretNames,
        ) as JsonObject,
      };
    case "applyPatchApproval":
      return {
        providerRequestId: id,
        kind: "file_change",
        title: params.reason
          ? auditText(params.reason, secretNames, 300)
          : "Codex wants to change files",
        detail: auditValue(params, secretNames) as JsonObject,
      };
    default:
      return {
        providerRequestId: id,
        kind: "permission",
        title: "Codex requested an unsupported privileged operation",
        detail: auditValue(
          { method: request.method, params },
          secretNames,
        ) as JsonObject,
      };
  }
}

function approvalResponse(
  message: ServerRequest,
  outcome: CodexProviderDecision,
  runRequest: CodexRunRequest,
): unknown {
  const accepted =
    outcome.status === "accepted" || outcome.status === "accepted_session";
  const params = object(message.params);
  switch (message.method) {
    case "item/commandExecution/requestApproval":
    case "execCommandApproval":
      return {
        decision:
          accepted && commandEscalationAllowed(runRequest, params)
            ? outcome.status === "accepted_session"
              ? "acceptForSession"
              : "accept"
            : outcome.status === "canceled"
              ? "cancel"
              : "decline",
      };
    case "item/fileChange/requestApproval":
    case "applyPatchApproval": {
      const grantRoot = params.grantRoot;
      const scoped =
        grantRoot == null || isWithinRoot(grantRoot, runRequest.workspaceRoot);
      return {
        decision:
          accepted && scoped
            ? outcome.status === "accepted_session"
              ? "acceptForSession"
              : "accept"
            : outcome.status === "canceled"
              ? "cancel"
              : "decline",
      };
    }
    case "item/tool/requestUserInput": {
      const questions = Array.isArray(params.questions)
        ? (params.questions as unknown[]).map(object)
        : [];
      const selected = outcome.decision.answer;
      const supplied = object(outcome.decision.answers);
      return {
        answers: Object.fromEntries(
          questions.map((question) => [
            String(question.id),
            {
              answers: accepted
                ? Array.isArray(supplied[String(question.id)])
                  ? supplied[String(question.id)]
                  : selected === undefined
                    ? []
                    : [String(selected)]
                : [],
            },
          ]),
        ),
      };
    }
    case "mcpServer/elicitation/request":
      return {
        action: accepted
          ? "accept"
          : outcome.status === "canceled"
            ? "cancel"
            : "decline",
        content: accepted ? (outcome.decision.content ?? {}) : null,
        _meta: null,
      };
    case "item/permissions/requestApproval":
      return {
        permissions: accepted
          ? grantedPermissions(runRequest, params.permissions)
          : {},
        scope: outcome.status === "accepted_session" ? "session" : "turn",
        strictAutoReview: true,
      };
    case "item/tool/call":
      return {
        contentItems: [
          {
            type: "inputText",
            text: accepted
              ? bounded(
                  outcome.decision.result ??
                    "Waypoint did not register a handler for this dynamic tool.",
                )
              : "The user declined this tool call.",
          },
        ],
        success: false,
      };
    default:
      return { decision: "decline" };
  }
}

function itemEvent(
  item: ThreadItem,
  completed: boolean,
  secretNames: string[],
): ExecutionEvent | undefined {
  if (!item || typeof item.type !== "string" || typeof item.id !== "string")
    throw new Error("Codex app-server emitted an invalid structured item");
  const state = completed ? "completed" : "started";
  switch (item.type) {
    case "commandExecution":
      return {
        type: "tool",
        name: `Command ${state}${completed && item.exitCode != null ? ` · exit ${item.exitCode}` : ""}`,
        text:
          completed && item.aggregatedOutput
            ? auditText(item.aggregatedOutput, secretNames, 4_000)
            : auditText(item.command ?? "", secretNames, 4_000),
        rawType: `codex.command.${state}`,
        metadata: {
          itemId: item.id,
          cwd: auditValue(item.cwd, secretNames),
          status: item.status,
        },
      };
    case "fileChange":
      return {
        type: "tool",
        name: `File changes ${state}`,
        text: completed
          ? auditText(item.changes, secretNames, 4_000)
          : undefined,
        rawType: `codex.file_change.${state}`,
        metadata: { itemId: item.id, status: item.status },
      };
    case "mcpToolCall":
      return {
        type: "tool",
        name: `${auditText(item.server, secretNames, 120)} · ${auditText(item.tool, secretNames, 120)} ${state}`,
        text: completed
          ? auditText(item.error ?? item.result ?? "", secretNames, 4_000)
          : auditText(item.arguments, secretNames, 2_000),
        rawType: `codex.mcp.${state}`,
        metadata: { itemId: item.id, status: item.status },
      };
    case "webSearch":
      return {
        type: "tool",
        name: `Web search ${state}`,
        rawType: `codex.web_search.${state}`,
      };
    case "imageGeneration":
      return {
        type: "tool",
        name: `Image generation ${state}`,
        rawType: `codex.image_generation.${state}`,
      };
    case "collabAgentToolCall":
      return {
        type: "agent",
        name: `${auditText(item.tool, secretNames, 120)} ${state}`,
        text:
          typeof item.prompt === "string"
            ? auditText(item.prompt, secretNames)
            : undefined,
        rawType: `codex.collaboration.${state}`,
        metadata: {
          senderThreadId: item.senderThreadId,
          receiverThreadIds: item.receiverThreadIds,
        },
      };
    case "subAgentActivity":
      if (
        !["started", "interacted", "interrupted"].includes(String(item.kind)) ||
        typeof item.agentPath !== "string" ||
        typeof item.agentThreadId !== "string"
      )
        throw new Error(
          "Codex app-server emitted an invalid subagent activity",
        );
      return {
        type: "agent",
        name: `Agent ${auditText(item.kind, secretNames, 120)}`,
        text: auditText(item.agentPath, secretNames, 1_000),
        rawType: "codex.subagent.activity",
        metadata: { agentThreadId: item.agentThreadId },
      };
    case "plan":
      return completed
        ? {
            type: "agent",
            name: "Plan updated",
            text: auditText(item.text, secretNames, 8_000),
            rawType: "codex.plan",
          }
        : undefined;
    default:
      return undefined;
  }
}

export async function terminateCodexProcessTree(
  child: ChildProcessWithoutNullStreams,
  platform: NodeJS.Platform = process.platform,
  signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
  killerSpawner: typeof spawn = spawn,
): Promise<void> {
  if (platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      let killer;
      try {
        killer = killerSpawner(
          path.join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
      } catch {
        child.kill(signal);
        resolve();
        return;
      }
      killer.once("error", () => {
        child.kill(signal);
        resolve();
      });
      killer.once("close", () => resolve());
    });
    return;
  }
  if (platform !== "win32" && child.pid)
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      /* The process group may already be gone. */
    }
  child.kill(signal);
}

export class CodexAppServerWorkbench {
  private readonly active = new Map<string, RunningExecution>();
  private readonly steerers = new Map<
    string,
    (prompt: string) => Promise<void>
  >();
  constructor(
    private readonly spawnProcess: SpawnProcess = spawn as SpawnProcess,
    private readonly resolver = resolveExecutable,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly invocationResolver: InvocationResolver = cliProcessInvocation,
    private readonly treeTerminator: TreeTerminator = terminateCodexProcessTree,
  ) {}

  async start(
    runId: string,
    request: CodexRunRequest,
    onEvent: (event: ExecutionEvent) => void,
  ): Promise<RunningExecution> {
    validateRequest(request);
    if (this.active.size >= request.profile.maxConcurrency)
      throw new Error("Execution concurrency limit reached");
    const executable = request.executable ?? (await this.resolver("codex"));
    if (!executable) throw new Error("codex CLI was not found on PATH");
    const targetIsAbsolute =
      this.platform === "win32" ? path.win32.isAbsolute : path.isAbsolute;
    if (!targetIsAbsolute(executable))
      throw new Error("Resolved CLI path must be absolute");
    const images = request.images ?? [];
    let snapshotRoot: string | undefined;
    const cleanupSnapshots = () => {
      if (snapshotRoot) {
        rmSync(snapshotRoot, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
        snapshotRoot = undefined;
      }
    };
    const deliveredImages: CliImageInput[] = [];
    try {
      for (const [index, image] of images.entries()) {
        if (!targetIsAbsolute(image.path))
          throw new Error("Attachment image paths must be absolute");
        const bytes = readFileSync(image.path);
        if (createHash("sha256").update(bytes).digest("hex") !== image.sha256)
          throw new Error("Attachment image integrity check failed");
        if (!snapshotRoot) {
          snapshotRoot = mkdtempSync(
            path.join(
              path.resolve(request.workspaceRoot),
              ".waypoint-cli-images-",
            ),
          );
          markRunScopedAttachmentDirectory(snapshotRoot);
        }
        const snapshotPath = path.join(
          snapshotRoot,
          `${index}${path.extname(image.name).toLowerCase()}`,
        );
        writeFileSync(snapshotPath, bytes, { flag: "wx", mode: 0o600 });
        deliveredImages.push({ ...image, path: snapshotPath });
      }
    } catch (error) {
      cleanupSnapshots();
      throw error;
    }
    const args = ["app-server"];
    let child: ChildProcessWithoutNullStreams;
    try {
      const invocation = await this.invocationResolver(
        "codex",
        executable,
        args,
        { platform: this.platform },
      );
      request.beforeSpawn?.();
      child = this.spawnProcess(invocation.executable, invocation.args, {
        cwd: path.resolve(request.workspaceRoot),
        env: cliExecutionEnvironment(executable, process.env, this.platform),
        shell: false,
        windowsHide: true,
        detached: this.platform !== "win32",
      });
    } catch (error) {
      cleanupSnapshots();
      throw error;
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let nextId = 1,
      buffer = "",
      stderr = "",
      settled = false,
      canceled = false,
      turnId: string | undefined,
      threadId: string | undefined;
    const pending = new Map<
      RpcId,
      { resolve: (value: unknown) => void; reject: (reason: Error) => void }
    >();
    const abort = new AbortController();
    const write = (message: unknown) =>
      child.stdin.write(`${JSON.stringify(message)}\n`);
    const notify = (method: string, params?: unknown) =>
      write(params === undefined ? { method } : { method, params });
    const rpc = <T = unknown>(method: string, params: unknown): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: (value) => resolve(value as T), reject });
        write({ id, method, params });
      });
    const respond = (id: RpcId, result?: unknown, error?: JsonObject) =>
      write(error ? { id, error } : { id, result });
    let discoveredSkills: JsonObject[] = [];
    const refreshSkills = async (forceReload: boolean) => {
      const result = object(
          await rpc("skills/list", {
            cwds: [path.resolve(request.workspaceRoot)],
            forceReload,
          }),
        ),
        entries = Array.isArray(result.data) ? result.data.map(object) : [];
      discoveredSkills = entries
        .flatMap((entry) =>
          Array.isArray(entry.skills) ? entry.skills.map(object) : [],
        )
        .filter(
          (skill) =>
            skill.enabled === true &&
            typeof skill.name === "string" &&
            typeof skill.path === "string",
        );
      return discoveredSkills;
    };
    let completeTurn: (turn: Turn) => void = () => undefined,
      failTurn: (error: Error) => void = () => undefined;
    const turnDone = new Promise<Turn>((resolve, reject) => {
      completeTurn = resolve;
      failTurn = reject;
    });
    const handleRequest = async (message: ServerRequest) => {
      if (message.method === "currentTime/read") {
        respond(message.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
        return;
      }
      if (
        message.method === "account/chatgptAuthTokens/refresh" ||
        message.method === "attestation/generate"
      ) {
        respond(message.id, undefined, {
          code: -32601,
          message:
            "Waypoint delegates authentication to the installed Codex CLI.",
        });
        return;
      }
      if (
        message.method === "item/tool/call" &&
        object(message.params).tool === "waypoint_automation_proposal"
      ) {
        if (!request.onAutomationProposal) {
          respond(message.id, {
            contentItems: [
              {
                type: "inputText",
                text: "The Waypoint automation proposal tool is unavailable for this delegated or system turn.",
              },
            ],
            success: false,
          });
          return;
        }
        const params = object(message.params),
          definition = object(object(params.arguments).definition);
        try {
          const action = object(definition.action);
          if (action.kind === "ai_skill") {
            if (action.provider !== "codex")
              throw new Error(
                "this Codex session can verify only Codex skills",
              );
            const identifier = String(action.skillIdentifier ?? "");
            await refreshSkills(true);
            if (
              !identifier ||
              !discoveredSkills.some((skill) => skill.name === identifier)
            )
              throw new Error(
                `exact Codex skill ${identifier || "<missing>"} is not in the refreshed provider inventory; if it was just created, start a fresh Codex session and submit the proposal again`,
              );
          }
          const result = await request.onAutomationProposal(definition);
          respond(message.id, {
            contentItems: [
              {
                type: "inputText",
                text:
                  result.summary ??
                  `Pending Waypoint automation proposal ${result.proposalId} was validated and prepared for explicit user confirmation. It is not provisioned or enabled.`,
              },
            ],
            success: true,
          });
        } catch (error) {
          const prerequisite = automationReceiverPrerequisite(error);
          if (prerequisite)
            await request.onApproval(
              automationReceiverQuestion(
                `automation-receiver-${bounded(message.id, 128)}`,
                prerequisite,
              ),
              abort.signal,
            );
          respond(message.id, {
            contentItems: [
              {
                type: "inputText",
                text: `Automation proposal rejected: ${error instanceof Error ? error.message : "validation failed"}. Correct the definition and call this tool again. Repository file changes made earlier in the run are unaffected.`,
              },
            ],
            success: false,
          });
        }
        return;
      }
      const requestView = providerRequest(message, request.profile.secretNames);
      onEvent({
        type: "diagnostic",
        name: `Waiting for approval · ${requestView.kind.replace("_", " ")}`,
        rawType: `codex.request.${requestView.kind}`,
      });
      try {
        respond(
          message.id,
          approvalResponse(
            message,
            await request.onApproval(requestView, abort.signal),
            request,
          ),
        );
      } catch (error) {
        respond(message.id, undefined, {
          code: -32000,
          message:
            error instanceof Error ? error.message : "Provider decision failed",
        });
      }
    };
    const handleNotification = (method: string, params: JsonObject) => {
      if (
        method === "item/agentMessage/delta" &&
        typeof params.delta === "string"
      )
        onEvent({
          type: "text",
          text: redactToolText(params.delta, request.profile.secretNames),
          rawType: method,
        });
      else if (method === "item/started" || method === "item/completed") {
        const event = itemEvent(
          params.item as ThreadItem,
          method === "item/completed",
          request.profile.secretNames,
        );
        if (event) onEvent(event);
      } else if (
        method === "item/commandExecution/outputDelta" &&
        typeof params.delta === "string"
      )
        onEvent({
          type: "tool",
          name: "Command output",
          text: auditText(params.delta, request.profile.secretNames, 4_000),
          rawType: method,
          metadata: { itemId: params.itemId },
        });
      else if (method === "item/fileChange/patchUpdated")
        onEvent({
          type: "tool",
          name: "File patch updated",
          text: auditText(
            params.patch ?? params.delta ?? params,
            request.profile.secretNames,
            8_000,
          ),
          rawType: method,
          metadata: { itemId: params.itemId },
        });
      else if (method === "turn/diff/updated")
        onEvent({
          type: "tool",
          name: "Working-tree diff updated",
          text: auditText(
            params.diff ?? params,
            request.profile.secretNames,
            8_000,
          ),
          rawType: method,
        });
      else if (method === "turn/plan/updated")
        onEvent({
          type: "agent",
          name: "Plan updated",
          text: auditText(
            params.plan ?? params,
            request.profile.secretNames,
            8_000,
          ),
          rawType: method,
        });
      else if (
        method === "item/reasoning/summaryTextDelta" &&
        typeof params.delta === "string"
      )
        onEvent({
          type: "agent",
          name: "Reasoning summary",
          text: auditText(params.delta, request.profile.secretNames),
          rawType: method,
          metadata: { itemId: params.itemId },
        });
      else if (method === "item/reasoning/summaryPartAdded")
        onEvent({
          type: "agent",
          name: "Reasoning summary section",
          rawType: method,
          metadata: {
            itemId: params.itemId,
            summaryIndex: params.summaryIndex,
          },
        });
      else if (method === "item/mcpToolCall/progress")
        onEvent({
          type: "tool",
          name: "MCP progress",
          text: auditText(
            params.message ?? params,
            request.profile.secretNames,
            4_000,
          ),
          rawType: method,
          metadata: { itemId: params.itemId },
        });
      else if (method === "thread/tokenUsage/updated")
        onEvent({
          type: "diagnostic",
          name: "Token usage updated",
          rawType: method,
          metadata: { tokenUsage: params.tokenUsage ?? params },
        });
      else if (method === "model/rerouted")
        onEvent({
          type: "diagnostic",
          name: "Model rerouted",
          text: auditText(params, request.profile.secretNames, 2_000),
          rawType: method,
        });
      else if (
        method === "warning" ||
        method === "error" ||
        method === "configWarning" ||
        method === "deprecationNotice"
      )
        onEvent({
          type: "diagnostic",
          name: method,
          text: auditText(params, request.profile.secretNames, 4_000),
          rawType: method,
        });
      else if (method === "turn/completed") {
        const turn = params.turn as Turn;
        if (
          !turn ||
          typeof turn.id !== "string" ||
          !["completed", "interrupted", "failed"].includes(turn.status)
        ) {
          failTurn(
            new Error("Codex app-server emitted an invalid terminal turn"),
          );
          return;
        }
        if (!turnId || turn.id === turnId) completeTurn(turn);
      }
    };
    const handleLine = (line: string) => {
      let message: JsonObject;
      try {
        message = object(JSON.parse(line));
      } catch {
        onEvent({
          type: "diagnostic",
          name: "Codex protocol warning",
          text: "Codex emitted an invalid JSONL message",
          rawType: "codex.protocol.invalid_json",
        });
        return;
      }
      if ("id" in message && !("method" in message)) {
        const response = message as RpcResponse,
          waiter = pending.get(response.id);
        if (!waiter) return;
        pending.delete(response.id);
        if (response.error)
          waiter.reject(
            new Error(
              response.error.message ??
                `Codex app-server request failed (${response.error.code ?? "unknown"})`,
            ),
          );
        else waiter.resolve(response.result);
        return;
      }
      if (typeof message.method === "string" && "id" in message) {
        void handleRequest(message as unknown as ServerRequest);
        return;
      }
      if (typeof message.method === "string")
        try {
          handleNotification(message.method, object(message.params));
        } catch (error) {
          failTurn(
            error instanceof Error
              ? error
              : new Error("Codex protocol notification failed"),
          );
        }
    };
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines)
        if (line.trim())
          try {
            handleLine(line);
          } catch (error) {
            failTurn(
              error instanceof Error
                ? error
                : new Error("Codex protocol message failed"),
            );
          }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });
    let forceTimer: NodeJS.Timeout | undefined,
      termination: Promise<void> | undefined;
    const terminate = (signal: "SIGTERM" | "SIGKILL") => {
      const next = () => this.treeTerminator(child, this.platform, signal);
      termination = termination ? termination.then(next, next) : next();
      return termination;
    };
    const stop = () => {
      if (settled) return;
      abort.abort();
      if (threadId && turnId)
        void rpc("turn/interrupt", { threadId, turnId }).catch(() => undefined);
      void terminate("SIGTERM");
      forceTimer ??= setTimeout(() => {
        if (!settled) void terminate("SIGKILL");
      }, 2_000);
    };
    const processClosed = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const protocol = (async () => {
      await rpc("initialize", {
        clientInfo: { name: "waypoint", title: "Waypoint", version: "0.0.9" },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          mcpServerOpenaiFormElicitation: true,
        },
      });
      notify("initialized");
      const accountResponse = object(
          await rpc("account/read", { refreshToken: false }),
        ),
        account = object(accountResponse.account);
      if (account.type !== "chatgpt")
        throw new Error(
          "Waypoint requires a signed-in ChatGPT subscription in the installed Codex CLI; API-key and managed-provider accounts are not used for this route",
        );
      onEvent({
        type: "diagnostic",
        name: `Codex subscription · ${auditText(account.planType ?? "unknown", request.profile.secretNames, 80)}`,
        rawType: "codex.account.subscription",
      });
      if (/^\/[a-z0-9][a-z0-9._-]*(?:\s|$)/i.test(request.prompt)) {
        try {
          await refreshSkills(false);
          onEvent({
            type: "diagnostic",
            name: `Codex skills · ${discoveredSkills.length} available`,
            rawType: "codex.skills.discovered",
            metadata: {
              skills: discoveredSkills.map((skill) => ({
                name: skill.name,
                scope: skill.scope,
              })),
            },
          });
        } catch (error) {
          onEvent({
            type: "diagnostic",
            name: "Codex skill discovery unavailable",
            text:
              error instanceof Error
                ? error.message
                : "The installed Codex CLI did not return a skill inventory",
            rawType: "codex.skills.unavailable",
          });
        }
      }
      const common = {
        model: request.model ?? null,
        cwd: path.resolve(request.workspaceRoot),
        runtimeWorkspaceRoots: [path.resolve(request.workspaceRoot)],
        approvalPolicy:
          request.profile.approval === "never" ? "never" : "on-request",
        approvalsReviewer:
          request.profile.approval !== "never" ? "user" : null,
        sandbox: codexSandboxMode(request),
        config: {
          web_search:
            request.profile.network === "enabled" ? "live" : "disabled",
          sandbox_workspace_write: {
            network_access: request.profile.network === "enabled",
            writable_roots: [path.resolve(request.workspaceRoot)],
            exclude_tmpdir_env_var: true,
            exclude_slash_tmp: true,
          },
        },
      };
      let session: JsonObject | undefined;
      if (request.providerSessionId)
        try {
          session = object(
            await rpc("thread/resume", {
              threadId: request.providerSessionId,
              ...common,
              excludeTurns: true,
            }),
          );
        } catch (error) {
          onEvent({
            type: "diagnostic",
            name: "Codex session could not be resumed",
            text: error instanceof Error ? error.message : "Resume failed",
            rawType: "codex.thread.resume_failed",
          });
          throw new Error(
            `Codex session ${request.providerSessionId} could not be resumed; reset the provider session explicitly before starting a fresh thread`,
            { cause: error },
          );
        }
      if (!session)
        session = object(
          await rpc("thread/start", {
            ...common,
            dynamicTools: request.onAutomationProposal
              ? [
                  {
                    type: "function",
                    name: "waypoint_automation_proposal",
                    description:
                      "Validate an exact Waypoint webhook automation definition and prepare a pending confirmation card. This never provisions or enables the automation.",
                    inputSchema: automationProposalInputSchema(),
                    deferLoading: false,
                  },
                ]
              : [],
            ephemeral: false,
            historyMode: "paginated",
          }),
        );
      const thread = object(session.thread);
      threadId = String(thread.id ?? "");
      if (!threadId)
        throw new Error("Codex app-server did not return a thread ID");
      if (request.providerSessionId && threadId !== request.providerSessionId)
        throw new Error(
          `Codex resumed an unexpected session (${threadId}); expected ${request.providerSessionId}`,
        );
      if (!request.providerSessionId) request.onSession(threadId);
      const reportMcpStatus = (result: unknown) => {
        const data = Array.isArray(object(result).data)
          ? (object(result).data as unknown[])
          : [];
        onEvent({
          type: "diagnostic",
          name: `Codex MCP · ${data.length} server${data.length === 1 ? "" : "s"}`,
          rawType: "codex.mcp.discovered",
          metadata: {
            servers: data.map((item) => {
              const server = object(item);
              return {
                name: server.name,
                authStatus: server.authStatus,
                toolCount: Object.keys(object(server.tools)).length,
              };
            }),
          },
        });
        return data;
      };
      void rpc("mcpServerStatus/list", {
          threadId,
          detail: "toolsAndAuthOnly",
        })
          .then(reportMcpStatus)
          .catch((error) =>
            onEvent({
              type: "diagnostic",
              name: "Codex MCP discovery unavailable",
              text:
                error instanceof Error
                  ? error.message
                  : "The installed Codex CLI did not return MCP status",
              rawType: "codex.mcp.unavailable",
            }),
          );
      const slash = /^\/([a-z0-9][a-z0-9._-]*)(?:\s+([\s\S]*))?$/i.exec(
          request.prompt.trim(),
        ),
        skill = slash
          ? discoveredSkills.find((candidate) => candidate.name === slash[1])
          : undefined;
      if (
        request.requiredSkillIdentifier &&
        (!slash || slash[1] !== request.requiredSkillIdentifier || !skill)
      )
        throw new Error(
          `Approved Codex skill ${request.requiredSkillIdentifier} is not installed and enabled in the selected repository`,
        );
      const input: unknown[] = [
        ...(skill
          ? [
              { type: "skill", name: skill.name, path: skill.path },
              ...(slash?.[2]
                ? [{ type: "text", text: slash[2], text_elements: [] }]
                : []),
            ]
          : [{ type: "text", text: request.prompt, text_elements: [] }]),
        ...deliveredImages.map((image: CliImageInput) => ({
          type: "localImage",
          path: image.path,
        })),
      ];
      request.beforeTurn?.();
      const started = object(
        await rpc("turn/start", {
          threadId,
          input,
          cwd: path.resolve(request.workspaceRoot),
          runtimeWorkspaceRoots: [path.resolve(request.workspaceRoot)],
          approvalPolicy:
            request.profile.approval === "never" ? "never" : "on-request",
          approvalsReviewer:
            request.profile.approval !== "never" ? "user" : null,
          sandboxPolicy: codexSandboxPolicy(request),
          model: request.model ?? null,
          effort: request.reasoningEffort ?? null,
        }),
      );
      turnId = String(object(started.turn).id ?? "");
      if (!turnId) throw new Error("Codex app-server did not return a turn ID");
      this.steerers.set(runId, async (prompt) => {
        request.beforeTurn?.();
        await rpc("turn/steer", {
          threadId,
          expectedTurnId: turnId,
          input: [{ type: "text", text: prompt, text_elements: [] }],
        });
        onEvent({
          type: "diagnostic",
          name: "User steered active Codex turn",
          rawType: "codex.turn.steered",
        });
      });
      const turn = await turnDone;
      if (turn.status === "failed")
        throw new Error(turn.error?.message ?? "Codex turn failed");
      return turn.status;
    })();
    const completion: RunningExecution["completion"] = (async () => {
      try {
        const result = await Promise.race([
          protocol.then((status) => ({ kind: "turn" as const, status })),
          processClosed.then((code) => ({ kind: "process" as const, code })),
        ]);
        if (result.kind === "process")
          throw new Error(
            stderr.trim() ||
              `Codex app-server exited before the turn completed (code ${result.code})`,
          );
        if (result.kind === "turn" && !settled) {
          child.stdin.end();
          await terminate("SIGTERM");
        }
        if (result.kind === "turn" && result.status === "interrupted")
          canceled = true;
        return {
          status: canceled ? ("canceled" as const) : ("completed" as const),
          exitCode: 0,
        };
      } catch (error) {
        return {
          status: canceled ? ("canceled" as const) : ("failed" as const),
          exitCode: null,
          error:
            error instanceof Error ? error.message : "Codex app-server failed",
        };
      } finally {
        settled = true;
        if (forceTimer) clearTimeout(forceTimer);
        abort.abort();
        for (const waiter of pending.values())
          waiter.reject(new Error("Codex app-server stopped"));
        pending.clear();
        this.active.delete(runId);
        this.steerers.delete(runId);
        cleanupSnapshots();
        if (termination) await termination;
        else if (!child.killed) await terminate("SIGTERM");
      }
    })();
    const running: RunningExecution = {
      executable,
      version: request.version,
      args,
      cancel: () => {
        canceled = true;
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
  async steer(runId: string, prompt: string): Promise<boolean> {
    if (!prompt.trim()) throw new Error("A steer prompt is required");
    if (!this.active.has(runId)) return false;
    for (
      let attempt = 0;
      attempt < 100 && !this.steerers.has(runId) && this.active.has(runId);
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    const steer = this.steerers.get(runId);
    if (!steer) return false;
    await steer(prompt);
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
