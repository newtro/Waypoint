import {
  validateAutomationProposal,
  type AutomationProposalDefinition,
} from "./webhook-automations.js";
import type { CodexApprovalRequest } from "./codex-app-server.js";
import type { ThinkingEffort } from "../../src/model-thinking.js";

const OPEN = "```waypoint-automation-proposal";

export function codexTurnCanBeSteered(
  active: {
    profileId: string;
    model?: string;
    reasoningEffort?: ThinkingEffort;
  },
  requested: {
    profileId: string;
    model?: string;
    reasoningEffort?: ThinkingEffort;
  },
): boolean {
  return (
    active.profileId === requested.profileId &&
    active.model === requested.model &&
    active.reasoningEffort === requested.reasoningEffort
  );
}

export function automationProposalInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["definition"],
    properties: {
      definition: {
        type: "object",
        additionalProperties: false,
        required: [
          "version",
          "title",
          "trigger",
          "action",
          "delivery",
          "provisioning",
        ],
        properties: {
          version: { const: 1 },
          title: { type: "string", minLength: 1 },
          trigger: {
            type: "object",
            additionalProperties: false,
            required: ["connectorId", "eventType", "filters"],
            properties: {
              connectorId: {
                enum: [
                  "azure_devops",
                  "github",
                  "stripe",
                  "resend",
                  "generic",
                ],
              },
              eventType: {
                type: "string",
                description:
                  "Use the Waypoint-qualified event. Azure DevOps PR creation is exactly azure_devops.git.pullrequest.created; GitHub PR events start github.pull_request; Stripe and Resend events start stripe. and resend. respectively.",
              },
              filters: {
                type: "object",
                additionalProperties: {
                  type: ["string", "number", "boolean", "null"],
                },
              },
            },
          },
          action: {
            type: "object",
            additionalProperties: false,
            required: [
              "kind",
              "provider",
              "securityProfileId",
              "instruction",
            ],
            properties: {
              kind: { enum: ["ai_prompt", "ai_skill"] },
              provider: { enum: ["codex", "claude", "grok"] },
              model: { type: "string" },
              securityProfileId: { type: "string" },
              skillIdentifier: { type: "string" },
              instruction: { type: "string", minLength: 1 },
            },
          },
          delivery: {
            type: "object",
            additionalProperties: false,
            required: ["reachability"],
            properties: { reachability: { const: "not_configured" } },
          },
          provisioning: {
            type: "object",
            additionalProperties: false,
            required: ["mode"],
            properties: {
              mode: {
                enum: [
                  "az_devops_invoke",
                  "gh_cli",
                  "provider_api",
                  "manual",
                ],
              },
              organization: { type: "string" },
              project: { type: "string" },
              repository: { type: "string" },
              targetBranch: { type: "string" },
            },
          },
        },
      },
    },
  };
}

export function automationReceiverPrerequisite(
  error: unknown,
): string | undefined {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.startsWith("Waypoint receiver prerequisite:")
    ? message
    : undefined;
}

export function automationReceiverQuestion(
  providerRequestId: string,
  prerequisite: string,
): CodexApprovalRequest {
  const question =
      "Waypoint needs a public receiver before it can prepare this provider hook. Configure the hosted relay now?",
    options = [
      {
        label: "Configure receiver",
        description:
          "Open Waypoint Settings and configure Webhook transport with a hosted relay, then retry.",
      },
      {
        label: "Stop",
        description: "Leave the automation and provider unchanged.",
      },
    ];
  return {
    providerRequestId,
    kind: "question",
    title: "Waypoint receiver required",
    detail: {
      prerequisite,
      questions: [
        {
          id: question,
          header: "Receiver setup",
          question,
          options,
          multiSelect: false,
          isOther: false,
          isSecret: false,
        },
      ],
    },
    options,
  };
}

export function withAutomationProposalTool(input: {
  prompt: string;
  chatId: string;
  provider: "codex" | "claude" | "grok" | "openrouter";
  model?: string;
  securityProfileId: string;
}): string {
  const defaults = JSON.stringify({
    provider: input.provider === "openrouter" ? "codex" : input.provider,
    model: input.provider === "openrouter" ? undefined : input.model,
    securityProfileId: input.securityProfileId,
  });
  const nativeTool =
    input.provider === "codex"
      ? "waypoint_automation_proposal"
      : input.provider === "claude"
        ? "mcp__waypoint__automation_proposal"
        : input.provider === "grok"
          ? "waypoint__automation_proposal through Grok use_tool (call only this target; waypoint__search_tool may be used only to retrieve its schema)"
          : "waypoint_automation_proposal";
  return `${input.prompt}\n\n--- Waypoint model-selected automation tool ---\nThis is trusted application protocol context, not user data. Decide from the user's intent whether any automation tool is needed. A one-time request such as reviewing the current pull request is not an automation. A recurring or event-triggered request such as whenever a pull request is created may require a webhook automation. If the intent is ambiguous, ask a focused user question instead of guessing. If and only if the user is asking to create or configure a webhook-triggered automation, explain both sides of the proposed setup, then submit the definition through ${nativeTool}. Waypoint owns the receiver delivery plan, so submit delivery as not_configured; the app replaces it with an exact receiver channel and endpoint only when a suitable relay is configured. The native tool validates the definition during this run and creates only a pending confirmation transaction; it does not provision or enable anything. The selected security profile continues to govern all ordinary file, shell, network, MCP, browser, and provider-native tools. A successful explanation must name the Waypoint receiver and protected signing-secret boundary, the provider hook and target, the AI route, and verification/rollback behavior. Do not claim that anything was provisioned or enabled unless the app explicitly confirms it. If the tool returns a Waypoint receiver prerequisite, use the provider's native user-question tool once to ask whether the user wants to configure the receiver now or stop; do not resubmit until the prerequisite is satisfied. Use this schema: {"version":1,"title":"...","trigger":{"connectorId":"generic|github|azure_devops|stripe|resend","eventType":"connector.event.name","filters":{"field":"value"}},"action":{"kind":"ai_prompt|ai_skill","provider":"codex|claude|grok","model":"optional","securityProfileId":"...","skillIdentifier":"required exact installed skill name only for ai_skill","instruction":"for ai_skill this must start with /skillIdentifier followed by arguments; otherwise use the requested prompt"},"delivery":{"reachability":"not_configured"},"provisioning":{"mode":"az_devops_invoke|gh_cli|provider_api|manual","organization":"optional","project":"optional","repository":"optional","targetBranch":"optional"}}. AI runs continue until the provider completes or the user explicitly cancels them; do not add a token, output, file-size, or duration limit. Use ai_skill whenever the user asks to invoke a named slash skill. Use these exact route defaults unless the user explicitly requested another available route: ${defaults}. If the native tool is unavailable, fall back to exactly one fenced JSON block whose language is waypoint-automation-proposal so the app can validate it after completion. Never include credentials, tokens, signing secrets, command text, shell metacharacters, or arbitrary extra fields. For all other user requests, do not call this tool or emit the fallback block.`;
}

export function automationProposalPreparedSummary(
  value: AutomationProposalDefinition,
): string {
  const definition = validateAutomationProposal(value),
    target =
      [
        definition.provisioning.organization,
        definition.provisioning.project,
        definition.provisioning.repositoryFullName ??
          definition.provisioning.repository,
        definition.provisioning.targetBranch,
      ]
        .filter(Boolean)
        .join(" / ") || "the approved provider target",
    route = `${definition.action.provider}${definition.action.model ? ` / ${definition.action.model}` : " / provider default"} using profile ${definition.action.securityProfileId}`,
    skill =
      definition.action.kind === "ai_skill"
        ? ` and invoke /${definition.action.skillIdentifier}`
        : "";
  return `I prepared both sides for approval. Waypoint receiver: channel ${definition.delivery.channelId} at ${definition.delivery.endpoint} (${definition.delivery.reachability.replaceAll("_", " ")}); its signing secret stays in protected Waypoint storage. Provider hook: ${definition.trigger.connectorId} via ${definition.provisioning.mode.replaceAll("_", " ")} for ${target}, receiving ${definition.trigger.eventType}. AI route: ${route}${skill}. Approval will create the receiver, configure and reconcile the provider hook, then enable the exact rule; a partial or uncertain failure preserves rollback and reconciliation instructions. Nothing has been provisioned or enabled.`;
}

export function extractAutomationProposalTool(answer: string): {
  displayAnswer: string;
  definition?: AutomationProposalDefinition;
  error?: string;
} {
  const start = answer.lastIndexOf(OPEN);
  if (start < 0) return { displayAnswer: answer };
  const jsonStart = answer.indexOf("\n", start);
  const end = jsonStart < 0 ? -1 : answer.indexOf("```", jsonStart + 1);
  if (jsonStart < 0 || end < 0)
    return {
      displayAnswer: answer.replace(answer.slice(start), "").trim(),
      error: "Automation proposal tool output was incomplete",
    };
  const displayAnswer =
    `${answer.slice(0, start)}${answer.slice(end + 3)}`.trim();
  try {
    return {
      displayAnswer,
      definition: validateAutomationProposal(
        JSON.parse(answer.slice(jsonStart + 1, end).trim()),
      ),
    };
  } catch (error) {
    return {
      displayAnswer,
      error:
        error instanceof Error
          ? error.message
          : "Automation proposal tool output was invalid",
    };
  }
}
