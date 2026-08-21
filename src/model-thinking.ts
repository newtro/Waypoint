export const THINKING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export type ThinkingEffort = (typeof THINKING_EFFORTS)[number];
export type ThinkingLane =
  | "codex"
  | "claude"
  | "grok"
  | "openrouterStrategic"
  | "openrouterEveryday"
  | "openrouterAttachment";

export type ThinkingPreferences = Record<ThinkingLane, ThinkingEffort | "">;

export const EMPTY_THINKING_PREFERENCES: ThinkingPreferences = {
  codex: "",
  claude: "",
  grok: "",
  openrouterStrategic: "",
  openrouterEveryday: "",
  openrouterAttachment: "",
};

export function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return THINKING_EFFORTS.includes(value as ThinkingEffort);
}

export function thinkingLabel(value: ThinkingEffort): string {
  return value === "xhigh"
    ? "Extra high"
    : value.slice(0, 1).toUpperCase() + value.slice(1);
}

export function acceptedThinkingEffort(
  value: unknown,
  supported: readonly ThinkingEffort[],
): ThinkingEffort | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isThinkingEffort(value) || !supported.includes(value))
    throw new Error("Thinking level is not supported by the selected model");
  return value;
}

export function localProviderAllowsThinking(
  provider: "codex" | "claude" | "grok",
  model: string | undefined,
  effort: ThinkingEffort,
): boolean {
  return providerThinkingEfforts(provider, model).includes(effort);
}

export function providerThinkingEfforts(
  provider: "codex" | "claude" | "grok",
  model: string | undefined,
): readonly ThinkingEffort[] {
  if (!model) return [];
  if (provider === "grok")
    return model === "grok-4.6"
      ? ["low", "medium", "high", "xhigh"]
      : model === "grok-4.5"
        ? ["low", "medium", "high"]
        : [];
  if (provider === "claude")
    return ["claude-fable-5", "claude-opus-5", "claude-sonnet-5"].includes(
      model,
    )
      ? ["low", "medium", "high", "xhigh", "max"]
      : [];
  const limits: Record<string, readonly ThinkingEffort[]> = {
    "gpt-5.6-sol": ["low", "medium", "high", "xhigh", "max", "ultra"],
    "gpt-5.6-terra": ["low", "medium", "high", "xhigh", "max", "ultra"],
    "gpt-5.6-luna": ["low", "medium", "high", "xhigh", "max"],
    "gpt-reserve": ["low", "medium", "high", "xhigh", "max"],
    "gpt-5.5": ["low", "medium", "high", "xhigh"],
    "gpt-5.4": ["low", "medium", "high", "xhigh"],
    "gpt-5.4-mini": ["low", "medium", "high", "xhigh"],
    "gpt-5.3-codex-spark": ["low", "medium", "high", "xhigh"],
    "codex-auto-review": ["low", "medium", "high", "xhigh", "max"],
  };
  return limits[model] ?? [];
}
