import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CodexAppServerWorkbench,
  codexSandboxPolicy,
  terminateCodexProcessTree,
  type CodexRunRequest,
} from "./codex-app-server.js";
import type { ExecutionEvent, SecurityProfile } from "./ai-workbench.js";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill() {
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
    roots: ["D:\\repo"],
    filesystem: "workspace-write",
    network: "disabled",
    tools: ["shell", "files", "skills", "mcp"],
    maxDurationMs: 10_000,
    maxConcurrency: 1,
    approval: "on-write",
    peerEligible: false,
    secretNames: [],
    ...overrides,
  };
}
function request(overrides: Partial<CodexRunRequest> = {}): CodexRunRequest {
  return {
    cli: "codex",
    prompt: "Inspect the repository",
    workspaceRoot: "D:\\repo",
    profile: profile(),
    executable: "D:\\bin\\codex.cmd",
    version: "0.146.0",
    onSession: vi.fn(),
    onApproval: vi.fn(async () => ({
      status: "accepted" as const,
      decision: {},
    })),
    ...overrides,
  };
}

function harness(
  onMessage: (
    message: Record<string, unknown>,
    send: (value: unknown) => void,
  ) => void,
  accountResponse:Record<string,unknown>={requiresOpenaiAuth:true,account:{type:"chatgpt",email:null,planType:"plus"}},
  treeTerminator?: (child: never, platform: NodeJS.Platform, signal: "SIGTERM" | "SIGKILL") => Promise<void>,
) {
  const child = new FakeChild(),
    messages: Record<string, unknown>[] = [],
    launchArgs: string[] = [],
    send = (value: unknown) => child.stdout.write(`${JSON.stringify(value)}\n`);
  let buffer = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines)
      if (line) {
        const message = JSON.parse(line) as Record<string, unknown>;
        messages.push(message);
        if(message.method==="account/read")queueMicrotask(()=>send({id:message.id,result:accountResponse}));
        else onMessage(message, send);
      }
  });
  const workbench = new CodexAppServerWorkbench(
    (() => child) as never,
    async () => "D:\\bin\\codex.cmd",
    "win32",
    async (_name, _executable, args) => {
      launchArgs.push(...args);
      return {
        executable: "D:\\node.exe",
        args: ["D:\\codex.js", ...args],
      };
    },
    treeTerminator as never,
  );
  return { child, launchArgs, messages, workbench };
}

function successfulServer(
  options: { resumeFails?: boolean; resumeThreadId?: string; approval?: boolean; cwd?: string; mcpServers?: unknown[]; configuredMcpNames?: string[]; accountResponse?:Record<string,unknown> } = {},
) {
  let started = false;
  return harness((message, send) =>
    queueMicrotask(() => {
      const method = message.method,
        id = message.id;
      if (method === "initialize") send({ id, result: { userAgent: "test" } });
      else if (method === "skills/list")
        send({
          id,
          result: { data: [{ cwd: "D:\\repo", skills: [], errors: [] }] },
        });
      else if (method === "mcpServerStatus/list")
        send({ id, result: { data: options.mcpServers ?? [] } });
      else if (method === "thread/resume") {
        if (options.resumeFails)
          send({ id, error: { code: -32000, message: "thread unavailable" } });
        else send({ id, result: { thread: { id: options.resumeThreadId ?? "thread-existing" } } });
      } else if (method === "thread/start")
        send({ id, result: { thread: { id: "thread-new" } } });
      else if (method === "turn/start") {
        send({ id, result: { turn: { id: "turn-1", status: "inProgress" } } });
        send({
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-new",
            turnId: "turn-1",
            itemId: "answer",
            delta: "Hello",
          },
        });
        send({
          method: "item/started",
          params: {
            threadId: "thread-new",
            turnId: "turn-1",
            item: {
              type: "commandExecution",
              id: "cmd",
              command: "git status",
              cwd: options.cwd ?? "D:\\repo",
              status: "inProgress",
            },
          },
        });
        if (options.approval)
          send({
            id: "approval-1",
            method: "item/commandExecution/requestApproval",
            params: {
              threadId: "thread-new",
              turnId: "turn-1",
              itemId: "cmd",
              command: "git status",
              cwd: options.cwd ?? "D:\\repo",
              reason: "Inspect working tree",
            },
          });
        else {
          send({
            method: "item/completed",
            params: {
              threadId: "thread-new",
              turnId: "turn-1",
              item: {
                type: "commandExecution",
                id: "cmd",
                command: "git status",
                cwd: "D:\\repo",
                status: "completed",
                exitCode: 0,
                aggregatedOutput: "clean",
              },
            },
          });
          send({
            method: "turn/completed",
            params: {
              threadId: "thread-new",
              turn: { id: "turn-1", status: "completed" },
            },
          });
        }
      } else if (message.id === "approval-1" && !started) {
        started = true;
        send({
          method: "turn/completed",
          params: {
            threadId: "thread-new",
            turn: { id: "turn-1", status: "completed" },
          },
        });
      }
    }),
    options.accountResponse,
  );
}

describe("Codex app-server workbench", () => {
  it("fails before thread or prompt release unless Codex reports a ChatGPT subscription",async()=>{for(const accountResponse of [{requiresOpenaiAuth:false,account:{type:"apiKey"}},{requiresOpenaiAuth:true,account:null}]){const{workbench,messages}=successfulServer({accountResponse}),running=await workbench.start(`non-subscription-${JSON.stringify(accountResponse)}`,request(),()=>undefined);await expect(running.completion).resolves.toMatchObject({status:"failed",error:expect.stringContaining("signed-in ChatGPT subscription")});expect(messages.some((item)=>item.method==="thread/start")).toBe(false)}});
  it("maps exact security profiles to scoped Codex sandbox policies", () => {
    expect(
      codexSandboxPolicy(
        request({
          profile: profile({
            filesystem: "read-only",
            network: "provider-only",
          }),
        }),
      ),
    ).toEqual({ type: "readOnly", networkAccess: false });
    expect(
      codexSandboxPolicy(request({ profile: profile({ network: "enabled" }) })),
    ).toEqual({ type: "readOnly", networkAccess: true });
    expect(
      codexSandboxPolicy(request({ profile: profile({ approval: "always" }) })),
    ).toEqual({
      type: "workspaceWrite",
      writableRoots: ["D:\\repo"],
      networkAccess: false,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    });
    expect(
      codexSandboxPolicy(request({ profile: profile({ approval: "never" }) })),
    ).toEqual({ type: "dangerFullAccess" });
  });

  it("maps the explicit bypass profile to Codex never/danger-full-access", async () => {
    const { workbench, messages } = successfulServer(),
      running = await workbench.start(
        "bypass",
        request({
          profile: profile({
            name: "Bypass permissions · no prompts",
            network: "enabled",
            approval: "never",
          }),
        }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(messages.find((item) => item.method === "thread/start")).toMatchObject({
      params: {
        approvalPolicy: "never",
        approvalsReviewer: null,
        sandbox: "danger-full-access",
      },
    });
    expect(messages.find((item) => item.method === "turn/start")).toMatchObject({
      params: {
        approvalPolicy: "never",
        approvalsReviewer: null,
        sandboxPolicy: { type: "dangerFullAccess" },
      },
    });
  });

  it("submits automation definitions through a native in-run dynamic tool", async () => {
    const onAutomationProposal = vi.fn(async () => ({
        proposalId: "proposal-1",
        status: "pending",
      })),
      { workbench, messages } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: { userAgent: "test" } });
          else if (message.method === "mcpServerStatus/list")
            send({ id: message.id, result: { data: [] } });
          else if (message.method === "thread/start")
            send({ id: message.id, result: { thread: { id: "thread-tool" } } });
          else if (message.method === "turn/start") {
            send({
              id: message.id,
              result: { turn: { id: "turn-tool", status: "inProgress" } },
            });
            send({
              id: "tool-call-1",
              method: "item/tool/call",
              params: {
                threadId: "thread-tool",
                turnId: "turn-tool",
                callId: "call-1",
                tool: "waypoint_automation_proposal",
                arguments: {
                  definition: {
                    version: 1,
                    action: { kind: "ai_prompt" },
                  },
                },
              },
            });
          } else if (message.id === "tool-call-1" && message.result) {
            send({
              method: "turn/completed",
              params: {
                threadId: "thread-tool",
                turn: { id: "turn-tool", status: "completed" },
              },
            });
          }
        }),
      ),
      running = await workbench.start(
        "native-automation-tool",
        request({ onAutomationProposal }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(onAutomationProposal).toHaveBeenCalledWith({
      version: 1,
      action: { kind: "ai_prompt" },
    });
    expect(messages.find((item) => item.method === "thread/start")).toMatchObject({
      params: {
        dynamicTools: [
          {
            type: "function",
            name: "waypoint_automation_proposal",
            deferLoading: false,
          },
        ],
      },
    });
    expect(messages.find((item) => item.id === "tool-call-1")).toMatchObject({
      result: {
        success: true,
        contentItems: [
          expect.objectContaining({
            text: expect.stringContaining("proposal-1"),
          }),
        ],
      },
    });
  });

  it("keeps the selected Bypass authority while advertising the bounded proposal tool",async()=>{const{workbench,messages,launchArgs}=successfulServer({mcpServers:[{name:"azure",authStatus:"connected",tools:{createHook:{}}}]}),running=await workbench.start("bypass-model-tools",request({profile:profile({name:"Bypass permissions · no prompts",approval:"never",network:"enabled"}),onAutomationProposal:vi.fn(async()=>({proposalId:"p",status:"pending"}))}),()=>undefined);expect((await running.completion).status).toBe("completed");expect(launchArgs).toEqual(["app-server"]);expect(messages.find((item)=>item.method==="thread/start")).toMatchObject({params:{approvalPolicy:"never",approvalsReviewer:null,sandbox:"danger-full-access",config:{web_search:"live",sandbox_workspace_write:{network_access:true}},dynamicTools:[{name:"waypoint_automation_proposal"}]}});expect(messages.find((item)=>item.method==="turn/start")).toMatchObject({params:{approvalPolicy:"never",approvalsReviewer:null,sandboxPolicy:{type:"dangerFullAccess"}}})});

  it("keeps ordinary approval-gated commands available alongside the proposal tool",async()=>{const repo=mkdtempSync(path.join(tmpdir(),"waypoint-codex-model-tools-")),onApproval=vi.fn(async()=>({status:"accepted" as const,decision:{}})),{workbench,messages}=successfulServer({approval:true,cwd:repo}),running=await workbench.start("model-tools-command",request({workspaceRoot:repo,profile:profile({roots:[repo]}),onAutomationProposal:vi.fn(async()=>({proposalId:"p",status:"pending"})),onApproval}),()=>undefined);await expect(running.completion).resolves.toMatchObject({status:"completed"});expect(onApproval).toHaveBeenCalledTimes(1);expect(messages.find((item)=>item.id==="approval-1")).toEqual({id:"approval-1",result:{decision:"accept"}})});

  it("rejects execution outside the exact security-profile root before spawn", async () => {
    const { workbench } = successfulServer();
    await expect(
      workbench.start(
        "outside",
        request({ workspaceRoot: "D:\\outside" }),
        () => undefined,
      ),
    ).rejects.toThrow("outside the security profile");
  });

  it("starts a durable thread, streams rich events, and completes the turn", async () => {
    const { workbench, messages } = successfulServer(),
      events: ExecutionEvent[] = [],
      onSession = vi.fn(),
      running = await workbench.start(
        "run-1",
        request({ onSession }),
        (event) => events.push(event),
      ),
      result = await running.completion;
    expect(result.status).toBe("completed");
    expect(onSession).toHaveBeenCalledWith("thread-new");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "Hello" }),
        expect.objectContaining({ type: "tool", name: "Command started" }),
      ]),
    );
    expect(messages.find((item) => item.method === "initialized")).toEqual({
      method: "initialized",
    });
    expect(
      messages.find((item) => item.method === "thread/start"),
    ).toMatchObject({
      params: {
        cwd: "D:\\repo",
        runtimeWorkspaceRoots: ["D:\\repo"],
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "read-only",
        ephemeral: false,
        historyMode: "paginated",
        dynamicTools: [],
      },
    });
    expect(messages.find((item) => item.method === "turn/start")).toMatchObject(
      { params: { sandboxPolicy: { type: "readOnly", networkAccess: false } } },
    );
  });

  it("fails closed when a persisted thread cannot resume", async () => {
    const { workbench, messages } = successfulServer({ resumeFails: true }),
      onSession = vi.fn(),
      running = await workbench.start(
        "run-2",
        request({ providerSessionId: "missing-thread", onSession }),
        () => undefined,
      );
    await expect(running.completion).resolves.toMatchObject({status:'failed',error:expect.stringContaining('reset the provider session explicitly')});
    expect(messages.some((item) => item.method === "thread/resume")).toBe(true);
    expect(messages.some((item) => item.method === "thread/start")).toBe(false);
    expect(onSession).not.toHaveBeenCalled();
  });

  it("rejects a successful resume that returns a different durable thread identity",async()=>{const{workbench,messages}=successfulServer({resumeThreadId:"replacement-thread"}),onSession=vi.fn(),running=await workbench.start("resume-identity-mismatch",request({providerSessionId:"expected-thread",onSession}),()=>undefined);await expect(running.completion).resolves.toMatchObject({status:"failed",error:expect.stringContaining("unexpected session")});expect(messages.some((item)=>item.method==="turn/start")).toBe(false);expect(onSession).not.toHaveBeenCalled()});

  it("resumes only the exact durable Codex thread without rebinding it",async()=>{const{workbench,messages}=successfulServer({resumeThreadId:"expected-thread"}),onSession=vi.fn(),running=await workbench.start("resume-identity-match",request({providerSessionId:"expected-thread",onSession}),()=>undefined);await expect(running.completion).resolves.toMatchObject({status:"completed"});expect(messages.some((item)=>item.method==="turn/start")).toBe(true);expect(onSession).not.toHaveBeenCalled()});

  it("round-trips provider command approval decisions", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "waypoint-codex-command-")),
      { workbench, messages } = successfulServer({ approval: true, cwd: repo }),
      onApproval = vi.fn(async () => ({
        status: "accepted_session" as const,
        decision: {},
      })),
      running = await workbench.start(
        "run-3",
        request({
          workspaceRoot: repo,
          profile: profile({ roots: [repo] }),
          onApproval,
        }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(onApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "command",
        title: "Inspect working tree",
      }),
      expect.any(AbortSignal),
    );
    expect(messages.find((item) => item.id === "approval-1")).toEqual({
      id: "approval-1",
      result: { decision: "acceptForSession" },
    });
  });

  it("redacts secrets from provider approvals and durable execution events", async () => {
    let answered = false;
    const slackAppToken = [
      "xapp",
      "1",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "1234567890",
      "abcdef",
    ].join("-");
    const slackEnterpriseToken = [
      "xoxe",
      "1",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "1234567890",
      "abcdef",
    ].join("-");
    const approvals: unknown[] = [],
      events: ExecutionEvent[] = [],
      { workbench } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-redact" } },
            });
          else if (message.method === "turn/start") {
            send({
              id: message.id,
              result: { turn: { id: "turn-redact", status: "inProgress" } },
            });
            send({
              id: "secret-approval",
              method: "item/commandExecution/requestApproval",
              params: {
                threadId: "thread-redact",
                turnId: "turn-redact",
                itemId: "cmd",
                command:
                  'curl -H "Authorization: Bearer SUPERSECRET" https://example.test',
                cwd: "D:\\repo",
                reason: "token=SUPERSECRET",
              },
            });
          } else if (message.id === "secret-approval" && !answered) {
            answered = true;
            send({
              method: "item/commandExecution/outputDelta",
              params: {
                threadId: "thread-redact",
                turnId: "turn-redact",
                itemId: "cmd",
                delta: `token=SUPERSECRET ${slackAppToken} ${slackEnterpriseToken} whsec_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 glft-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 glimt-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 glwt-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 glffct-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 _gitlab_session=ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890`,
              },
            });
            send({
              method: "turn/completed",
              params: {
                threadId: "thread-redact",
                turn: { id: "turn-redact", status: "completed" },
              },
            });
          }
        }),
      ),
      running = await workbench.start(
        "redact",
        request({
          profile: profile(),
          onApproval: async (value) => {
            approvals.push(value);
            return { status: "declined", decision: {} };
          },
        }),
        (event) => events.push(event),
      );
    expect((await running.completion).status).toBe("completed");
    const audit = JSON.stringify({ approvals, events });
    expect(audit).not.toContain("SUPERSECRET");
    expect(audit).not.toMatch(/xapp-|xoxe-|whsec_|glft-|glimt-|glwt-|glffct-|_gitlab_session=.*ABCDEFGHIJKLMNOPQRSTUVWXYZ/);
    expect(audit).toContain("REDACTED");
  });

  it("returns a declined provider decision without executing the request", async () => {
    const { workbench, messages } = successfulServer({ approval: true }),
      running = await workbench.start(
        "decline",
        request({
          onApproval: async () => ({ status: "declined", decision: {} }),
        }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(messages.find((item) => item.id === "approval-1")).toEqual({
      id: "approval-1",
      result: { decision: "decline" },
    });
  });

  it("never echoes host-wide permissions beyond the selected profile", async () => {
    let answered = false;
    const { workbench, messages } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-permission" } },
            });
          else if (message.method === "turn/start") {
            send({
              id: message.id,
              result: { turn: { id: "turn-permission", status: "inProgress" } },
            });
            send({
              id: "permission-1",
              method: "item/permissions/requestApproval",
              params: {
                threadId: "thread-permission",
                turnId: "turn-permission",
                itemId: "permission",
                cwd: "D:\\repo",
                permissions: {
                  network: { enabled: true },
                  fileSystem: {
                    read: ["C:\\Users\\scott"],
                    write: ["C:\\Users\\scott"],
                  },
                },
              },
            });
          } else if (message.id === "permission-1" && !answered) {
            answered = true;
            send({
              method: "turn/completed",
              params: {
                threadId: "thread-permission",
                turn: { id: "turn-permission", status: "completed" },
              },
            });
          }
        }),
      ),
      running = await workbench.start(
        "permission",
        request({
          profile: profile({ filesystem: "read-only", network: "disabled" }),
          onApproval: async () => ({ status: "accepted", decision: {} }),
        }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(messages.find((item) => item.id === "permission-1")).toEqual({
      id: "permission-1",
      result: { permissions: {}, scope: "turn", strictAutoReview: true },
    });
  });

  it("never grants a repository junction that resolves outside the selected root", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-codex-junction-")),
      repo = path.join(root, "repo"),
      outside = path.join(root, "outside"),
      escape = path.join(repo, "escape");
    mkdirSync(repo);
    mkdirSync(outside);
    symlinkSync(
      outside,
      escape,
      process.platform === "win32" ? "junction" : "dir",
    );
    let answered = false;
    const { workbench, messages } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-junction" } },
            });
          else if (message.method === "turn/start") {
            send({
              id: message.id,
              result: { turn: { id: "turn-junction", status: "inProgress" } },
            });
            send({
              id: "junction-1",
              method: "item/permissions/requestApproval",
              params: {
                threadId: "thread-junction",
                turnId: "turn-junction",
                itemId: "permission",
                cwd: repo,
                permissions: { fileSystem: { write: [escape] } },
              },
            });
          } else if (message.id === "junction-1" && !answered) {
            answered = true;
            send({
              method: "turn/completed",
              params: {
                threadId: "thread-junction",
                turn: { id: "turn-junction", status: "completed" },
              },
            });
          }
        }),
      ),
      running = await workbench.start(
        "junction",
        request({
          workspaceRoot: repo,
          profile: profile({ roots: [repo], filesystem: "workspace-write" }),
          onApproval: async () => ({ status: "accepted", decision: {} }),
        }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(messages.find((item) => item.id === "junction-1")).toEqual({
      id: "junction-1",
      result: { permissions: {}, scope: "turn", strictAutoReview: true },
    });
  });

  it("declines a provider file grant outside the selected root", async () => {
    let answered = false;
    const { workbench, messages } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-file-grant" } },
            });
          else if (message.method === "turn/start") {
            send({
              id: message.id,
              result: { turn: { id: "turn-file-grant", status: "inProgress" } },
            });
            send({
              id: "file-1",
              method: "item/fileChange/requestApproval",
              params: {
                threadId: "thread-file-grant",
                turnId: "turn-file-grant",
                itemId: "file",
                grantRoot: "C:\\Users\\scott",
                reason: "Write outside root",
              },
            });
          } else if (message.id === "file-1" && !answered) {
            answered = true;
            send({
              method: "turn/completed",
              params: {
                threadId: "thread-file-grant",
                turn: { id: "turn-file-grant", status: "completed" },
              },
            });
          }
        }),
      ),
      running = await workbench.start(
        "file-grant",
        request({
          onApproval: async () => ({
            status: "accepted_session",
            decision: {},
          }),
        }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(messages.find((item) => item.id === "file-1")).toEqual({
      id: "file-1",
      result: { decision: "decline" },
    });
  });

  it("returns distinct answers for every native Codex question", async () => {
    let answered = false;
    const { workbench, messages } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-question" } },
            });
          else if (message.method === "turn/start") {
            send({
              id: message.id,
              result: { turn: { id: "turn-question", status: "inProgress" } },
            });
            send({
              id: "question-1",
              method: "item/tool/requestUserInput",
              params: {
                threadId: "thread-question",
                turnId: "turn-question",
                itemId: "question",
                questions: [
                  {
                    id: "language",
                    header: "Language",
                    question: "Choose language",
                    isOther: true,
                    isSecret: false,
                    options: [{ label: "TypeScript", description: "TS" }],
                  },
                  {
                    id: "tests",
                    header: "Tests",
                    question: "Choose test depth",
                    isOther: false,
                    isSecret: false,
                    options: [{ label: "Full", description: "All tests" }],
                  },
                ],
              },
            });
          } else if (message.id === "question-1" && !answered) {
            answered = true;
            send({
              method: "turn/completed",
              params: {
                threadId: "thread-question",
                turn: { id: "turn-question", status: "completed" },
              },
            });
          }
        }),
      ),
      running = await workbench.start(
        "question",
        request({
          onApproval: async () => ({
            status: "accepted",
            decision: { answers: { language: ["Rust"], tests: ["Full"] } },
          }),
        }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(messages.find((item) => item.id === "question-1")).toEqual({
      id: "question-1",
      result: {
        answers: {
          language: { answers: ["Rust"] },
          tests: { answers: ["Full"] },
        },
      },
    });
  });

  it("discovers and invokes an installed slash skill as structured input", async () => {
    const { workbench, messages } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "skills/list")
            send({
              id: message.id,
              result: {
                data: [
                  {
                    cwd: "D:\\repo",
                    errors: [],
                    skills: [
                      {
                        name: "auto-pr-review",
                        path: "C:\\skills\\auto-pr-review\\SKILL.md",
                        description: "Review PRs",
                        enabled: true,
                        scope: "user",
                      },
                    ],
                  },
                ],
              },
            });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-skill" } },
            });
          else if (message.method === "mcpServerStatus/list")
            send({ id: message.id, result: { data: [] } });
          else if (message.method === "turn/start") {
            send({
              id: message.id,
              result: { turn: { id: "turn-skill", status: "inProgress" } },
            });
            send({
              method: "turn/completed",
              params: {
                threadId: "thread-skill",
                turn: { id: "turn-skill", status: "completed" },
              },
            });
          }
        }),
      ),
      running = await workbench.start(
        "skill",
        request({ prompt: "/auto-pr-review PR 42" }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(messages.find((item) => item.method === "turn/start")).toMatchObject(
      {
        params: {
          input: [
            {
              type: "skill",
              name: "auto-pr-review",
              path: "C:\\skills\\auto-pr-review\\SKILL.md",
            },
            { type: "text", text: "PR 42" },
          ],
        },
      },
    );
  });

  it("fails closed when an automation requires an unavailable exact skill", async () => {
    const { workbench, messages } = successfulServer(),
      running = await workbench.start(
        "missing-skill",
        request({
          prompt: "/auto-pr-review PR 42",
          requiredSkillIdentifier: "auto-pr-review",
        }),
        () => undefined,
      ),
      result = await running.completion;
    expect(result.status).toBe("failed");
    expect(result.error).toContain("is not installed and enabled");
    expect(messages.some((item) => item.method === "turn/start")).toBe(false);
  });

  it("steers an active turn through the native Codex protocol", async () => {
    let finish: ((value: unknown) => void) | undefined;
    const { workbench, messages } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-steer" } },
            });
          else if (message.method === "mcpServerStatus/list")
            send({ id: message.id, result: { data: [] } });
          else if (message.method === "turn/start")
            send({
              id: message.id,
              result: { turn: { id: "turn-steer", status: "inProgress" } },
            });
          else if (message.method === "turn/steer") {
            send({ id: message.id, result: { turnId: "turn-steer" } });
            finish = () =>
              send({
                method: "turn/completed",
                params: {
                  threadId: "thread-steer",
                  turn: { id: "turn-steer", status: "completed" },
                },
              });
          }
        }),
      ),
      running = await workbench.start("steer", request(), () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await workbench.steer("steer", "Focus on tests")).toBe(true);
    finish?.({});
    expect((await running.completion).status).toBe("completed");
    expect(messages.find((item) => item.method === "turn/steer")).toMatchObject(
      {
        params: {
          threadId: "thread-steer",
          expectedTurnId: "turn-steer",
          input: [{ type: "text", text: "Focus on tests" }],
        },
      },
    );
  });

  it("cancels an active turn and terminates app-server", async () => {
    const { workbench } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-cancel" } },
            });
          else if (message.method === "turn/start")
            send({
              id: message.id,
              result: { turn: { id: "turn-cancel", status: "inProgress" } },
            });
        }),
      ),
      running = await workbench.start("cancel", request(), () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running.cancel();
    expect((await running.completion).status).toBe("canceled");
  });

  it("does not treat the profile duration as a turn deadline", async () => {
    const { workbench } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-timeout" } },
            });
          else if (message.method === "turn/start") {
            send({
              id: message.id,
              result: { turn: { id: "turn-timeout", status: "inProgress" } },
            });
            setTimeout(() => send({
              method: "turn/completed",
              params: { threadId: "thread-timeout", turn: { id: "turn-timeout", status: "completed" } },
            }), 30);
          }
        }),
      ),
      timedProfile = profile({ maxDurationMs: 20 }),
      running = await workbench.start(
        "timeout",
        request({ profile: timedProfile }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
  });

  it("surfaces malformed protocol output without losing a later valid completion", async () => {
    let malformedSent = false;
    const { workbench, child } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-malformed" } },
            });
          else if (message.method === "turn/start") {
            send({
              id: message.id,
              result: { turn: { id: "turn-malformed", status: "inProgress" } },
            });
            if (!malformedSent) {
              malformedSent = true;
              child.stdout.write("{not-json}\n");
            }
            send({
              method: "turn/completed",
              params: {
                threadId: "thread-malformed",
                turn: { id: "turn-malformed", status: "completed" },
              },
            });
          }
        }),
      ),
      events: ExecutionEvent[] = [],
      running = await workbench.start("malformed", request(), (event) =>
        events.push(event),
      );
    expect((await running.completion).status).toBe("completed");
    expect(events).toContainEqual(
      expect.objectContaining({
        name: "Codex protocol warning",
        rawType: "codex.protocol.invalid_json",
      }),
    );
  });

  it("fails closed on an unknown terminal turn status", async () => {
    const { workbench } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-invalid-terminal" } },
            });
          else if (message.method === "turn/start") {
            send({
              id: message.id,
              result: {
                turn: { id: "turn-invalid-terminal", status: "inProgress" },
              },
            });
            send({
              method: "turn/completed",
              params: {
                threadId: "thread-invalid-terminal",
                turn: { id: "turn-invalid-terminal", status: "futureStatus" },
              },
            });
          }
        }),
      ),
      running = await workbench.start(
        "invalid-terminal",
        request(),
        () => undefined,
      ),
      result = await running.completion;
    expect(result.status).toBe("failed");
    expect(result.error).toContain("invalid terminal turn");
  });

  it("fails closed on a malformed structured provider notification", async () => {
    const { workbench } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-invalid-item" } },
            });
          else if (message.method === "turn/start") {
            send({
              id: message.id,
              result: {
                turn: { id: "turn-invalid-item", status: "inProgress" },
              },
            });
            send({
              method: "item/started",
              params: {
                threadId: "thread-invalid-item",
                turnId: "turn-invalid-item",
              },
            });
          }
        }),
      ),
      running = await workbench.start(
        "invalid-item",
        request(),
        () => undefined,
      ),
      result = await running.completion;
    expect(result.status).toBe("failed");
    expect(result.error).toContain("invalid structured item");
  });

  it("fails closed on a schema-invalid subagent activity variant", async () => {
    const { workbench } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize")
            send({ id: message.id, result: {} });
          else if (message.method === "thread/start")
            send({
              id: message.id,
              result: { thread: { id: "thread-invalid-subagent" } },
            });
          else if (message.method === "turn/start") {
            send({
              id: message.id,
              result: {
                turn: { id: "turn-invalid-subagent", status: "inProgress" },
              },
            });
            send({
              method: "item/started",
              params: {
                threadId: "thread-invalid-subagent",
                turnId: "turn-invalid-subagent",
                item: { type: "subAgentActivity", id: "subagent" },
              },
            });
            send({
              method: "turn/completed",
              params: {
                threadId: "thread-invalid-subagent",
                turn: { id: "turn-invalid-subagent", status: "completed" },
              },
            });
          }
        }),
      ),
      running = await workbench.start(
        "invalid-subagent",
        request(),
        () => undefined,
      ),
      result = await running.completion;
    expect(result.status).toBe("failed");
    expect(result.error).toContain("invalid subagent activity");
  });

  it.each([
    {
      type: "subAgentActivity",
      id: "subagent",
      kind: "started",
      agentPath: "agent/one",
    },
    {
      type: "subAgentActivity",
      id: "subagent",
      kind: "future",
      agentPath: "agent/one",
      agentThreadId: "thread-agent",
    },
  ])(
    "rejects incomplete or future subagent activity fields %#",
    async (item) => {
      const { workbench } = harness((message, send) =>
          queueMicrotask(() => {
            if (message.method === "initialize")
              send({ id: message.id, result: {} });
            else if (message.method === "thread/start")
              send({
                id: message.id,
                result: { thread: { id: "thread-subagent-schema" } },
              });
            else if (message.method === "turn/start") {
              send({
                id: message.id,
                result: {
                  turn: { id: "turn-subagent-schema", status: "inProgress" },
                },
              });
              send({
                method: "item/started",
                params: {
                  threadId: "thread-subagent-schema",
                  turnId: "turn-subagent-schema",
                  item,
                },
              });
              send({
                method: "turn/completed",
                params: {
                  threadId: "thread-subagent-schema",
                  turn: { id: "turn-subagent-schema", status: "completed" },
                },
              });
            }
          }),
        ),
        running = await workbench.start(
          `subagent-${String(item.kind)}`,
          request(),
          () => undefined,
        ),
        result = await running.completion;
      expect(result.status).toBe("failed");
      expect(result.error).toContain("invalid subagent activity");
    },
  );

  it("fails closed when app-server exits before a terminal turn", async () => {
    const { workbench, child } = harness((message, send) =>
        queueMicrotask(() => {
          if (message.method === "initialize") {
            send({ id: message.id, result: {} });
            child.emit("close", 0);
          }
        }),
      ),
      running = await workbench.start("run-4", request(), () => undefined),
      result = await running.completion;
    expect(result.status).toBe("failed");
    expect(result.error).toContain("exited before the turn completed");
  });

  it("awaits process-tree termination before cancellation completes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const terminator = vi.fn(async (target: FakeChild) => { await gate; target.kill(); });
    const { workbench } = harness((message, send) => queueMicrotask(() => {
      if (message.method === "initialize") send({ id: message.id, result: {} });
      else if (message.method === "thread/start") send({ id: message.id, result: { thread: { id: "thread-cancel-tree" } } });
      else if (message.method === "turn/start") send({ id: message.id, result: { turn: { id: "turn-cancel-tree", status: "inProgress" } } });
      else if (message.method === "turn/interrupt") send({ id: message.id, result: {} });
    }), undefined, terminator as never);
    await workbench.start("cancel-tree", request(), () => undefined);
    let completed = false;
    const canceled = workbench.cancelAndWait("cancel-tree").then((value) => { completed = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(terminator).toHaveBeenCalledWith(expect.anything(), "win32", "SIGTERM");
    expect(completed).toBe(false);
    release();
    await expect(canceled).resolves.toBe(true);
  });

  it("uses Windows taskkill tree semantics", async () => {
    const child = { pid: 4242, kill: vi.fn() } as unknown as Parameters<typeof terminateCodexProcessTree>[0],
      killer = new EventEmitter(),
      spawnKiller = vi.fn(() => killer);
    const stopping = terminateCodexProcessTree(child, "win32", "SIGTERM", spawnKiller as never);
    queueMicrotask(() => killer.emit("close", 0));
    await stopping;
    expect(spawnKiller).toHaveBeenCalledWith(expect.stringMatching(/taskkill\.exe$/i), ["/PID", "4242", "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === "win32")("kills a real Windows command descendant before returning", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "waypoint-codex-tree-")),
      pidFile = path.join(directory, "descendant.pid"),
      scriptFile = path.join(directory, "descendant.ps1");
    writeFileSync(scriptFile, `$child = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 30') -PassThru\n$child.Id | Set-Content -LiteralPath '${pidFile.replaceAll("'", "''")}'\nWait-Process -Id $child.Id\n`);
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptFile], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    try {
      for (let index = 0; index < 100 && !existsSync(pidFile); index++) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(existsSync(pidFile)).toBe(true);
      const descendantPid = Number(readFileSync(pidFile, "utf8").trim());
      await terminateCodexProcessTree(child, "win32", "SIGTERM");
      for (let index = 0; index < 50; index++) {
        try { process.kill(descendantPid, 0); await new Promise((resolve) => setTimeout(resolve, 20)); }
        catch { break; }
      }
      expect(() => process.kill(descendantPid, 0)).toThrow();
    } finally {
      if (!child.killed) child.kill("SIGKILL");
    }
  });
});
