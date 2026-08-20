import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  AiWaypointControlBridge,
  ToolGateway,
  discoverLocalCli,
  localCliProcessInvocation,
  policyDigest,
  redactToolText,
  type ToolGatewayHooks,
  type ToolGatewayPolicy,
  type ToolResult,
} from "./tool-gateway.js";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed: string[] = [];
  kill(signal?: NodeJS.Signals) {
    this.killed.push(signal ?? "SIGTERM");
    queueMicrotask(() => this.emit("close", null, signal ?? "SIGTERM"));
    return true;
  }
}
const root = () => {
  const value = mkdtempSync(path.join(tmpdir(), "waypoint-tools-"));
  writeFileSync(path.join(value, "safe.txt"), "hello");
  return value;
};
const policy = (
  workspaceRoot: string,
  override: Partial<ToolGatewayPolicy> = {},
): ToolGatewayPolicy => ({
  profileName: "Developer · approve changes",
  roots: [workspaceRoot],
  denyPatterns: [],
  stopped: false,
  secretNames: ["MY_TOKEN"],
  maxDurationMs: 1000,
  maxConcurrency: 1,
  suppressCommit: false,
  suppressPush: false,
  ...override,
});
const request = (
  workspaceId: string,
  tool:
    | "workspace.list_files"
    | "workspace.read_file"
    | "workspace.search"
    | "workspace.write_file"
    | "terminal.run"
    | "local_cli.run"
    | "agent_browser.run"
    | "waypoint.command",
  args: Record<string, unknown>,
  origin: "ui" | "ai" = "ui",
) => ({ version: 1 as const, workspaceId, origin, tool, arguments: args });
function setup(child = new FakeChild()) {
  const completed: ToolResult[] = [],
    progress: unknown[] = [],
    domain = vi.fn(async (_workspaceId: string, command: string) => ({
      value: { command },
      summary: `Ran ${command}`,
      rollbackRef: "undo-1",
    })),
    hooks: ToolGatewayHooks = {
      domain,
      progress: (value) => progress.push(value),
      complete: (value) => completed.push(value),
    },
    gateway = new ToolGateway(
      hooks,
      (() => child) as never,
      async () => ({ url: "http://127.0.0.1:43123", close: async () => {} }),
      (name: "git" | "gh" | "az") => ({
        name,
        available: true,
        executable: `/usr/bin/${name}`,
        authentication: "existing-local-identity" as const,
      }),
    );
  return { gateway, child, completed, progress, domain };
}

describe("generic tool gateway", () => {
  it("launches the verified Microsoft Azure CLI shim through its adjacent native Python runtime", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "waypoint-az-shim-")),
      wbin = path.join(directory, "wbin"),
      shim = path.join(wbin, "az.cmd"),
      python = path.join(directory, "python.exe");
    mkdirSync(wbin);
    writeFileSync(
      shim,
      '@IF EXIST "%~dp0\\..\\python.exe" (\n  "%~dp0\\..\\python.exe" -IBm azure.cli %*\n)',
    );
    writeFileSync(python, "native placeholder");
    expect(
      localCliProcessInvocation(
        "az",
        shim,
        ["devops", "project", "show"],
        "win32",
      ),
    ).toEqual({
      executable: realpathSync(python),
      args: ["-IBm", "azure.cli", "devops", "project", "show"],
    });
  });

  it("rejects unsupported Windows command shims instead of enabling shell interpolation", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "waypoint-cli-shim-")),
      shim = path.join(directory, "gh.cmd");
    writeFileSync(shim, "@echo unsafe %*");
    expect(() =>
      localCliProcessInvocation("gh", shim, ["api", "repos/a/b"], "win32"),
    ).toThrow(/unsupported/);
  });

  it("rejects an oversized Azure shim before reading or interpreting it",()=>{const directory=mkdtempSync(path.join(tmpdir(),"waypoint-large-az-shim-")),shim=path.join(directory,"az.cmd");writeFileSync(shim,`@echo off\n${"x".repeat(16_385)}\n%~dp0\\..\\python.exe -IBm azure.cli %*`);expect(()=>localCliProcessInvocation("az",shim,["version"],"win32")).toThrow(/unsupported installer layout/)});

  it("uses identical domain command semantics for UI and AI while blocking AI security settings", async () => {
    const directory = root(),
      { gateway, domain } = setup(),
      ui = await gateway.execute(
        request(
          "workspace_one",
          "waypoint.command",
          { command: "chat.create", input: { title: "x" } },
          "ui",
        ),
        policy(directory),
      ),
      ai = await gateway.execute(
        request(
          "workspace_one",
          "waypoint.command",
          { command: "chat.create", input: { title: "x" } },
          "ai",
        ),
        policy(directory),
      );
    expect(ui.result?.receipt.summary).toBe(ai.result?.receipt.summary);
    expect(domain).toHaveBeenCalledTimes(2);
    const blocked = await gateway.execute(
      request(
        "workspace_one",
        "waypoint.command",
        { command: "security.profile.update" },
        "ai",
      ),
      policy(directory),
    );
    expect(blocked.result?.receipt).toMatchObject({
      status: "denied",
      code: "user_only_command",
    });
  });
  it("keeps file reads and listings inside the canonical root and records symlink escapes as terminal failures", async () => {
    const directory = root(),
      outside = root();
    writeFileSync(path.join(outside, "secret.txt"), "no");
    symlinkSync(
      outside,
      path.join(directory, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const { gateway } = setup(),
      listed = await gateway.execute(
        request("workspace_one", "workspace.list_files", { path: "." }),
        policy(directory),
      ),
      read = await gateway.execute(
        request("workspace_one", "workspace.read_file", { path: "safe.txt" }),
        policy(directory),
      );
    expect(listed.result?.value).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "safe.txt" })]),
    );
    expect(read.result?.output).toBe("hello");
    const escaped = await gateway.execute(
      request("workspace_one", "workspace.read_file", {
        path: "escape/secret.txt",
      }),
      policy(directory),
    );
    expect(escaped.result?.receipt).toMatchObject({
      status: "failed",
      code: "tool_error",
    });
  });
  it("searches and atomically writes large workspace files without following symlink escapes or claiming rollback", async () => {
    const directory = root(),
      outside = root(),
      { gateway } = setup(),
      search = await gateway.execute(
        request("workspace_one", "workspace.search", { query: "hello" }, "ai"),
        policy(directory),
      );
    expect(search.result?.value).toEqual([
      expect.objectContaining({ path: "safe.txt", line: 1, text: "hello" }),
    ]);
    const written = await gateway.execute(
      request(
        "workspace_one",
        "workspace.write_file",
        { path: "nested/result.md", content: "# safe" },
        "ai",
      ),
      policy(directory),
    );
    expect(written.result?.receipt).toMatchObject({
      status: "completed",
      rollbackRef: undefined,
    });
    expect(readFileSync(path.join(directory, "nested/result.md"), "utf8")).toBe(
      "# safe",
    );
    const largeContent = "x".repeat(512 * 1024);
    const large = await gateway.execute(
      request(
        "workspace_one",
        "workspace.write_file",
        { path: "nested/large.txt", content: largeContent },
        "ai",
      ),
      policy(directory),
    );
    expect(large.result?.receipt.status).toBe("completed");
    expect(readFileSync(path.join(directory, "nested/large.txt"), "utf8")).toHaveLength(largeContent.length);
    symlinkSync(
      outside,
      path.join(directory, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const escaped = await gateway.execute(
      request(
        "workspace_one",
        "workspace.write_file",
        { path: "linked/no.txt", content: "no" },
        "ai",
      ),
      policy(directory),
    );
    expect(escaped.result?.receipt.status).not.toBe("completed");
  });
  it("redacts secrets and stable policy receipts never include configured secret values", () => {
    const input =
      'Authorization: Bearer abc.def\npassword=hunter2\nMY_TOKEN=topsecret\n{"secret":"dynamic-signing-value","basicAuthCredentials":"waypoint:dynamic-basic"}\nhttps://u:p@example.test\ngho_abcdefghijklmnopqrstuvwxyz1234567890\ngithub_pat_11AAabcdefghijklmnopqrstuvwxyz1234567890\nxapp-1-ABCDEFGHIJKLMNOPQRSTUVWXYZ-1234567890-abcdef\nxoxe-1-ABCDEFGHIJKLMNOPQRSTUVWXYZ-1234567890-abcdef\nwhsec_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\ngldt-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\nglrt-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\nglrtr-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\nglcbt-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\ngloas-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\nglptt-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\nglagent-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\nglsoat-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\nglft-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\nglimt-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\nglwt-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\nglffct-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\n_gitlab_session=ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\neyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----';
    const output = redactToolText(input, ["MY_TOKEN"]);
    expect(output).not.toMatch(
      /abc\.def|hunter2|topsecret|dynamic-signing-value|dynamic-basic|u:p|gho_|github_pat_|xapp-|xoxe-|whsec_|gl[a-z]{2,12}-|ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890|eyJabcdefghijk|BEGIN PRIVATE/,
    );
    expect(output).toMatch(/REDACTED/);
    expect(policyDigest(policy(root()))).toMatch(/^[a-f0-9]{64}$/);
  });
  it("enforces deny patterns, secret dumps, task suppressions, PR and deployment authority", async () => {
    const directory = root(),
      { gateway } = setup();
    for (const [command, code] of [
      ["rm -rf build", "deny_list"],
      ["printenv", "secret_environment"],
      ["git commit -m x", "task_suppressed_commit"],
      ["gh pr create", "explicit_authority_required"],
      ["terraform apply", "explicit_authority_required"],
    ] as const) {
      const active = policy(directory, {
          denyPatterns: ["rm\\s+-rf"],
          suppressCommit: true,
        }),
        result = await gateway.execute(
          request("workspace_one", "terminal.run", { command }),
          active,
        );
      expect(result.result?.receipt).toMatchObject({ status: "denied", code });
    }
  });
  it("streams bounded safe progress, completes, cancels, and honors stop without crossing workspaces", async () => {
    const directory = root(),
      first = setup(),
      pending = await first.gateway.execute(
        request("workspace_one", "terminal.run", { command: "printf ok" }),
        policy(directory),
      );
    first.child.stdout.write("password=hunter2\nok");
    first.child.emit("close", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(first.completed.at(-1)?.receipt.status).toBe("completed");
    expect(JSON.stringify(first.progress)).not.toContain("hunter2");
    const second = setup(),
      run = await second.gateway.execute(
        request("workspace_one", "terminal.run", { command: "sleep 10" }),
        policy(directory),
      );
    expect(second.gateway.cancel("workspace_two", run.runId)).toBe(false);
    expect(second.gateway.cancel("workspace_one", run.runId)).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(second.completed.at(-1)?.receipt.status).toBe("canceled");
    first.gateway.stop("workspace_one");
    const stopped = await first.gateway.execute(
      request("workspace_one", "terminal.run", { command: "true" }),
      policy(directory),
    );
    expect(stopped.result?.receipt.code).toBe("workspace_stopped");
    expect(pending.runId).toBeTruthy();
  });
  it("lets provisioning await clean stdout from an asynchronous local CLI run", async () => {
    const directory = root(),
      { gateway, child } = setup(),
      started = await gateway.execute(
        request(
          "workspace_one",
          "local_cli.run",
          { cli: "gh", args: ["api", "repos/owner/repo/hooks"] },
          "ui",
        ),
        policy(directory),
      ),
      completion = gateway.waitForCompletion(started.runId, 1_000);
    expect(started.result).toBeUndefined();
    child.stderr.write("warning: update available\n");
    child.stdout.write('{"id":42}');
    child.emit("close", 0, null);
    await expect(completion).resolves.toMatchObject({
      receipt: { id: started.runId, status: "completed" },
      output: '{"id":42}',
    });
  });
  it("redacts exact vault-sourced runtime secrets from provisioning output", async () => {
    const directory = root(),
      { gateway, child, progress } = setup(),
      started = await gateway.execute(
        request(
          "workspace_one",
          "local_cli.run",
          { cli: "az", args: ["devops", "invoke", "waypoint:supersecret"] },
          "ui",
        ),
        policy(directory),
        ["waypoint:supersecret"],
      ),
      completion = gateway.waitForCompletion(started.runId, 1_000);
    child.stdout.write("created waypoint:supersecret");
    child.emit("close", 0, null);
    const result = await completion;
    expect(result.output).toContain("[REDACTED]");
    expect(result.output).not.toContain("supersecret");
    expect(JSON.stringify(progress)).not.toContain("supersecret");
  });
  it("enforces per-workspace concurrency, ignores AI time hints, and bounds local CLI capability", async () => {
    const directory = root(),
      { gateway, child } = setup();
    await gateway.execute(
      request("workspace_one", "terminal.run", { command: "sleep 10" }),
      policy(directory),
    );
    const concurrent = await gateway.execute(
      request("workspace_one", "terminal.run", { command: "echo no" }),
      policy(directory),
    );
    expect(concurrent.result?.receipt.code).toBe("concurrency_limit");
    const invalid = await gateway.execute(
      request("workspace_two", "terminal.run", {
        command: "echo no",
        timeoutMs: 10,
      }),
      policy(directory),
    );
    expect(invalid.result).toBeUndefined();
    child.emit("close", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    const unsupported = await gateway.execute(
      request("workspace_one", "local_cli.run", {
        cli: "powershell",
        args: [],
      }),
      policy(directory),
    );
    expect(unsupported.result?.receipt.code).toBe("unsupported_cli");
    expect(discoverLocalCli("git")).toMatchObject({
      name: "git",
      authentication: "existing-local-identity",
    });
  });
  it.runIf(process.platform === "win32")(
    "waits for Windows process-tree termination before reporting cancellation",
    async () => {
      const directory = root(),
        pidFile = path.join(directory, "descendant.pid"),
        scriptFile = path.join(directory, "descendant.ps1"),
        completed: ToolResult[] = [],
        gateway = new ToolGateway({
          domain: async () => ({ value: {}, summary: "ok" }),
          progress: () => undefined,
          complete: (value) => completed.push(value),
        }),
        command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${scriptFile}`;
      writeFileSync(
        scriptFile,
        `$PID | Set-Content -LiteralPath '${pidFile.replaceAll("'", "''")}'\nStart-Sleep -Seconds 30\n`,
      );
      const started = await gateway.execute(
        request("workspace_one", "terminal.run", { command }),
        policy(directory, { maxDurationMs: 30_000 }),
      );
      expect(started.result).toBeUndefined();
      for (let index = 0; index < 100 && !existsSync(pidFile); index++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      expect(existsSync(pidFile)).toBe(true);
      const descendantPid = Number(readFileSync(pidFile, "utf8").trim());
      expect(gateway.cancel("workspace_one", started.runId)).toBe(true);
      await expect(
        gateway.waitForCompletion(started.runId, 5_000),
      ).resolves.toMatchObject({ receipt: { status: "canceled" } });
      expect(() => process.kill(descendantPid, 0)).toThrow();
      expect(completed.at(-1)?.receipt.status).toBe("canceled");
    },
  );
  it("runs the pinned browser without shell interpolation and only under user-owned domain/profile policy", async () => {
    const directory = root(),
      first = setup(),
      denied = await first.gateway.execute(
        request(
          "workspace_one",
          "agent_browser.run",
          { action: { command: "open", url: "https://example.com" } },
          "ai",
        ),
        policy(directory),
      );
    expect(denied.result?.receipt.code).toBe("browser_unavailable");
    const second = setup(),
      active = policy(directory, {
        browserExecutable: "/app/agent-browser",
        browserBrowserExecutable: "/app/chromium",
        browserProfileMode: "isolated",
        browserAllowedDomains: ["example.com"],
        browserSessionName: "workspace_one",
        browserHomeDir: path.join(directory, "browser-home"),
      }),
      run = await second.gateway.execute(
        request(
          "workspace_one",
          "agent_browser.run",
          { action: { command: "open", url: "https://example.com" } },
          "ai",
        ),
        active,
      );
    expect(run.result).toBeUndefined();
    second.child.emit("close", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(second.completed.at(-1)?.receipt).toMatchObject({
      tool: "agent_browser.run",
      status: "completed",
      summary: "Command completed",
    });
  });
  it("fails closed for unknown tools while trusted AI execution uses the same bounded local policy", async () => {
    const directory = root(),
      first = setup(),
      unknown = await first.gateway
        .execute(
          {
            ...request("workspace_one", "terminal.run", { command: "true" }),
            tool: "not.a.tool",
          } as never,
          policy(directory),
        )
        .catch((error: Error) => error);
    expect(unknown).toBeInstanceOf(Error);
    const terminal = await first.gateway.execute(
      request(
        "workspace_one",
        "terminal.run",
        { command: "printf safe" },
        "ai",
      ),
      policy(directory),
    );
    expect(terminal.result).toBeUndefined();
    first.child.emit("close", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(first.completed.at(-1)?.receipt).toMatchObject({
      origin: "ai",
      tool: "terminal.run",
      status: "completed",
    });
    const second = setup(),
      cli = await second.gateway.execute(
        request(
          "workspace_one",
          "local_cli.run",
          { cli: "gh", args: ["--version"] },
          "ai",
        ),
        policy(directory),
      );
    expect(cli.result?.receipt.code).not.toBe(
      "interactive_local_execution_required",
    );
  });
  it("redacts secrets split across output chunks before any content is exposed", async () => {
    const directory = root(),
      { gateway, child, completed, progress } = setup();
    await gateway.execute(
      request("workspace_one", "terminal.run", { command: "printf safe" }),
      policy(directory),
    );
    child.stdout.write("pass");
    child.stdout.write("word=hunter2");
    child.emit("close", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(completed.at(-1)?.output).not.toContain("hunter2");
    expect(JSON.stringify(progress)).not.toContain("hunter2");
  });
  it("provides a policy-governed trusted-main AI bridge and terminal receipts for thrown operations", async () => {
    const directory = root(),
      configured = policy(directory),
      { gateway, domain, completed } = setup(),
      bridge = new AiWaypointControlBridge(gateway, () => configured),
      domainResult = await bridge.execute("workspace_one", "chat.create", {
        title: "x",
      }),
      readResult = await bridge.executeTool(
        "workspace_one",
        "workspace.read_file",
        { path: "safe.txt" },
      );
    expect(domainResult.result?.receipt).toMatchObject({
      origin: "ai",
      tool: "waypoint.command",
      status: "completed",
    });
    expect(readResult.result?.receipt).toMatchObject({
      origin: "ai",
      tool: "workspace.read_file",
      status: "completed",
    });
    expect(domain).toHaveBeenCalled();
    const failingHooks: ToolGatewayHooks = {
        domain: async () => {
          throw new Error("domain exploded");
        },
        progress: () => {},
        complete: (value) => completed.push(value),
      },
      failing = new ToolGateway(failingHooks, (() => {
        throw new Error("spawn exploded");
      }) as never),
      domainFailure = await failing.execute(
        request(
          "workspace_one",
          "waypoint.command",
          { command: "chat.create" },
          "ai",
        ),
        configured,
      ),
      spawnFailure = await failing.execute(
        request("workspace_one", "terminal.run", { command: "true" }),
        configured,
      );
    expect(domainFailure.result?.receipt).toMatchObject({
      status: "failed",
      code: "tool_error",
    });
    expect(spawnFailure.result?.receipt).toMatchObject({
      status: "failed",
      code: "tool_error",
    });
    expect(completed.at(-1)?.receipt.status).toBe("failed");
  });
  it("preflights equivalent failures and permits only a reasoned retry that can supersede knowledge", async () => {
    const directory = root(),
      child = new FakeChild(),
      learn = vi.fn(),
      hooks: ToolGatewayHooks = {
        domain: async () => ({ value: {}, summary: "ok" }),
        progress: () => {},
        complete: () => {},
        preflight: () => ({
          id: "failure_one",
          errorClass: "nonzero_exit",
          remediation: "Repair the fixture",
          expiresAt: new Date(Date.now() + 1000).toISOString(),
        }),
        learn,
      },
      gateway = new ToolGateway(hooks, (() => child) as never),
      blocked = await gateway.execute(
        request("workspace_one", "terminal.run", { command: "make test" }),
        policy(directory),
      );
    expect(blocked.result?.receipt).toMatchObject({
      status: "denied",
      code: "known_failure_preflight",
      notification: "Prior remedy: Repair the fixture",
    });
    const invalid = await gateway.execute(
      request("workspace_one", "terminal.run", {
        command: "make test",
        failureOverrideReason: "too short",
      }),
      policy(directory),
    );
    expect(invalid.result?.receipt).toMatchObject({
      status: "failed",
      code: "tool_error",
    });
    const retry = await gateway.execute(
      request("workspace_one", "terminal.run", {
        command: "make test",
        failureOverrideReason: "Changed the local compiler version",
      }),
      policy(directory),
    );
    expect(retry.result).toBeUndefined();
    child.emit("close", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(learn).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "terminal.run" }),
      expect.objectContaining({
        receipt: expect.objectContaining({ status: "completed" }),
      }),
      "Changed the local compiler version",
      undefined,
    );
  });
  it("binds external web authority into the audit policy digest", () => {
    const directory = root(),
      base = policy(directory);
    expect(
      policyDigest({
        ...base,
        webFetchEnabled: false,
        webSearchEnabled: false,
      }),
    ).not.toBe(
      policyDigest({ ...base, webFetchEnabled: true, webSearchEnabled: false }),
    );
    expect(
      policyDigest({ ...base, webFetchEnabled: true, webSearchEnabled: false }),
    ).not.toBe(
      policyDigest({ ...base, webFetchEnabled: true, webSearchEnabled: true }),
    );
  });
  it("binds browser progress and terminal output to the originating chat", async () => {
    const directory = root(),
      { gateway, progress } = setup();
    gateway.configureBrowser(async () => ({
      summary: "Captured snapshot",
      output: "bounded page text",
    }));
    const configured = policy(directory, {
        browserExecutable: "/app/agent-browser",
        browserBrowserExecutable: "/app/chromium",
        browserProfileMode: "isolated",
        browserAllowedDomains: ["example.com"],
        browserHomeDir: path.join(directory, "browser-home"),
      }),
      result = await gateway.execute(
        request("workspace_one", "agent_browser.run", {
          contextChatId: "chat_one",
          action: { command: "open", url: "https://example.com" },
        }),
        configured,
      );
    expect(result.result?.receipt).toMatchObject({
      chatId: "chat_one",
      status: "completed",
    });
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "agent_browser.run",
          chatId: "chat_one",
          type: "completed",
          output: "bounded page text",
        }),
      ]),
    );
  });
  it("cancels an in-app browser action and emits one terminal canceled event", async () => {
    const directory = root(),
      { gateway, progress } = setup();
    gateway.configureBrowser(
      async (_workspaceId, _action, _root, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Canceled", "AbortError")),
            { once: true },
          ),
        ),
    );
    const configured = policy(directory, {
        browserExecutable: "/app/agent-browser",
        browserBrowserExecutable: "/app/chromium",
        browserProfileMode: "isolated",
        browserAllowedDomains: ["example.com"],
        browserHomeDir: path.join(directory, "browser-home"),
      }),
      pending = gateway.execute(
        request("workspace_one", "agent_browser.run", {
          contextChatId: "chat_one",
          action: { command: "wait", milliseconds: 10000 },
        }),
        configured,
      );
    await new Promise((resolve) => setImmediate(resolve));
    const events = progress as Array<{ runId: string; type: string }>,
      runId = events.find((item) => item.type === "started")?.runId;
    expect(runId).toBeTruthy();
    expect(gateway.cancel("workspace_one", runId!)).toBe(true);
    const result = await pending;
    expect(result.result?.receipt.status).toBe("canceled");
    expect(
      events.filter(
        (item) =>
          item.runId === runId &&
          ["completed", "failed", "canceled"].includes(item.type),
      ),
    ).toHaveLength(1);
  });
  it("publishes an async browser run id before awaiting it so provider cancellation can reach it", async () => {
    const directory = root(),
      { gateway } = setup();
    gateway.configureBrowser(
      async (_workspaceId, _action, _root, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Canceled", "AbortError")),
            { once: true },
          ),
        ),
    );
    let started: string | undefined;
    const configured = policy(directory, {
        browserExecutable: "/app/agent-browser",
        browserBrowserExecutable: "/app/chromium",
        browserProfileMode: "isolated",
        browserAllowedDomains: ["example.com"],
        browserHomeDir: path.join(directory, "browser-home"),
      }),
      pending = gateway.execute(
        request("workspace_one", "agent_browser.run", {
          action: { command: "wait", milliseconds: 10000 },
        }),
        configured,
        [],
        (runId) => {
          started = runId;
        },
      );
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toBeTruthy();
    expect(gateway.cancel("workspace_one", started!)).toBe(true);
    await expect(pending).resolves.toMatchObject({
      runId: started,
      result: { receipt: { status: "canceled" } },
    });
  });
});
