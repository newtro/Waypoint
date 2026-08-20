import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  Options,
  Query,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ClaudeAgentWorkbench,
  claudeAutomationSkillAvailable,
  claudeAgentEnvironment,
  claudeAgentLaunchOptions,
  claudeMessageEvents,
  type ClaudeRunRequest,
} from "./claude-agent-sdk.js";
import type { CodexApprovalRequest } from "./codex-app-server.js";
import type { SecurityProfile } from "./ai-workbench.js";

const defaultRoot = mkdtempSync(
  path.join(tmpdir(), "waypoint-claude-default-"),
);
function profile(overrides: Partial<SecurityProfile> = {}): SecurityProfile {
  return {
    id: "developer",
    name: "Developer · approve changes",
    roots: [defaultRoot],
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
function request(overrides: Partial<ClaudeRunRequest> = {}): ClaudeRunRequest {
  return {
    cli: "claude",
    prompt: "Inspect the repository",
    workspaceRoot: defaultRoot,
    profile: profile(),
    executable: "D:\\bin\\claude.exe",
    version: "2.1.229 (Claude Code)",
    onSession: vi.fn(),
    onApproval: vi.fn(async () => ({
      status: "accepted" as const,
      decision: {},
    })),
    ...overrides,
  };
}
const sessionInfo = (sessionId: string, cwd = defaultRoot) =>
  vi.fn(async () => ({ sessionId, cwd, summary: "Waypoint session", lastModified: Date.now() }));
function sdkMessage(value: Record<string, unknown>): SDKMessage {
  return value as unknown as SDKMessage;
}
function init(
  sessionId: string,
  cwd: string,
  overrides: Record<string, unknown> = {},
) {
  return sdkMessage({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    apiKeySource: "oauth",
    claude_code_version: "2.1.229",
    cwd,
    model: "claude-sonnet",
    tools: ["Read", "Edit"],
    skills: ["auto-pr-review"],
    plugins: [],
    mcp_servers: [],
    permissionMode: "default",
    ...overrides,
  });
}
function success(sessionId: string, result = "Done") {
  return sdkMessage({
    type: "result",
    subtype: "success",
    session_id: sessionId,
    result,
    is_error: false,
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    total_cost_usd: 0,
    stop_reason: null,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    uuid: `uuid-${sessionId}`,
  });
}
function fakeQuery(
  run: (options: Options) => AsyncIterable<SDKMessage>,
  capture: (value: unknown) => unknown,
  account: Record<string, unknown> = {
    subscriptionType: "Claude Team",
    apiProvider: "firstParty",
  },
  captureQuery?: (query: Query) => void,
  commands: Array<Record<string, unknown>> = [{ name: "auto-pr-review" }],
) {
  return (params: {
    prompt: string | AsyncIterable<unknown>;
    options?: Options;
  }) => {
    capture(params);
    let closed = false;
    const generator = (async function* () {
        for await (const message of run(params.options!)) {
          if (closed) return;
          yield message;
        }
      })(),
      dynamicMcp = new Map<string, string>(),
      query = Object.assign(generator, {
        interrupt: vi.fn(async () => undefined),
        close: vi.fn(() => {
          closed = true;
          void generator.return(undefined);
        }),
        initializationResult: vi.fn(async () => ({
          commands: [],
          agents: [],
          output_style: "default",
          available_output_styles: [],
          models: [],
          account,
        })),
        supportedCommands: vi.fn(async () => commands),
        supportedModels: vi.fn(async () => []),
        supportedAgents: vi.fn(async () => []),
        reloadSkills: vi.fn(async () => ({ commands: [] })),
        setMcpServers: vi.fn(async (servers: Record<string, unknown>) => {
          dynamicMcp.clear();
          for (const name of Object.keys(servers)) dynamicMcp.set(name, "connected");
          return { added: [...dynamicMcp.keys()], removed: [], errors: {} };
        }),
        mcpServerStatus: vi.fn(async () =>
          [...dynamicMcp].map(([name, status]) => ({ name, status })),
        ),
      });
    captureQuery?.(query as unknown as Query);
    return query as unknown as Query;
  };
}

describe("Claude Agent SDK workbench", () => {
  it("reloads Claude skills before validating a same-turn automation proposal",async()=>{let commands:Array<Record<string,unknown>>=[];const sdkQuery={reloadSkills:vi.fn(async()=>{commands=[{name:"auto-pr-review"}];return {commands:[]}}),supportedCommands:vi.fn(async()=>commands)};await expect(claudeAutomationSkillAvailable(sdkQuery as never,"auto-pr-review",new Set())).resolves.toBe(true);expect(sdkQuery.reloadSkills).toHaveBeenCalledBefore(sdkQuery.supportedCommands)});
  it("uses the installed CLI subscription, full tool preset, persistent resume, and exact root", async () => {
    const capture = vi.fn(),
      onSession = vi.fn(),
      events: unknown[] = [],
      workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("prior-session", String(options.cwd));
          yield sdkMessage({
            type: "assistant",
            session_id: "prior-session",
            parent_tool_use_id: null,
            message: { content: [{ type: "text", text: "Done" }] },
          });
          yield success("prior-session");
        }, capture),
        sessionInfo("prior-session"),
      ),
      running = await workbench.start(
        "run",
        request({ providerSessionId: "prior-session", onSession }),
        (event) => events.push(event),
      ),
      result = await running.completion;
    expect(result.status).toBe("completed");
    expect(running.executable).toBe("D:\\bin\\claude.exe");
    expect(running.version).toBe(
      "SDK 0.3.229 · Claude Code 2.1.229",
    );
    expect(onSession).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rawType: "claude.system.init" }),
        expect.objectContaining({ type: "text", text: "Done" }),
      ]),
    );
    expect(capture.mock.calls[0][0].options).toMatchObject({
      cwd: defaultRoot,
      resume: "prior-session",
      permissionMode: "default",
      tools: { type: "preset", preset: "claude_code" },
      skills: "all",
      settingSources: ["user", "project", "local"],
      settings: {
        sandbox: {
          enabled: process.platform !== "win32",
          failIfUnavailable: process.platform !== "win32",
          allowUnsandboxedCommands: process.platform === "win32",
        },
      },
    });
    expect(
      capture.mock.calls[0][0].options.pathToClaudeCodeExecutable,
    ).toBe("D:\\bin\\claude.exe");
    expect(
      capture.mock.calls[0][0].options.allowDangerouslySkipPermissions,
    ).toBeUndefined();
  });

  it("reattaches the in-process Waypoint MCP server before a resumed Claude turn", async () => {
    const capture = vi.fn(),
      events: Array<Record<string, unknown>> = [];
    let capturedQuery: Query | undefined;
    const workbench = new ClaudeAgentWorkbench(
        fakeQuery(
          async function* (options) {
            yield init("resumed-session", String(options.cwd), {
              mcp_servers: [{ name: "waypoint", status: "connected" }],
            });
            yield success("resumed-session", "proposal ready");
          },
          capture,
          undefined,
          (query) => {
            capturedQuery = query;
          },
        ),
        sessionInfo("resumed-session"),
      ),
      running = await workbench.start(
        "resumed-mcp",
        request({
          providerSessionId: "resumed-session",
          onAutomationProposal: vi.fn(async () => ({
            proposalId: "proposal-1",
            status: "pending",
          })),
        }),
        (event) => events.push(event),
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "completed",
    });
    expect(capturedQuery?.setMcpServers).toHaveBeenCalledWith({
      waypoint: expect.anything(),
    });
    expect(capturedQuery?.reloadSkills).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({ rawType: "claude.mcp.reattached" }),
    );
  });

  it("verifies a fresh Waypoint MCP connection before releasing the first turn", async()=>{const events:Array<Record<string,unknown>>=[];let capturedQuery:Query|undefined;const workbench=new ClaudeAgentWorkbench(fakeQuery(async function*(options){yield init("fresh-mcp",String(options.cwd),{mcp_servers:[{name:"waypoint",status:"connected"}]});yield success("fresh-mcp")},vi.fn(),undefined,(query)=>{capturedQuery=query})),running=await workbench.start("fresh-mcp",request({onAutomationProposal:vi.fn(async()=>({proposalId:"proposal-fresh",status:"pending"}))}),(event)=>events.push(event));await expect(running.completion).resolves.toMatchObject({status:"completed"});expect(capturedQuery?.setMcpServers).toHaveBeenCalledWith({waypoint:expect.anything()});expect(capturedQuery?.reloadSkills).toHaveBeenCalledOnce();expect(events).toContainEqual(expect.objectContaining({rawType:"claude.mcp.connected"}))});

  it("fails before releasing a resumed turn when Waypoint MCP cannot reconnect", async () => {
    let yielded = false;
    const workbench = new ClaudeAgentWorkbench(
      ((params: { prompt: string | AsyncIterable<unknown> }) => {
        const generator = (async function* () {
          for await (const message of params.prompt as AsyncIterable<unknown>) {
            yielded = message !== undefined;
            if (yielded) yield success("unexpected-released-prompt");
          }
        })();
        return Object.assign(generator, {
          initializationResult: vi.fn(async () => ({
            commands: [],
            agents: [],
            output_style: "default",
            available_output_styles: [],
            models: [],
            account: {
              subscriptionType: "Claude Team",
              apiProvider: "firstParty",
            },
          })),
          setMcpServers: vi.fn(async () => {
            throw new Error("transport unavailable");
          }),
          reloadSkills: vi.fn(),
          mcpServerStatus: vi.fn(async () => []),
          supportedCommands: vi.fn(async () => []),
          interrupt: vi.fn(async () => undefined),
          close: vi.fn(),
        }) as unknown as Query;
      }) as never,
      sessionInfo("resumed-session"),
    );
    const running = await workbench.start(
      "failed-resume-mcp",
      request({
        providerSessionId: "resumed-session",
        onAutomationProposal: vi.fn(async () => ({
          proposalId: "proposal-1",
          status: "pending",
        })),
      }),
      () => undefined,
    );
    await expect(running.completion).resolves.toMatchObject({
      status: "failed",
      error: expect.stringContaining("Could not connect Waypoint MCP"),
    });
    expect(yielded).toBe(false);
  });

  it("launches the discovered user CLI instead of the SDK bundled binary", async () => {
    await expect(
      claudeAgentLaunchOptions("D:\\Tools\\claude.exe"),
    ).resolves.toEqual({
      pathToClaudeCodeExecutable: "D:\\Tools\\claude.exe",
    });
  });

  it("keeps Node reachable for a Windows npm shim with sparse PATH", async () => {
    await expect(
      claudeAgentLaunchOptions(
        "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd",
        {
          platform: "win32",
          env: { PATH: "C:\\Windows\\System32" },
          nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
          canAccess: async () => undefined,
        },
      ),
    ).resolves.toEqual({
      executable: "node",
      pathToClaudeCodeExecutable:
        "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js",
    });
    expect(
      claudeAgentEnvironment(
        "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd",
        {
          PATH: "C:\\Windows\\System32",
          USERPROFILE: "C:\\Users\\test",
          APPDATA: "C:\\Users\\test\\AppData\\Roaming",
          ProgramFiles: "C:\\Program Files",
        },
        "win32",
      ).PATH?.split(";"),
    ).toContain("C:\\Program Files\\nodejs");
  });

  it("maps the explicit bypass profile to native no-prompt mode", async () => {
    const capture = vi.fn(),
      onApproval = vi.fn(),
      workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("session-bypass", String(options.cwd), {
            permissionMode: "bypassPermissions",
          });
          await expect(
            options.canUseTool!(
              "Bash",
              { command: "powershell.exe -NoProfile -Command Get-Location" },
              {
                signal: new AbortController().signal,
                toolUseID: "bypass-shell",
                requestId: "bypass-shell",
              },
            ),
          ).resolves.toMatchObject({ behavior: "allow" });
          yield success("session-bypass");
        }, capture),
      ),
      running = await workbench.start(
        "bypass",
        request({
          profile: profile({
            name: "Bypass permissions · no prompts",
            network: "enabled",
            approval: "never",
          }),
          onApproval,
        }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(onApproval).not.toHaveBeenCalled();
    expect(capture.mock.calls[0][0].options).toMatchObject({
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      hooks: { PreToolUse: [{ hooks: [expect.any(Function)] }] },
    });
  });

  it("enforces repository authority through PreToolUse for an approval-gated profile", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "waypoint-claude-bypass-hook-")),
      outside = path.join(tmpdir(), "waypoint-outside.txt"),
      capture = vi.fn(),
      events: Array<Record<string, unknown>> = [],
      workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("session-bypass-hook", String(options.cwd));
          const preToolUse = options.hooks?.PreToolUse?.[0]?.hooks[0];
          expect(preToolUse).toBeTypeOf("function");
          await expect(
            preToolUse!(
              {
                hook_event_name: "PreToolUse",
                session_id: "session-bypass-hook",
                transcript_path: "transcript",
                cwd: repo,
                permission_mode: "default",
                tool_name: "Write",
                tool_input: { file_path: outside, content: "no" },
                tool_use_id: "outside-write",
              },
              "outside-write",
              { signal: new AbortController().signal },
            ),
          ).resolves.toMatchObject({
            hookSpecificOutput: {
              permissionDecision: "deny",
              permissionDecisionReason: expect.stringContaining("outside"),
            },
          });
          yield success("session-bypass-hook");
        }, capture),
      ),
      running = await workbench.start(
        "bypass-hook",
        request({
          workspaceRoot: repo,
          profile: profile({
            roots: [repo],
            name: "Full agent · network enabled",
            network: "enabled",
            approval: "on-write",
          }),
        }),
        (event) => events.push(event),
      );
    expect((await running.completion).status).toBe("completed");
    expect(events).toContainEqual(
      expect.objectContaining({
        rawType: "claude.hook.pre_tool_use.denied",
      }),
    );
  });

  it("keeps Bypass file, shell, network, and MCP authority alongside the proposal tool",async()=>{const repo=mkdtempSync(path.join(tmpdir(),"waypoint-claude-model-tools-")),workbench=new ClaudeAgentWorkbench(fakeQuery(async function*(options){yield init("model-tools",String(options.cwd),{permissionMode:"bypassPermissions"});const hook=options.hooks?.PreToolUse?.[0]?.hooks[0],signal={signal:new AbortController().signal},base={hook_event_name:"PreToolUse" as const,session_id:"model-tools",transcript_path:"transcript",cwd:repo};for(const [tool_name,tool_input] of [["Write",{file_path:path.join(repo,".claude","skills","auto-pr-review.md")}],["Bash",{command:"az devops service-hook create"}],["WebFetch",{url:"https://dev.azure.com"}],["mcp__azure__create_hook",{}]] as const)await expect(hook!({...base,tool_name,tool_input,tool_use_id:tool_name},tool_name,signal)).resolves.toMatchObject({hookSpecificOutput:{permissionDecision:"allow"}});yield success("model-tools")},vi.fn())),running=await workbench.start("model-tools",request({workspaceRoot:repo,profile:profile({roots:[repo],name:"Bypass permissions · no prompts",network:"enabled",approval:"never"}),onAutomationProposal:vi.fn(async()=>({proposalId:"p",status:"pending"}))}),()=>undefined);expect((await running.completion).status).toBe("completed")});
  it("keeps Bypass structured file tools inside the selected root while Bash remains host authority",async()=>{const repo=mkdtempSync(path.join(tmpdir(),"waypoint-claude-bypass-structured-")),outside=path.join(tmpdir(),"outside-bypass.txt"),workbench=new ClaudeAgentWorkbench(fakeQuery(async function*(options){yield init("bypass-structured",String(options.cwd),{permissionMode:"bypassPermissions"});const hook=options.hooks?.PreToolUse?.[0]?.hooks[0],signal={signal:new AbortController().signal},base={hook_event_name:"PreToolUse" as const,session_id:"bypass-structured",transcript_path:"transcript",cwd:repo};await expect(hook!({...base,tool_name:"Write",tool_input:{file_path:outside},tool_use_id:"write"},"write",signal)).resolves.toMatchObject({hookSpecificOutput:{permissionDecision:"deny",permissionDecisionReason:expect.stringContaining("outside")}});await expect(hook!({...base,tool_name:"Bash",tool_input:{command:`Set-Content -LiteralPath '${outside}' -Value ok`},tool_use_id:"bash"},"bash",signal)).resolves.toMatchObject({hookSpecificOutput:{permissionDecision:"allow"}});yield success("bypass-structured")},vi.fn())),running=await workbench.start("bypass-structured",request({workspaceRoot:repo,profile:profile({roots:[repo],name:"Bypass permissions · no prompts",network:"enabled",approval:"never"})}),()=>undefined);expect((await running.completion).status).toBe("completed")});

  it("fails closed when a resumed CLI reports a different session identity", async () => {
    const onSession = vi.fn(),
      workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("replacement-session", String(options.cwd));
          yield success("replacement-session");
        }, vi.fn()),
        sessionInfo("expected-session"),
      ),
      running = await workbench.start(
        "resume-identity-mismatch",
        request({ providerSessionId: "expected-session", onSession }),
        () => undefined,
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "failed",
      error: "Claude Agent SDK initialization provenance is invalid",
    });
    expect(onSession).not.toHaveBeenCalled();
  });

  it("blocks a changed resumed session in UserPromptSubmit before model processing",async()=>{let modelProcessed=false;const onSession=vi.fn(),workbench=new ClaudeAgentWorkbench(fakeQuery(async function*(options){const hook=options.hooks?.UserPromptSubmit?.[0]?.hooks[0];expect(hook).toBeTypeOf("function");const decision=await hook!({hook_event_name:"UserPromptSubmit",session_id:"replacement-session",transcript_path:"transcript",cwd:defaultRoot,prompt:"secret prompt"},undefined,{signal:new AbortController().signal});expect(decision).toMatchObject({decision:"block",hookSpecificOutput:{suppressOriginalPrompt:true}});if(!("decision" in decision)||decision.decision!=="block")modelProcessed=true;yield success("expected-session")},vi.fn()),sessionInfo("expected-session")),running=await workbench.start("prompt-session-mismatch",request({providerSessionId:"expected-session",onSession}),()=>undefined);await expect(running.completion).resolves.toMatchObject({status:"failed"});expect(modelProcessed).toBe(false);expect(onSession).not.toHaveBeenCalled()});

  it("rejects missing durable resume provenance before starting the CLI",async()=>{const queryFactory=vi.fn();const workbench=new ClaudeAgentWorkbench(queryFactory as never,vi.fn(async()=>undefined));await expect(workbench.start("missing-resume",request({providerSessionId:"missing-session"}),()=>undefined)).rejects.toThrow(/resume provenance/);expect(queryFactory).not.toHaveBeenCalled()});

  it("fails closed when the launched CLI reports a different version than detection", async () => {
    const workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("session-version-mismatch", String(options.cwd), {
            claude_code_version: "2.1.228",
          });
          yield success("session-version-mismatch");
        }, vi.fn()),
      ),
      running = await workbench.start(
        "version-mismatch",
        request({ version: "2.1.229 (Claude Code)" }),
        () => undefined,
      );
    await expect(running.completion).resolves.toMatchObject({
      status: "failed",
      error: "Claude Agent SDK initialization provenance is invalid",
    });
  });

  it("routes write approval through Waypoint and returns only the reviewed input", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "waypoint-claude-edit-")),
      capture = vi.fn(),
      onApproval = vi.fn(async () => ({
        status: "accepted" as const,
        decision: {},
      })),
      workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("session-edit", String(options.cwd));
          const decision = await options.canUseTool!(
            "Edit",
            { file_path: "src/app.ts", old_string: "a", new_string: "b" },
            {
              signal: new AbortController().signal,
              toolUseID: "tool-edit",
              requestId: "request-edit",
              title: "Edit src/app.ts",
            },
          );
          expect(decision).toMatchObject({
            behavior: "allow",
            updatedInput: { file_path: "src/app.ts" },
          });
          yield success("session-edit", "edited");
        }, capture),
      ),
      running = await workbench.start(
        "edit",
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
        providerRequestId: "tool-edit",
        kind: "file_change",
        title: "Edit src/app.ts",
      }),
      expect.any(AbortSignal),
    );
  });

  it("redacts common secrets before a tool request becomes durable", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "waypoint-claude-redaction-")),
      capture = vi.fn(),
      requests: CodexApprovalRequest[] = [],
      onApproval = vi.fn(async (value: CodexApprovalRequest) => {
        requests.push(value);
        return { status: "declined" as const, decision: {} };
      }),
      workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("session-secret", String(options.cwd));
          await options.canUseTool!(
            "Write",
            { file_path: "config.txt", content: "token=SUPERSECRET" },
            {
              signal: new AbortController().signal,
              toolUseID: "secret-write",
              requestId: "secret-write",
            },
          );
          yield success("session-secret", "declined");
        }, capture),
      ),
      running = await workbench.start(
        "secret",
        request({
          workspaceRoot: repo,
          profile: profile({ roots: [repo] }),
          onApproval,
        }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(JSON.stringify(requests[0])).not.toContain("SUPERSECRET");
    expect(requests[0]).toMatchObject({
      detail: { input: { content: "token=[REDACTED]" } },
    });
  });

  it("fails closed for paths outside the selected repository and for read-only writes", async () => {
    const capture = vi.fn(),
      onApproval = vi.fn(),
      workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("session-safe", String(options.cwd));
          await expect(
            options.canUseTool!(
              "Read",
              { file_path: "C:\\Users\\scott\\secret.txt" },
              {
                signal: new AbortController().signal,
                toolUseID: "outside",
                requestId: "outside",
              },
            ),
          ).resolves.toMatchObject({ behavior: "deny" });
          await expect(
            options.canUseTool!(
              "Bash",
              { command: "git status" },
              {
                signal: new AbortController().signal,
                toolUseID: "bash",
                requestId: "bash",
              },
            ),
          ).resolves.toMatchObject({
            behavior: "deny",
            message: expect.stringContaining("read-only"),
          });
          yield success("session-safe", "safe");
        }, capture),
      ),
      running = await workbench.start(
        "safe",
        request({ profile: profile({ filesystem: "read-only" }), onApproval }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(onApproval).not.toHaveBeenCalled();
  });

  it("fails closed for a repository junction that resolves outside the selected root", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-claude-junction-")),
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
    const capture = vi.fn(),
      onApproval = vi.fn(),
      workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("session-junction", String(options.cwd));
          await expect(
            options.canUseTool!(
              "Write",
              { file_path: path.join(escape, "escaped.txt"), content: "no" },
              {
                signal: new AbortController().signal,
                toolUseID: "junction",
                requestId: "junction",
              },
            ),
          ).resolves.toMatchObject({
            behavior: "deny",
            message: expect.stringContaining("outside"),
          });
          yield success("session-junction", "safe");
        }, capture),
      ),
      running = await workbench.start(
        "junction",
        request({
          workspaceRoot: repo,
          profile: profile({ roots: [repo] }),
          onApproval,
        }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(onApproval).not.toHaveBeenCalled();
  });

  it("round-trips every AskUserQuestion answer through the durable decision surface", async () => {
    const capture = vi.fn(),
      onApproval = vi.fn(async () => ({
        status: "accepted" as const,
        decision: {
          answers: {
            "Which language?": ["TypeScript"],
            "Run tests?": ["Full"],
          },
        },
      })),
      workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("session-question", String(options.cwd));
          const result = await options.canUseTool!(
            "AskUserQuestion",
            {
              questions: [
                {
                  question: "Which language?",
                  header: "Language",
                  options: [
                    { label: "TypeScript", description: "TS" },
                    { label: "Rust", description: "Rust" },
                  ],
                  multiSelect: false,
                },
                {
                  question: "Run tests?",
                  header: "Tests",
                  options: [
                    { label: "Full", description: "All" },
                    { label: "Focused", description: "Fast" },
                  ],
                  multiSelect: false,
                },
              ],
            },
            {
              signal: new AbortController().signal,
              toolUseID: "question",
              requestId: "question",
            },
          );
          expect(result).toMatchObject({
            behavior: "allow",
            updatedInput: {
              answers: {
                "Which language?": "TypeScript",
                "Run tests?": "Full",
              },
            },
          });
          yield success("session-question", "answered");
        }, capture),
      ),
      running = await workbench.start(
        "question",
        request({ onApproval }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(onApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "question",
        detail: {
          questions: expect.arrayContaining([
            expect.objectContaining({ id: "Which language?" }),
          ]),
        },
      }),
      expect.any(AbortSignal),
    );
  });

  it("streams tool, subagent, usage, and failure events without exposing raw secrets", () => {
    expect(
      claudeMessageEvents(
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool",
                name: "Bash",
                input: { command: "npm test" },
              },
            ],
          },
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({ type: "tool", name: "Bash started" }),
    );
    expect(
      claudeMessageEvents(
        sdkMessage({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool",
                is_error: true,
                content: "token=hidden",
              },
            ],
          },
        }),
      )[0],
    ).toMatchObject({ name: "Tool failed", text: "token=[REDACTED]" });
    expect(
      claudeMessageEvents(
        sdkMessage({
          type: "system",
          subtype: "task_progress",
          task_id: "agent",
          summary: "Reviewing",
        }),
      )[0],
    ).toMatchObject({ type: "agent" });
    expect(
      claudeMessageEvents(
        sdkMessage({
          type: "result",
          subtype: "success",
          result: "ok",
          num_turns: 2,
          usage: { input_tokens: 1 },
          modelUsage: {},
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rawType: "claude.usage" }),
      ]),
    );
  });

  it("redacts secrets from every durable model text and reasoning event", () => {
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
    const messages = [
      sdkMessage({
        type: "stream_event",
        event: { delta: { type: "text_delta", text: "token=SUPERSECRET" } },
      }),
      sdkMessage({
        type: "stream_event",
        event: {
          delta: {
            type: "thinking_delta",
            thinking: "Authorization: Bearer SUPERSECRET",
          },
        },
      }),
      sdkMessage({
        type: "assistant",
        message: {
          content: [
            {
              type: "thinking",
              thinking: "CUSTOM_SECRET=SUPERSECRET",
            },
          ],
        },
      }),
      sdkMessage({
        type: "result",
        subtype: "success",
        result: `password=SUPERSECRET ${slackAppToken} ${slackEnterpriseToken} whsec_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 glft-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 glimt-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 glwt-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 glffct-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 _gitlab_session=ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890`,
        num_turns: 1,
        usage: {},
        modelUsage: {},
      }),
      sdkMessage({type:"system",subtype:"task_progress",summary:"token=SUPERSECRET"}),
      sdkMessage({type:"tool_progress",tool_name:"Bash",detail:"password=SUPERSECRET"}),
      sdkMessage({type:"auth_status",error:"Authorization: Bearer SUPERSECRET"}),
      sdkMessage({type:"system",subtype:"permission_denied",reason:"CUSTOM_SECRET=SUPERSECRET"}),
      sdkMessage({type:"system",subtype:"init",session_id:"s",claude_code_version:"2",model:"m",permissionMode:"CUSTOM_SECRET=SUPERSECRET",skills:["token=SUPERSECRET"],mcp_servers:[{name:"password=SUPERSECRET"}]}),
      sdkMessage({type:"assistant",parent_tool_use_id:"token=SUPERSECRET",message:{content:[{type:"tool_use",id:"password=SUPERSECRET",name:"Authorization: Bearer SUPERSECRET",input:{ok:true}}]}}),
      sdkMessage({type:"system",subtype:"task_progress",task_id:"token=SUPERSECRET",tool_use_id:"password=SUPERSECRET",summary:"ok"}),
      sdkMessage({type:"result",subtype:"success",result:"ok",num_turns:1,usage:{label:"token=SUPERSECRET"},modelUsage:{label:"password=SUPERSECRET"},terminal_reason:"Authorization: Bearer SUPERSECRET"}),
    ];
    const durable = messages.flatMap((message) =>
      claudeMessageEvents(message, ["CUSTOM_SECRET"]),
    );
    expect(JSON.stringify(durable)).not.toContain("SUPERSECRET");
    expect(JSON.stringify(durable)).not.toMatch(/xapp-|xoxe-|whsec_|glft-|glimt-|glwt-|glffct-|_gitlab_session=.*ABCDEFGHIJKLMNOPQRSTUVWXYZ/);
    expect(JSON.stringify(durable)).toContain("[REDACTED]");
  });

  it("retains provider settings and Waypoint hooks when the proposal tool is attached",async()=>{const capture=vi.fn(),workbench=new ClaudeAgentWorkbench(fakeQuery(async function*(options){yield init("model-tools",String(options.cwd),{permissionMode:"bypassPermissions"});yield success("model-tools")},capture)),running=await workbench.start("model-tools-settings",request({profile:profile({approval:"never"}),onAutomationProposal:vi.fn(async()=>({proposalId:"p",status:"pending"}))}),()=>undefined);await expect(running.completion).resolves.toMatchObject({status:"completed"});expect(capture.mock.calls[0][0].options.settingSources).toEqual(["user","project","local"]);expect(capture.mock.calls[0][0].options.settings.hooks).toBeUndefined();expect(capture.mock.calls[0][0].options.hooks).toMatchObject({PreToolUse:expect.any(Array),UserPromptSubmit:expect.any(Array)})});

  it("revalidates root identity for every tool, keeps Chat MCP closed, and never installs provider wildcard rules", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "waypoint-claude-authority-"));
    let rootChecks = 0;
    const onApproval = vi.fn(async () => ({
        status: "accepted_session" as const,
        decision: {},
      })),
      capture = vi.fn(),
      workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("authority", String(options.cwd));
          await expect(
            options.canUseTool!(
              "mcp__github__create_issue",
              { title: "no" },
              {
                signal: new AbortController().signal,
                toolUseID: "mcp",
                requestId: "mcp",
              },
            ),
          ).resolves.toMatchObject({ behavior: "deny" });
          yield success("authority");
        }, capture),
      ),
      running = await workbench.start(
        "authority",
        request({
          workspaceRoot: repo,
          profile: profile({
            roots: [repo],
            filesystem: "read-only",
            tools: ["provider-native"],
          }),
          beforeTurn: () => {
            rootChecks++;
          },
          onApproval,
        }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
    expect(rootChecks).toBeGreaterThanOrEqual(2);
    expect(onApproval).not.toHaveBeenCalled();
    const bashApproval = vi.fn(async () => ({
        status: "accepted" as const,
        decision: {},
      })),
      bashWorkbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("bash-approved", String(options.cwd));
          await expect(
            options.canUseTool!(
              "Bash",
              { command: "powershell.exe -NoProfile -Command Get-Location" },
              {
                signal: new AbortController().signal,
                toolUseID: "bash",
                requestId: "bash",
              },
            ),
          ).resolves.toMatchObject({ behavior: "allow" });
          yield success("bash-approved");
        }, vi.fn()),
      ),
      bash = await bashWorkbench.start(
        "bash-approved",
        request({
          workspaceRoot: repo,
          profile: profile({ roots: [repo] }),
          onApproval: bashApproval,
        }),
        () => undefined,
      );
    expect((await bash.completion).status).toBe("completed");
    expect(bashApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "command",
        detail: expect.objectContaining({
          tool: "Bash",
          input: expect.objectContaining({
            command: "powershell.exe -NoProfile -Command Get-Location",
          }),
        }),
      }),
      expect.any(AbortSignal),
    );
  });

  it("passes a minimum environment and rejects non-OAuth or malformed terminal provenance", async () => {
    const prior = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "SHOULD_NOT_LEAK";
    const capture = vi.fn(),
      workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined();
          yield init("bad-auth", String(options.cwd), { apiKeySource: "user" });
          yield success("bad-auth");
        }, capture),
      ),
      running = await workbench.start("bad-auth", request(), () => undefined);
    expect((await running.completion).status).toBe("failed");
    if (prior === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prior;
    const malformed = new ClaudeAgentWorkbench(
        fakeQuery(async function* () {
          yield sdkMessage({ type: "result", subtype: "success" });
        }, vi.fn()),
      ),
      bad = await malformed.start("malformed", request(), () => undefined);
    expect(await bad.completion).toMatchObject({
      status: "failed",
      error: expect.stringContaining("terminal result"),
    });
  });

  it("does not release the prompt for invalid subscription provenance or a missing required skill",async()=>{for(const variant of ["auth","skill"] as const){let yielded=false;const factory=((params:{prompt:string|AsyncIterable<unknown>})=>{const generator=(async function*(){for await(const message of params.prompt as AsyncIterable<unknown>){yielded=message!==undefined;if(yielded)yield success("unexpected")}})();return Object.assign(generator,{initializationResult:vi.fn(async()=>({commands:[],agents:[],output_style:"default",available_output_styles:[],models:[],account:variant==="auth"?{subscriptionType:"Claude Team",apiProvider:"anthropic",apiKeySource:"user"}:{subscriptionType:"Claude Team",apiProvider:"firstParty"}})),supportedCommands:vi.fn(async()=>[]),supportedModels:vi.fn(async()=>[]),supportedAgents:vi.fn(async()=>[]),reloadSkills:vi.fn(async()=>({commands:[]})),setMcpServers:vi.fn(async()=>({added:[],removed:[],errors:{}})),mcpServerStatus:vi.fn(async()=>[]),interrupt:vi.fn(async()=>undefined),close:vi.fn()})}) as never,workbench=new ClaudeAgentWorkbench(factory),running=await workbench.start(`preflight-${variant}`,request(variant==="skill"?{requiredSkillIdentifier:"missing-skill"}:{}),()=>undefined);await expect(running.completion).resolves.toMatchObject({status:"failed",error:expect.stringMatching(variant==="auth"?/authentication provenance/:/not installed/)});expect(yielded).toBe(false)}});

  it("interrupts when the persisted execution root changes before a tool call", async () => {
    const repo = mkdtempSync(
      path.join(tmpdir(), "waypoint-claude-root-change-"),
    );
    let checks = 0;
    const workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("root-change", String(options.cwd));
          await expect(
            options.canUseTool!(
              "Read",
              { file_path: "safe.txt" },
              {
                signal: new AbortController().signal,
                toolUseID: "read",
                requestId: "read",
              },
            ),
          ).resolves.toMatchObject({ behavior: "deny", interrupt: true });
          yield success("root-change");
        }, vi.fn()),
      ),
      running = await workbench.start(
        "root-change",
        request({
          workspaceRoot: repo,
          profile: profile({ roots: [repo] }),
          beforeTurn: () => {
            if (++checks > 1) throw new Error("root changed");
          },
        }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
  });

  it("fails closed when an automation requires an unavailable exact skill", async () => {
    const workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("missing-skill", String(options.cwd), { skills: [] });
          yield success("missing-skill");
        }, vi.fn(), undefined, undefined, []),
      ),
      running = await workbench.start(
        "missing-skill",
        request({ requiredSkillIdentifier: "auto-pr-review" }),
        () => undefined,
      ),
      result = await running.completion;
    expect(result.status).toBe("failed");
    expect(result.error).toContain("is not installed and enabled");
  });

  it("interrupts a different skill invocation during an exact-skill automation", async () => {
    const workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("wrong-skill", String(options.cwd));
          await expect(
            options.canUseTool!(
              "Skill",
              { skill: "different-review" },
              {
                signal: new AbortController().signal,
                toolUseID: "skill",
                requestId: "skill",
              },
            ),
          ).resolves.toMatchObject({ behavior: "deny", interrupt: true });
          yield success("wrong-skill");
        }, vi.fn()),
      ),
      running = await workbench.start(
        "wrong-skill",
        request({ requiredSkillIdentifier: "auto-pr-review" }),
        () => undefined,
      );
    const result = await running.completion;
    expect(result.status).toBe("failed");
    expect(result.error).toContain("without invoking the approved exact skill");
  });

  it("completes only after invoking the approved exact skill", async () => {
    const workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("exact-skill", String(options.cwd));
          await expect(
            options.canUseTool!(
              "Skill",
              { skill: "auto-pr-review" },
              {
                signal: new AbortController().signal,
                toolUseID: "skill",
                requestId: "skill",
              },
            ),
          ).resolves.toMatchObject({ behavior: "allow" });
          yield success("exact-skill");
        }, vi.fn()),
      ),
      running = await workbench.start(
        "exact-skill",
        request({ requiredSkillIdentifier: "auto-pr-review" }),
        () => undefined,
      );
    expect((await running.completion).status).toBe("completed");
  });

  it("cancels explicitly and ignores profile duration as an AI deadline", async () => {
    const capture = vi.fn(),
      workbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* () {
          await new Promise((resolve) => setTimeout(resolve, 100));
          yield sdkMessage({
            type: "result",
            subtype: "success",
            session_id: "late",
            result: "late",
            num_turns: 1,
            usage: {},
            modelUsage: {},
          });
        }, capture),
      ),
      running = await workbench.start("cancel", request(), () => undefined);
    running.cancel();
    expect((await running.completion).status).toBe("canceled");
    const unlimitedWorkbench = new ClaudeAgentWorkbench(
        fakeQuery(async function* (options) {
          yield init("unlimited", String(options.cwd));
          await new Promise((resolve) => setTimeout(resolve, 30));
          yield success("unlimited", "completed after the legacy profile duration");
        }, vi.fn()),
      ),
      unlimited = await unlimitedWorkbench.start(
        "unlimited",
        request({ profile: profile({ maxDurationMs: 10 }) }),
        () => undefined,
      );
    expect((await unlimited.completion).status).toBe("completed");
  });
});
