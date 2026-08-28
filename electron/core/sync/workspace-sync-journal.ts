import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { R0_PROTOCOL_CONTRACT } from "./protocol-contract.js";
import type {
  CausalClock,
  InboundChange,
  LocalMutation,
  SyncOperation,
} from "./sync-store.js";

const now = () => new Date().toISOString();
const RETENTION_MS =
  R0_PROTOCOL_CONTRACT.retention.tombstoneMinimumDays * 86_400_000;

function dominates(left: CausalClock, right: CausalClock): boolean {
  const devices = new Set([...Object.keys(left), ...Object.keys(right)]);
  let greater = false;
  for (const device of devices) {
    const l = left[device] ?? 0,
      r = right[device] ?? 0;
    if (l < r) return false;
    if (l > r) greater = true;
  }
  return greater;
}
function canonical(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
}
function changeFingerprint(change: LocalMutation): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          id: change.id,
          workspaceId: change.workspaceId,
          objectId: change.objectId,
          objectKind: change.objectKind,
          operation: change.operation,
          deviceId: change.deviceId,
          sequence: change.sequence,
          clock: change.clock,
          payload: change.payload,
          createdAt: change.createdAt,
        }),
      ),
    )
    .digest("hex");
}

/** Uses the WorkspaceStore connection; callers supply the surrounding transaction. */
export class WorkspaceSyncJournal {
  constructor(private readonly db: DatabaseSync) {
    WorkspaceSyncJournal.install(db);
  }
  static install(db: DatabaseSync): void {
    db.exec(`
    CREATE TABLE IF NOT EXISTS sync_workspace_state(
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      local_device_id TEXT NOT NULL, setup_status TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_sequences(device_id TEXT PRIMARY KEY,sequence INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_mutations(
      id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      object_id TEXT NOT NULL,object_kind TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('upsert','delete')),
      device_id TEXT NOT NULL,sequence INTEGER NOT NULL,clock_json TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(device_id,sequence)
    );
    CREATE TABLE IF NOT EXISTS sync_outbox(
      envelope_id TEXT PRIMARY KEY,mutation_id TEXT NOT NULL UNIQUE,workspace_id TEXT NOT NULL,
      object_id TEXT NOT NULL,operation TEXT NOT NULL,ciphertext BLOB NOT NULL,created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_inbox(envelope_id TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_envelope_fingerprints(envelope_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_applied_changes(change_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_heads(
      workspace_id TEXT NOT NULL,object_id TEXT NOT NULL,object_kind TEXT NOT NULL,operation TEXT NOT NULL,
      change_id TEXT NOT NULL,clock_json TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(workspace_id,object_id)
    );
    CREATE TABLE IF NOT EXISTS sync_conflicts(
      workspace_id TEXT NOT NULL,object_id TEXT NOT NULL,change_id TEXT NOT NULL,object_kind TEXT NOT NULL,
      clock_json TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id,object_id,change_id)
    );
    CREATE TABLE IF NOT EXISTS sync_tombstones(
      workspace_id TEXT NOT NULL,object_id TEXT NOT NULL,change_id TEXT NOT NULL,retain_until TEXT NOT NULL,created_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id,object_id)
    );
    CREATE TABLE IF NOT EXISTS sync_attachment_manifests(
      workspace_id TEXT NOT NULL,transfer_id TEXT PRIMARY KEY,attachment_id TEXT NOT NULL,owner_id TEXT NOT NULL,
      name TEXT NOT NULL,media_type TEXT NOT NULL,sha256 TEXT NOT NULL,total_bytes INTEGER NOT NULL,chunk_count INTEGER NOT NULL,created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_attachment_chunks(
      workspace_id TEXT NOT NULL,transfer_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,chunk_count INTEGER NOT NULL,plaintext BLOB NOT NULL,
      PRIMARY KEY(transfer_id,chunk_index)
    );
    CREATE TABLE IF NOT EXISTS sync_attachment_missing_requests(workspace_id TEXT NOT NULL,transfer_id TEXT NOT NULL,peer_device_id TEXT NOT NULL,indices_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(transfer_id,peer_device_id));
    CREATE TABLE IF NOT EXISTS sync_attachment_outbound(transfer_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,object_id TEXT NOT NULL,mutation_json TEXT NOT NULL,retained_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_quarantine(envelope_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,sender_device_id TEXT NOT NULL,reason_code TEXT NOT NULL,quarantined_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_control_requests(request_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,sender_device_id TEXT NOT NULL,consumed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_snapshot_requests(request_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,owner_device_id TEXT NOT NULL,created_at TEXT NOT NULL,consumed_at TEXT);
    CREATE TABLE IF NOT EXISTS sync_snapshot_targets(mutation_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,recipient_device_id TEXT NOT NULL);
  `);
  }

  ensureWorkspace(
    workspaceId: string,
    status: "local_only" | "snapshot_required" = "local_only",
  ): void {
    this.db
      .prepare("INSERT OR IGNORE INTO sync_workspace_state VALUES (?,?,?,0,?)")
      .run(workspaceId, randomUUID(), status, now());
  }

  status(workspaceId: string): Record<string, unknown> {
    const state = this.db
      .prepare(
        "SELECT local_device_id localDeviceId,setup_status setupStatus,enabled,updated_at updatedAt FROM sync_workspace_state WHERE workspace_id=?",
      )
      .get(workspaceId) as Record<string, unknown> | undefined;
    if (!state) throw new Error("Sync state not found for workspace");
    const count = (table: string) =>
      Number(
        (
          this.db
            .prepare(`SELECT count(*) count FROM ${table} WHERE workspace_id=?`)
            .get(workspaceId) as { count: number }
        ).count,
      );
    const conflictVariants = count("sync_conflicts"),
      conflicts = Number(
        (
          this.db
            .prepare(
              "SELECT count(DISTINCT object_id) count FROM sync_conflicts WHERE workspace_id=?",
            )
            .get(workspaceId) as { count: number }
        ).count,
      );
    return {
      ...state,
      enabled: Boolean(state.enabled),
      pendingMutations: count("sync_mutations"),
      pendingEnvelopes: count("sync_outbox"),
      conflicts,
      conflictVariants,
      tombstones: count("sync_tombstones"),
    };
  }

  configureDevice(workspaceId: string, deviceId: string): void {
    if (!deviceId.trim()) throw new Error("Device identity required");
    const state = this.db
      .prepare(
        "SELECT local_device_id localDeviceId FROM sync_workspace_state WHERE workspace_id=?",
      )
      .get(workspaceId) as { localDeviceId: string } | undefined;
    if (!state) throw new Error("Workspace sync state not found");
    if (state.localDeviceId !== deviceId) {
      const rows = this.db
        .prepare(
          "SELECT * FROM sync_mutations WHERE workspace_id=? AND device_id=? ORDER BY sequence,id",
        )
        .all(workspaceId, state.localDeviceId) as Array<
        Record<string, unknown>
      >;
      let sequence = Number(
        (
          this.db
            .prepare("SELECT sequence FROM sync_sequences WHERE device_id=?")
            .get(deviceId) as { sequence: number } | undefined
        )?.sequence ?? 0,
      );
      for (const row of rows) {
        sequence++;
        const clock = JSON.parse(String(row.clock_json)) as CausalClock;
        delete clock[state.localDeviceId];
        clock[deviceId] = sequence;
        const mutation: LocalMutation = {
          id: String(row.id),
          workspaceId,
          objectId: String(row.object_id),
          objectKind: String(row.object_kind),
          operation: row.operation as SyncOperation,
          deviceId,
          sequence,
          clock,
          payload: JSON.parse(String(row.payload_json)),
          createdAt: String(row.created_at),
        };
        this.db
          .prepare(
            "UPDATE sync_mutations SET device_id=?,sequence=?,clock_json=? WHERE id=? AND workspace_id=?",
          )
          .run(
            deviceId,
            sequence,
            JSON.stringify(clock),
            mutation.id,
            workspaceId,
          );
        this.db
          .prepare(
            "UPDATE sync_heads SET clock_json=? WHERE workspace_id=? AND change_id=?",
          )
          .run(JSON.stringify(clock), workspaceId, mutation.id);
        this.db
          .prepare(
            "UPDATE sync_applied_changes SET fingerprint=? WHERE change_id=?",
          )
          .run(changeFingerprint(mutation), mutation.id);
      }
      if (rows.length)
        this.db
          .prepare(
            "INSERT INTO sync_sequences VALUES (?,?) ON CONFLICT(device_id) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)",
          )
          .run(deviceId, sequence);
    }
    this.db
      .prepare(
        "UPDATE sync_workspace_state SET local_device_id=?,setup_status='device_pending_keys',updated_at=? WHERE workspace_id=?",
      )
      .run(deviceId, now(), workspaceId);
  }

  resetWorkspace(workspaceId: string): void {
    const state = this.db
      .prepare(
        "SELECT local_device_id localDeviceId FROM sync_workspace_state WHERE workspace_id=?",
      )
      .get(workspaceId) as { localDeviceId: string } | undefined;
    if (!state) throw new Error("Workspace sync state not found");
    for (const table of [
      "sync_outbox",
      "sync_mutations",
      "sync_heads",
      "sync_conflicts",
      "sync_tombstones",
      "sync_attachment_manifests",
      "sync_attachment_chunks",
      "sync_attachment_missing_requests",
      "sync_attachment_outbound",
      "sync_quarantine",
      "sync_control_requests",
      "sync_snapshot_requests",
      "sync_snapshot_targets",
    ])
      this.db
        .prepare(`DELETE FROM ${table} WHERE workspace_id=?`)
        .run(workspaceId);
    this.db
      .prepare(
        "UPDATE sync_workspace_state SET local_device_id=?,setup_status='local_only',enabled=0,updated_at=? WHERE workspace_id=?",
      )
      .run(randomUUID(), now(), workspaceId);
  }

  enqueue(
    workspaceId: string,
    objectId: string,
    objectKind: string,
    operation: SyncOperation,
    payload: unknown,
    ownedIds: string[] = [],
  ): LocalMutation {
    this.ensureWorkspace(workspaceId);
    if (
      operation === "upsert" &&
      this.db
        .prepare(
          "SELECT 1 FROM sync_tombstones WHERE workspace_id=? AND object_id=?",
        )
        .get(workspaceId, objectId)
    )
      throw new Error("Tombstoned object identity cannot be resurrected");
    const state = this.db
      .prepare(
        "SELECT local_device_id deviceId FROM sync_workspace_state WHERE workspace_id=?",
      )
      .get(workspaceId) as { deviceId: string };
    const prior = this.db
      .prepare("SELECT sequence FROM sync_sequences WHERE device_id=?")
      .get(state.deviceId) as { sequence: number } | undefined;
    const sequence = (prior?.sequence ?? 0) + 1,
      head = this.db
        .prepare(
          "SELECT clock_json clock FROM sync_heads WHERE workspace_id=? AND object_id=?",
        )
        .get(workspaceId, objectId) as { clock: string } | undefined,
      clock = {
        ...(head ? (JSON.parse(head.clock) as CausalClock) : {}),
        [state.deviceId]: sequence,
      },
      id = randomUUID(),
      createdAt = now();
    this.db
      .prepare(
        "INSERT INTO sync_sequences VALUES (?,?) ON CONFLICT(device_id) DO UPDATE SET sequence=excluded.sequence",
      )
      .run(state.deviceId, sequence);
    if (operation === "delete") {
      this.db
        .prepare(
          "DELETE FROM sync_attachment_outbound WHERE workspace_id=? AND object_id=?",
        )
        .run(workspaceId, objectId);
      const purgeIds = [
          objectId,
          ...ownedIds.filter((value) => value !== objectId),
        ],
        placeholders = purgeIds.map(() => "?").join(",");
      this.db
        .prepare(
          `DELETE FROM sync_mutations WHERE workspace_id=? AND object_id IN (${placeholders}) AND operation='upsert'`,
        )
        .run(workspaceId, ...purgeIds);
      this.db
        .prepare(
          `DELETE FROM sync_outbox WHERE workspace_id=? AND object_id IN (${placeholders}) AND operation='upsert'`,
        )
        .run(workspaceId, ...purgeIds);
      const derivedIds = purgeIds.filter((value) => value !== objectId);
      if (derivedIds.length) {
        const derivedPlaceholders = derivedIds.map(() => "?").join(",");
        this.db
          .prepare(
            `DELETE FROM sync_heads WHERE workspace_id=? AND object_id IN (${derivedPlaceholders})`,
          )
          .run(workspaceId, ...derivedIds);
        this.db
          .prepare(
            `DELETE FROM sync_conflicts WHERE workspace_id=? AND object_id IN (${derivedPlaceholders})`,
          )
          .run(workspaceId, ...derivedIds);
      }
      this.db
        .prepare(
          "INSERT INTO sync_tombstones VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,object_id) DO UPDATE SET change_id=excluded.change_id,retain_until=excluded.retain_until,created_at=excluded.created_at",
        )
        .run(
          workspaceId,
          objectId,
          id,
          new Date(Date.now() + RETENTION_MS).toISOString(),
          createdAt,
        );
    }
    this.db
      .prepare("INSERT INTO sync_mutations VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        workspaceId,
        objectId,
        objectKind,
        operation,
        state.deviceId,
        sequence,
        JSON.stringify(clock),
        JSON.stringify(payload),
        createdAt,
      );
    const mutation = {
      id,
      workspaceId,
      objectId,
      objectKind,
      operation,
      deviceId: state.deviceId,
      sequence,
      clock,
      payload,
      createdAt,
    };
    this.db
      .prepare("INSERT INTO sync_applied_changes VALUES (?,?)")
      .run(id, changeFingerprint(mutation));
    this.convergeHead(mutation);
    return mutation;
  }

  pending(workspaceId: string): LocalMutation[] {
    const pending = (
      this.db
        .prepare(
          "SELECT * FROM sync_mutations WHERE workspace_id=? ORDER BY device_id,sequence",
        )
        .all(workspaceId) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      objectId: String(row.object_id),
      objectKind: String(row.object_kind),
      operation: row.operation as SyncOperation,
      deviceId: String(row.device_id),
      sequence: Number(row.sequence),
      clock: JSON.parse(String(row.clock_json)),
      payload: JSON.parse(String(row.payload_json)),
      createdAt: String(row.created_at),
    }));
    const ids = new Set(pending.map((item) => item.id)),
      resumable = (
        this.db
          .prepare(
            "SELECT mutation_json mutation FROM sync_attachment_outbound o WHERE workspace_id=? AND EXISTS(SELECT 1 FROM sync_attachment_missing_requests r WHERE r.workspace_id=o.workspace_id AND r.transfer_id=o.transfer_id)",
          )
          .all(workspaceId) as Array<{ mutation: string }>
      )
        .map((row) => JSON.parse(row.mutation) as LocalMutation)
        .filter((item) => !ids.has(item.id));
    return [...pending, ...resumable];
  }
  markRelayed(workspaceId: string, mutationId: string): void {
    const row = this.db
      .prepare("SELECT * FROM sync_mutations WHERE id=? AND workspace_id=?")
      .get(mutationId, workspaceId) as Record<string, unknown> | undefined;
    if (row) {
      if (row.object_kind === "attachment" && row.operation === "upsert") {
        const mutation: LocalMutation = {
          id: String(row.id),
          workspaceId: String(row.workspace_id),
          objectId: String(row.object_id),
          objectKind: String(row.object_kind),
          operation: row.operation as SyncOperation,
          deviceId: String(row.device_id),
          sequence: Number(row.sequence),
          clock: JSON.parse(String(row.clock_json)),
          payload: JSON.parse(String(row.payload_json)),
          createdAt: String(row.created_at),
        };
        this.db
          .prepare(
            "INSERT OR REPLACE INTO sync_attachment_outbound VALUES (?,?,?,?,?)",
          )
          .run(
            mutation.id,
            workspaceId,
            mutation.objectId,
            JSON.stringify(mutation),
            now(),
          );
      }
      this.db
        .prepare("DELETE FROM sync_mutations WHERE id=? AND workspace_id=?")
        .run(mutationId, workspaceId);
      this.db
        .prepare(
          "DELETE FROM sync_snapshot_targets WHERE mutation_id=? AND workspace_id=?",
        )
        .run(mutationId, workspaceId);
      return;
    }
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM sync_attachment_outbound WHERE transfer_id=? AND workspace_id=?",
        )
        .get(mutationId, workspaceId)
    )
      throw new Error("Pending sync mutation not found");
  }
  targetMutation(
    workspaceId: string,
    mutationId: string,
    recipientDeviceId: string,
  ): void {
    this.db
      .prepare("INSERT OR REPLACE INTO sync_snapshot_targets VALUES (?,?,?)")
      .run(mutationId, workspaceId, recipientDeviceId);
  }
  mutationTarget(workspaceId: string, mutationId: string): string | undefined {
    return (
      this.db
        .prepare(
          "SELECT recipient_device_id recipient FROM sync_snapshot_targets WHERE workspace_id=? AND mutation_id=?",
        )
        .get(workspaceId, mutationId) as { recipient: string } | undefined
    )?.recipient;
  }
  recordSnapshotRequest(
    workspaceId: string,
    requestId: string,
    ownerDeviceId: string,
  ): void {
    const cutoff = new Date(Date.now() - 86_400_000).toISOString();
    this.db
      .prepare("DELETE FROM sync_snapshot_requests WHERE created_at<?")
      .run(cutoff);
    const count = Number(
      (
        this.db
          .prepare(
            "SELECT count(*) count FROM sync_snapshot_requests WHERE workspace_id=?",
          )
          .get(workspaceId) as { count: number }
      ).count,
    );
    if (count >= 100)
      throw new Error("Outstanding snapshot request limit reached");
    this.db
      .prepare("INSERT INTO sync_snapshot_requests VALUES (?,?,?,?,NULL)")
      .run(requestId, workspaceId, ownerDeviceId, now());
  }
  consumeSnapshotResponse(
    workspaceId: string,
    requestId: string,
    ownerDeviceId: string,
  ): boolean {
    const cutoff = new Date(Date.now() - 86_400_000).toISOString();
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM sync_snapshot_requests WHERE request_id=? AND workspace_id=? AND owner_device_id=? AND created_at>=? AND consumed_at IS NULL",
        )
        .get(requestId, workspaceId, ownerDeviceId, cutoff),
    );
  }
  completeSnapshotResponse(
    workspaceId: string,
    requestId: string,
    ownerDeviceId: string,
  ): void {
    this.db
      .prepare(
        "UPDATE sync_snapshot_requests SET consumed_at=? WHERE request_id=? AND workspace_id=? AND owner_device_id=? AND consumed_at IS NULL",
      )
      .run(now(), requestId, workspaceId, ownerDeviceId);
  }
  removeSnapshotRequest(workspaceId: string, requestId: string): void {
    this.db
      .prepare(
        "DELETE FROM sync_snapshot_requests WHERE workspace_id=? AND request_id=? AND consumed_at IS NULL",
      )
      .run(workspaceId, requestId);
  }
  hasAppliedChange(changeId: string): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM sync_applied_changes WHERE change_id=?")
        .get(changeId),
    );
  }
  stageAttachment(
    changeId: string,
    workspaceId: string,
    payload: Record<string, unknown>,
    chunkCount: number,
  ): void {
    if (
      !Number.isSafeInteger(chunkCount) ||
      chunkCount < 1 ||
      chunkCount > 7 ||
      !Number.isSafeInteger(payload.bytes) ||
      Number(payload.bytes) < 1 ||
      Number(payload.bytes) > 25 * 1024 * 1024
    )
      throw new Error("Invalid attachment transfer bounds");
    this.db
      .prepare(
        "INSERT INTO sync_attachment_manifests VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(transfer_id) DO NOTHING",
      )
      .run(
        workspaceId,
        changeId,
        String(payload.id),
        String(payload.ownerId),
        String(payload.name),
        String(payload.mediaType),
        String(payload.sha256),
        Number(payload.bytes),
        chunkCount,
        String(payload.createdAt),
      );
  }
  acceptAttachmentChunk(
    workspaceId: string,
    transferId: string,
    index: number,
    total: number,
    plaintext: Uint8Array,
  ): {
    complete: boolean;
    manifest?: Record<string, unknown>;
    bytes?: Uint8Array;
  } {
    const manifest = this.db
      .prepare(
        "SELECT * FROM sync_attachment_manifests WHERE workspace_id=? AND transfer_id=?",
      )
      .get(workspaceId, transferId) as Record<string, unknown> | undefined;
    if (
      !manifest ||
      Number(manifest.chunk_count) !== total ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= total ||
      plaintext.byteLength > 4 * 1024 * 1024
    )
      throw new Error("Attachment chunk has no matching manifest");
    const stored = Number(
      (
        this.db
          .prepare(
            "SELECT COALESCE(SUM(length(plaintext)),0) bytes FROM sync_attachment_chunks WHERE workspace_id=? AND transfer_id=?",
          )
          .get(workspaceId, transferId) as { bytes: number }
      ).bytes,
    );
    if (stored + plaintext.byteLength > Number(manifest.total_bytes))
      throw new Error("Attachment chunks exceed manifest size");
    this.db
      .prepare(
        "INSERT OR IGNORE INTO sync_attachment_chunks VALUES (?,?,?,?,?)",
      )
      .run(workspaceId, transferId, index, total, Buffer.from(plaintext));
    const rows = this.db
      .prepare(
        "SELECT chunk_index,plaintext FROM sync_attachment_chunks WHERE workspace_id=? AND transfer_id=? ORDER BY chunk_index",
      )
      .all(workspaceId, transferId) as Array<{
      chunk_index: number;
      plaintext: Uint8Array;
    }>;
    if (rows.length !== total) return { complete: false };
    if (rows.some((row, expected) => row.chunk_index !== expected))
      throw new Error("Attachment chunk sequence is incomplete");
    const buffers = rows.map((row) => Buffer.from(row.plaintext)),
      bytes = Buffer.concat(buffers);
    if (
      bytes.byteLength !== Number(manifest.total_bytes) ||
      createHash("sha256").update(bytes).digest("hex") !==
        String(manifest.sha256)
    )
      throw new Error("Attachment transfer integrity mismatch");
    return { complete: true, manifest, bytes: new Uint8Array(bytes) };
  }
  finishAttachment(transferId: string): void {
    this.db
      .prepare("DELETE FROM sync_attachment_chunks WHERE transfer_id=?")
      .run(transferId);
    this.db
      .prepare("DELETE FROM sync_attachment_manifests WHERE transfer_id=?")
      .run(transferId);
  }
  missingAttachmentChunks(
    workspaceId: string,
    transferId: string,
    total: number,
  ): number[] {
    const received = new Set(
      (
        this.db
          .prepare(
            "SELECT chunk_index FROM sync_attachment_chunks WHERE workspace_id=? AND transfer_id=?",
          )
          .all(workspaceId, transferId) as Array<{ chunk_index: number }>
      ).map((row) => row.chunk_index),
    );
    return Array.from({ length: total }, (_, index) => index).filter(
      (index) => !received.has(index),
    );
  }
  recordAttachmentMissing(
    workspaceId: string,
    transferId: string,
    peerDeviceId: string,
    indices: number[],
  ): void {
    const cutoff = new Date(
      Date.now() -
        R0_PROTOCOL_CONTRACT.retention.relayEnvelopeMaximumDays * 86_400_000,
    ).toISOString();
    this.db
      .prepare("DELETE FROM sync_attachment_outbound WHERE retained_at<?")
      .run(cutoff);
    this.db
      .prepare(
        "DELETE FROM sync_attachment_missing_requests WHERE updated_at<?",
      )
      .run(cutoff);
    if (
      indices.length > 7 ||
      new Set(indices).size !== indices.length ||
      indices.some(
        (index) => !Number.isSafeInteger(index) || index < 0 || index > 6,
      ) ||
      !(
        this.db
          .prepare(
            "SELECT 1 FROM sync_attachment_outbound WHERE workspace_id=? AND transfer_id=?",
          )
          .get(workspaceId, transferId) ||
        this.db
          .prepare(
            "SELECT 1 FROM sync_mutations WHERE workspace_id=? AND id=? AND object_kind='attachment' AND operation='upsert'",
          )
          .get(workspaceId, transferId)
      )
    )
      throw new Error("Attachment missing-index request is invalid");
    this.db
      .prepare(
        "INSERT INTO sync_attachment_missing_requests VALUES (?,?,?,?,?) ON CONFLICT(transfer_id,peer_device_id) DO UPDATE SET indices_json=excluded.indices_json,updated_at=excluded.updated_at",
      )
      .run(
        workspaceId,
        transferId,
        peerDeviceId,
        JSON.stringify(indices),
        now(),
      );
  }
  requestedAttachmentChunks(
    workspaceId: string,
    transferId: string,
    peerDeviceId: string,
  ): number[] | undefined {
    const row = this.db
      .prepare(
        "SELECT indices_json indices FROM sync_attachment_missing_requests WHERE workspace_id=? AND transfer_id=? AND peer_device_id=?",
      )
      .get(workspaceId, transferId, peerDeviceId) as
      { indices: string } | undefined;
    return row ? (JSON.parse(row.indices) as number[]) : undefined;
  }
  clearAttachmentRequest(transferId: string, peerDeviceId: string): void {
    this.db
      .prepare(
        "DELETE FROM sync_attachment_missing_requests WHERE transfer_id=? AND peer_device_id=?",
      )
      .run(transferId, peerDeviceId);
  }
  quarantine(
    workspaceId: string,
    envelopeId: string,
    senderDeviceId: string,
    reasonCode: string,
  ): void {
    this.db
      .prepare("INSERT OR IGNORE INTO sync_quarantine VALUES (?,?,?,?,?)")
      .run(
        envelopeId,
        workspaceId,
        senderDeviceId,
        reasonCode.slice(0, 64),
        now(),
      );
  }
  consumeControlRequest(
    workspaceId: string,
    requestId: string,
    senderDeviceId: string,
  ): boolean {
    this.db
      .prepare("DELETE FROM sync_control_requests WHERE consumed_at<?")
      .run(new Date(Date.now() - 86_400_000).toISOString());
    const count = Number(
      (
        this.db
          .prepare(
            "SELECT count(*) count FROM sync_control_requests WHERE workspace_id=?",
          )
          .get(workspaceId) as { count: number }
      ).count,
    );
    if (count >= 1000) throw new Error("Snapshot request dedupe limit reached");
    return Boolean(
      this.db
        .prepare("INSERT OR IGNORE INTO sync_control_requests VALUES (?,?,?,?)")
        .run(requestId, workspaceId, senderDeviceId, now()).changes,
    );
  }
  cascadeTombstone(
    workspaceId: string,
    objectId: string,
    changeId: string,
  ): void {
    this.db
      .prepare(
        "DELETE FROM sync_conflicts WHERE workspace_id=? AND object_id=?",
      )
      .run(workspaceId, objectId);
    this.db
      .prepare("DELETE FROM sync_heads WHERE workspace_id=? AND object_id=?")
      .run(workspaceId, objectId);
    this.db
      .prepare(
        "INSERT INTO sync_tombstones VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,object_id) DO UPDATE SET change_id=excluded.change_id,retain_until=excluded.retain_until,created_at=excluded.created_at",
      )
      .run(
        workspaceId,
        objectId,
        changeId,
        new Date(Date.now() + RETENTION_MS).toISOString(),
        now(),
      );
  }
  head(
    workspaceId: string,
    objectId: string,
  ): Record<string, unknown> | undefined {
    const row = this.db
      .prepare(
        "SELECT object_kind objectKind,operation,change_id changeId,clock_json clock,payload_json payload FROM sync_heads WHERE workspace_id=? AND object_id=?",
      )
      .get(workspaceId, objectId) as Record<string, unknown> | undefined;
    return row
      ? {
          ...row,
          clock: JSON.parse(String(row.clock)),
          payload: JSON.parse(String(row.payload)),
        }
      : undefined;
  }

  recordInbound(
    change: InboundChange,
  ): "applied" | "conflict" | "ignored" | "replay" {
    const fingerprint = changeFingerprint(change),
      envelopeFingerprint = createHash("sha256")
        .update(`${change.envelopeId}:${fingerprint}`)
        .digest("hex");
    const priorEnvelope = this.db
      .prepare(
        "SELECT fingerprint FROM sync_envelope_fingerprints WHERE envelope_id=?",
      )
      .get(change.envelopeId) as { fingerprint: string } | undefined;
    if (priorEnvelope) {
      if (priorEnvelope.fingerprint !== envelopeFingerprint)
        throw new Error("Envelope ID collision with different content");
      return "replay";
    }
    const priorChange = this.db
      .prepare("SELECT fingerprint FROM sync_applied_changes WHERE change_id=?")
      .get(change.id) as { fingerprint: string } | undefined;
    if (priorChange) {
      if (priorChange.fingerprint !== fingerprint)
        throw new Error("Change ID collision with different content");
      this.db
        .prepare("INSERT INTO sync_envelope_fingerprints VALUES (?,?)")
        .run(change.envelopeId, envelopeFingerprint);
      this.db
        .prepare("INSERT INTO sync_inbox VALUES (?,?)")
        .run(change.envelopeId, now());
      return "replay";
    }
    this.db
      .prepare("INSERT INTO sync_envelope_fingerprints VALUES (?,?)")
      .run(change.envelopeId, envelopeFingerprint);
    this.db
      .prepare("INSERT INTO sync_applied_changes VALUES (?,?)")
      .run(change.id, fingerprint);
    this.db
      .prepare("INSERT INTO sync_inbox VALUES (?,?)")
      .run(change.envelopeId, now());
    const tombstoned = this.db
      .prepare(
        "SELECT 1 FROM sync_tombstones WHERE workspace_id=? AND object_id=?",
      )
      .get(change.workspaceId, change.objectId);
    if (tombstoned && change.operation !== "delete") return "ignored";
    if (change.operation === "delete") {
      this.convergeHead(change);
      this.db
        .prepare(
          "INSERT INTO sync_tombstones VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,object_id) DO UPDATE SET change_id=excluded.change_id,retain_until=excluded.retain_until,created_at=excluded.created_at",
        )
        .run(
          change.workspaceId,
          change.objectId,
          change.id,
          new Date(Date.now() + RETENTION_MS).toISOString(),
          now(),
        );
      return "applied";
    }
    return this.convergeHead(change);
  }
  private convergeHead(
    change: LocalMutation,
  ): "applied" | "conflict" | "ignored" {
    const existing = this.db
      .prepare(
        "SELECT object_kind objectKind,operation,change_id changeId,clock_json clock,payload_json payload FROM sync_heads WHERE workspace_id=? AND object_id=?",
      )
      .get(change.workspaceId, change.objectId) as
      | {
          objectKind: string;
          operation: SyncOperation;
          changeId: string;
          clock: string;
          payload: string;
        }
      | undefined;
    if (existing?.operation === "delete" && change.operation !== "delete")
      return "ignored";
    if (change.operation === "delete") {
      this.db
        .prepare(
          "DELETE FROM sync_conflicts WHERE workspace_id=? AND object_id=?",
        )
        .run(change.workspaceId, change.objectId);
      this.putHead(change);
      return "applied";
    }
    const stored = (
      this.db
        .prepare(
          "SELECT change_id changeId,object_kind objectKind,clock_json clock,payload_json payload FROM sync_conflicts WHERE workspace_id=? AND object_id=?",
        )
        .all(change.workspaceId, change.objectId) as Array<{
        changeId: string;
        objectKind: string;
        clock: string;
        payload: string;
      }>
    ).map((row) => ({
      ...row,
      clockValue: JSON.parse(row.clock) as CausalClock,
    }));
    if (stored.length) {
      if (
        stored.every((variant) => dominates(change.clock, variant.clockValue))
      ) {
        this.db
          .prepare(
            "DELETE FROM sync_conflicts WHERE workspace_id=? AND object_id=?",
          )
          .run(change.workspaceId, change.objectId);
        this.putHead(change);
        return "applied";
      }
      if (stored.some((variant) => dominates(variant.clockValue, change.clock)))
        return "ignored";
      this.db
        .prepare("INSERT OR IGNORE INTO sync_conflicts VALUES (?,?,?,?,?,?,?)")
        .run(
          change.workspaceId,
          change.objectId,
          change.id,
          change.objectKind,
          JSON.stringify(change.clock),
          JSON.stringify(change.payload),
          now(),
        );
      const canonical = [
        ...stored.map((variant) => variant.changeId),
        change.id,
      ].sort()[0];
      if (canonical === change.id) this.putHead(change);
      return "conflict";
    }
    if (!existing) {
      this.putHead(change);
      return "applied";
    }
    const currentClock = JSON.parse(existing.clock) as CausalClock;
    if (dominates(change.clock, currentClock)) {
      this.putHead(change);
      return "applied";
    }
    if (dominates(currentClock, change.clock)) return "ignored";
    if (!["document", "memory"].includes(change.objectKind)) {
      if (change.id.localeCompare(existing.changeId) > 0) this.putHead(change);
      return "applied";
    }
    this.db
      .prepare("INSERT OR IGNORE INTO sync_conflicts VALUES (?,?,?,?,?,?,?)")
      .run(
        change.workspaceId,
        change.objectId,
        existing.changeId,
        existing.objectKind,
        existing.clock,
        existing.payload,
        now(),
      );
    this.db
      .prepare("INSERT OR IGNORE INTO sync_conflicts VALUES (?,?,?,?,?,?,?)")
      .run(
        change.workspaceId,
        change.objectId,
        change.id,
        change.objectKind,
        JSON.stringify(change.clock),
        JSON.stringify(change.payload),
        now(),
      );
    if (change.id.localeCompare(existing.changeId) < 0) this.putHead(change);
    return "conflict";
  }
  private putHead(change: LocalMutation): void {
    this.db
      .prepare(
        "INSERT INTO sync_heads VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id,object_id) DO UPDATE SET object_kind=excluded.object_kind,operation=excluded.operation,change_id=excluded.change_id,clock_json=excluded.clock_json,payload_json=excluded.payload_json",
      )
      .run(
        change.workspaceId,
        change.objectId,
        change.objectKind,
        change.operation,
        change.id,
        JSON.stringify(change.clock),
        JSON.stringify(change.payload),
      );
  }
}
