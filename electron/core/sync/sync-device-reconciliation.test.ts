import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "../store.js";
import { WaypointCrypto } from "./crypto.js";
import { DesktopSyncService } from "./desktop-sync-service.js";
import {
  ProtectedSyncVault,
  type SecretProtector,
} from "./protected-sync-vault.js";
import { reconcileProtectedSyncDevices } from "./sync-device-reconciliation.js";

const protector: SecretProtector = {
  available: () => true,
  encrypt: (value) => Buffer.from(value),
  decrypt: (value) => Buffer.from(value).toString(),
};

function fixture(label: string) {
  const root = mkdtempSync(path.join(tmpdir(), label)),
    database = path.join(root, "waypoint.sqlite"),
    store = new WorkspaceStore(database),
    workspace = store.createWorkspace("Reconcile", path.join(root, "work")),
    vault = new ProtectedSyncVault(path.join(root, "vault"), protector);
  return { root, database, store, workspace, vault };
}

describe("protected sync device reconciliation", () => {
  it("repairs an interrupted owner initialization before sync starts", async () => {
    const input = fixture("waypoint-owner-reconcile-"),
      service = await DesktopSyncService.create(input.vault),
      bootstrap = service.initializeOwner(input.workspace.id);
    input.store.createDocument(input.workspace.id, "Interrupted", "local");
    input.store.close();
    const restarted = new WorkspaceStore(input.database);
    expect(reconcileProtectedSyncDevices(restarted, input.vault)).toBe(1);
    expect(restarted.syncStatus(input.workspace.id)).toMatchObject({
      localDeviceId: bootstrap.deviceId,
      setupStatus: "device_pending_keys",
    });
    expect(
      restarted
        .pendingSyncChanges(input.workspace.id)
        .every((change) => change.deviceId === bootstrap.deviceId),
    ).toBe(true);
    expect(reconcileProtectedSyncDevices(restarted, input.vault)).toBe(0);
    restarted.close();
  });

  it("repairs an interrupted join finalization and rebases unsent work", async () => {
    const input = fixture("waypoint-join-reconcile-"),
      crypto = await WaypointCrypto.create(),
      device = crypto.generateDevice("joined_device_0001");
    input.vault.save({
      version: 1,
      workspaceId: input.workspace.id,
      device,
      workspaceKey: crypto.generateWorkspaceKey(),
      keyEpoch: 1,
      endpoint: "https://waypoint-relay.johnnycode.ai",
      snapshotRequired: true,
    });
    input.store.createDocument(input.workspace.id, "Before restart", "local");
    input.store.close();
    const restarted = new WorkspaceStore(input.database);
    expect(reconcileProtectedSyncDevices(restarted, input.vault)).toBe(1);
    expect(restarted.syncStatus(input.workspace.id).localDeviceId).toBe(
      device.deviceId,
    );
    expect(
      restarted
        .pendingSyncChanges(input.workspace.id)
        .every(
          (change) =>
            change.deviceId === device.deviceId &&
            change.clock[device.deviceId] === change.sequence,
        ),
    ).toBe(true);
    restarted.close();
  });

  it("rolls the entire mutation rebase back when final state commit fails", async () => {
    const input = fixture("waypoint-reconcile-rollback-"),
      crypto = await WaypointCrypto.create(),
      device = crypto.generateDevice("rollback_device_001");
    input.store.createDocument(input.workspace.id, "Atomic", "rebase");
    const beforeStatus = input.store.syncStatus(input.workspace.id),
      before = input.store.pendingSyncChanges(input.workspace.id),
      admin = new DatabaseSync(input.database);
    admin.exec(`
      CREATE TRIGGER reject_sync_device_reconcile
      BEFORE UPDATE OF local_device_id ON sync_workspace_state
      WHEN NEW.local_device_id='rollback_device_001'
      BEGIN SELECT RAISE(ABORT,'simulated state commit failure'); END;
    `);
    admin.close();
    expect(() =>
      input.store.configureSyncDevice(input.workspace.id, device.deviceId),
    ).toThrow("simulated state commit failure");
    expect(input.store.syncStatus(input.workspace.id).localDeviceId).toBe(
      beforeStatus.localDeviceId,
    );
    expect(input.store.pendingSyncChanges(input.workspace.id)).toEqual(before);
    const cleanup = new DatabaseSync(input.database);
    cleanup.exec("DROP TRIGGER reject_sync_device_reconcile");
    cleanup.close();
    input.store.configureSyncDevice(input.workspace.id, device.deviceId);
    expect(
      input.store
        .pendingSyncChanges(input.workspace.id)
        .every((change) => change.deviceId === device.deviceId),
    ).toBe(true);
    input.store.close();
  });
});
