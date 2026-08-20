import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Waypoint Help route and package integration", () => {
  const root = path.resolve(import.meta.dirname, "../..");

  it("enriches root CLI and OpenRouter prompts, records sources, and skips child tasks", () => {
    const source = readFileSync(path.join(root, "electron/main.ts"), "utf8");
    expect(source).toMatch(
      /withProductHelp\(\s*prompt,\s*userPrompt,\s*productHelpLibrary\s*\)/,
    );
    expect(source).toMatch(
      /parentExecutionId\s*\|\|\s*isInteractiveSlashSkill/,
    );
    expect(source).toContain("userPrompt.trimStart().match(");
    expect(source).toContain(
      "isInteractiveSlashSkill = Boolean(interactiveSlashSkillIdentifier)",
    );
    expect(source).toContain(
      "requiredSkillIdentifier: interactiveSlashSkillIdentifier",
    );
    expect(source).toContain("Waypoint Help · ${helpSelection.sources.length}");
    expect(source).toContain("store.addHostedRunEvent(");
  });

  it("prepares Help before every build and bundles it on both desktop platforms", () => {
    const packageJson = JSON.parse(
        readFileSync(path.join(root, "package.json"), "utf8"),
      ) as { scripts: Record<string, string> },
      builder = readFileSync(path.join(root, "electron-builder.yml"), "utf8"),
      closure = readFileSync(
        path.join(root, "scripts/package-runtime-closure.ts"),
        "utf8",
      );
    expect(packageJson.scripts.build).toContain("prepare:product-help");
    expect(packageJson.scripts["verify:product-help"]).toContain("--verify");
    expect(builder).toContain("to: waypoint-help");
    expect(closure).toContain("verifyPackagedProductHelp(resources)");
  });
});
