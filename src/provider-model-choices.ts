export type ProviderModelChoice = {
  id: string;
  label: string;
  legacy?: boolean;
  thinking?: {
    supported: Array<import("./model-thinking.js").ThinkingEffort>;
    defaultEffort?: import("./model-thinking.js").ThinkingEffort;
  };
};
export function withLegacyModel(
  models: ProviderModelChoice[],
  selected: string,
): ProviderModelChoice[] {
  const value = selected.trim();
  return value && !models.some((model) => model.id === value)
    ? [
        {
          id: value,
          label: `Legacy / custom saved model — ${value}`,
          legacy: true,
        },
        ...models,
      ]
    : models;
}

export function subscriptionFallbackModel(
  provider: "codex" | "claude" | "grok",
  models: Record<"codex" | "claude" | "grok", string>,
): string | undefined {
  return models[provider].trim() || undefined;
}
