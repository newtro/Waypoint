import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GrokAgentWorkbench,
  type GrokRunRequest,
} from "../../electron/core/grok-agent-acp.js";
import type {
  ExecutionEvent,
  SecurityProfile,
} from "../../electron/core/ai-workbench.js";
import { validateAutomationProposal } from "../../electron/core/webhook-automations.js";
import { withAutomationProposalTool } from "../../electron/core/automation-ai-tool.js";

const executable = "C:\\Users\\scott\\.grok\\bin\\grok.exe",
  version = "grok 1.0.3 (1a29d5bc12) [stable]",
  root = mkdtempSync(path.join(tmpdir(), "waypoint-grok-workbench-automate-")),
  profile: SecurityProfile = {
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
    ],
    maxDurationMs: 0,
    maxConcurrency: 1,
    approval: "never",
    peerEligible: false,
    secretNames: [],
  },
  events: ExecutionEvent[] = [],
  proposals: Record<string, unknown>[] = [],
  approvals: unknown[] = [],
  workbench = new GrokAgentWorkbench();

try {
  const skillName = "waypoint-parity-proof",
    skillRoot = path.join(root, ".grok", "skills", skillName);
  mkdirSync(skillRoot, { recursive: true });
  writeFileSync(
    path.join(skillRoot, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: Waypoint Grok slash skill parity proof\n---\nWhen invoked, reply with exactly GROK_SLASH_PARITY_OK and nothing else.\n`,
    "utf8",
  );
  const slashEvents: ExecutionEvent[] = [],
    slash = await workbench.start(
      "grok-live-slash",
      {
        cli: "grok",
        prompt: `/${skillName}`,
        workspaceRoot: root,
        profile: { ...profile, network: "disabled", approval: "always" },
        executable,
        version,
        model: "grok-4.6",
        requiredSkillIdentifier: skillName,
        onSession: () => undefined,
        onApproval: async () => ({ status: "declined", decision: {} }),
      },
      (event) => slashEvents.push(event),
    ),
    slashResult = await slash.completion,
    slashText = slashEvents
      .filter((event) => event.type === "text")
      .map((event) => event.text ?? "")
      .join("");
  if (
    slashResult.status !== "completed" ||
    !slashText.includes("GROK_SLASH_PARITY_OK")
  )
    throw new Error(JSON.stringify({ slashResult, slashText }));

  const request: GrokRunRequest = {
      cli: "grok",
      prompt: withAutomationProposalTool({
        prompt:
          "Prepare one pending Waypoint automation proposal titled Grok signed-in proof. It triggers on Azure DevOps pull request creation and routes a Grok prompt to review the pull request. Use delivery not_configured and az_devops_invoke for organization https://dev.azure.com/example, project SCV2, repository SCV2. Do not claim it is enabled or provisioned.",
        chatId: "live-grok-proof",
        provider: "grok",
        model: "grok-4.6",
        securityProfileId: "bypass",
      }),
      workspaceRoot: root,
      profile,
      executable,
      version,
      model: "grok-4.6",
      onSession: () => undefined,
      onApproval: async (approval) => {
        approvals.push(approval);
        return { status: "declined", decision: {} };
      },
      onAutomationProposal: async (definition) => {
        const validated = validateAutomationProposal(definition);
        proposals.push(validated as unknown as Record<string, unknown>);
        return {
          proposalId: "grok-live-proof",
          status: "pending_confirmation",
          summary:
            "Pending Grok signed-in proof proposal prepared; nothing was provisioned or enabled.",
        };
      },
    },
    running = await workbench.start("grok-live-automate", request, (event) => {
      events.push(event);
      if (event.type === "tool" || event.type === "diagnostic")
        console.error(
          JSON.stringify({ type: event.type, name: event.name, text: event.text }),
        );
    }),
    result = await running.completion;
  if (result.status !== "completed" || proposals.length !== 1)
    throw new Error(
      JSON.stringify({
        result,
        proposalCount: proposals.length,
        events: events.slice(-30),
      }),
    );
  console.log(
    JSON.stringify({
      ok: true,
      result,
      proposalCount: proposals.length,
      slashSkill: true,
      title: proposals[0]?.title,
      approvals: approvals.length,
      normalAuthorityRetained: true,
      assistantText: events
        .filter((event) => event.type === "text")
        .map((event) => event.text ?? "")
        .join(""),
      toolEvents: events
        .filter((event) => event.type === "tool")
        .map((event) => ({ name: event.name, rawType: event.rawType })),
    }),
  );
} finally {
  await workbench.shutdown();
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}
