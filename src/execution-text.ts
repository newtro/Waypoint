export type ProviderExecution = "codex" | "claude" | "grok";

function eventItemId(event: Record<string, unknown>): string | undefined {
  const metadata = event.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return;
  const itemId = (metadata as Record<string, unknown>).itemId;
  return typeof itemId === "string" && itemId ? itemId : undefined;
}

/**
 * Preserve provider-authored message boundaries while still joining token
 * deltas from one message. Legacy runs did not persist Codex item IDs, so a
 * non-text event between text runs is the only safe recoverable boundary.
 */
export function executionTextSections(
  events: Array<Record<string, unknown>>,
): string[] {
  const sections: string[] = [];
  let section = "";
  let sectionItemId: string | undefined;
  let lastTextIndex = -2;
  for (const [index, event] of events.entries()) {
    if (event.type !== "text" || typeof event.text !== "string") continue;
    const itemId = eventItemId(event);
    const startsNew = Boolean(
      section &&
        ((itemId && sectionItemId && itemId !== sectionItemId) ||
          (!itemId && !sectionItemId && index !== lastTextIndex + 1) ||
          (itemId && !sectionItemId) ||
          (!itemId && sectionItemId)),
    );
    if (startsNew) {
      if (section.trim()) sections.push(section.trim());
      section = "";
    }
    section += event.text;
    sectionItemId = itemId;
    lastTextIndex = index;
  }
  if (section.trim()) sections.push(section.trim());
  return sections;
}

export function providerExecutionText(
  provider: ProviderExecution,
  events: Array<Record<string, unknown>>,
  limit = Number.POSITIVE_INFINITY,
): string {
  if (provider === "claude") {
    const final = events
      .filter(
        (event) =>
          event.type === "text" &&
          typeof event.text === "string" &&
          !String(event.rawType ?? "").includes("text_delta") &&
          event.rawType !== "stream_event.content_block_delta",
      )
      .at(-1)?.text;
    if (typeof final === "string") return final.trim().slice(0, limit);
  }
  return executionTextSections(events).join("\n\n").trim().slice(0, limit);
}
