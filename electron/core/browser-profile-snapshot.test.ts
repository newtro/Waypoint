import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotBrowserProfile } from "./browser-profile-snapshot.js";

describe("private installed-browser profile snapshots", () => {
  it("copies atomically, excludes caches, and records bounded provenance", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "waypoint-browser-profile-")),
      source = path.join(root, "Default"),
      target = path.join(root, "managed", "brave.Default");
    mkdirSync(path.join(source, "Cache"), { recursive: true });
    writeFileSync(path.join(source, "Preferences"), "fixture");
    writeFileSync(path.join(source, "Cache", "ignored"), "secret-cache");
    writeFileSync(path.join(root, "old"), "old");
    const result = snapshotBrowserProfile({
      source,
      target,
      browserId: "brave",
      profileId: "Default",
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });
    expect(readFileSync(path.join(target, "Default", "Preferences"), "utf8")).toBe("fixture");
    expect(() => readFileSync(path.join(target, "Default", "Cache", "ignored"))).toThrow();
    expect(JSON.parse(readFileSync(path.join(target, ".waypoint-profile.json"), "utf8"))).toMatchObject({
      browserId: "brave",
      profileId: "Default",
      bytes: 7,
      files: 1,
      importedAt: "2026-08-06T00:00:00.000Z",
      sourceManifestSha256: result.sourceManifestSha256,
    });
  });

  it("fails closed on links and resource-bound overflow", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "waypoint-browser-profile-")),
      source = path.join(root, "Default"),
      target = path.join(root, "managed", "profile");
    mkdirSync(source);
    writeFileSync(path.join(source, "data"), "12345");
    expect(() => snapshotBrowserProfile({ source, target, browserId: "brave", profileId: "Default", maxBytes: 4 })).toThrow("bounded");
    if (process.platform === "win32") {
      const linkedDirectory = path.join(root, "linked-directory");
      mkdirSync(linkedDirectory);
      symlinkSync(linkedDirectory, path.join(source, "link"), "junction");
    } else symlinkSync(path.join(source, "data"), path.join(source, "link"));
    expect(() => snapshotBrowserProfile({ source, target, browserId: "brave", profileId: "Default" })).toThrow("symbolic link");
  });
});
