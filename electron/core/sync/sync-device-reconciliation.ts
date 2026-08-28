import type { WorkspaceStore } from "../store.js";
import type { ProtectedSyncVault } from "./protected-sync-vault.js";

type ReconciliationStore = Pick<
  WorkspaceStore,
  "listWorkspaces" | "syncStatus" | "configureSyncDevice"
>;

/** Reconciles the protected identity before any sync transport can start. */
export function reconcileProtectedSyncDevices(
  store: ReconciliationStore,
  vault: ProtectedSyncVault,
): number {
  let repaired = 0;
  for (const workspace of store.listWorkspaces()) {
    const active = vault.load(workspace.id);
    if (!active) continue;
    const status = store.syncStatus(workspace.id);
    if (
      status.localDeviceId === active.device.deviceId &&
      status.setupStatus === "device_pending_keys"
    )
      continue;
    store.configureSyncDevice(workspace.id, active.device.deviceId);
    repaired++;
  }
  return repaired;
}
