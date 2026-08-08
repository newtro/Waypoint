import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync("src/main.tsx", "utf8"),
  theme = readFileSync("src/theme.css", "utf8");

describe("appearance UI contract", () => {
  it("offers a curated accessible appearance selector with live status", () => {
    expect(main).toContain('role="radiogroup" aria-label="App appearance"');
    expect(main).toContain('role="radio"');
    expect(main).toContain('aria-checked={appearance === value}');
    expect(main).toContain('tabIndex={appearance === value ? 0 : -1}');
    expect(main).toContain("nextAppearanceFromKey(appearance, event.key)");
    expect(main).toContain('className="appearance-status" role="status"');
    expect(main).toContain('["system", "System", "Follow this device"]');
    expect(main).toContain('["dark", "Dark", "Midnight cartography"]');
  });

  it("styles primary app, chat, settings, capture, and browser surfaces", () => {
    for (const selector of [
      ".left-sidebar",
      ".chat-main",
      ".composer",
      ".settings-page-body .settings-section",
      ".capture-overlay",
      ".right-drawer.browser-drawer",
    ]) expect(theme).toContain(`html[data-theme="dark"] ${selector}`);
    expect(theme).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps explicit appearance authoritative and gives dark primary actions readable labels", () => {
    const attachments = readFileSync("src/chat-attachments.css", "utf8");
    expect(attachments).not.toContain("prefers-color-scheme:dark");
    expect(attachments).toContain('html[data-theme="dark"] .attachment-image-card');
    expect(theme).toContain('html[data-theme="dark"] .empty-chat > button');
    expect(theme).toContain('html[data-theme="dark"] .capture-studio > header > button:hover');
    expect(theme).toContain('html[data-theme="dark"] .capture-preview-actions button.primary');
  });
});
