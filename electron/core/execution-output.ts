export function canonicalExecutionText(
  cli: 'codex' | 'claude',
  events: Array<Record<string, unknown>>,
  limit = Number.POSITIVE_INFINITY,
): string {
  const textEvents = events
    .filter((event) => event.type === 'text')
    .map((event) => typeof event.text === 'string' ? event.text : '')
  return (cli === 'claude' ? textEvents.at(-1) ?? '' : textEvents.join('')).trim().slice(0, limit)
}
