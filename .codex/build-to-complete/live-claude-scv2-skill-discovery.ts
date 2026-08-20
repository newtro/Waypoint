import path from "node:path";
import type { SecurityProfile } from "../../electron/core/ai-workbench.js";
import { withAutomationProposalTool } from "../../electron/core/automation-ai-tool.js";
import { ClaudeAgentWorkbench } from "../../electron/core/claude-agent-sdk.js";
import { validateAutomationProposal } from "../../electron/core/webhook-automations.js";
import { detectCli } from "../../spikes/cli-capabilities.js";

const root = path.resolve("D:\\Mathew Repos\\SCV2");
const profile: SecurityProfile = {
  id: "scv2-read-only-proof",
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
const capability = await detectCli("claude");
if (
  !capability.available ||
  !capability.executable ||
  capability.compatible === false
)
  throw new Error(capability.compatibilityError ?? "Claude unavailable");
let proposal:
  | ReturnType<typeof validateAutomationProposal>
  | undefined;
const prompt = withAutomationProposalTool({
  prompt:
    "Prepare—but do not provision—an Azure DevOps PR-created automation for the SCV2 project/repository. It must invoke the exact installed Claude slash skill auto-pr-review with /auto-pr-review --event-context. Submit it through the native Waypoint automation proposal tool. Do not write files, run shell commands, or contact Azure DevOps.",
  chatId: "scv2-skill-proof",
  provider: "claude",
  securityProfileId: profile.id,
});
const workbench = new ClaudeAgentWorkbench();
try {
  const events: unknown[] = [];
  const running = await workbench.start(
    "live-claude-scv2-skill",
    {
      cli: "claude",
      prompt,
      workspaceRoot: root,
      profile,
      executable: capability.executable,
      version: capability.version,
      onSession: () => undefined,
      onApproval: async () => ({ status: "declined", decision: {} }),
      onAutomationProposal: async (value) => {
        proposal = validateAutomationProposal(value);
        return { proposalId: "scv2-skill-proof", status: "pending" };
      },
    },
    (event) => events.push(event),
  );
  const terminal = await running.completion;
  if (
    terminal.status !== "completed" ||
    !proposal ||
    proposal.action.kind !== "ai_skill" ||
    proposal.action.skillIdentifier !== "auto-pr-review"
  )
    throw new Error(
      `${terminal.error ?? "Claude did not discover and bind the exact auto-pr-review command"}: ${JSON.stringify(events)}`,
    );
  console.log(
    JSON.stringify({
      ok: true,
      skillIdentifier: proposal.action.skillIdentifier,
      instruction: proposal.action.instruction,
      status: "validated-only",
    }),
  );
} finally {
  await workbench.shutdown();
}
