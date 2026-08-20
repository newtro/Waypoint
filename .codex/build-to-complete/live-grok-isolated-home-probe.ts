import { execFile, spawn } from "node:child_process";
import { linkSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const run = promisify(execFile),
  executable = "C:\\Users\\scott\\.grok\\bin\\grok.exe",
  sourceHome = "C:\\Users\\scott\\.grok",
  isolated = mkdtempSync(path.join(tmpdir(), "waypoint-grok-isolated-"));
try {
  linkSync(
    path.join(sourceHome, "auth.json"),
    path.join(isolated, "auth.json"),
  );
  writeFileSync(
    path.join(isolated, "config.toml"),
    '[cli]\nauto_update=false\n[models]\ndefault="grok-4.6"\n[compat.claude]\nmcps=false\nplugins=false\nhooks=false\nskills=false\nagents=false\nrules=false\n[compat.cursor]\nmcps=false\nplugins=false\nhooks=false\nskills=false\nagents=false\nrules=false\n',
    { encoding: "utf8", mode: 0o600 },
  );
  const env = {
      ...process.env,
      HOME: isolated,
      USERPROFILE: isolated,
      HOMEDRIVE: path.parse(isolated).root.slice(0, -1),
      HOMEPATH: isolated.slice(path.parse(isolated).root.length - 1),
      APPDATA: path.join(isolated, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(isolated, "AppData", "Local"),
      GROK_HOME: isolated,
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
    },
    models = await run(executable, ["models"], { env, windowsHide: true }),
    inspect = await run(
      executable,
      ["--cwd", "D:\\Repos\\Waypoint", "inspect", "--json"],
      { env, windowsHide: true },
    ),
    report = JSON.parse(inspect.stdout) as Record<string, unknown>;
  const child = spawn(executable, ["agent", "--no-leader", "stdio"], {
      cwd: "D:\\Repos\\Waypoint",
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }),
    stderr: string[] = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const acpResult = await acp
    .client({ name: "waypoint-isolation-probe" })
    .connectWith(
      acp.ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
      async (ctx) => {
        const initialized = await ctx.request(acp.methods.agent.initialize, {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientInfo: { name: "waypoint", version: "0.0.0" },
            clientCapabilities: {},
          }),
          session = await ctx.request(acp.methods.agent.session.new, {
            cwd: "D:\\Repos\\Waypoint",
            mcpServers: [],
          });
        await ctx.notify(acp.methods.agent.session.cancel, {
          sessionId: session.sessionId,
        });
        return { initialized, session };
      },
    );
  child.kill();
  await new Promise<void>((resolve) => child.once("close", () => resolve()));
  const initMeta = (acpResult.initialized._meta ?? {}) as Record<
      string,
      unknown
    >,
    sessionMeta = (acpResult.session._meta ?? {}) as Record<string, unknown>;
  console.log(
    JSON.stringify({
      signedIn: /You are logged in with grok\.com\./.test(models.stdout),
      hooks: report.hooks,
      plugins: report.plugins,
      mcpServers: report.mcpServers,
      acpInitMcpServers: initMeta.mcpServers,
      acpSessionMcpServers: sessionMeta.mcpServers,
      hookRan: stderr.join("").includes("hook failed"),
    }),
  );
} finally {
  rmSync(isolated, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
