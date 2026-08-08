export const APPEARANCE_STORAGE_KEY = "waypoint.appearance.v1";

export type AppearancePreference = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";
export const APPEARANCE_OPTIONS: readonly AppearancePreference[] = ["system", "light", "dark"];
type AppearanceStorage = Pick<Storage, "getItem" | "setItem">;
type ThemeTarget = {
  dataset: DOMStringMap;
  style: Pick<CSSStyleDeclaration, "colorScheme">;
};

export function normalizeAppearance(value: unknown): AppearancePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function readAppearance(storage?: AppearanceStorage): AppearancePreference {
  try {
    return normalizeAppearance(storage?.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemDark: boolean,
): ResolvedAppearance {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export function nextAppearanceFromKey(
  current: AppearancePreference,
  key: string,
): AppearancePreference | undefined {
  if (key === "Home") return APPEARANCE_OPTIONS[0];
  if (key === "End") return APPEARANCE_OPTIONS.at(-1);
  const direction = key === "ArrowRight" || key === "ArrowDown"
    ? 1
    : key === "ArrowLeft" || key === "ArrowUp"
      ? -1
      : 0;
  if (!direction) return undefined;
  const currentIndex = APPEARANCE_OPTIONS.indexOf(current);
  return APPEARANCE_OPTIONS[
    (currentIndex + direction + APPEARANCE_OPTIONS.length) % APPEARANCE_OPTIONS.length
  ];
}

export function applyAppearance(
  target: ThemeTarget,
  preference: AppearancePreference,
  systemDark: boolean,
): ResolvedAppearance {
  const resolved = resolveAppearance(preference, systemDark);
  target.dataset.theme = resolved;
  target.dataset.appearance = preference;
  target.style.colorScheme = resolved;
  return resolved;
}

export function persistAppearance(
  storage: AppearanceStorage,
  preference: AppearancePreference,
): void {
  storage.setItem(APPEARANCE_STORAGE_KEY, normalizeAppearance(preference));
}
