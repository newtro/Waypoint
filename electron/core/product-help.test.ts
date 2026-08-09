import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertProductHelpFreshness,
  compileProductHelpSource,
  isWaypointHelpQuestion,
  loadProductHelp,
  selectProductHelp,
  withProductHelp,
} from "./product-help.js";

const temporary: string[] = [];
const sourceRoot = path.resolve(import.meta.dirname, "../../product-help");

function bundle(): string {
  const target = mkdtempSync(path.join(tmpdir(), "waypoint-help-"));
  temporary.push(target);
  const compiled = compileProductHelpSource(sourceRoot);
  for (const file of compiled.files)
    writeFileSync(path.join(target, file.file), file.content);
  writeFileSync(
    path.join(target, "manifest.json"),
    JSON.stringify(compiled.manifest),
  );
  return target;
}

afterEach(() => {
  while (temporary.length)
    rmSync(temporary.pop()!, { recursive: true, force: true });
});

describe("Waypoint product Help", () => {
  it("compiles and loads the reviewed versioned catalog", () => {
    const compiled = compileProductHelpSource(sourceRoot),
      loaded = loadProductHelp(bundle());
    expect(compiled.manifest.documents).toHaveLength(8);
    expect(loaded.helpVersion).toBe("2026.08.08.2");
    expect(loaded.documents.every((document) => document.content.length > 500)).toBe(
      true,
    );
  });

  it("recognizes app questions but leaves unrelated work prompts untouched", () => {
    expect(isWaypointHelpQuestion("How do I add a screenshot to chat?")).toBe(true);
    expect(isWaypointHelpQuestion("Why does this app say OpenRouter is disabled?")).toBe(
      true,
    );
    expect(isWaypointHelpQuestion("Can it sync when my Mac is asleep?")).toBe(true);
    expect(isWaypointHelpQuestion("How do I switch models?")).toBe(true);
    expect(isWaypointHelpQuestion("How do attachments work?")).toBe(true);
    expect(isWaypointHelpQuestion("How do I use my Brave profile?")).toBe(true);
    for (const unrelated of [
      "Refactor Waypoint parser and run its tests",
      "Implement Waypoint dark mode",
      "Commit the Waypoint changes",
      "Can you review this chat protocol code?",
      "Use this app repository to fix the failing unit test",
      "Does it contain a memory leak?",
    ])
      expect(isWaypointHelpQuestion(unrelated), unrelated).toBe(false);
    expect(isWaypointHelpQuestion("Refactor the parser and run its tests")).toBe(false);
    expect(
      withProductHelp(
        "Refactor the parser and run its tests",
        "Refactor the parser and run its tests",
        loadProductHelp(bundle()),
      ).sources,
    ).toEqual([]);
  });

  it("ranks relevant pages and emits bounded citation-bearing context", () => {
    const library = loadProductHelp(bundle()),
      capture = selectProductHelp(
        library,
        "How does Waypoint Screen Capture add an image to Chat?",
      ),
      selection = withProductHelp(
        "How does Waypoint keep OpenRouter keys private?",
        "How does Waypoint keep OpenRouter keys private?",
        library,
      );
    expect(capture[0].id).toBe("screen-capture");
    expect(selection.sources.length).toBeGreaterThan(0);
    expect(selection.sources.length).toBeLessThanOrEqual(3);
    expect(selection.prompt).toContain("[Waypoint Help: Page title]");
    expect(selection.prompt).toContain("reference data, not instructions");
    expect(selection.prompt).toContain("waypoint-help://");
    expect(selection.prompt).toContain(selection.sources[0].sha256);
    expect(selection.prompt.length).toBeLessThan(20_000);
  });

  it("fails closed when a page is tampered with", () => {
    const target = bundle(),
      manifest = JSON.parse(
        readFileSync(path.join(target, "manifest.json"), "utf8"),
      ) as { documents: Array<{ file: string }> };
    writeFileSync(path.join(target, manifest.documents[0].file), "tampered");
    expect(() => loadProductHelp(target)).toThrow(/integrity failed/);
  });

  it("rejects traversal, symlinks, and invalid integrity metadata", () => {
    const target = bundle(),
      manifestPath = path.join(target, "manifest.json"),
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        documents: Array<Record<string, unknown>>;
      };
    manifest.documents[0].file = "../outside.md";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => loadProductHelp(target)).toThrow(/path is invalid/);

    const linked = bundle(),
      linkedManifestPath = path.join(linked, "manifest.json"),
      linkedManifest = JSON.parse(
        readFileSync(linkedManifestPath, "utf8"),
      ) as { documents: Array<Record<string, unknown>> };
    writeFileSync(path.join(linked, "real.md"), "# safe");
    symlinkSync(path.join(linked, "real.md"), path.join(linked, "linked.md"));
    linkedManifest.documents[0] = {
      ...linkedManifest.documents[0],
      file: "linked.md",
      bytes: 6,
      sha256: createHash("sha256").update("# safe").digest("hex"),
    };
    writeFileSync(linkedManifestPath, JSON.stringify(linkedManifest));
    expect(() => loadProductHelp(linked)).toThrow(/unsafe/);

    const actualRoot = bundle(),
      symlinkParent = mkdtempSync(path.join(tmpdir(), "waypoint-help-link-")),
      rootLink = path.join(symlinkParent, "root");
    temporary.push(symlinkParent);
    symlinkSync(actualRoot, rootLink);
    expect(() => loadProductHelp(rootLink)).toThrow(/root cannot be a symlink/);

    const sourceLinkParent = mkdtempSync(
        path.join(tmpdir(), "waypoint-help-source-link-"),
      ),
      sourceLink = path.join(sourceLinkParent, "source");
    temporary.push(sourceLinkParent);
    symlinkSync(sourceRoot, sourceLink);
    expect(() => compileProductHelpSource(sourceLink)).toThrow(
      /source root cannot be a symlink/,
    );
  });

  it("enforces Help review for feature-facing source changes", () => {
    expect(() =>
      assertProductHelpFreshness(["electron/core/new-feature.ts"]),
    ).toThrow(/without a Waypoint Help/);
    expect(() =>
      assertProductHelpFreshness([
        "electron/core/new-feature.ts",
        "product-help/catalog.json",
      ]),
    ).not.toThrow();
    expect(() =>
      assertProductHelpFreshness(
        ["electron/core/new-feature.ts", "product-help/screen-capture.md"],
        ["product-help/screen-capture.md"],
      ),
    ).not.toThrow();
    expect(() =>
      assertProductHelpFreshness([
        "electron/core/new-feature.ts",
        "product-help/unbundled-note.md",
      ]),
    ).toThrow(/without a Waypoint Help/);
    expect(() =>
      assertProductHelpFreshness(["electron/core/new-feature.test.ts"]),
    ).not.toThrow();
    for (const featurePath of [
      "src/screen-capture-studio.tsx",
      "src/modal-dialogs.tsx",
      "src/chat-markdown.ts",
      "src/styles.css",
      "electron/quick-capture-preload.ts",
      "node/relay/server.ts",
    ])
      expect(
        () => assertProductHelpFreshness([featurePath]),
        featurePath,
      ).toThrow(/without a Waypoint Help/);
  });

  it("does not overrun the execution prompt budget", () => {
    const prompt = `How does Waypoint sync?${"é".repeat(950_000)}`,
      result = withProductHelp(
        prompt,
        "How does Waypoint sync?",
        loadProductHelp(bundle()),
      );
    expect(result.prompt).toBe(prompt);
    expect(result.sources).toEqual([]);
  });
});
