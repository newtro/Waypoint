export function currentDateTimeContext(now: Date = new Date()): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const stamp = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(now);
  return `[Context] Current local date and time: ${stamp} (${timeZone}). Treat this as the present moment; do not rely on your training cutoff for today's date.`;
}

export function withCurrentDateTime(
  prompt: string,
  now: Date = new Date(),
): string {
  const context = currentDateTimeContext(now);
  return /^\/[a-z0-9][a-z0-9._-]*(?:\s|$)/i.test(prompt.trimStart())
    ? `${prompt}\n\n${context}`
    : `${context}\n\n${prompt}`;
}
