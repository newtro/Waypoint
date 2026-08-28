import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DeviceHostPreferenceStore } from "./device-host-preferences.js";

describe("Device Host preferences", () => {
  it("defaults to background availability and persists every explicit pause", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-host-prefs-")),
      store = new DeviceHostPreferenceStore(root);
    expect(store.load()).toEqual({
      version: 1,
      startAtLogin: true,
      closeToTray: true,
      pauseWork: false,
      pauseSync: false,
    });
    const saved = store.save({
      version: 1,
      startAtLogin: false,
      closeToTray: true,
      pauseWork: true,
      pauseSync: true,
    });
    expect(new DeviceHostPreferenceStore(root).load()).toEqual(saved);
    expect(
      readFileSync(path.join(root, "device-host-preferences.json"), "utf8"),
    ).not.toContain("partial");
  });

  it("fails closed for unknown or malformed preference state", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-host-prefs-bad-"));
    writeFileSync(
      path.join(root, "device-host-preferences.json"),
      JSON.stringify({ version: 1, startAtLogin: true }),
    );
    expect(() => new DeviceHostPreferenceStore(root).load()).toThrow(/Invalid/);
  });
});
