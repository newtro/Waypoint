import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync("src/main.tsx", "utf8"),
  css = readFileSync("src/provider-settings.css", "utf8");

describe("Models and routing settings UI", () => {
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
    expect(main).toContain('className="model-usage-ledger"');
    expect(main).not.toContain("ready unverified");
  });

  it("has dark and container-responsive model layouts", () => {
    expect(css).toContain('html[data-theme="dark"] .model-settings-block');
    expect(css).toContain("container: model-settings / inline-size");
    expect(css).toContain("@container model-settings (max-width: 620px)");
    expect(css).toContain("@container model-settings (max-width: 400px)");
  });
});
