export type ProviderModelChoice = { id: string; label: string; legacy?: boolean };
export function withLegacyModel(models: ProviderModelChoice[], selected: string): ProviderModelChoice[] {
  const value = selected.trim();
  return value && !models.some((model) => model.id === value) ? [{ id: value, label: `Legacy / custom saved model — ${value}`, legacy: true }, ...models] : models;
}

export function subscriptionFallbackModel(provider:"codex"|"claude",models:Record<"codex"|"claude",string>):string|undefined{
  return models[provider].trim()||undefined
}
