import { describe, expect, it } from "vitest";
import {
  automationProposalInputSchema,
  automationProposalPreparedSummary,
  automationReceiverPrerequisite,
  automationReceiverQuestion,
  codexTurnCanBeSteered,
  extractAutomationProposalTool,
  withAutomationProposalTool,
} from "./automation-ai-tool.js";
import { validateAutomationProposal } from "./webhook-automations.js";

describe("automation proposal AI tool", () => {
  it("steers only when the model, thinking, and selected authority profile are unchanged", () => {
    const active = {
      profileId: "bypass",
      model: "gpt-5",
      reasoningEffort: "high" as const,
    };
    expect(codexTurnCanBeSteered(active, { ...active })).toBe(true);
    expect(
      codexTurnCanBeSteered(active, { ...active, profileId: "developer" }),
    ).toBe(false);
    expect(
      codexTurnCanBeSteered(active, {
        ...active,
        reasoningEffort: "xhigh",
      }),
    ).toBe(false);
  });

  it("lets the model distinguish one-off work from recurring automation without changing authority", () => {
    const prompt = withAutomationProposalTool({
      prompt: "Review this pull request",
      chatId: "chat-1",
      provider: "claude",
      securityProfileId: "profile-1",
    });
    expect(prompt).toContain("one-time request");
    expect(prompt).toContain("recurring or event-triggered request");
    expect(prompt).toContain("ask a focused user question");
    expect(prompt).toContain("selected security profile continues to govern");
    expect(prompt).not.toContain("mode toggle");
  });

  it("advertises exact skill-bound automation actions without an AI duration limit", () => {
    const prompt = withAutomationProposalTool({
      prompt: "Set up PR review",
      chatId: "chat-1",
      provider: "grok",
      securityProfileId: "profile-1",
    });
    expect(prompt).toContain("Use ai_skill whenever");
    expect(prompt).toContain(
      "do not add a token, output, file-size, or duration limit",
    );
    expect(prompt).toContain("waypoint__automation_proposal");
  });

  it("shares the exact bounded proposal schema across providers", () => {
    expect(automationProposalInputSchema()).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["definition"],
      properties: {
        definition: {
          additionalProperties: false,
          properties: {
            action: {
              properties: {
                provider: { enum: ["codex", "claude", "grok"] },
              },
            },
          },
        },
      },
    });
  });

  it("only exposes a proposal contract and strips a validated fallback call from chat text", () => {
    const prompt = withAutomationProposalTool({
      prompt: "Set up PR review",
      chatId: "chat-1",
      provider: "codex",
      model: "gpt-5",
      securityProfileId: "profile-1",
    });
    expect(prompt).toContain("Do not claim that anything was provisioned");
    const answer =
        "I prepared this for review.\n```waypoint-automation-proposal\n" +
        JSON.stringify({
          version: 1,
          title: "Review PR",
          trigger: {
            connectorId: "github",
            eventType: "github.pull_request",
            filters: {},
          },
          action: {
            kind: "ai_prompt",
            provider: "codex",
            model: "gpt-5",
            securityProfileId: "profile-1",
            instruction: "Review the pull request",
          },
          delivery: { reachability: "not_configured" },
          provisioning: { mode: "gh_cli" },
        }) +
        "\n```",
      result = extractAutomationProposalTool(answer);
    expect(result.displayAnswer).toBe("I prepared this for review.");
    expect(result.definition?.trigger.connectorId).toBe("github");
  });

  it("never treats malformed fallback output as an approved action", () => {
    const result = extractAutomationProposalTool(
      'No change.\n```waypoint-automation-proposal\n{"version":1}\n```',
    );
    expect(result.definition).toBeUndefined();
    expect(result.error).toMatch(/invalid/i);
  });

  it("presents the Waypoint receiver and provider hook as one explicit transaction", () => {
    const definition = validateAutomationProposal({
        version: 1,
        title: "Review PR",
        trigger: {
          connectorId: "azure_devops",
          eventType: "azure_devops.git.pullrequest.created",
          filters: {},
        },
        action: {
          kind: "ai_skill",
          provider: "claude",
          model: "claude-opus",
          securityProfileId: "bypass",
          skillIdentifier: "auto-pr-review",
          instruction: "/auto-pr-review",
        },
        delivery: {
          channelId: "channel_0000000000000001",
          endpoint:
            "https://relay.example/v1/native-hooks/channel_0000000000000001",
          reachability: "public_relay",
        },
        provisioning: {
          mode: "az_devops_invoke",
          organization: "https://dev.azure.com/example",
          project: "SCV2",
          repository: "SCV2",
        },
      }),
      summary = automationProposalPreparedSummary(definition);
    expect(summary).toContain(
      "Waypoint receiver: channel channel_0000000000000001",
    );
    expect(summary).toContain("protected Waypoint storage");
    expect(summary).toContain(
      "Provider hook: azure_devops via az devops invoke",
    );
    expect(summary).toContain(
      "claude / claude-opus using profile bypass and invoke /auto-pr-review",
    );
    expect(summary).toContain("rollback and reconciliation");
    expect(summary).toContain("Nothing has been provisioned or enabled");
  });

  it("turns a receiver prerequisite into a native deterministic user question", () => {
    const prerequisite = automationReceiverPrerequisite(
      new Error("Waypoint receiver prerequisite: configure hosted relay"),
    );
    expect(prerequisite).toContain("configure hosted relay");
    expect(
      automationReceiverQuestion("receiver-1", prerequisite!),
    ).toMatchObject({
      providerRequestId: "receiver-1",
      kind: "question",
      title: "Waypoint receiver required",
      detail: {
        questions: [
          {
            header: "Receiver setup",
            multiSelect: false,
            isOther: false,
            isSecret: false,
          },
        ],
      },
      options: [{ label: "Configure receiver" }, { label: "Stop" }],
    });
    expect(automationReceiverPrerequisite(new Error("other"))).toBeUndefined();
  });
});
