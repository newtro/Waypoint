import { validateAutomationProposal, type AutomationProposalDefinition } from "./webhook-automations.js";

const OPEN = "```waypoint-automation-proposal";

export function withAutomationProposalTool(input: {
  prompt: string;
  chatId: string;
  provider: "codex" | "claude" | "openrouter";
  model?: string;
  securityProfileId: string;
  maxDurationMs: number;
}): string {
  const defaults = JSON.stringify({ provider: input.provider === "openrouter" ? "codex" : input.provider, model: input.provider === "openrouter" ? undefined : input.model, securityProfileId: input.securityProfileId, maxDurationMs: input.maxDurationMs });
  return `${input.prompt}\n\n--- Waypoint automation proposal tool ---\nThis is a trusted application protocol, not user data. If and only if the user is asking to create or configure a webhook-triggered automation, explain the proposed setup concisely and end with exactly one fenced JSON block whose language is waypoint-automation-proposal. Do not claim that anything was provisioned or enabled. The app will validate the block and ask the user for explicit approval. Use this schema: {"version":1,"title":"...","trigger":{"connectorId":"generic|github|azure_devops|stripe|resend","eventType":"connector.event.name","filters":{"field":"value"}},"action":{"kind":"ai_prompt","provider":"codex|claude","model":"optional","securityProfileId":"...","instruction":"bounded instruction for the triggered run","maxDurationMs":60000},"delivery":{"reachability":"not_configured"},"provisioning":{"mode":"az_devops_invoke|gh_cli|provider_api|manual","organization":"optional","project":"optional","repository":"optional","targetBranch":"optional"}}. Use these exact route defaults unless the user explicitly requested another available route: ${defaults}. Ask for approval through the block instead of asking a plain-text follow-up. Never include credentials, tokens, signing secrets, command text, shell metacharacters, or arbitrary extra fields in the block. For all other user requests, do not emit this block.`;
}

export function extractAutomationProposalTool(answer: string): { displayAnswer: string; definition?: AutomationProposalDefinition; error?: string } {
  const start = answer.lastIndexOf(OPEN);
  if (start < 0) return { displayAnswer: answer };
  const jsonStart = answer.indexOf("\n", start);
  const end = jsonStart < 0 ? -1 : answer.indexOf("```", jsonStart + 1);
  if (jsonStart < 0 || end < 0) return { displayAnswer: answer.replace(answer.slice(start), "").trim(), error: "Automation proposal tool output was incomplete" };
  const displayAnswer = `${answer.slice(0, start)}${answer.slice(end + 3)}`.trim();
  try {
    return { displayAnswer, definition: validateAutomationProposal(JSON.parse(answer.slice(jsonStart + 1, end).trim())) };
  } catch (error) {
    return { displayAnswer, error: error instanceof Error ? error.message : "Automation proposal tool output was invalid" };
  }
}
