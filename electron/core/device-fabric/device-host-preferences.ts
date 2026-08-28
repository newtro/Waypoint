import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { syncDirectoryDurably, syncFileDurably } from "../durable-fs.js";

export interface DeviceHostPreferences {
  version: 1;
  startAtLogin: boolean;
  closeToTray: boolean;
  pauseWork: boolean;
  pauseSync: boolean;
}

export const DEFAULT_DEVICE_HOST_PREFERENCES: DeviceHostPreferences = {
  version: 1,
  startAtLogin: true,
  closeToTray: true,
  pauseWork: false,
  pauseSync: false,
};

export class DeviceHostPreferenceStore {
  private readonly target: string;
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.target = path.join(root, "device-host-preferences.json");
  }
  load(): DeviceHostPreferences {
    if (!existsSync(this.target)) return { ...DEFAULT_DEVICE_HOST_PREFERENCES };
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(this.target, "utf8"));
    } catch {
      throw new Error("Device Host preferences cannot be opened");
    }
    assertPreferences(value);
    return { ...value };
  }
  save(value: DeviceHostPreferences): DeviceHostPreferences {
    assertPreferences(value);
    const temporary = `${this.target}.${process.pid}.${Date.now()}.partial`;
    try {
      writeFileSync(temporary, JSON.stringify(value), {
        flag: "wx",
        mode: 0o600,
      });
      syncFileDurably(temporary);
      renameSync(temporary, this.target);
      syncDirectoryDurably(this.root);
      return { ...value };
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}

function assertPreferences(
  value: unknown,
): asserts value is DeviceHostPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Device Host preferences");
  const item = value as Partial<DeviceHostPreferences>;
  if (
    item.version !== 1 ||
    typeof item.startAtLogin !== "boolean" ||
    typeof item.closeToTray !== "boolean" ||
    typeof item.pauseWork !== "boolean" ||
    typeof item.pauseSync !== "boolean" ||
    Object.keys(item).some(
      (key) =>
        ![
          "version",
          "startAtLogin",
          "closeToTray",
          "pauseWork",
          "pauseSync",
        ].includes(key),
    )
  )
    throw new Error("Invalid Device Host preferences");
}
