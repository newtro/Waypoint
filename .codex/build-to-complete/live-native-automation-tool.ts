import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SecurityProfile } from "../../electron/core/ai-workbench.js";
import { withAutomationProposalTool } from "../../electron/core/automation-ai-tool.js";
import { ClaudeAgentWorkbench } from "../../electron/core/claude-agent-sdk.js";
import { CodexAppServerWorkbench } from "../../electron/core/codex-app-server.js";
import { validateAutomationProposal } from "../../electron/core/webhook-automations.js";
import { detectCli } from "../../spikes/cli-capabilities.js";

const root = mkdtempSync(path.join(tmpdir(), "waypoint-native-automation-"));
const profile: SecurityProfile = {
  id: "chat",
  name: "Chat · read only",
  roots: [root],
  filesystem: "read-only",
  network: "provider-only",
  tools: ["provider-native", "mcp", "skills"],
  maxDurationMs: 120_000,
  maxConcurrency: 1,
  approval: "always",
  peerEligible: false,
  secretNames: [],
};
const claude = await detectCli("claude");
const codex = await detectCli("codex");
if (!claude.available || !claude.executable || claude.compatible === false)
  throw new Error(claude.compatibilityError ?? "Claude unavailable");
if (!codex.available || !codex.executable || codex.compatible === false)
  throw new Error(codex.compatibilityError ?? "Codex unavailable");
const definitions: Array<Record<string, unknown>> = [];
const onAutomationProposal = async (value: Record<string, unknown>) => {
  const definition = validateAutomationProposal(value);
  definitions.push(definition as unknown as Record<string, unknown>);
  return { proposalId: `live-proposal-${definitions.length}`, status: "pending" };
};
const requestText =
  'Prepare a Waypoint generic webhook automation named "Live native tool proof" for event "generic.live.proof". It must use an ai_prompt action that asks the selected provider to reply LIVE_NATIVE_AUTOMATION_OK. Use the current provider and current security profile. Delivery is not configured and provisioning is manual. Submit it through the native Waypoint automation proposal tool. Do not write files or use shell commands.';
const claudeWorkbench = new ClaudeAgentWorkbench();
const codexWorkbench = new CodexAppServerWorkbench();
const codexEvents: Array<Record<string, unknown>> = [];
try {
  const claudeRun = await claudeWorkbench.start(
    "live-claude-native-automation",
    {
      cli: "claude",
      prompt: withAutomationProposalTool({
        prompt: requestText,
        chatId: "live-chat",
        provider: "claude",
        securityProfileId: profile.id,
      }),
      workspaceRoot: root,
      profile,
      executable: claude.executable,
      version: claude.version,
      onSession: () => undefined,
      onApproval: async () => ({
        status: "declined",
        decision: {},
      }),
      onAutomationProposal,
    },
    (event) => codexEvents.push(event),
  );
  const claudeTerminal = await claudeRun.completion;
  if (claudeTerminal.status !== "completed" || definitions.length !== 1)
    throw new Error(
      claudeTerminal.error ?? "Claude did not call the native automation tool",
    );
  const codexRun = await codexWorkbench.start(
    "live-codex-native-automation",
    {
      cli: "codex",
      prompt: withAutomationProposalTool({
        prompt: requestText,
        chatId: "live-chat",
        provider: "codex",
        securityProfileId: profile.id,
      }),
      workspaceRoot: root,
      profile,
      executable: codex.executable,
      version: codex.version,
      onSession: () => undefined,
      onApproval: async () => ({
        status: "declined",
        decision: {},
      }),
      onAutomationProposal,
    },
    () => undefined,
  );
  const codexTerminal = await codexRun.completion;
  if (codexTerminal.status !== "completed" || definitions.length !== 2)
    throw new Error(
      `${codexTerminal.error ?? "Codex did not call the native automation tool"}\n${JSON.stringify(codexEvents)}`,
    );
  console.log(
    JSON.stringify({
      ok: true,
      calls: definitions.length,
      providers: ["claude", "codex"],
      eventTypes: definitions.map(
        (definition) =>
          (definition.trigger as Record<string, unknown>).eventType,
      ),
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
