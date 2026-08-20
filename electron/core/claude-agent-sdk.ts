import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  createSdkMcpServer,
  getSessionInfo,
  query,
  tool,
  type CanUseTool,
  type Options,
  type Query,
  type SDKMessage,
  type SDKSessionInfo,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { redactToolText } from "./tool-gateway.js";
import { automationReceiverPrerequisite, automationReceiverQuestion } from "./automation-ai-tool.js";
import {
  cliExecutionPath,
  cliProcessInvocation,
  parseCliVersion,
  type DetectionOptions,
} from "../../spikes/cli-capabilities.js";
import {
  validateRequest,
  type CliImageInput,
  type ExecutionEvent,
  type RunningExecution,
  type RunRequest,
} from "./ai-workbench.js";
import type {
  CodexApprovalRequest,
  CodexProviderDecision,
} from "./codex-app-server.js";

type JsonObject = Record<string, unknown>;
type QueryFactory = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => Query;
export const CLAUDE_AGENT_SDK_VERSION = "0.3.229";

export interface ClaudeRunRequest extends Omit<RunRequest, "cli"> {
  cli: "claude";
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

export async function claudeAutomationSkillAvailable(
  sdkQuery: Pick<Query, "reloadSkills" | "supportedCommands">,
  identifier: string,
  discoveredSkills: ReadonlySet<string>,
): Promise<boolean> {
  await sdkQuery.reloadSkills();
  const commands = await sdkQuery.supportedCommands(),
    commandNames = new Set(
      commands.flatMap((command) => {
        const value = object(command);
        return [value.name, value.command]
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.replace(/^\//, ""));
      }),
    );
  return Boolean(
    identifier &&
      (discoveredSkills.has(identifier) || commandNames.has(identifier)),
  );
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
function bounded(value: unknown, max = 16_000): string {
  const encoded = typeof value === "string" ? value : JSON.stringify(value),
    text = encoded ?? "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
function within(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
function scopedPath(value: unknown, root: string): boolean {
  if (typeof value !== "string" || !value.trim()) return true;
  const candidate = path.isAbsolute(value) ? value : path.resolve(root, value);
  if (!within(candidate, root)) return false;
  try {
    const canonicalRoot = realpathSync.native(root);
    let ancestor = path.resolve(candidate);
    while (!existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor || !within(parent, root)) return false;
      ancestor = parent;
    }
    return within(realpathSync.native(ancestor), canonicalRoot);
  } catch {
    return false;
  }
}
function toolWithinRoot(input: JsonObject, root: string): boolean {
  return ["path", "file_path", "notebook_path", "cwd"].every((key) =>
    scopedPath(input[key], root),
  );
}
function isReadTool(name: string): boolean {
  return ["Read", "Glob", "Grep", "LS"].includes(name);
}
function isWriteTool(name: string): boolean {
  return ["Edit", "Write", "NotebookEdit", "MultiEdit"].includes(name);
}
function isNetworkTool(name: string): boolean {
  return ["WebFetch", "WebSearch"].includes(name);
}
export function claudeAgentEnvironment(
  executable: string,
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const allowed = [
      "PATH",
      "Path",
      "PATHEXT",
      "SYSTEMROOT",
      "SystemRoot",
      "WINDIR",
      "ComSpec",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "PROGRAMDATA",
      "HOME",
      "XDG_CONFIG_HOME",
      "LANG",
      "LC_ALL",
      "TERM",
    ],
    env: Record<string, string> = {
      CLAUDE_AGENT_SDK_CLIENT_APP: "waypoint/0.0.9",
    };
  for (const name of allowed) {
      const value = source[name];
      if (value) env[name] = value;
  }
  env.PATH = cliExecutionPath(executable, source, platform);
  return env;
}
function auditableValue(value: unknown, secretNames:string[] = [], depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") return redactToolText(value,secretNames).slice(0, 16_000);
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => auditableValue(item, secretNames, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .slice(0, 100)
        .map(([key, item]) => [key, auditableValue(item, secretNames, depth + 1)]),
    );
  return value;
}
function auditableToolInput(input: JsonObject,secretNames:string[]=[]): JsonObject {
  return auditableValue(input,secretNames) as JsonObject;
}

function exactClaudeVersion(value: string | undefined): string | undefined {
  return value ? parseCliVersion(value)?.join(".") : undefined;
}

/**
 * The Agent SDK otherwise resolves its optional native dependency relative to
 * sdk.mjs. Inside Electron that is a virtual app.asar path and cannot be
 * spawned. Waypoint already discovers and version-checks the user's normal
 * signed-in Claude CLI, so launch that exact executable instead.
 */
export async function claudeAgentLaunchOptions(
  executable: string,
  resolution: Pick<DetectionOptions, "env" | "platform" | "canAccess"> & {
    nodeExecutable?: string;
  } = {},
): Promise<Pick<Options, "executable" | "pathToClaudeCodeExecutable">> {
  const invocation = await cliProcessInvocation(
    "claude",
    executable,
    [],
    resolution,
  );
  if (invocation.args.length === 0)
    return { pathToClaudeCodeExecutable: invocation.executable };
  if (
    invocation.args.length === 1 &&
    /\.(?:c?js|mjs)$/i.test(invocation.args[0])
  )
    return {
      executable: "node",
      pathToClaudeCodeExecutable: invocation.args[0],
    };
  throw new Error("Claude CLI launch resolution returned an unsafe invocation");
}

function questionRequest(
  toolUseId: string,
  input: JsonObject,
  secretNames:string[] = [],
): CodexApprovalRequest {
  const questions: JsonObject[] = Array.isArray(input.questions)
    ? input.questions.map((item, index) => {
        const question = object(item);
        return {
          ...question,
          id: String(
            question.question ?? question.header ?? `question-${index}`,
          ),
          isOther: true,
          isSecret: false,
        };
      })
    : [];
  return {
    providerRequestId: toolUseId,
    kind: "question",
    title:
      questions.map((item) => redactToolText(bounded(item.question, 240),secretNames)).join(" / ") ||
      "Claude needs your input",
    detail: auditableValue({ questions },secretNames) as JsonObject,
    options: auditableValue(questions.flatMap((question) =>
      Array.isArray(question.options) ? question.options : [],
    ),secretNames) as unknown[],
  };
}

function permissionRequest(
  toolName: string,
  toolUseId: string,
  input: JsonObject,
  options: Parameters<CanUseTool>[2],
  secretNames:string[] = [],
): CodexApprovalRequest {
  return {
    providerRequestId: toolUseId,
    kind: isWriteTool(toolName)
      ? "file_change"
      : isNetworkTool(toolName)
        ? "network"
        : toolName === "Bash"
          ? "command"
          : toolName.startsWith("mcp__")
            ? "tool"
            : "permission",
    title:redactToolText(
      String(options.title ?? options.displayName ?? `Claude wants to use ${toolName}`),
      secretNames,
    ),
    detail: auditableValue({
      tool: toolName,
      input: auditableToolInput(input, secretNames),
      blockedPath: options.blockedPath ?? null,
      reason: options.decisionReason ?? options.description ?? null,
    },secretNames) as JsonObject,
    options: auditableValue(options.suggestions ?? [],secretNames) as unknown[],
  };
}

function rawEventsFromMessage(
  message: SDKMessage,
  secretNames: string[] = [],
): ExecutionEvent[] {
  const value = message as unknown as JsonObject;
  if (value.type === "system" && value.subtype === "init")
    return [
      {
        type: "diagnostic",
        name: redactToolText(`Claude ${bounded(value.claude_code_version, 80)} · ${bounded(value.model, 120)}`,secretNames),
        text: `${Array.isArray(value.tools) ? value.tools.length : 0} tools · ${Array.isArray(value.skills) ? value.skills.length : 0} skills · ${Array.isArray(value.plugins) ? value.plugins.length : 0} plugins · ${Array.isArray(value.mcp_servers) ? value.mcp_servers.length : 0} MCP servers`,
        rawType: "claude.system.init",
        metadata: auditableValue({
          sessionId: value.session_id,
          permissionMode: value.permissionMode,
          skills: value.skills,
          mcpServers: value.mcp_servers,
        },secretNames) as JsonObject,
      },
    ];
  if (value.type === "stream_event") {
    const event = object(value.event),
      delta = object(event.delta);
    if (
      delta.type === "text_delta" &&
      typeof delta.text === "string" &&
      delta.text
    )
      return [
        {
          type: "text",
          text: redactToolText(delta.text, secretNames),
          rawType: "claude.stream.text_delta",
        },
      ];
    if (
      delta.type === "thinking_delta" &&
      typeof delta.thinking === "string" &&
      delta.thinking
    )
      return [
        {
          type: "agent",
          name: "Thinking",
          text: redactToolText(delta.thinking, secretNames),
          rawType: "claude.stream.thinking_delta",
        },
      ];
  }
  if (value.type === "assistant") {
    const content = Array.isArray(object(value.message).content)
      ? (object(value.message).content as unknown[])
      : [];
    return content.flatMap<ExecutionEvent>((blockValue) => {
      const block = object(blockValue);
      if (block.type === "tool_use" || block.type === "server_tool_use")
        return [
          {
            type: "tool",
            name: `${bounded(block.name, 160)} started`,
            text: redactToolText(bounded(block.input, 4_000), secretNames),
            rawType: "claude.tool.started",
            metadata: {
              toolUseId: block.id,
              parentToolUseId: value.parent_tool_use_id,
            },
          },
        ];
      if (
        block.type === "thinking" &&
        typeof block.thinking === "string" &&
        block.thinking
      )
        return [
          {
            type: "agent",
            name: "Reasoning",
            text: redactToolText(block.thinking.slice(0, 6_000), secretNames),
            rawType: "claude.reasoning",
          },
        ];
      return [];
    });
  }
  if (value.type === "user") {
    const content = Array.isArray(object(value.message).content)
      ? (object(value.message).content as unknown[])
      : [];
    return content.flatMap<ExecutionEvent>((blockValue) => {
      const block = object(blockValue);
      return block.type === "tool_result"
        ? [
            {
              type: "tool",
              name: block.is_error === true ? "Tool failed" : "Tool completed",
              text: redactToolText(bounded(block.content, 4_000), secretNames),
              rawType: "claude.tool.completed",
              metadata: { toolUseId: block.tool_use_id },
            },
          ]
        : [];
    });
  }
  if (value.type === "result")
    return value.subtype === "success"
      ? [
          {
            type: "text",
            text: redactToolText(String(value.result ?? ""), secretNames),
            rawType: "claude.result",
          },
          {
            type: "diagnostic",
            name: `Claude completed · ${Number(value.num_turns ?? 0)} turn${Number(value.num_turns ?? 0) === 1 ? "" : "s"}`,
            rawType: "claude.usage",
            metadata: {
              usage: value.usage,
              modelUsage: value.modelUsage,
              terminalReason: value.terminal_reason,
            },
          },
        ]
      : [
          {
            type: "diagnostic",
            name: "Claude execution failed",
            text: redactToolText(
              bounded(value.errors ?? value, 6_000),
              secretNames,
            ),
            rawType: "claude.result.error",
          },
        ];
  if (
    value.type === "system" &&
    [
      "task_started",
      "task_progress",
      "task_notification",
      "task_updated",
    ].includes(String(value.subtype))
  )
    return [
      {
        type: "agent",
        name: `Claude agent · ${String(value.subtype).replace("task_", "")}`,
        text: redactToolText(bounded(value.summary ?? value.description ?? value, 4_000),secretNames),
        rawType: `claude.${value.subtype}`,
        metadata: { taskId: value.task_id, toolUseId: value.tool_use_id },
      },
    ];
  if (value.type === "tool_progress")
    return [
      {
        type: "tool",
        name: `${bounded(value.tool_name ?? "Tool", 120)} progress`,
        text: redactToolText(bounded(value.elapsed_time_seconds ?? value, 2_000),secretNames),
        rawType: "claude.tool.progress",
      },
    ];
  if (value.type === "auth_status")
    return [
      {
        type: "diagnostic",
        name: value.error
          ? "Claude authentication failed"
          : "Claude authentication status",
        text: redactToolText(bounded(value.error ?? value.output, 3_000),secretNames),
        rawType: "claude.auth",
      },
    ];
  if (value.type === "system" && value.subtype === "permission_denied")
    return [
      {
        type: "diagnostic",
        name: "Claude permission denied",
        text: redactToolText(bounded(value, 4_000),secretNames),
        rawType: "claude.permission.denied",
      },
    ];
  return [];
}

function eventFromMessage(
  message: SDKMessage,
  secretNames: string[] = [],
): ExecutionEvent[] {
  return rawEventsFromMessage(message,secretNames).map((event)=>{
    const audited=auditableValue(event,secretNames) as ExecutionEvent;
    return {...audited,type:event.type};
  });
}

async function* promptStream(
  prompt: string,
  images: CliImageInput[],
  ready: Promise<void> = Promise.resolve(),
): AsyncGenerator<SDKUserMessage> {
  await ready;
  const content: JsonObject[] = [{ type: "text", text: prompt }];
  for (const image of images) {
    const bytes = readFileSync(image.path);
    if (createHash("sha256").update(bytes).digest("hex") !== image.sha256)
      throw new Error("Attachment image integrity check failed");
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: bytes.toString("base64"),
      },
    });
  }
  yield {
    type: "user",
    message: { role: "user", content } as never,
    parent_tool_use_id: null,
    session_id: "",
  };
}

export class ClaudeAgentWorkbench {
  private readonly active = new Map<
    string,
    { running: RunningExecution; query: Query; controller: AbortController }
  >();
  constructor(
    private readonly queryFactory: QueryFactory = query,
    private readonly sessionInfo: (
      sessionId: string,
      options: { dir: string },
    ) => Promise<SDKSessionInfo | undefined> = getSessionInfo,
  ) {}

  async start(
    runId: string,
    request: ClaudeRunRequest,
    onEvent: (event: ExecutionEvent) => void,
  ): Promise<RunningExecution> {
    validateRequest(request);
    if (this.active.size >= request.profile.maxConcurrency)
      throw new Error("Execution concurrency limit reached");
    request.beforeSpawn?.();
    request.beforeTurn?.();
    const expectedVersion = exactClaudeVersion(request.version);
    if (!expectedVersion)
      throw new Error("Claude CLI version provenance is unavailable");
    if (!request.executable)
      throw new Error("Claude CLI executable provenance is unavailable");
    const launchOptions = await claudeAgentLaunchOptions(request.executable),
      controller = new AbortController(),
      root = realpathSync.native(path.resolve(request.workspaceRoot)),
      sessionApprovedTools = new Set<string>();
    if (request.providerSessionId) {
      const prior = await this.sessionInfo(request.providerSessionId, { dir: root });
      if (
        !prior ||
        prior.sessionId !== request.providerSessionId ||
        typeof prior.cwd !== "string" ||
        realpathSync.native(prior.cwd) !== realpathSync.native(root)
      )
        throw new Error(
          "Claude resume provenance is unavailable for the exact Waypoint session and repository",
        );
    }
    let canceled = false,
      requiredSkillInvoked = false,
      sessionId: string | undefined = request.providerSessionId;
    const discoveredSkills = new Set<string>();
    const waypointMcp = request.onAutomationProposal
      ? createSdkMcpServer({
          name: "waypoint",
          version: "1.0.0",
          instructions:
            "Use automation_proposal to validate and prepare webhook automations. A successful call only creates a pending confirmation card; it never provisions or enables the automation.",
          alwaysLoad: true,
          tools: [
            tool(
              "automation_proposal",
              "Validate an exact Waypoint webhook automation definition and prepare it for explicit user confirmation. Call this instead of printing a fenced proposal.",
              { definition: z.record(z.string(), z.unknown()) },
              async ({ definition }) => {
                const action = object(definition.action);
                if (action.kind === "ai_skill") {
                  if (action.provider !== "claude")
                    return {
                      content: [
                        {
                          type: "text" as const,
                          text: "Automation proposal rejected: this Claude session can verify only Claude skills.",
                        },
                      ],
                      isError: true,
                    };
                  const identifier = String(action.skillIdentifier ?? "");
                  if (!(await claudeAutomationSkillAvailable(
                    sdkQuery,
                    identifier,
                    discoveredSkills,
                  )))
                    return {
                      content: [
                        {
                          type: "text" as const,
                          text: `Automation proposal rejected: exact Claude skill or slash command ${identifier || "<missing>"} is not in this session's refreshed provider inventory.`,
                        },
                      ],
                      isError: true,
                    };
                }
                try {
                  const result = await request.onAutomationProposal!(definition);
                  return {
                    content: [
                      {
                        type: "text" as const,
                        text: result.summary ?? `Pending Waypoint automation proposal ${result.proposalId} was validated and prepared for explicit user confirmation. It is not provisioned or enabled.`,
                      },
                    ],
                  };
                } catch (error) {
                  const prerequisite = automationReceiverPrerequisite(error);
                  if (prerequisite)
                    await request.onApproval(
                      automationReceiverQuestion(`automation-receiver-${Date.now()}`, prerequisite),
                      controller.signal,
                    );
                  return {
                    content: [
                      {
                        type: "text" as const,
                        text: `Automation proposal rejected: ${error instanceof Error ? error.message : "validation failed"}. Correct the definition and call this tool again. Repository file changes made earlier in the run are unaffected.`,
                      },
                    ],
                    isError: true,
                  };
                }
              },
              { alwaysLoad: true },
            ),
          ],
        })
      : undefined;
    const canUseTool: CanUseTool = async (toolName, input, options) => {
      if (options.signal.aborted)
        return {
          behavior: "deny",
          message: "Execution canceled",
          interrupt: true,
        };
      try {
        request.beforeTurn?.();
      } catch {
        return {
          behavior: "deny",
          message: "The selected Waypoint repository changed during execution.",
          interrupt: true,
        };
      }
      if (!toolWithinRoot(input, root))
        return {
          behavior: "deny",
          message:
            "The requested path is outside the selected Waypoint repository.",
        };
      if (isReadTool(toolName))
        return { behavior: "allow", updatedInput: input };
      if (toolName === "AskUserQuestion") {
        const outcome = await request.onApproval(
          questionRequest(options.toolUseID, input,request.profile.secretNames),
          options.signal,
        );
        if (!["accepted", "accepted_session"].includes(outcome.status))
          return {
            behavior: "deny",
            message: "The user declined the question.",
            interrupt: outcome.status === "canceled",
          };
        const supplied = object(outcome.decision.answers),
          questions = Array.isArray(input.questions)
            ? input.questions.map(object)
            : [],
          answers = Object.fromEntries(
            questions.map((question, index) => {
              const id = String(
                  question.question ?? question.header ?? `question-${index}`,
                ),
                answer = supplied[id];
              return [
                id,
                Array.isArray(answer)
                  ? answer.map(String).join(", ")
                  : String(answer ?? ""),
              ];
            }),
          );
        return { behavior: "allow", updatedInput: { ...input, answers } };
      }
      if (toolName === "mcp__waypoint__automation_proposal")
        return { behavior: "allow", updatedInput: input };
      if (
        toolName.startsWith("mcp__") &&
        !request.profile.tools.includes("mcp")
      )
        return {
          behavior: "deny",
          message: "The selected Waypoint profile does not allow MCP tools.",
        };
      if (toolName === "Skill" && !request.profile.tools.includes("skills"))
        return {
          behavior: "deny",
          message: "The selected Waypoint profile does not allow skills.",
        };
      if (toolName === "Skill" && request.requiredSkillIdentifier) {
        const requested = String(
          input.skill ?? input.name ?? input.command ?? "",
        ).replace(/^\//, "");
        if (requested !== request.requiredSkillIdentifier)
          return {
            behavior: "deny",
            message: "This automation is approved for a different exact skill.",
            interrupt: true,
          };
        requiredSkillInvoked = true;
        return { behavior: "allow", updatedInput: input };
      }
      if (
        request.profile.filesystem === "read-only" &&
        (isWriteTool(toolName) || toolName === "Bash")
      )
        return {
          behavior: "deny",
          message: "The selected Waypoint profile is read-only.",
        };
      if (request.profile.network !== "enabled" && isNetworkTool(toolName))
        return {
          behavior: "deny",
          message: "The selected Waypoint profile does not allow web tools.",
        };
      if (request.profile.approval === "never")
        return { behavior: "allow", updatedInput: input };
      if (sessionApprovedTools.has(toolName))
        return { behavior: "allow", updatedInput: input };
      const outcome = await request.onApproval(
        permissionRequest(toolName, options.toolUseID, input, options,request.profile.secretNames),
        options.signal,
      );
      if (!["accepted", "accepted_session"].includes(outcome.status))
        return {
          behavior: "deny",
          message: "The user declined this tool call.",
          interrupt: outcome.status === "canceled",
        };
      try {
        request.beforeTurn?.();
      } catch {
        return {
          behavior: "deny",
          message:
            "The selected Waypoint repository changed while approval was pending.",
          interrupt: true,
        };
      }
      if (!toolWithinRoot(input, root))
        return {
          behavior: "deny",
          message:
            "The approved path is no longer inside the selected Waypoint repository.",
          interrupt: true,
        };
      if (outcome.status === "accepted_session")
        sessionApprovedTools.add(toolName);
      return { behavior: "allow", updatedInput: input };
    };
    const askRules = [
        "Bash(*)",
        "Edit(*)",
        "Write(*)",
        "NotebookEdit(*)",
        "Read(*)",
        "Glob(*)",
        "Grep(*)",
        "AskUserQuestion(*)",
        "WebFetch(*)",
        "WebSearch(*)",
        "mcp__*",
      ],
      networkBlocked = request.profile.network !== "enabled";
    const bypassPreToolUse = async (
      inputValue: unknown,
      _toolUseId: string | undefined,
      options: { signal: AbortSignal },
    ) => {
      const hook = object(inputValue),
        toolName = String(hook.tool_name ?? ""),
        input = object(hook.tool_input),
        toolUseId = String(hook.tool_use_id ?? _toolUseId ?? "");
      const deny = (reason: string) => {
        onEvent({
          type: "diagnostic",
          name: `${toolName || "Claude tool"} denied by Waypoint`,
          text: reason,
          rawType: "claude.hook.pre_tool_use.denied",
          metadata: { toolUseId },
        });
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "deny" as const,
            permissionDecisionReason: reason,
          },
        };
      };
      if (options.signal.aborted) return deny("Execution canceled");
      try {
        request.beforeTurn?.();
      } catch {
        return deny("The selected Waypoint repository changed during execution.");
      }
      if (toolName !== "Bash" && !toolWithinRoot(input, root))
        return deny("The requested path is outside the selected Waypoint repository.");
      if (
        toolName.startsWith("mcp__") &&
        toolName !== "mcp__waypoint__automation_proposal" &&
        !request.profile.tools.includes("mcp")
      )
        return deny("The selected Waypoint profile does not allow MCP tools.");
      if (toolName === "Skill" && !request.profile.tools.includes("skills"))
        return deny("The selected Waypoint profile does not allow skills.");
      if (toolName === "Skill" && request.requiredSkillIdentifier) {
        const requested = String(
          input.skill ?? input.name ?? input.command ?? "",
        ).replace(/^\//, "");
        if (requested !== request.requiredSkillIdentifier)
          return deny("This automation is approved for a different exact skill.");
        requiredSkillInvoked = true;
      }
      if (
        request.profile.filesystem === "read-only" &&
        (isWriteTool(toolName) || toolName === "Bash")
      )
        return deny("The selected Waypoint profile is read-only.");
      if (request.profile.network !== "enabled" && isNetworkTool(toolName))
        return deny("The selected Waypoint profile does not allow web tools.");
      if (request.profile.approval !== "never") return {};
      if (toolName === "AskUserQuestion") {
        const outcome = await request.onApproval(
          questionRequest(toolUseId, input,request.profile.secretNames),
          options.signal,
        );
        if (!["accepted", "accepted_session"].includes(outcome.status))
          return deny("The user declined the question.");
        const supplied = object(outcome.decision.answers),
          questions = Array.isArray(input.questions)
            ? input.questions.map(object)
            : [],
          answers = Object.fromEntries(
            questions.map((question, index) => {
              const id = String(
                  question.question ?? question.header ?? `question-${index}`,
                ),
                answer = supplied[id];
              return [
                id,
                Array.isArray(answer)
                  ? answer.map(String).join(", ")
                  : String(answer ?? ""),
              ];
            }),
          );
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "allow" as const,
            updatedInput: { ...input, answers },
          },
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "allow" as const,
          updatedInput: input,
        },
      };
    };
    const verifyPromptSession = async (inputValue: unknown) => {
      const hook = object(inputValue),
        reported = String(hook.session_id ?? ""),
        cwd = String(hook.cwd ?? ""),
        validRoot = (() => {
          try {
            return Boolean(cwd) && realpathSync.native(cwd) === realpathSync.native(root);
          } catch {
            return false;
          }
        })();
      if (!reported || !validRoot || (sessionId && reported !== sessionId)) {
        onEvent({
          type: "diagnostic",
          name: "Claude prompt blocked by Waypoint",
          text: "The Claude provider session or repository identity changed before the prompt was processed.",
          rawType: "claude.hook.user_prompt_submit.denied",
        });
        return {
          decision: "block" as const,
          reason: "Claude provider session identity changed",
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit" as const,
            suppressOriginalPrompt: true,
          },
        };
      }
      if (!sessionId) {
        sessionId = reported;
        request.onSession(sessionId);
      }
      return {};
    };
    let releasePrompt!: () => void;
    const promptReady = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    const sdkQuery = this.queryFactory({
      prompt: promptStream(request.prompt, request.images ?? [], promptReady),
      options: {
        ...launchOptions,
        abortController: controller,
        cwd: root,
        model: request.model,
        resume: request.providerSessionId,
        tools:
          request.profile.filesystem === "read-only"
            ? ["Read", "Glob", "Grep", "AskUserQuestion"]
            : { type: "preset", preset: "claude_code" },
        skills: request.profile.tools.includes("skills") ? "all" : [],
        mcpServers: waypointMcp ? { waypoint: waypointMcp } : undefined,
        settingSources: ["user", "project", "local"],
        permissionMode:
          request.profile.approval === "never"
            ? "bypassPermissions"
            : "default",
        allowDangerouslySkipPermissions:
          request.profile.approval === "never" ? true : undefined,
        canUseTool,
        hooks: {
          PreToolUse: [{ hooks: [bypassPreToolUse] }],
          UserPromptSubmit: [{ hooks: [verifyPromptSession] }],
        },
        settings: {
          permissions: {
            ask: askRules,
            deny: networkBlocked ? ["WebFetch(*)", "WebSearch(*)"] : [],
            disableBypassPermissionsMode:
              request.profile.approval === "never" ? undefined : "disable",
          },
          sandbox: {
            enabled: process.platform !== "win32",
            failIfUnavailable: process.platform !== "win32",
            autoAllowBashIfSandboxed: false,
            allowUnsandboxedCommands: process.platform === "win32",
            ...(networkBlocked
              ? {
                  network: {
                    allowedDomains: [],
                    deniedDomains: ["*"],
                    strictAllowlist: true,
                  },
                }
              : {}),
          },
        },
        env: claudeAgentEnvironment(request.executable),
        includePartialMessages: true,
        forwardSubagentText: true,
        stderr: (data) =>
          onEvent({
            type: "diagnostic",
            name: "Claude stderr",
            text: redactToolText(bounded(data, 2_000),request.profile.secretNames),
            rawType: "claude.stderr",
          }),
      },
    });
    const completion: RunningExecution["completion"] = (async () => {
      try {
        const initialization = await sdkQuery.initializationResult();
        if (waypointMcp) {
          try {
            await sdkQuery.setMcpServers({ waypoint: waypointMcp });
            await sdkQuery.reloadSkills();
            let waypointStatus: unknown;
            for (let attempt = 0; attempt < 50; attempt += 1) {
              waypointStatus = (await sdkQuery.mcpServerStatus()).find(
                (item) => object(item).name === "waypoint",
              );
              if (object(waypointStatus).status === "connected") break;
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            if (object(waypointStatus).status !== "connected")
              throw new Error("Waypoint MCP did not report connected");
            onEvent({
              type: "diagnostic",
              name: request.providerSessionId ? "Waypoint MCP reattached" : "Waypoint MCP connected",
              text: `The native automation tool was connected before the ${request.providerSessionId ? "resumed" : "fresh"} Claude turn started.`,
              rawType: request.providerSessionId ? "claude.mcp.reattached" : "claude.mcp.connected",
            });
          } catch (error) {
            throw new Error(
              `Could not connect Waypoint MCP before the Claude turn: ${error instanceof Error ? error.message : "unknown error"}`,
              { cause: error },
            );
          }
        }
        const
          account = object(initialization.account),
          supportedCommands = await sdkQuery.supportedCommands(),
          commandNames = new Set(
            supportedCommands.flatMap((command) => {
              const value = object(command);
              return [value.name, value.command]
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.replace(/^\//, ""));
            }),
          ),
          requestedSlash = /^\/([a-z0-9][a-z0-9._-]*)(?:\s|$)/i.exec(
            request.prompt.trimStart(),
          )?.[1];
        if (
          account.apiProvider !== "firstParty" ||
          typeof account.subscriptionType !== "string" ||
          !account.subscriptionType.trim() ||
          account.apiKeySource !== undefined
        )
          throw new Error(
            "Claude subscription authentication provenance is invalid",
          );
        if (
          request.requiredSkillIdentifier &&
          !commandNames.has(request.requiredSkillIdentifier)
        )
          throw new Error(
            `Approved Claude skill or slash command ${request.requiredSkillIdentifier} is not installed and enabled in the selected repository`,
          );
        releasePrompt();
        let resultStatus: "success" | "error" | undefined,
          initialized = false;
        if (
          request.requiredSkillIdentifier &&
          requestedSlash === request.requiredSkillIdentifier &&
          commandNames.has(request.requiredSkillIdentifier)
        )
          requiredSkillInvoked = true;
        for await (const message of sdkQuery) {
          const value = message as unknown as JsonObject;
          if (value.type === "system" && value.subtype === "init") {
            if (
              initialized ||
              value.claude_code_version !== expectedVersion ||
              typeof value.session_id !== "string" ||
              !value.session_id ||
              (request.providerSessionId !== undefined &&
                value.session_id !== request.providerSessionId) ||
              !["none", "oauth"].includes(String(value.apiKeySource)) ||
              typeof value.cwd !== "string" ||
              realpathSync.native(value.cwd) !== root ||
              !Array.isArray(value.tools) ||
              !Array.isArray(value.skills) ||
              !Array.isArray(value.plugins) ||
              !Array.isArray(value.mcp_servers)
            )
              throw new Error(
                "Claude Agent SDK initialization provenance is invalid",
              );
            initialized = true;
            for (const skill of value.skills) discoveredSkills.add(String(skill));
            if (
              request.requiredSkillIdentifier &&
              !value.skills.includes(request.requiredSkillIdentifier) &&
              !commandNames.has(request.requiredSkillIdentifier)
            )
              throw new Error(
                `Approved Claude skill or slash command ${request.requiredSkillIdentifier} is not installed and enabled in the selected repository`,
              );
          }
          if (
            typeof value.session_id === "string" &&
            value.session_id
          ) {
            if (sessionId && value.session_id !== sessionId)
              throw new Error("Claude provider session identity changed during execution");
            if (!sessionId) {
              sessionId = value.session_id;
              request.onSession(sessionId);
            }
          }
          if (value.type === "result") {
            if (
              !initialized ||
              typeof value.session_id !== "string" ||
              value.session_id !== sessionId ||
              !Number.isSafeInteger(value.num_turns) ||
              Number(value.num_turns) < 0 ||
              !Number.isFinite(value.duration_ms) ||
              !Number.isFinite(value.duration_api_ms) ||
              !value.usage ||
              typeof value.usage !== "object" ||
              !value.modelUsage ||
              typeof value.modelUsage !== "object" ||
              !Array.isArray(value.permission_denials)
            )
              throw new Error("Claude Agent SDK terminal result is invalid");
            if (
              value.subtype === "success" &&
              (typeof value.result !== "string" || value.is_error !== false)
            )
              throw new Error("Claude Agent SDK success result is invalid");
            resultStatus = value.subtype === "success" ? "success" : "error";
          }
          for (const event of eventFromMessage(
            message,
            request.profile.secretNames,
          )) {
            onEvent(event);
          }
        }
        if (!initialized)
          throw new Error("Claude Agent SDK ended without initialization");
        if (!resultStatus)
          throw new Error("Claude Agent SDK ended without a terminal result");
        if (resultStatus === "error")
          throw new Error("Claude Agent SDK reported an execution failure");
        if (request.requiredSkillIdentifier && !requiredSkillInvoked)
          throw new Error(
            `Claude completed without invoking the approved exact skill ${request.requiredSkillIdentifier}`,
          );
        return {
          status: canceled
              ? ("canceled" as const)
              : ("completed" as const),
          exitCode: 0,
        };
      } catch (error) {
        return {
          status: canceled
              ? ("canceled" as const)
              : ("failed" as const),
          exitCode: null,
          error:
            error instanceof Error ? error.message : "Claude Agent SDK failed",
        };
      } finally {
        releasePrompt();
        this.active.delete(runId);
        controller.abort();
        sdkQuery.close();
      }
    })();
    const running: RunningExecution = {
      executable: request.executable,
      version: `SDK ${CLAUDE_AGENT_SDK_VERSION} · Claude Code ${expectedVersion}`,
      args: ["query"],
      cancel: () => {
        canceled = true;
        void sdkQuery.interrupt().catch(() => undefined);
        controller.abort();
        sdkQuery.close();
      },
      completion,
    };
    this.active.set(runId, { running, query: sdkQuery, controller });
    return running;
  }
  cancel(runId: string): boolean {
    const active = this.active.get(runId);
    if (!active) return false;
    active.running.cancel();
    return true;
  }
  async cancelAndWait(runId: string): Promise<boolean> {
    const active = this.active.get(runId);
    if (!active) return false;
    active.running.cancel();
    await active.running.completion;
    return true;
  }
  cancelAll(): void {
    for (const active of this.active.values()) active.running.cancel();
  }
  async shutdown(graceMs = 2_500): Promise<void> {
    const completions = [...this.active.values()].map(
      ({ running }) => running.completion,
    );
    this.cancelAll();
    if (completions.length)
      await Promise.race([
        Promise.allSettled(completions),
        new Promise<void>((resolve) => setTimeout(resolve, graceMs)),
      ]);
  }
}

export const claudeMessageEvents = eventFromMessage;
