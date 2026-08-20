import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupLegacyWindowsInstall } from "./legacy-windows-install.js";

describe("legacy Windows install cleanup", () => {
  it("quarantines only an authenticated legacy binary directory and preserves every byte", () => {
    const local = mkdtempSync(path.join(os.tmpdir(), "waypoint-legacy-")),
      target = path.join(local, "Programs", "Waypoint"),
      sibling = path.join(local, "Programs", "Other");
    mkdirSync(target, { recursive: true });
    mkdirSync(path.join(target, "resources"));
    mkdirSync(sibling);
    writeFileSync(path.join(target, "Waypoint.exe"), "legacy");
    writeFileSync(path.join(target, "resources", "app.asar"), "asar");
    writeFileSync(path.join(target, "resources", "elevate.exe"), "elevate");
    writeFileSync(path.join(target, "user-note.txt"), "preserve");
    writeFileSync(path.join(sibling, "keep.txt"), "keep");
    expect(
      cleanupLegacyWindowsInstall({
        localAppData: local,
        currentExecutable: "C:\\Program Files\\Waypoint\\Waypoint.exe",
        nonce: "fixture",
      }),
    ).toBe("quarantined");
    expect(existsSync(target)).toBe(false);
    expect(existsSync(path.join(local, "Programs", "Waypoint.legacy-removal-fixture", "user-note.txt"))).toBe(true);
    expect(existsSync(path.join(sibling, "keep.txt"))).toBe(true);
  });
  it("does not touch a same-named directory without exact Waypoint package markers", () => {
    const local = mkdtempSync(path.join(os.tmpdir(), "waypoint-legacy-unrelated-")), target = path.join(local, "Programs", "Waypoint");
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "family-photos.txt"), "keep");
    expect(cleanupLegacyWindowsInstall({ localAppData: local, currentExecutable: "C:\\Program Files\\Waypoint\\Waypoint.exe" })).toBe("unsafe");
    expect(existsSync(path.join(target, "family-photos.txt"))).toBe(true);
  });
  it("does not remove the current install or follow a redirected directory", () => {
    const local = mkdtempSync(path.join(os.tmpdir(), "waypoint-legacy-")),
      programs = path.join(local, "Programs"),
      outside = path.join(local, "outside"),
      target = path.join(programs, "Waypoint");
    mkdirSync(programs, { recursive: true });
    mkdirSync(outside);
    expect(
      cleanupLegacyWindowsInstall({
        localAppData: local,
        currentExecutable: path.join(target, "Waypoint.exe"),
      }),
    ).toBe("current_install");
    symlinkSync(outside, target, "junction");
    expect(
      cleanupLegacyWindowsInstall({
        localAppData: local,
        currentExecutable: "C:\\Program Files\\Waypoint\\Waypoint.exe",
      }),
    ).toBe("unsafe");
    expect(existsSync(outside)).toBe(true);
  });
});
