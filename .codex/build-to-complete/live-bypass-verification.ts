import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SecurityProfile } from "../../electron/core/ai-workbench.js";
import { ClaudeAgentWorkbench } from "../../electron/core/claude-agent-sdk.js";
import { CodexAppServerWorkbench } from "../../electron/core/codex-app-server.js";
import { detectCli } from "../../spikes/cli-capabilities.js";

const root = mkdtempSync(path.join(tmpdir(), "waypoint live bypass-"));
const profile: SecurityProfile = {
  id: "bypass",
  name: "Bypass permissions · no prompts",
  roots: [root],
  filesystem: "workspace-write",
  network: "enabled",
  tools: [
    "provider-native",
    "terminal",
    "local-cli",
    "mcp",
    "skills",
    "subagents",
    "web",
    "browser",
    "waypoint",
  ],
  maxDurationMs: 120_000,
  maxConcurrency: 1,
  approval: "never",
  peerEligible: false,
  secretNames: [],
};
const claude = await detectCli("claude");
const codex = await detectCli("codex");
if (!claude.available || !claude.executable || claude.compatible === false)
  throw new Error(claude.compatibilityError ?? "Claude unavailable");
if (!codex.available || !codex.executable || codex.compatible === false)
  throw new Error(codex.compatibilityError ?? "Codex unavailable");
let approvalCalls = 0;
const onApproval = async () => {
  approvalCalls += 1;
  throw new Error("Bypass unexpectedly requested approval");
};
const claudeWorkbench = new ClaudeAgentWorkbench();
const codexWorkbench = new CodexAppServerWorkbench();
try {
  const claudeEvents: unknown[] = [];
  const claudeRun = await claudeWorkbench.start(
    "live-claude-bypass",
    {
      cli: "claude",
      prompt:
        "Use PowerShell to create claude-write-check.txt in the current working directory containing exactly CLAUDE_WRITE_CHECK_OK with no other repository changes. Then reply with exactly CLAUDE_WRITE_CHECK_OK.",
      workspaceRoot: root,
      profile,
      executable: claude.executable,
      version: claude.version,
      onSession: () => undefined,
      onApproval,
    },
    (event) => claudeEvents.push(event),
  );
  const claudeTerminal = await claudeRun.completion;
  if (
    claudeTerminal.status !== "completed" ||
    !existsSync(path.join(root, "claude-write-check.txt")) ||
    readFileSync(path.join(root, "claude-write-check.txt"), "utf8").trim() !==
      "CLAUDE_WRITE_CHECK_OK"
  )
    throw new Error(
      `${claudeTerminal.error ?? "Claude bypass PowerShell proof failed"}: ${JSON.stringify(claudeEvents)}`,
    );
  const codexRun = await codexWorkbench.start(
    "live-codex-bypass",
    {
      cli: "codex",
      prompt:
        "Create codex-write-check.txt in the current working directory containing exactly CODEX_WRITE_CHECK_OK with no other changes. Then reply with exactly CODEX_WRITE_CHECK_OK.",
      workspaceRoot: root,
      profile,
      executable: codex.executable,
      version: codex.version,
      onSession: () => undefined,
      onApproval,
    },
    () => undefined,
  );
  const codexTerminal = await codexRun.completion;
  if (
    codexTerminal.status !== "completed" ||
    readFileSync(path.join(root, "codex-write-check.txt"), "utf8").trim() !==
      "CODEX_WRITE_CHECK_OK"
  )
    throw new Error(codexTerminal.error ?? "Codex bypass proof failed");
  if (approvalCalls !== 0)
    throw new Error(`Bypass requested ${approvalCalls} approval(s)`);
  console.log(
    JSON.stringify({
      ok: true,
      approvalCalls,
      claude: claude.version,
      codex: codex.version,
      proofs: ["CLAUDE_WRITE_CHECK_OK", "CODEX_WRITE_CHECK_OK"],
    }),
  );
} finally {
  await Promise.all([
    claudeWorkbench.shutdown(),
    codexWorkbench.shutdown(),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 750));
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
