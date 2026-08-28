import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync("electron/main.ts", "utf8").replace(/\s+/g, " "),
  preload = readFileSync("electron/preload.ts", "utf8"),
  renderer = readFileSync("src/main.tsx", "utf8"),
  surface = readFileSync("src/device-network/DeviceNetwork.tsx", "utf8"),
  office = readFileSync("src/office/OfficeCommandCenter.tsx", "utf8"),
  workOrder = readFileSync("src/office/office-work-order.ts", "utf8");

describe("Device Network desktop integration", () => {
  it("wires the tested desktop lifecycle into the Electron entry point", () => {
    expect(main).toContain("new Tray(icon)");
    expect(main).toContain("buildDeviceTrayCommands(deviceHostPreferences");
    expect(main).toContain("shouldHideWindowOnClose({");
    expect(main).toContain('args: ["--background"]');
    expect(main).toContain("deviceNetworkRuntime?.stop()");
  });

  it("binds the typed IPC bridge to the additive Device Network screen", () => {
    for (const channel of [
      "waypoint:device-network-status",
      "waypoint:device-network-pair-request",
      "waypoint:device-network-pair-confirm",
      "waypoint:device-network-unlink",
      "waypoint:device-network-preferences",
      "waypoint:device-network-catalog",
      "waypoint:device-network-search",
      "waypoint:device-network-open-object",
      "waypoint:device-network-pin-workspace",
      "waypoint:device-network-cache-status",
    ]) {
      expect(main).toContain(channel);
      expect(preload).toContain(channel);
    }
    expect(renderer).toContain('openViewTab("devices")');
    expect(renderer).toContain("<DeviceNetwork");
    expect(surface).toContain("there is no invite");
    expect(surface).toContain("Codes match · link");
    expect(surface).toContain("Nothing is linked until both devices confirm");
    expect(surface).toContain("Fleet knowledge");
    expect(surface).toContain("Open and cache");
    expect(surface).toContain("deviceNetworkCatalog()");
    expect(surface).toContain("Trusted workspace catalog");
    expect(renderer).toContain('context="knowledge"');
    expect(office).toContain('context="office"');
    expect(office).toContain("onSelect=");
    expect(workOrder).toContain("Trusted fleet context");
    expect(main).toContain("Fleet source is no longer actively trusted");
    expect(main).toContain("fleetCacheService.sourceDeviceIds()");
    expect(main).toContain('"workspace-grants"');
    expect(main).toContain('"encrypted-cache"');
  });
});
