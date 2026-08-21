import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync("src/main.tsx", "utf8"),
  css = readFileSync("src/provider-settings.css", "utf8"),
  builder = readFileSync("electron-builder.yml", "utf8");

describe("Models and routing settings UI", () => {
  it("packages the shared thinking contract for the Electron main process", () => {
    expect(builder).toContain("dist-electron/src/model-thinking.js");
  });

  it("keeps provider behavior behind a structured accessible routing console", () => {
    expect(main).toContain('className="settings-section models-settings-section"');
    expect(main).toContain("Models & routing");
    expect(main).toContain('aria-labelledby="subscription-lanes-title"');
    expect(main).toContain('aria-labelledby="hosted-lane-title"');
    expect(main).toContain('aria-label="Allow hosted OpenRouter requests"');
    expect(main).toContain('aria-label="OpenRouter API key"');
    expect(main).toContain("Save hosted routing");
  });

  it("preserves curated provider selectors, spend controls, and the usage ledger", () => {
    for (const label of [
      "Codex model preference",
      "Claude model preference",
      "OpenRouter strategic model",
      "OpenRouter everyday model",
      "Monthly OpenRouter budget used",
      "Year-to-date OpenRouter budget used",
    ]) expect(main).toContain(`aria-label="${label}"`);
    for (const label of [
      "Codex thinking",
      "Claude thinking",
      "Grok Build thinking",
      "Strategic thinking",
      "Everyday thinking",
      "Image thinking",
    ]) expect(main).toContain(`label="${label}"`);
    expect(main).toContain('className="model-usage-ledger"');
    expect(main).not.toContain("ready unverified");
    expect(main).toContain("updateOpenRouterRouting(");
    expect(main).toContain("openRouterSettingsDraft");
    expect(main).toContain("hostedSettings.monthlyCapMicros");
    expect(main).toContain("hostedSettings.fallbackProvider");
    expect(main).toMatch(
      /if \(!settingsOpenRef\.current\)\s+setOpenRouterThinkingDraft/,
    );
    expect(main).toContain("generation !== openRouterDraftGenerationRef.current");
    expect(main).toContain("editOpenRouterThinkingDraft((current)");
    expect(main).toContain("editOpenRouterSettingsDraft({");
    expect(main).toContain(
      "window.waypoint.chatThinkingPreferences(workspace.id)",
    );
    expect(main).toMatch(
      /selectedComposerModel\s*=\s*chatCli\s*===\s*"openrouter"[\s\S]*?openRouter\?\.settings\.attachmentModel[\s\S]*?openRouter\?\.settings\.everydayModel/,
    );
    expect(main).toContain("openRouterThinkingDraft.openrouterStrategic");
  });

  it("has dark and container-responsive model layouts", () => {
    expect(css).toContain('html[data-theme="dark"] .model-settings-block');
    expect(css).toContain("container: model-settings / inline-size");
    expect(css).toContain("@container model-settings (max-width: 620px)");
    expect(css).toContain("@container model-settings (max-width: 400px)");
  });
});
