import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DesktopSyncService } from "./desktop-sync-service.js";
import type { PeerHostRuntime } from "./peer-host-runtime.js";
import {
  ProtectedSyncVault,
  type SecretProtector,
} from "./protected-sync-vault.js";

const protector: SecretProtector = {
  available: () => true,
  encrypt: (value) => Buffer.from(value),
  decrypt: (value) => Buffer.from(value).toString(),
};

describe("desktop sync lifecycle", () => {
  it("blocks host restart throughout a deferred leave transition", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-leave-race-")),
      vault = new ProtectedSyncVault(path.join(root, "vault"), protector);
    let releaseStop!: () => void;
    const stopped = new Promise<void>((resolve) => {
        releaseStop = resolve;
      }),
      host = {
        status: () => ({
          running: true,
          mode: "desktop-host" as const,
          reason: "fixture",
          workspaceId: "workspace_leave_race_01",
        }),
        stop: vi.fn(() => stopped),
        start: vi.fn(),
      },
      service = await DesktopSyncService.create(
        vault,
        host as unknown as PeerHostRuntime,
      ),
      bootstrap = service.initializeOwner("workspace_leave_race_01"),
      onLocked = vi.fn(),
      leaving = service.leave("workspace_leave_race_01", onLocked);
    expect(onLocked).toHaveBeenCalledOnce();
    expect(service.isLeaving("workspace_leave_race_01")).toBe(true);
    await expect(
      service.startPeerHost("workspace_leave_race_01", "127.0.0.1"),
    ).rejects.toThrow(/leave is in progress/);
    expect(host.start).not.toHaveBeenCalled();
    expect(vault.load(bootstrap.workspaceId)?.device.deviceId).toBe(
      bootstrap.deviceId,
    );
    releaseStop();
    await leaving;
    expect(service.isLeaving("workspace_leave_race_01")).toBe(false);
    expect(vault.load(bootstrap.workspaceId)).toBeUndefined();
  });

  it("keeps a committed failed leave locked until an explicit retry succeeds", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-leave-retry-")),
      vault = new ProtectedSyncVault(path.join(root, "vault"), protector),
      stop = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("close failed"))
        .mockResolvedValueOnce(),
      host = {
        status: () => ({
          running: true,
          mode: "desktop-host" as const,
          reason: "fixture",
          workspaceId: "workspace_leave_retry_01",
        }),
        stop,
        start: vi.fn(),
      },
      service = await DesktopSyncService.create(
        vault,
        host as unknown as PeerHostRuntime,
      );
    service.initializeOwner("workspace_leave_retry_01");
    await expect(
      service.leave("workspace_leave_retry_01", () => undefined),
    ).rejects.toThrow("close failed");
    expect(service.isLeaving("workspace_leave_retry_01")).toBe(true);
    await expect(
      service.startPeerHost("workspace_leave_retry_01", "127.0.0.1"),
    ).rejects.toThrow(/leave is in progress/);
    await expect(
      service.leave("workspace_leave_retry_01", () => undefined),
    ).resolves.toMatchObject({ configured: false, contentPreserved: true });
    expect(stop).toHaveBeenCalledTimes(2);
    expect(service.isLeaving("workspace_leave_retry_01")).toBe(false);
  });
});
