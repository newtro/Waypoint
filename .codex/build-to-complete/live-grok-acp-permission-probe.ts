import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const executable = "C:\\Users\\scott\\.grok\\bin\\grok.exe";
const root = mkdtempSync(path.join(tmpdir(), "waypoint-grok-permission-"));
const target = path.join(root, "SHOULD_EXIST.txt");
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: process.env.USERPROFILE,
  GROK_HOME: `${process.env.USERPROFILE}\\.grok`,
};
delete environment.XAI_API_KEY;
delete environment.GROK_API_KEY;
const child = spawn(
  executable,
  [
    "--always-approve",
    "--sandbox",
    "workspace",
    "agent",
    "--no-leader",
    "stdio",
  ],
  {
    cwd: root,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  },
);
let permissionRequests = 0;
let stderr = "";
child.stderr.on("data", (chunk) => (stderr += String(chunk)));
const app = acp
  .client({ name: "waypoint-permission-probe" })
  .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
    permissionRequests += 1;
    const allow = params.options.find((option) => option.kind === "allow_once");
    return allow
      ? { outcome: { outcome: "selected" as const, optionId: allow.optionId } }
      : { outcome: { outcome: "cancelled" as const } };
  });
try {
  const result = await app.connectWith(
    acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
    async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "waypoint", version: "0.0.0" },
      });
      const updates: string[] = [];
      const session = await ctx.request(acp.methods.agent.session.new, {
        cwd: root,
        mcpServers: [],
      });
      const result = await ctx.request(acp.methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [
          {
            type: "text",
            text: "Create a file named SHOULD_EXIST.txt containing exactly YES. Do not do anything else.",
          },
        ],
      });
      return { stopReason: result.stopReason, updates };
    },
  );
  console.log(
    JSON.stringify(
      {
        result,
        permissionRequests,
        exists: existsSync(target),
        stderr: stderr.slice(-2000),
      },
      null,
      2,
    ),
  );
} finally {
  child.kill();
  await new Promise<void>((resolve) => child.once("close", () => resolve()));
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 100,
  });
}
