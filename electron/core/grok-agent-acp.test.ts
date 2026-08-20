import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SecurityProfile } from "./ai-workbench.js";
import {
  GrokAgentWorkbench,
  cleanupStaleGrokAutomationDirectories,
  grokAgentArgs,
  grokApprovalRequest,
  grokExecutionEnvironment,
  grokUpdateEvents,
  markGrokAutomationIsolationDirectory,
  parseGrokSubscriptionStatus,
  validateGrokWireMessage,
  type GrokRunRequest,
} from "./grok-agent-acp.js";

const TEST_ROOT = path.resolve(process.cwd());
const OUTSIDE_ROOT = path.resolve(TEST_ROOT, "..", "waypoint-grok-outside");

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    if (this.killed) return false;
    this.killed = true;
    queueMicrotask(() => this.emit("close", 0));
    return true;
  }
}

function profile(overrides: Partial<SecurityProfile> = {}): SecurityProfile {
  return {
    id: "developer",
    name: "Developer · approve changes",
    roots: [TEST_ROOT],
    filesystem: "workspace-write",
    network: "disabled",
    tools: ["terminal", "files", "skills", "mcp"],
    maxDurationMs: 0,
    maxConcurrency: 1,
    approval: "on-write",
    peerEligible: false,
    secretNames: [],
    ...overrides,
  };
}

function request(overrides: Partial<GrokRunRequest> = {}): GrokRunRequest {
  return {
    cli: "grok",
    prompt: "Inspect the repository",
    workspaceRoot: TEST_ROOT,
    profile: profile(),
    executable: "D:\\bin\\grok.exe",
    version: "grok 1.0.3 (test) [stable]",
    onSession: vi.fn(),
    onApproval: vi.fn(async () => ({
      status: "accepted" as const,
      decision: {},
    })),
    ...overrides,
  };
}

type HarnessOptions = {
  protocolVersion?: number;
  authMethods?: ReadonlyArray<{
    id: string;
    name: string;
    description?: string;
  }>;
  agentVersion?: string;
  updateSessionId?: string;
  paginatedSession?: boolean;
  loadUpdateSessionId?: string;
  rawMalformedJson?: boolean;
  malformedUpdate?: boolean;
  nestedMalformedUpdate?: boolean;
  permission?: {
    toolCallId?: string;
    name?: string;
    title?: string;
    kind?: string;
    rawInput?: unknown;
    locations?: unknown;
    content?: unknown;
  };
  permissionOptions?: Array<{
    optionId: string;
    name: string;
    kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
  }>;
  permissionStopReason?: "end_turn" | "cancelled";
  automation?: boolean;
  automationExtraTool?: string;
  automationSdk?: boolean;
  automationProposalDefinition?: Record<string, unknown>;
  automationRetryAfterError?: boolean;
  automationDuplicateAfterSuccess?: boolean;
  automationPreSessionId?: string;
  automationSkipMcpInitialize?: boolean;
  isolatedNoTools?: boolean;
  skills?: Array<{
    name: string;
    userInvocable: boolean;
    compatibilityStatus?: string;
  }>;
  subscriptionVerifier?: (
    executable: string,
    environment: NodeJS.ProcessEnv,
    signal: AbortSignal,
  ) => Promise<{
    signedIn: true;
    defaultModel?: string;
    models: string[];
    rawSummary: string;
  }>;
};

function harness(options: HarnessOptions = {}) {
  const child = new FakeChild(),
    messages: Array<Record<string, unknown>> = [],
    send = (value: unknown) => child.stdout.write(`${JSON.stringify(value)}\n`);
  let input = "",
    pendingPromptId: unknown,
    automationSessionId = "automation-session";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk: string) => {
    input += chunk;
    const lines = input.split(/\r?\n/);
    input = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      messages.push(message);
      const method = String(message.method ?? ""),
        id = message.id;
      queueMicrotask(() => {
        if (method === "initialize")
          send({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: options.protocolVersion ?? 1,
              agentCapabilities: {
                loadSession: true,
                promptCapabilities: {
                  image: false,
                  audio: false,
                  embeddedContext: true,
                },
                sessionCapabilities: { list: {}, resume: {}, close: {} },
              },
              authMethods: options.authMethods ?? [
                { id: "cached_token", name: "cached_token" },
                { id: "grok.com", name: "Grok" },
              ],
              _meta: {
                grokShell: true,
                "x.ai/mcp/sdk":
                  options.automationSdk ?? options.automation ?? false,
                defaultAuthMethodId: "cached_token",
                agentVersion: options.agentVersion ?? "1.0.3",
                modelState: {
                  availableModels: [{ modelId: "grok-4.6" }],
                },
              },
            },
          });
        else if (method === "x.ai/mcp/list") {
          send({
            jsonrpc: "2.0",
            id,
            result: (message.params as Record<string, unknown>)?.sessionId
              ? {
                  servers: [
                    {
                      name: "managed_gateway:voice",
                      type: "managedGateway",
                      session: { enabled: false, tools: [] },
                    },
                    {
                      name: "context7",
                      type: "stdio",
                      session: { enabled: false, tools: [] },
                    },
                    {
                      name: "waypoint",
                      type: "stdio",
                      session: {
                        enabled: true,
                        tools: [
                          {
                            name: "waypoint__automation_proposal",
                            enabled: true,
                          },
                        ],
                      },
                    },
                  ],
                }
              : {
                  servers: [
                    {
                      name: "managed_gateway:voice",
                      type: "managedGateway",
                      session: { enabled: true, tools: [] },
                    },
                    {
                      name: "context7",
                      type: "stdio",
                      session: { enabled: true, tools: [] },
                    },
                  ],
                },
          });
        } else if (method === "session/list") {
          const params = message.params as Record<string, unknown>;
          if (options.paginatedSession && !params.cursor)
            send({
              jsonrpc: "2.0",
              id,
              result: {
                sessions: [],
                nextCursor: "page-2",
              },
            });
          else
            send({
              jsonrpc: "2.0",
              id,
              result: {
                sessions: [
                  {
                    sessionId: "existing-session",
                    cwd: TEST_ROOT,
                    title: "Existing",
                    updatedAt: "2026-08-14T12:00:00Z",
                  },
                ],
              },
            });
        } else if (method === "session/resume" || method === "session/load") {
          if (method === "session/load" && options.loadUpdateSessionId)
            send({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: options.loadUpdateSessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "Loaded history" },
                },
              },
            });
          send({ jsonrpc: "2.0", id, result: {} });
        } else if (method === "session/new") {
          automationSessionId = options.automation
            ? "automation-session"
            : "new-session";
          if (options.isolatedNoTools)
            send({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: automationSessionId,
                update: {
                  sessionUpdate: "available_commands_update",
                  availableCommands: [],
                  _meta: { tools: [] },
                },
              },
            });
          if (options.automation) {
            send({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId:
                  options.automationPreSessionId ?? automationSessionId,
                update: {
                  sessionUpdate: "available_commands_update",
                  availableCommands: [],
                  _meta: {
                    tools: [
                      "use_tool",
                      ...(options.automationExtraTool
                        ? [options.automationExtraTool]
                        : []),
                    ],
                  },
                },
              },
            });
            send({
              jsonrpc: "2.0",
              id: options.automationSkipMcpInitialize ? "mcp-list" : "mcp-init",
              method: "_x.ai/mcp/sdk_call",
              params: {
                serverId: "waypoint-automation",
                message: {
                  jsonrpc: "2.0",
                  id: options.automationSkipMcpInitialize ? 1 : 0,
                  method: options.automationSkipMcpInitialize
                    ? "tools/list"
                    : "initialize",
                  params: options.automationSkipMcpInitialize
                    ? {}
                    : { protocolVersion: "2025-11-25" },
                },
              },
            });
          }
          send({
            jsonrpc: "2.0",
            id,
            result: { sessionId: automationSessionId },
          });
        } else if (method === "session/prompt") {
          const params = message.params as Record<string, unknown>;
          if (options.automation) {
            pendingPromptId = id;
            send({
              jsonrpc: "2.0",
              id: "mcp-call-1",
              method: "_x.ai/mcp/sdk_call",
              params: {
                serverId: "waypoint-automation",
                message: {
                  jsonrpc: "2.0",
                  id: 2,
                  method: "tools/call",
                  params: {
                    name: "automation_proposal",
                    arguments: {
                      definition: options.automationProposalDefinition ?? {
                        version: 1,
                        title: "Grok proof",
                        action: { kind: "ai_prompt", provider: "grok" },
                      },
                    },
                  },
                },
              },
            });
            return;
          }
          if (options.permission) {
            pendingPromptId = id;
            send({
              jsonrpc: "2.0",
              id: "permission-1",
              method: "session/request_permission",
              params: {
                sessionId: params.sessionId,
                toolCall: {
                  toolCallId: options.permission.toolCallId ?? "tool-1",
                  title: options.permission.name,
                  ...options.permission,
                },
                options: options.permissionOptions ?? [
                  {
                    optionId: "allow",
                    name: "Allow once",
                    kind: "allow_once",
                  },
                  {
                    optionId: "reject",
                    name: "Reject",
                    kind: "reject_once",
                  },
                ],
              },
            });
            return;
          }
          if (options.rawMalformedJson)
            child.stdout.write('{"jsonrpc":"2.0","method":\n');
          else if (options.nestedMalformedUpdate)
            send({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "bogus" },
                },
              },
            });
          else if (options.malformedUpdate)
            child.stdout.write(
              '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"new-session","update":{"sessionUpdate":"tool_call"}}}\n',
            );
          else
            send({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: options.updateSessionId ?? params.sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "Hello from Grok" },
                },
              },
            });
          send({
            jsonrpc: "2.0",
            id,
            result: { stopReason: "end_turn" },
          });
        } else if (message.id === "mcp-init") {
          send({
            jsonrpc: "2.0",
            id: "mcp-list",
            method: "_x.ai/mcp/sdk_call",
            params: {
              serverId: "waypoint-automation",
              message: {
                jsonrpc: "2.0",
                id: 1,
                method: "tools/list",
                params: {},
              },
            },
          });
        } else if (message.id === "mcp-list") {
          send({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: automationSessionId,
              update: {
                sessionUpdate: "available_commands_update",
                availableCommands: [],
                _meta: {
                  tools: [
                    "use_tool",
                    "waypoint__search_tool",
                    "waypoint__automation_proposal",
                  ],
                },
              },
            },
          });
        } else if (
          String(message.id).startsWith("mcp-call-") &&
          pendingPromptId
        ) {
          const inner = message.result as Record<string, unknown> | undefined,
            innerResult = inner?.result as Record<string, unknown> | undefined;
          if (
            options.automationRetryAfterError &&
            message.id === "mcp-call-1" &&
            innerResult?.isError === true
          )
            send({
              jsonrpc: "2.0",
              id: "mcp-call-2",
              method: "_x.ai/mcp/sdk_call",
              params: {
                serverId: "waypoint-automation",
                message: {
                  jsonrpc: "2.0",
                  id: 3,
                  method: "tools/call",
                  params: {
                    name: "automation_proposal",
                    arguments: {
                      definition: {
                        version: 1,
                        title: "Corrected Grok proof",
                        action: { kind: "ai_prompt", provider: "grok" },
                      },
                    },
                  },
                },
              },
            });
          else if (
            options.automationDuplicateAfterSuccess &&
            message.id === "mcp-call-1" &&
            innerResult?.isError !== true
          )
            send({
              jsonrpc: "2.0",
              id: "mcp-call-2",
              method: "_x.ai/mcp/sdk_call",
              params: {
                serverId: "waypoint-automation",
                message: {
                  jsonrpc: "2.0",
                  id: 3,
                  method: "tools/call",
                  params: {
                    name: "automation_proposal",
                    arguments: {
                      definition: {
                        version: 1,
                        title: "Duplicate Grok proof",
                        action: { kind: "ai_prompt", provider: "grok" },
                      },
                    },
                  },
                },
              },
            });
          else {
            send({
              jsonrpc: "2.0",
              id: pendingPromptId,
              result: { stopReason: "end_turn" },
            });
            pendingPromptId = undefined;
          }
        } else if (message.id === "permission-1" && pendingPromptId) {
          send({
            jsonrpc: "2.0",
            id: pendingPromptId,
            result: { stopReason: options.permissionStopReason ?? "end_turn" },
          });
          pendingPromptId = undefined;
        }
      });
    }
  });
  const workbench = new GrokAgentWorkbench(
    (() => child) as never,
    async () => "D:\\bin\\grok.exe",
    "win32",
    async () => ({ executable: "D:\\bin\\grok.exe", args: [] }),
    async (target) => {
      target.kill();
    },
    options.subscriptionVerifier ??
      (async () => ({
        signedIn: true,
        defaultModel: "grok-4.6",
        models: ["grok-4.6"],
        rawSummary: "You are logged in with grok.com.",
      })),
    async () => ({
      skills: options.skills ?? [
        {
          name: "review",
          userInvocable: true,
          compatibilityStatus: "enabled",
        },
      ],
      mcpServerNames: ["context7", "unityMCP"],
    }),
    () => ({
      home: mkdtempSync(path.join(tmpdir(), "waypoint-grok-automate-home-")),
      root: mkdtempSync(path.join(tmpdir(), "waypoint-grok-automate-root-")),
      authPath: path.join(TEST_ROOT, "package.json"),
    }),
  );
  return { child, messages, workbench };
}

describe("Grok Build ACP adapter", () => {
  it("uses a custom Grok home, strips API credentials, and supports stale Windows PATH", () => {
    const environment = grokExecutionEnvironment(
      "C:\\Users\\scott\\.grok\\bin\\grok.exe",
      {
        USERPROFILE: "C:\\Users\\scott",
        GROK_HOME: "D:\\grok-home",
        XAI_API_KEY: "secret",
        GROK_API_KEY: "secret",
      },
      "win32",
    );
    expect(environment.GROK_HOME).toBe("D:\\grok-home");
    expect(environment.GROK_DISABLE_AUTOUPDATER).toBe("1");
    expect(environment.XAI_API_KEY).toBeUndefined();
    expect(environment.GROK_API_KEY).toBeUndefined();
    expect(environment.PATH).toContain("C:\\Users\\scott\\.grok\\bin");
  });

  it("maps read-only, Developer, Full, and Bypass authority without a Waypoint run cap", () => {
    expect(
      grokAgentArgs(request({ profile: profile({ filesystem: "read-only" }) })),
    ).toEqual(
      expect.arrayContaining(["--permission-mode", "default", "read-only"]),
    );
    expect(grokAgentArgs(request())).toEqual(
      expect.arrayContaining(["--permission-mode", "default", "workspace"]),
    );
    expect(
      grokAgentArgs(
        request({
          profile: profile({ network: "enabled", tools: ["subagents"] }),
        }),
      ),
    ).not.toContain("--disable-web-search");
    expect(
      grokAgentArgs(
        request({
          profile: profile({ approval: "never", network: "enabled" }),
        }),
      ),
    ).toContain("--always-approve");
  });

  it("requires subscription login and parses the account model catalog", () => {
    expect(
      parseGrokSubscriptionStatus(
        "You are logged in with grok.com.\nDefault model: grok-4.6\n  * grok-4.6 (default)\n  - grok-4.5\n",
      ),
    ).toMatchObject({
      signedIn: true,
      defaultModel: "grok-4.6",
      models: ["grok-4.6", "grok-4.5"],
    });
    expect(() => parseGrokSubscriptionStatus("API key configured")).toThrow(
      /grok\.com subscription/,
    );
    for (const invalid of [
      "You are logged in with grok.com.\nDefault model: github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\n  * grok-4.6\n",
      "You are logged in with grok.com.\nDefault model: grok-4.6\n",
      "You are logged in with grok.com.\nDefault model: grok-4.6\n  * ../../bad\n",
    ])
      expect(() => parseGrokSubscriptionStatus(invalid)).toThrow(
        /model catalog|default account model/,
      );
  });

  it("redacts durable tool updates and approval details", () => {
    const token = "github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
      spoofed = JSON.parse(
        `{"__proto__":{"command":"${token}"},"${token}":"value","safe":"visible"}`,
      ) as Record<string, unknown>;
    expect(
      grokUpdateEvents({
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: token,
      })[0]?.text,
    ).not.toContain(token);
    const approval = grokApprovalRequest({
        sessionId: "session",
        toolCall: {
          toolCallId: token,
          title: "Run command",
          kind: "execute",
          rawInput: spoofed,
        },
        options: [{ optionId: "yes", name: "Yes", kind: "allow_once" }],
      }),
      input = approval.detail.input as Record<string, unknown>;
    expect(JSON.stringify(approval)).not.toContain(token);
    expect(Object.hasOwn(input, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(input)).toBeNull();
    expect(
      grokUpdateEvents({
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-2",
        status: "completed",
        rawOutput: spoofed,
      })[0]?.text,
    ).not.toContain(token);
  });

  it("runs a signed-in turn and keeps assistant prose outside tool events", async () => {
    const { workbench } = harness(),
      events: Array<Record<string, unknown>> = [],
      running = await workbench.start("new", request(), (event) =>
        events.push(event),
      );
    const result = await running.completion;
    expect(result).toMatchObject({ status: "completed" });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text", text: "Hello from Grok" }),
    );
  });

  it("releases an isolated no-tools prompt only after an exact empty tool inventory", async () => {
    const { messages, workbench } = harness({ isolatedNoTools: true }),
      running = await workbench.start(
        "no-tools",
        request({
          isolatedNoTools: true,
          profile: profile({
            filesystem: "read-only",
            network: "provider-only",
            tools: [],
            approval: "always",
          }),
        }),
        () => undefined,
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "completed",
    });
    expect(
      messages.find((message) => message.method === "session/new"),
    ).toMatchObject({
      params: {
        _meta: {
          agentProfile: {
            name: "waypoint-no-tools",
            toolConfig: { tools: [] },
            injectDefaultTools: false,
            skills: [],
            mcpServers: [],
          },
        },
      },
    });
    expect(
      messages.some((message) => message.method === "session/prompt"),
    ).toBe(true);
  });

  it("reserves max concurrency before asynchronous Grok startup", async () => {
    const { workbench } = harness(),
      starts = await Promise.allSettled([
        workbench.start("first", request(), () => undefined),
        workbench.start("second", request(), () => undefined),
      ]),
      fulfilled = starts.find(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof workbench.start>>
        > => result.status === "fulfilled",
      ),
      rejected = starts.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
    expect(fulfilled).toBeTruthy();
    expect(String(rejected?.reason)).toMatch(/concurrency limit/);
    await expect(fulfilled!.value.completion).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("paginates durable session inventory before exact resume", async () => {
    const { messages, workbench } = harness({ paginatedSession: true }),
      running = await workbench.start(
        "resume",
        request({ providerSessionId: "existing-session" }),
        () => undefined,
      );
    const result = await running.completion;
    expect(result).toEqual({ status: "completed", exitCode: 0 });
    expect(
      messages.filter((message) => message.method === "session/list"),
    ).toHaveLength(2);
  });

  it("supports explicit ACP session/load without replaying provider history", async () => {
    const { messages, workbench } = harness(),
      events: Array<Record<string, unknown>> = [],
      running = await workbench.start(
        "load",
        request({
          providerSessionId: "existing-session",
          loadProviderHistory: true,
        }),
        (event) => events.push(event),
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "completed",
    });
    expect(messages.some((message) => message.method === "session/load")).toBe(
      true,
    );
    expect(events.filter((event) => event.type === "text")).toHaveLength(1);
  });

  it("fails closed on a mismatched session update during session/load", async () => {
    const { workbench } = harness({ loadUpdateSessionId: "other-session" }),
      running = await workbench.start(
        "load-session-drift",
        request({
          providerSessionId: "existing-session",
          loadProviderHistory: true,
        }),
        () => undefined,
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "failed",
      error: expect.stringMatching(/different provider session/),
    });
  });

  it("fails closed on malformed ACP JSON and notification schemas", async () => {
    for (const message of [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "session/update",
        params: {
          sessionId: "session",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
          },
        },
      },
      {
        jsonrpc: "2.0",
        method: "session/request_permission",
        params: {
          sessionId: "session",
          toolCall: { toolCallId: "tool", name: "read_file", kind: "read" },
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        },
      },
      {
        jsonrpc: "2.0",
        id: 1,
        method: "$/cancel_request",
        params: { requestId: 1 },
      },
    ])
      expect(() => validateGrokWireMessage(message)).toThrow(
        /notification|request ID/,
      );
    for (const message of [
      { jsonrpc: "2.0", id: { bad: 1 }, result: {} },
      {
        jsonrpc: "2.0",
        id: { bad: 1 },
        method: "_x.ai/mcp/sdk_call",
        params: {
          serverId: "waypoint-automation",
          message: { jsonrpc: "2.0", id: 1, method: "ping" },
        },
      },
    ])
      expect(() => validateGrokWireMessage(message)).toThrow(/ID is invalid/);
    expect(() =>
      validateGrokWireMessage({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session",
          update: { sessionUpdate: "tool_call" },
        },
      }),
    ).toThrow(/session update schema/);
    for (const update of [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool",
        title: "bad",
        kind: "edit",
        status: "pending",
        locations: [{ path: 123 }],
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool",
        locations: [{ path: 123 }],
      },
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "review", description: 123 }],
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool",
        content: [{ type: "content", content: { type: "text", text: 123 } }],
      },
      {
        sessionUpdate: "plan",
        entries: [{ content: 123, priority: "high", status: "pending" }],
      },
      {
        sessionUpdate: "config_option_update",
        configOptions: [
          { id: "model", name: "Model", type: "boolean", currentValue: "yes" },
        ],
      },
      {
        sessionUpdate: "session_info_update",
        title: 123,
        updatedAt: true,
      },
      {
        sessionUpdate: "usage_update",
        used: 10,
        size: 100,
        cost: { amount: "1", currency: "USD" },
      },
    ])
      expect(() =>
        validateGrokWireMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "session", update },
        }),
      ).toThrow(/session update schema/);
    for (const options of [
      [
        { optionId: "same", name: "Allow", kind: "allow_once" },
        { optionId: "same", name: "Reject", kind: "reject_once" },
      ],
      [{ optionId: "", name: "Allow", kind: "allow_once" }],
      [{ optionId: "allow", name: "", kind: "allow_once" }],
    ])
      expect(() =>
        validateGrokWireMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "session/request_permission",
          params: {
            sessionId: "session",
            toolCall: {
              toolCallId: "tool",
              name: "read_file",
              kind: "read",
            },
            options,
          },
        }),
      ).toThrow(/permission request schema/);
    const overwideInput = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [`key${index}`, index]),
    );
    expect(() =>
      validateGrokWireMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "session/request_permission",
        params: {
          sessionId: "session",
          toolCall: {
            toolCallId: "tool",
            name: "batch_operation",
            kind: "other",
            rawInput: overwideInput,
          },
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        },
      }),
    ).toThrow(/permission request schema/);
    expect(() =>
      validateGrokWireMessage({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "bogus" },
          },
        },
      }),
    ).toThrow(/session update schema/);
    for (const [name, options, expected] of [
      ["json", { rawMalformedJson: true }, /Malformed Grok ACP JSON/],
      ["schema", { malformedUpdate: true }, /session update schema/],
      [
        "nested-schema",
        { nestedMalformedUpdate: true },
        /session update schema/,
      ],
    ] as const) {
      const { workbench } = harness(options),
        running = await workbench.start(
          `malformed-${name}`,
          request(),
          () => undefined,
        );
      await expect(running.completion).resolves.toMatchObject({
        status: "failed",
        error: expect.stringMatching(expected),
      });
    }
  });

  it("rejects any declared outside-root path before Bypass auto-approval", async () => {
    const { messages, workbench } = harness({
        permission: {
          name: "mcp_write_file",
          kind: "other",
          rawInput: { path: path.join(OUTSIDE_ROOT, "outside.txt"), content: "unsafe" },
        },
      }),
      running = await workbench.start(
        "outside-root",
        request({
          profile: profile({
            approval: "never",
            network: "enabled",
            tools: ["terminal", "files", "skills", "mcp"],
          }),
        }),
        () => undefined,
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "completed",
    });
    expect(
      JSON.stringify(messages.find((message) => message.id === "permission-1")),
    ).toContain("reject");
  });

  it("rejects plural outside-root paths and unclassifiable permissions", async () => {
    for (const [name, permission] of [
      [
        "plural-path",
        {
          name: "batch_operation",
          kind: "other",
          rawInput: { paths: [path.join(OUTSIDE_ROOT, "secret.txt")] },
        },
      ],
      ["unknown", {}],
    ] as const) {
      const onApproval = vi.fn(async () => ({
          status: "accepted" as const,
          decision: {},
        })),
        { messages, workbench } = harness({ permission: { ...permission } }),
        running = await workbench.start(
          `fail-closed-${name}`,
          request({
            profile: profile({
              approval: "never",
              network: "enabled",
              tools: ["terminal", "files", "skills", "mcp"],
            }),
            onApproval,
          }),
          () => undefined,
        );
      await expect(running.completion).resolves.toMatchObject({
        status: "completed",
      });
      expect(onApproval).not.toHaveBeenCalled();
      expect(
        JSON.stringify(
          messages.find((message) => message.id === "permission-1"),
        ),
      ).toContain("reject");
    }
  });

  it("rejects malformed path containers, outside diff paths, and command-kind spoofing before approval", async () => {
    for (const [name, permission] of [
      [
        "mixed-paths",
        {
          name: "batch_operation",
          kind: "other",
          rawInput: { paths: ["inside.txt", 7] },
        },
      ],
      [
        "deep-path",
        {
          name: "batch_operation",
          kind: "other",
          rawInput: {
            a: {
              b: {
                c: {
                  d: { e: { f: { g: { path: path.join(OUTSIDE_ROOT, "secret.txt") } } } },
                },
              },
            },
          },
        },
      ],
      [
        "outside-diff",
        {
          name: "batch_operation",
          kind: "other",
          content: [
            { type: "diff", path: path.join(OUTSIDE_ROOT, "secret.txt"), newText: "pwn" },
          ],
        },
      ],
      [
        "command-kind",
        {
          name: "execute_cli_code",
          kind: "other",
          rawInput: { code: "Set-Content outside.txt pwn" },
        },
      ],
    ] as const) {
      const onApproval = vi.fn(async () => ({
          status: "accepted" as const,
          decision: {},
        })),
        { messages, workbench } = harness({ permission: { ...permission } }),
        running = await workbench.start(
          `permission-${name}`,
          request({
            profile: profile({
              filesystem:
                name === "command-kind" ? "read-only" : "workspace-write",
              approval: "never",
              network: "enabled",
            }),
            onApproval,
          }),
          () => undefined,
        );
      await expect(running.completion).resolves.toMatchObject({
        status: "completed",
      });
      expect(onApproval).not.toHaveBeenCalled();
      expect(
        JSON.stringify(
          messages.find((message) => message.id === "permission-1"),
        ),
      ).toContain("reject");
    }
  });

  it("denies wrapped dynamic MCP tools unless the profile grants MCP", async () => {
    for (const [name, tools, expected] of [
      ["denied", ["provider-native"], "reject"],
      ["allowed", ["provider-native", "mcp"], "allow"],
    ] as const) {
      const { messages, workbench } = harness({
          permission: {
            name: "use_tool",
            kind: "other",
            rawInput: {
              tool_name: "context7__query-docs",
              tool_input: { query: "ACP" },
            },
          },
        }),
        running = await workbench.start(
          `wrapped-mcp-${name}`,
          request({
            profile: profile({
              approval: "never",
              network: "enabled",
              tools: [...tools],
            }),
          }),
          () => undefined,
        );
      await expect(running.completion).resolves.toMatchObject({
        status: "completed",
      });
      expect(
        JSON.stringify(
          messages.find((message) => message.id === "permission-1"),
        ),
      ).toContain(expected);
    }
  });

  it("classifies direct MCP tool names before approval", async () => {
    for (const [name, tools, expected, approvalCalls] of [
      ["denied", ["provider-native"], "reject", 0],
      ["allowed", ["provider-native", "mcp"], "allow", 1],
    ] as const) {
      const onApproval = vi.fn(async () => ({
          status: "accepted" as const,
          decision: {},
        })),
        { messages, workbench } = harness({
          permission: {
            name: "github__create_issue",
            kind: "other",
            rawInput: { title: "QA" },
          },
        }),
        running = await workbench.start(
          `direct-mcp-${name}`,
          request({
            profile: profile({
              approval: "on-write",
              network: "enabled",
              tools: [...tools],
            }),
            onApproval,
          }),
          () => undefined,
        );
      await expect(running.completion).resolves.toMatchObject({
        status: "completed",
      });
      expect(onApproval).toHaveBeenCalledTimes(approvalCalls);
      if (approvalCalls)
        expect(onApproval).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "tool" }),
          expect.any(AbortSignal),
        );
      expect(
        JSON.stringify(
          messages.find((message) => message.id === "permission-1"),
        ),
      ).toContain(expected);
    }
  });

  it("rejects spoofed or targetless dynamic tool wrappers", async () => {
    for (const [name, permission, tools] of [
      [
        "mcp-title",
        {
          name: "use_tool",
          kind: "other",
          rawInput: {},
        },
        ["provider-native"],
      ],
      [
        "missing-target-with-mcp",
        { name: "use_tool", kind: "other", rawInput: {} },
        ["provider-native", "mcp"],
      ],
    ] as const) {
      const onApproval = vi.fn(async () => ({
          status: "accepted" as const,
          decision: {},
        })),
        configuredPermission =
          name === "mcp-title"
            ? { ...permission, name: "use_tool", title: "github__create_issue" }
            : permission,
        { messages, workbench } = harness({
          permission: configuredPermission,
        }),
        running = await workbench.start(
          `dynamic-wrapper-${name}`,
          request({
            profile: profile({
              approval: "on-write",
              network: "enabled",
              tools: [...tools],
            }),
            onApproval,
          }),
          () => undefined,
        );
      await expect(running.completion).resolves.toMatchObject({
        status: "completed",
      });
      expect(onApproval).not.toHaveBeenCalled();
      expect(
        JSON.stringify(
          messages.find((message) => message.id === "permission-1"),
        ),
      ).toContain("reject");
    }
  });

  it("never substitutes provider allow-always for a one-time approval", async () => {
    const { messages, workbench } = harness({
        permission: {
          name: "execute_cli_code",
          kind: "execute",
          rawInput: { code: "Get-Location" },
        },
        permissionOptions: [
          {
            optionId: "always",
            name: "Allow always",
            kind: "allow_always",
          },
          {
            optionId: "reject",
            name: "Reject once",
            kind: "reject_once",
          },
        ],
      }),
      running = await workbench.start(
        "no-allow-always",
        request({
          profile: profile({ approval: "never", network: "enabled" }),
        }),
        () => undefined,
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "completed",
    });
    const response = JSON.stringify(
      messages.find((message) => message.id === "permission-1"),
    );
    expect(response).not.toContain("always");
    expect(response).toContain("cancelled");
  });

  it("reports a provider-canceled turn after a declined permission as canceled", async () => {
    const { workbench } = harness({
        permission: {
          name: "execute_cli_code",
          kind: "execute",
          rawInput: { code: "Get-Location" },
        },
        permissionStopReason: "cancelled",
      }),
      running = await workbench.start(
        "declined",
        request({
          onApproval: async () => ({ status: "declined", decision: {} }),
        }),
        () => undefined,
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "canceled",
    });
  });

  it("rejects incompatible Grok versions before starting ACP", async () => {
    const { messages, workbench } = harness();
    await expect(
      workbench.start(
        "old-version",
        request({ version: "grok 1.0.2" }),
        () => undefined,
      ),
    ).rejects.toThrow(/unsupported/);
    expect(messages).toHaveLength(0);
  });

  it("cancels and waits for a hanging subscription preflight", async () => {
    const { workbench } = harness({
        subscriptionVerifier: async (_executable, _environment, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new Error("preflight canceled")),
              { once: true },
            );
          }),
      }),
      running = await workbench.start("preflight", request(), () => undefined);
    await expect(workbench.cancelAndWait("preflight")).resolves.toBe(true);
    await expect(running.completion).resolves.toMatchObject({
      status: "canceled",
    });
  });

  it("fails closed on protocol, account, model, and session update drift", async () => {
    for (const [name, options, expected] of [
      ["protocol", { protocolVersion: 2 }, /protocol/],
      ["account", { authMethods: [] }, /authentication provenance/],
      ["version", { agentVersion: "1.0.4" }, /version provenance/],
      [
        "session",
        { updateSessionId: "other-session" },
        /different provider session/,
      ],
    ] as const) {
      const { workbench } = harness(options),
        running = await workbench.start(
          name,
          request({ model: "grok-4.6" }),
          () => undefined,
        );
      await expect(running.completion).resolves.toMatchObject({
        status: "failed",
        error: expect.stringMatching(expected),
      });
    }
  });

  it("kills and waits for the process tree on cancel", async () => {
    const { child, workbench } = harness(),
      running = await workbench.start("cancel", request(), () => undefined);
    running.cancel();
    await expect(running.completion).resolves.toMatchObject({
      status: "canceled",
    });
    expect(child.killed).toBe(true);
  });

  it("prepares a model-selected proposal after the Waypoint bridge is ready without an isolated agent profile", async () => {
    const onAutomationProposal = vi.fn(async () => ({
        proposalId: "proposal-1",
        status: "pending_confirmation",
      })),
      { messages, workbench } = harness({ automation: true }),
      running = await workbench.start(
        "automate",
        request({ onAutomationProposal }),
        () => undefined,
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "completed",
    });
    expect(onAutomationProposal).toHaveBeenCalledOnce();
    expect(
      messages.find((message) => message.method === "session/new"),
    ).toMatchObject({
      params: {
        _meta: {
          "x.ai/mcp/servers": [
            { name: "waypoint", serverId: "waypoint-automation" },
          ],
        },
      },
    });
    expect(
      (messages.find((message) => message.method === "session/new")?.params as {
        _meta?: { agentProfile?: unknown };
      })._meta?.agentProfile,
    ).toBeUndefined();
  });

  it("fails before prompt release when the Waypoint reverse MCP bridge is unavailable or out of order", async () => {
    for (const [name, options, expected] of [
      [
        "sdk",
        { automation: true, automationSdk: false },
        /proposal bridge/,
      ],
      [
        "mcp-order",
        { automation: true, automationSkipMcpInitialize: true },
        /tools\/list is out of order/,
      ],
    ] as const) {
      const { messages, workbench } = harness(options),
        running = await workbench.start(
          `automate-${name}`,
          request({
            onAutomationProposal: async () => ({
              proposalId: "proposal",
              status: "pending_confirmation",
            }),
          }),
          () => undefined,
        );
      await expect(running.completion).resolves.toMatchObject({
        status: "failed",
        error: expect.stringMatching(expected),
      });
      expect(
        messages.some((message) => message.method === "session/prompt"),
      ).toBe(false);
    }
  });

  it("returns a schema error to Grok and accepts one corrected proposal in the same turn", async () => {
    const onAutomationProposal = vi
        .fn()
        .mockRejectedValueOnce(new Error("definition schema is invalid"))
        .mockResolvedValueOnce({
          proposalId: "corrected-proposal",
          status: "pending_confirmation",
        }),
      { workbench } = harness({
        automation: true,
        automationRetryAfterError: true,
      }),
      running = await workbench.start(
        "automate-corrected",
        request({ onAutomationProposal }),
        () => undefined,
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "completed",
    });
    expect(onAutomationProposal).toHaveBeenCalledTimes(2);
  });

  it("admits exactly one successful pending proposal per Grok Automate turn", async () => {
    const onAutomationProposal = vi.fn(async () => ({
        proposalId: "only-proposal",
        status: "pending_confirmation",
      })),
      { workbench } = harness({
        automation: true,
        automationDuplicateAfterSuccess: true,
      }),
      running = await workbench.start(
        "automate-duplicate",
        request({ onAutomationProposal }),
        () => undefined,
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "completed",
    });
    expect(onAutomationProposal).toHaveBeenCalledOnce();
  });

  it("verifies the exact installed Grok slash skill before releasing an automation action prompt", async () => {
    const available = harness({
        skills: [
          {
            name: "review",
            userInvocable: true,
            compatibilityStatus: "enabled",
          },
        ],
      }),
      running = await available.workbench.start(
        "skill",
        request({ prompt: "/review 123", requiredSkillIdentifier: "review" }),
        () => undefined,
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "completed",
    });

    const missing = harness({ skills: [] }),
      failed = await missing.workbench.start(
        "missing-skill",
        request({ prompt: "/review 123", requiredSkillIdentifier: "review" }),
        () => undefined,
      );
    await expect(failed.completion).resolves.toMatchObject({
      status: "failed",
      error: expect.stringMatching(/Exact Grok skill/),
    });
    expect(
      missing.messages.some((message) => message.method === "session/prompt"),
    ).toBe(false);
  });

  it("rejects malformed reverse MCP requests and removes only exact stale isolation directories", () => {
    expect(() =>
      validateGrokWireMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "_x.ai/mcp/sdk_call",
        params: {
          serverId: "waypoint-automation",
          message: { jsonrpc: "2.0", method: "tools/call" },
        },
      }),
    ).toThrow(/request ID/);
    const parent = mkdtempSync(
        path.join(tmpdir(), "waypoint-grok-cleanup-test-"),
      ),
      stale = mkdtempSync(path.join(parent, "waypoint-grok-automate-home-")),
      unmarked = mkdtempSync(path.join(parent, "waypoint-grok-automate-root-")),
      unrelated = mkdtempSync(path.join(parent, "other-grok-home-")),
      canonicalStale = realpathSync.native(stale);
    markGrokAutomationIsolationDirectory(stale);
    writeFileSync(
      path.join(unmarked, ".waypoint-grok-automation.json"),
      JSON.stringify({
        owner: "waypoint",
        purpose: "grok-automation-isolation",
        version: 2,
        signature: "0".repeat(64),
      }),
      "utf8",
    );
    expect(cleanupStaleGrokAutomationDirectories(parent)).toEqual([
      canonicalStale,
    ]);
    expect(existsSync(unmarked)).toBe(true);
    expect(() =>
      cleanupStaleGrokAutomationDirectories(unrelated),
    ).not.toThrow();
    rmSync(parent, { recursive: true, force: true });
  });

  it("does not assume the test repository exists outside its selected root", () => {
    expect(path.isAbsolute(request().workspaceRoot)).toBe(true);
  });

  it("routes both Grok metadata lanes through the verified no-tools boundary", () => {
    const source = readFileSync(
      new URL("../main.ts", import.meta.url),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(source.match(/isolatedNoTools: true/g)).toHaveLength(2);
    expect(source).toContain(
      "profile: { ...profile, tools: [], maxConcurrency: 1, secretNames: [], }, isolatedNoTools: true",
    );
  });
});
