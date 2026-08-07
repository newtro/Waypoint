import { describe, expect, it } from "vitest";
import {
  knowledgeShortcutIcon,
  primaryShortcutLabel,
  primaryShortcutPressed,
} from "./platform-shortcuts.js";

describe("platform shortcut presentation", () => {
  it("keeps Command shortcuts on macOS", () => {
    expect(primaryShortcutLabel("darwin")).toBe("⌘");
    expect(knowledgeShortcutIcon("darwin")).toBe("⌘");
    expect(primaryShortcutPressed("darwin", { metaKey: true, ctrlKey: false })).toBe(
      true,
    );
    expect(primaryShortcutPressed("darwin", { metaKey: false, ctrlKey: true })).toBe(
      false,
    );
  });

  it("uses Control shortcuts and a neutral icon on Windows", () => {
    expect(primaryShortcutLabel("win32")).toBe("Ctrl");
    expect(knowledgeShortcutIcon("win32")).toBe("◈");
    expect(primaryShortcutPressed("win32", { metaKey: false, ctrlKey: true })).toBe(
      true,
    );
    expect(primaryShortcutPressed("win32", { metaKey: true, ctrlKey: false })).toBe(
      false,
    );
  });
});
