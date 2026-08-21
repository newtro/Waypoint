import { providerExecutionText } from "../../src/execution-text.js";

export function canonicalExecutionText(
  cli: "codex" | "claude" | "grok",
  events: Array<Record<string, unknown>>,
  limit = Number.POSITIVE_INFINITY,
): string {
  return providerExecutionText(cli, events, limit);
}
