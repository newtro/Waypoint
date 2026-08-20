import {
  existsSync,
  lstatSync,
  realpathSync,
  renameSync,
} from "node:fs";
import path from "node:path";

export type LegacyInstallCleanup =
  | "not_found"
  | "current_install"
  | "quarantined"
  | "unsafe"
  | "failed";

const samePath = (left: string, right: string) =>
  path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

export function cleanupLegacyWindowsInstall(input: {
  localAppData: string;
  currentExecutable: string;
  nonce?: string;
}): LegacyInstallCleanup {
  const programs = path.resolve(input.localAppData, "Programs"),
    target = path.join(programs, "Waypoint"),
    current = path.resolve(input.currentExecutable);
  if (
    samePath(current, path.join(target, path.basename(current))) ||
    current.toLowerCase().startsWith(`${target.toLowerCase()}${path.sep}`)
  )
    return "current_install";
  if (!existsSync(target)) return "not_found";
  try {
    const entry = lstatSync(target);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return "unsafe";
    const programsReal = realpathSync(programs),
      targetReal = realpathSync(target);
    if (
      !samePath(path.dirname(targetReal), programsReal) ||
      path.basename(targetReal).toLowerCase() !== "waypoint"
    )
      return "unsafe";
    const requiredMarkers = [
      path.join(targetReal, "Waypoint.exe"),
      path.join(targetReal, "resources", "app.asar"),
      path.join(targetReal, "resources", "elevate.exe"),
    ];
    if (!requiredMarkers.every((marker) => existsSync(marker) && lstatSync(marker).isFile()))
      return "unsafe";
    const quarantine = path.join(
      programs,
      `Waypoint.legacy-removal-${input.nonce ?? `${process.pid}-${Date.now()}`}`,
    );
    if (existsSync(quarantine)) return "unsafe";
    renameSync(target, quarantine);
    const moved = lstatSync(quarantine),
      movedReal = realpathSync(quarantine);
    if (
      !moved.isDirectory() ||
      moved.isSymbolicLink() ||
      !samePath(path.dirname(movedReal), programsReal)
    )
      return "unsafe";
    // Keep the authenticated legacy tree recoverable. A later explicit cleanup
    // can remove this quarantine after the user verifies the new installation.
    return "quarantined";
  } catch {
    return "failed";
  }
}
