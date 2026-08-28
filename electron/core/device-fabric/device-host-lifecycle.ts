import type { DeviceHostPreferences } from "./device-host-preferences.js";

export interface DeviceTrayActions {
  open(): void;
  openDeviceNetwork(): void;
  update(patch: Partial<Omit<DeviceHostPreferences, "version">>): void;
  quit(): void;
}

export type DeviceTrayCommand =
  | { type: "separator" }
  | {
      type: "normal" | "checkbox";
      label: string;
      checked?: boolean;
      activate(checked?: boolean): void;
    };

export function buildDeviceTrayCommands(
  preferences: DeviceHostPreferences,
  actions: DeviceTrayActions,
): DeviceTrayCommand[] {
  return [
    { type: "normal", label: "Open Waypoint", activate: actions.open },
    {
      type: "normal",
      label: "Command Center · Device Network",
      activate: actions.openDeviceNetwork,
    },
    { type: "separator" },
    {
      type: "checkbox",
      label: "Pause remote work",
      checked: preferences.pauseWork,
      activate: (checked) => actions.update({ pauseWork: Boolean(checked) }),
    },
    {
      type: "checkbox",
      label: "Pause sync",
      checked: preferences.pauseSync,
      activate: (checked) => actions.update({ pauseSync: Boolean(checked) }),
    },
    { type: "separator" },
    {
      type: "checkbox",
      label: "Start Waypoint at sign-in",
      checked: preferences.startAtLogin,
      activate: (checked) => actions.update({ startAtLogin: Boolean(checked) }),
    },
    {
      type: "checkbox",
      label: "Keep running when window closes",
      checked: preferences.closeToTray,
      activate: (checked) => actions.update({ closeToTray: Boolean(checked) }),
    },
    { type: "separator" },
    { type: "normal", label: "Quit Waypoint", activate: actions.quit },
  ];
}

export function shouldHideWindowOnClose(input: {
  explicitQuit: boolean;
  platform: NodeJS.Platform;
  closeToTray: boolean;
}): boolean {
  return (
    !input.explicitQuit &&
    input.platform === "win32" &&
    input.closeToTray
  );
}
