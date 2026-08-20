import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const executable = "C:\\Users\\scott\\.grok\\bin\\grok.exe";
const environment: NodeJS.ProcessEnv = { ...process.env };
environment.HOME = environment.USERPROFILE;
environment.GROK_HOME = `${environment.USERPROFILE}\\.grok`;
delete environment.XAI_API_KEY;
delete environment.GROK_API_KEY;

const child = spawn(executable, ["agent", "--no-leader", "stdio"], {
  cwd: process.cwd(),
  env: environment,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
let stderr = "";
child.stderr.on("data", (chunk) => (stderr += String(chunk)));
const stream = acp.ndJsonStream(
  Writable.toWeb(child.stdin),
  Readable.toWeb(child.stdout),
);

try {
  const result = await acp
    .client({ name: "waypoint-probe" })
    .connectWith(stream, async (ctx) => {
      const initialize = await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientInfo: { name: "waypoint", version: "0.0.0" },
        clientCapabilities: {},
      });
      const session = await ctx.buildSession(process.cwd()).start();
      const response = {
        initialize,
        sessionId: session.sessionId,
        sessionMeta: session.meta,
        modes: session.modes,
        newSession: session.newSessionResponse,
      };
      session.dispose();
      return response;
    });
  console.log(JSON.stringify(result, null, 2));
} finally {
  child.kill();
  await new Promise<void>((resolve) => child.once("close", () => resolve()));
  if (stderr.trim()) console.error(stderr.trim());
}
