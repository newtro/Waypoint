import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { GrokAgentWorkbench } from "../../electron/core/grok-agent-acp.js";
import type {
  ExecutionEvent,
  SecurityProfile,
} from "../../electron/core/ai-workbench.js";

const executable = "C:\\Users\\scott\\.grok\\bin\\grok.exe",
  version = "grok 1.0.3 (1a29d5bc12) [stable]",
  root = mkdtempSync(path.join(tmpdir(), "waypoint-grok-live-"));
const base: SecurityProfile = {
  id: "grok-live",
  name: "Chat · read only",
  roots: [root],
  filesystem: "read-only",
  network: "provider-only",
  tools: ["provider-native"],
  maxDurationMs: 0,
  maxConcurrency: 1,
  approval: "always",
  peerEligible: false,
  secretNames: [],
};
const workbench = new GrokAgentWorkbench();
let sessionId = "",
  approvals = 0;
const run = async (
  id: string,
  prompt: string,
  profile: SecurityProfile,
  existing?: string,
  loadProviderHistory = false,
) => {
  const events: ExecutionEvent[] = [];
  const running = await workbench.start(
    id,
    {
      cli: "grok",
      prompt,
      workspaceRoot: root,
      profile,
      executable,
      version,
      providerSessionId: existing,
      loadProviderHistory,
      onSession: (value) => {
        sessionId = value;
      },
      onApproval: async () => {
        approvals += 1;
        return { status: "declined", decision: {} };
      },
    },
    (event) => events.push(event),
  );
  const result = await running.completion;
  return {
    result,
    text: events
      .filter((event) => event.type === "text")
      .map((event) => event.text ?? "")
      .join(""),
    events,
  };
};
try {
  const first = await run(
    "grok-live-1",
    "Reply with exactly GROK_WAYPOINT_ONE and nothing else.",
    base,
  );
  if (
    first.result.status !== "completed" ||
    !first.text.includes("GROK_WAYPOINT_ONE") ||
    !sessionId
  )
    throw new Error(
      `First Grok turn failed: ${JSON.stringify({ result: first.result, text: first.text, sessionId })}`,
    );
  const originalSession = sessionId,
    second = await run(
      "grok-live-2",
      "Reply with exactly GROK_WAYPOINT_TWO and nothing else.",
      base,
      originalSession,
    );
  if (
    second.result.status !== "completed" ||
    !second.text.includes("GROK_WAYPOINT_TWO") ||
    sessionId !== originalSession
  )
    throw new Error(
      `Grok resume failed: ${JSON.stringify({ result: second.result, text: second.text, sessionId, originalSession })}`,
    );
  const loaded = await run(
    "grok-live-load",
    "Reply with exactly GROK_WAYPOINT_LOADED and nothing else.",
    base,
    originalSession,
    true,
  );
  if (
    loaded.result.status !== "completed" ||
    !loaded.text.includes("GROK_WAYPOINT_LOADED") ||
    sessionId !== originalSession
  )
    throw new Error(
      `Grok load failed: ${JSON.stringify({ result: loaded.result, text: loaded.text, sessionId, originalSession })}`,
    );
  const declinedTarget = path.join(root, "GROK_WAYPOINT_DECLINED.txt"),
    developer: SecurityProfile = {
      ...base,
      name: "Developer · approve changes",
      filesystem: "workspace-write",
      tools: ["provider-native", "terminal", "files", "skills"],
      approval: "on-write",
    },
    declined = await run(
      "grok-live-declined",
      "Create GROK_WAYPOINT_DECLINED.txt containing exactly NO. Do not do anything else.",
      developer,
    );
  if (
    declined.result.status !== "canceled" ||
    approvals < 1 ||
    existsSync(declinedTarget)
  )
    throw new Error(
      `Grok decline failed: ${JSON.stringify({ result: declined.result, approvals, exists: existsSync(declinedTarget) })}`,
    );
  const target = path.join(root, "GROK_WAYPOINT_WRITE.txt"),
    bypass: SecurityProfile = {
      ...base,
      name: "Bypass permissions · no prompts",
      filesystem: "workspace-write",
      network: "enabled",
      tools: [
        "provider-native",
        "terminal",
        "local-cli",
        "mcp",
        "skills",
        "subagents",
      ],
      approval: "never",
    };
  const third = await run(
    "grok-live-3",
    "Create GROK_WAYPOINT_WRITE.txt in the current workspace containing exactly GROK_WRITE_OK. Do not change anything else.",
    bypass,
  );
  if (
    third.result.status !== "completed" ||
    !existsSync(target) ||
    readFileSync(target, "utf8").trim() !== "GROK_WRITE_OK"
  )
    throw new Error(
      `Grok write failed: ${JSON.stringify({ result: third.result, text: third.text, exists: existsSync(target), events: third.events.filter((event) => event.type === "tool" || event.type === "diagnostic").map((event) => ({ type: event.type, name: event.name, rawType: event.rawType, text: event.text?.slice(0, 1000), metadata: event.metadata })) })}`,
    );
  const childPidFile = path.join(root, "GROK_CHILD_PID.txt"),
    childScript = path.join(root, "spawn-grok-child.ps1");
  writeFileSync(
    childScript,
    '$child = Start-Process powershell.exe -ArgumentList @("-NoProfile", "-Command", "Start-Sleep -Seconds 300") -PassThru\nSet-Content -LiteralPath "GROK_CHILD_PID.txt" -Value $child.Id\nWait-Process -Id $child.Id\n',
    "utf8",
  );
  let childPid = 0;
  const cancelEvents: ExecutionEvent[] = [],
    cancelRun = await workbench.start(
      "grok-live-cancel",
      {
        cli: "grok",
        prompt:
          "Use the shell tool to run exactly `powershell.exe -NoProfile -File .\\spawn-grok-child.ps1` and wait for it to finish. Do not do anything else.",
        workspaceRoot: root,
        profile: bypass,
        executable,
        version,
        onSession: () => undefined,
        onApproval: async () => {
          throw new Error(
            "Bypass cancellation proof must not ask for approval",
          );
        },
      },
      (event) => cancelEvents.push(event),
    );
  try {
    const deadline = Date.now() + 90_000;
    while (!existsSync(childPidFile) && Date.now() < deadline) {
      const completed = await Promise.race([
        cancelRun.completion.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      if (completed) break;
    }
    if (!existsSync(childPidFile))
      throw new Error(
        `Grok cancellation child did not start: ${JSON.stringify(cancelEvents.slice(-20))}`,
      );
    childPid = Number(readFileSync(childPidFile, "utf8").trim());
    if (!Number.isInteger(childPid) || childPid <= 0)
      throw new Error("Grok cancellation child PID is invalid");
    cancelRun.cancel();
    const canceled = await cancelRun.completion;
    if (canceled.status !== "canceled")
      throw new Error(`Grok cancellation failed: ${JSON.stringify(canceled)}`);
    let childAlive = true;
    try {
      process.kill(childPid, 0);
    } catch {
      childAlive = false;
    }
    if (childAlive)
      throw new Error("Grok cancellation left the PowerShell descendant alive");
  } finally {
    cancelRun.cancel();
    await cancelRun.completion;
    if (childPid > 0)
      spawnSync("taskkill.exe", ["/PID", String(childPid), "/T", "/F"], {
        windowsHide: true,
      });
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        version,
        sessionId: originalSession,
        resumed: true,
        loaded: true,
        declinedWrite: true,
        write: true,
        canceledProcessTree: true,
        approvals,
        firstEvents: first.events.length,
        secondEvents: second.events.length,
        thirdEvents: third.events.length,
      },
      null,
      2,
    ),
  );
} finally {
  await workbench.shutdown();
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
