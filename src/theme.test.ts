import { describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  nextAppearanceFromKey,
  normalizeAppearance,
  persistAppearance,
  readAppearance,
  resolveAppearance,
} from "./theme.js";

describe("appearance preference", () => {
  it("accepts only curated values and resolves system preference", () => {
    expect(normalizeAppearance("dark")).toBe("dark");
    expect(normalizeAppearance("light")).toBe("light");
    expect(normalizeAppearance("legacy-neon")).toBe("system");
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
  });

  it("fails safely when local appearance storage is unavailable", () => {
    expect(readAppearance({ getItem: () => "dark", setItem: vi.fn() })).toBe("dark");
    expect(
      readAppearance({
        getItem: () => {
          throw new Error("storage unavailable");
        },
        setItem: vi.fn(),
      }),
    ).toBe("system");
  });

  it("persists one curated value and applies truthful DOM state", () => {
    const setItem = vi.fn();
    persistAppearance({ getItem: vi.fn(), setItem }, "dark");
    expect(setItem).toHaveBeenCalledWith(APPEARANCE_STORAGE_KEY, "dark");
    const target = { dataset: {} as DOMStringMap, style: { colorScheme: "" } };
    expect(applyAppearance(target, "system", true)).toBe("dark");
    expect(target).toEqual({
      dataset: { theme: "dark", appearance: "system" },
      style: { colorScheme: "dark" },
    });
  });

  it("provides wrapping arrow, Home, and End navigation for the radio group", () => {
    expect(nextAppearanceFromKey("system", "ArrowLeft")).toBe("dark");
    expect(nextAppearanceFromKey("dark", "ArrowRight")).toBe("system");
    expect(nextAppearanceFromKey("dark", "ArrowUp")).toBe("light");
    expect(nextAppearanceFromKey("system", "ArrowDown")).toBe("light");
    expect(nextAppearanceFromKey("dark", "Home")).toBe("system");
    expect(nextAppearanceFromKey("system", "End")).toBe("dark");
    expect(nextAppearanceFromKey("light", "Enter")).toBeUndefined();
  });
});
