export function canonicalExecutionText(
  cli: "codex" | "claude" | "grok",
  events: Array<Record<string, unknown>>,
  limit = Number.POSITIVE_INFINITY,
): string {
  const textEvents = events.filter(
    (event) => event.type === "text" && typeof event.text === "string",
  );
  const text =
    cli === "claude"
      ? (textEvents
          .filter(
            (event) =>
              !String(event.rawType ?? "").includes("text_delta") &&
              event.rawType !== "stream_event.content_block_delta",
          )
          .at(-1)?.text ?? textEvents.map((event) => event.text).join(""))
      : textEvents.map((event) => event.text).join("");
  return String(text).trim().slice(0, limit);
}
