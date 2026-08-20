import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SecurityProfile } from "../../electron/core/ai-workbench.js";
import { withAutomationProposalTool } from "../../electron/core/automation-ai-tool.js";
import { ClaudeAgentWorkbench } from "../../electron/core/claude-agent-sdk.js";
import { validateAutomationProposal } from "../../electron/core/webhook-automations.js";
import { detectCli } from "../../spikes/cli-capabilities.js";

const root = mkdtempSync(path.join(tmpdir(), "waypoint-resumed-mcp-")),
  outsideFile = path.join(
    tmpdir(),
    `waypoint-bypass-outside-${process.pid}-${Date.now()}.txt`,
  ),
  profile: SecurityProfile = {
    id: "bypass",
    name: "Bypass permissions · no prompts",
    roots: [root],
    filesystem: "workspace-write",
    network: "enabled",
    tools: ["provider-native", "mcp", "skills", "terminal", "local-cli"],
    maxDurationMs: 120_000,
    maxConcurrency: 1,
    approval: "never",
    peerEligible: false,
    secretNames: [],
  },
  capability = await detectCli("claude");
if (!capability.available || !capability.executable || capability.compatible === false)
  throw new Error(capability.compatibilityError ?? "Claude unavailable");

const workbench = new ClaudeAgentWorkbench(),
  events: Array<Record<string, unknown>> = [],
  definitions: Array<Record<string, unknown>> = [];
let sessionId = "";
const observedSessionIds: string[] = [];
const shared = {
  cli: "claude" as const,
  workspaceRoot: root,
  profile,
  executable: capability.executable,
  version: capability.version,
  onSession: (value: string) => {
    sessionId = value;
    observedSessionIds.push(value);
  },
  onApproval: async () => ({ status: "declined" as const, decision: {} }),
  onAutomationProposal: async (value: Record<string, unknown>) => {
    const definition = validateAutomationProposal(value);
    definitions.push(definition as unknown as Record<string, unknown>);
    return { proposalId: "resumed-live-proposal", status: "pending" };
  },
};

try {
  const first = await workbench.start(
    "resumed-mcp-first",
    {
      ...shared,
      prompt:
        "Remember the continuity marker violet-orbit for my next message. Reply exactly FIRST_TURN_OK. Do not call tools.",
    },
    (event) => events.push(event),
  );
  const firstResult = await first.completion;
  if (firstResult.status !== "completed" || !sessionId)
    throw new Error(firstResult.error ?? "First Claude turn failed");

  const second = await workbench.start(
    "resumed-mcp-second",
    {
      ...shared,
      providerSessionId: sessionId,
      prompt: withAutomationProposalTool({
        prompt:
          "Prepare a generic manual webhook automation through the native Waypoint tool. Put the continuity marker from my previous message in its title. The event is generic.resume.proof and the ai_prompt instruction is Reply RESUMED_MCP_OK. Do not use shell or write files.",
        chatId: "resumed-live-chat",
        provider: "claude",
        securityProfileId: profile.id,
      }),
    },
    (event) => events.push(event),
  );
  const secondResult = await second.completion;
  if (secondResult.status !== "completed")
    throw new Error(secondResult.error ?? "Resumed Claude turn failed");
  if (definitions.length !== 1 || !/violet-orbit/i.test(String(definitions[0]?.title)))
    throw new Error("Resumed Claude turn did not preserve context and call the native tool");
  if (!events.some((event) => event.rawType === "claude.mcp.reattached"))
    throw new Error("Resumed Claude turn did not prove Waypoint MCP reattachment");
  const third = await workbench.start(
    "resumed-mcp-outside-root",
    {
      ...shared,
      providerSessionId: sessionId,
      prompt: `Use the Bash tool to run PowerShell and create this exact absolute file outside the current repository: ${outsideFile}. The file must contain BYPASS_HOST_AUTHORITY_OK. Do not use the Write tool. Then report the tool result truthfully.`,
    },
    (event) => events.push(event),
  );
  const thirdResult = await third.completion;
  if (thirdResult.status !== "completed")
    throw new Error(thirdResult.error ?? "Bypass authority turn failed");
  if (!existsSync(outsideFile))
    throw new Error("Bypass did not retain direct-CLI host filesystem authority");
  if (new Set(observedSessionIds).size !== 1)
    throw new Error("Claude resume changed the provider session identity");
  console.log(
    JSON.stringify({
      ok: true,
      sameSession: new Set(observedSessionIds).size === 1,
      nativeCalls: definitions.length,
      title: definitions[0]?.title,
      mcpReattached: true,
      bypassHostAuthority: true,
      claude: capability.version,
    }),
  );
} finally {
  await workbench.shutdown();
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  rmSync(outsideFile, { force: true });
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  } catch (error) {
    console.warn(`Live proof passed but disposable workspace cleanup is pending: ${error instanceof Error ? error.message : String(error)}`);
  }
}
