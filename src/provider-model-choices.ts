export type ProviderModelChoice = { id: string; label: string; legacy?: boolean };
export function withLegacyModel(models: ProviderModelChoice[], selected: string): ProviderModelChoice[] {
  const value = selected.trim();
  return value && !models.some((model) => model.id === value) ? [{ id: value, label: `Legacy / custom saved model — ${value}`, legacy: true }, ...models] : models;
}
