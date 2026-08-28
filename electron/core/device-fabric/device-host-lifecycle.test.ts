import { describe, expect, it, vi } from "vitest";
import {
  buildDeviceTrayCommands,
  shouldHideWindowOnClose,
} from "./device-host-lifecycle.js";

const preferences = {
  version: 1 as const,
  startAtLogin: true,
  closeToTray: true,
  pauseWork: false,
  pauseSync: false,
};

describe("device host desktop lifecycle", () => {
  it("keeps only an ordinary Windows close in the tray", () => {
    expect(
      shouldHideWindowOnClose({
        explicitQuit: false,
        platform: "win32",
        closeToTray: true,
      }),
    ).toBe(true);
    expect(
      shouldHideWindowOnClose({
        explicitQuit: true,
        platform: "win32",
        closeToTray: true,
      }),
    ).toBe(false);
    expect(
      shouldHideWindowOnClose({
        explicitQuit: false,
        platform: "darwin",
        closeToTray: true,
      }),
    ).toBe(false);
  });

  it("routes every tray command to its real action", () => {
    const actions = {
        open: vi.fn(),
        openDeviceNetwork: vi.fn(),
        update: vi.fn(),
        quit: vi.fn(),
      },
      commands = buildDeviceTrayCommands(preferences, actions),
      activate = (label: string, checked?: boolean) => {
        const command = commands.find(
          (item) => item.type !== "separator" && item.label === label,
        );
        if (!command || command.type === "separator")
          throw new Error(`Missing ${label}`);
        command.activate(checked);
      };
    activate("Open Waypoint");
    activate("Command Center · Device Network");
    activate("Pause remote work", true);
    activate("Pause sync", true);
    activate("Start Waypoint at sign-in", false);
    activate("Keep running when window closes", false);
    activate("Quit Waypoint");
    expect(actions.open).toHaveBeenCalledOnce();
    expect(actions.openDeviceNetwork).toHaveBeenCalledOnce();
    expect(actions.update.mock.calls).toEqual([
      [{ pauseWork: true }],
      [{ pauseSync: true }],
      [{ startAtLogin: false }],
      [{ closeToTray: false }],
    ]);
    expect(actions.quit).toHaveBeenCalledOnce();
  });
});
