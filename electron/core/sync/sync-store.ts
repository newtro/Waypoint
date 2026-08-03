import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export type SyncOperation = 'upsert' | 'delete'
export type CausalClock = Record<string, number>

export interface LocalMutation {
  id: string
  workspaceId: string
  objectId: string
  objectKind: string
  operation: SyncOperation
  deviceId: string
  sequence: number
  clock: CausalClock
  payload: unknown
  createdAt: string
}

export interface InboundChange extends LocalMutation {
  envelopeId: string
}

export interface SyncHead {
  workspaceId: string
  objectId: string
  objectKind: string
  operation: SyncOperation
  changeId: string
  clock: CausalClock
  payload: unknown
}

const timestamp = () => new Date().toISOString()

function dominates(left: CausalClock, right: CausalClock): boolean {
  const devices = new Set([...Object.keys(left), ...Object.keys(right)])
  let greater = false
  for (const device of devices) {
    const l = left[device] ?? 0, r = right[device] ?? 0
    if (l < r) return false
    if (l > r) greater = true
  }
  return greater
}

/** Durable Phase 3 sync state. It deliberately owns no network listener. */
export class SyncStateStore {
  private readonly db: DatabaseSync

  constructor(readonly databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_devices(
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, label TEXT NOT NULL,
        signing_public_key TEXT NOT NULL, encryption_public_key TEXT NOT NULL,
        membership_epoch INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','revoked')),
        last_seen_at TEXT, presence_expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS sync_devices_workspace ON sync_devices(workspace_id,status);
      CREATE TABLE IF NOT EXISTS sync_sequences(device_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_mutations(
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, object_id TEXT NOT NULL, object_kind TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('upsert','delete')), device_id TEXT NOT NULL,
        sequence INTEGER NOT NULL, clock_json TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(device_id,sequence)
      );
      CREATE TABLE IF NOT EXISTS sync_outbox(
        envelope_id TEXT PRIMARY KEY, mutation_id TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL,
        object_id TEXT NOT NULL, operation TEXT NOT NULL, ciphertext BLOB NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_inbox(envelope_id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_heads(
        workspace_id TEXT NOT NULL, object_id TEXT NOT NULL, object_kind TEXT NOT NULL,
        operation TEXT NOT NULL, change_id TEXT NOT NULL, clock_json TEXT NOT NULL, payload_json TEXT NOT NULL,
        PRIMARY KEY(workspace_id,object_id)
      );
      CREATE TABLE IF NOT EXISTS sync_conflicts(
        workspace_id TEXT NOT NULL, object_id TEXT NOT NULL, change_id TEXT NOT NULL,
        object_kind TEXT NOT NULL, clock_json TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id,object_id,change_id)
      );
      CREATE TABLE IF NOT EXISTS sync_tombstones(
        workspace_id TEXT NOT NULL, object_id TEXT NOT NULL, change_id TEXT NOT NULL,
        retain_until TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,object_id)
      );
      CREATE TABLE IF NOT EXISTS sync_tombstone_acks(
        workspace_id TEXT NOT NULL, object_id TEXT NOT NULL, device_id TEXT NOT NULL, acked_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id,object_id,device_id)
      );
      CREATE TABLE IF NOT EXISTS sync_attachment_chunks(
        transfer_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, chunk_count INTEGER NOT NULL,
        ciphertext BLOB NOT NULL, ciphertext_hash TEXT NOT NULL, received_at TEXT NOT NULL,
        PRIMARY KEY(transfer_id,chunk_index)
      );
      CREATE TABLE IF NOT EXISTS sync_peer_requests(
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, requester_device_id TEXT NOT NULL,
        target_device_id TEXT NOT NULL, profile_id TEXT NOT NULL, expires_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','canceled')),
        created_at TEXT NOT NULL, decided_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sync_consumed_enrollments(request_id TEXT PRIMARY KEY,consumed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_consumed_peer_requests(request_id TEXT PRIMARY KEY,consumed_at TEXT NOT NULL);
    `)
  }

  close(): void { this.db.close() }
  hasEnrollment(requestId:string):boolean{return Boolean(this.db.prepare('SELECT 1 FROM sync_consumed_enrollments WHERE request_id=?').get(requestId))}
  consumeEnrollment(requestId:string):void{this.db.prepare('INSERT INTO sync_consumed_enrollments VALUES (?,?)').run(requestId,timestamp())}
  hasPeerRequest(requestId:string):boolean{return Boolean(this.db.prepare('SELECT 1 FROM sync_consumed_peer_requests WHERE request_id=?').get(requestId))}
  consumePeerRequest(requestId:string):void{this.db.prepare('INSERT INTO sync_consumed_peer_requests VALUES (?,?)').run(requestId,timestamp())}

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = operation(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  registerDevice(input: { id: string; workspaceId: string; label: string; signingPublicKey: string; encryptionPublicKey: string; membershipEpoch: number }): void {
    this.db.prepare('INSERT INTO sync_devices(id,workspace_id,label,signing_public_key,encryption_public_key,membership_epoch,status,created_at) VALUES (?,?,?,?,?,?,\'active\',?)')
      .run(input.id, input.workspaceId, input.label, input.signingPublicKey, input.encryptionPublicKey, input.membershipEpoch, timestamp())
  }

  setPresence(workspaceId: string, deviceId: string, expiresAt: string, at = timestamp()): void {
    const result = this.db.prepare("UPDATE sync_devices SET last_seen_at=?,presence_expires_at=? WHERE id=? AND workspace_id=? AND status='active'").run(at, expiresAt, deviceId, workspaceId)
    if (!result.changes) throw new Error('Active enrolled device required')
  }

  revokeDevice(workspaceId: string, deviceId: string, membershipEpoch: number): void {
    const result = this.db.prepare("UPDATE sync_devices SET status='revoked',membership_epoch=?,presence_expires_at=NULL,revoked_at=? WHERE id=? AND workspace_id=? AND status='active' AND membership_epoch<?")
      .run(membershipEpoch, timestamp(), deviceId, workspaceId, membershipEpoch)
    if (!result.changes) throw new Error('Revocation must advance an active device membership epoch')
    this.db.prepare("UPDATE sync_peer_requests SET status='canceled',decided_at=? WHERE workspace_id=? AND requester_device_id=? AND status='pending'").run(timestamp(), workspaceId, deviceId)
  }

  listDevices(workspaceId: string, at = timestamp()): Array<Record<string, unknown>> {
    return this.db.prepare("SELECT id,label,membership_epoch membershipEpoch,status,last_seen_at lastSeenAt,presence_expires_at presenceExpiresAt,CASE WHEN status='active' AND presence_expires_at>? THEN 1 ELSE 0 END online FROM sync_devices WHERE workspace_id=? ORDER BY created_at")
      .all(at, workspaceId) as Array<Record<string, unknown>>
  }

  queueMutation(input: Omit<LocalMutation, 'id'|'sequence'|'clock'|'createdAt'> & { clock?: CausalClock }): LocalMutation {
    return this.transaction(() => {
      const device = this.db.prepare("SELECT status FROM sync_devices WHERE id=? AND workspace_id=?").get(input.deviceId, input.workspaceId) as {status:string}|undefined
      if (device?.status !== 'active') throw new Error('Active enrolled device required')
      const current = this.db.prepare('SELECT sequence FROM sync_sequences WHERE device_id=?').get(input.deviceId) as {sequence:number}|undefined
      const sequence = (current?.sequence ?? 0) + 1
      this.db.prepare('INSERT INTO sync_sequences VALUES (?,?) ON CONFLICT(device_id) DO UPDATE SET sequence=excluded.sequence').run(input.deviceId, sequence)
      const clock = { ...(input.clock ?? {}), [input.deviceId]: sequence }
      const mutation: LocalMutation = { ...input, id: randomUUID(), sequence, clock, createdAt: timestamp() }
      if (input.operation === 'delete') {
        this.db.prepare("DELETE FROM sync_mutations WHERE workspace_id=? AND object_id=? AND operation='upsert'").run(input.workspaceId, input.objectId)
        this.db.prepare("DELETE FROM sync_outbox WHERE workspace_id=? AND object_id=? AND operation='upsert'").run(input.workspaceId, input.objectId)
      }
      this.db.prepare('INSERT INTO sync_mutations VALUES (?,?,?,?,?,?,?,?,?,?)').run(mutation.id, mutation.workspaceId, mutation.objectId, mutation.objectKind, mutation.operation, mutation.deviceId, mutation.sequence, JSON.stringify(mutation.clock), JSON.stringify(mutation.payload), mutation.createdAt)
      return mutation
    })
  }

  pendingMutations(workspaceId: string): LocalMutation[] {
    return (this.db.prepare('SELECT * FROM sync_mutations WHERE workspace_id=? ORDER BY device_id,sequence').all(workspaceId) as Array<Record<string,unknown>>).map((row) => ({
      id:String(row.id), workspaceId:String(row.workspace_id), objectId:String(row.object_id), objectKind:String(row.object_kind), operation:row.operation as SyncOperation,
      deviceId:String(row.device_id), sequence:Number(row.sequence), clock:JSON.parse(String(row.clock_json)) as CausalClock, payload:JSON.parse(String(row.payload_json)), createdAt:String(row.created_at),
    }))
  }

  promoteEncrypted(mutationId: string, envelopeId: string, ciphertext: Uint8Array): void {
    if (!ciphertext.length) throw new Error('Encrypted payload required')
    this.transaction(() => {
      const row = this.db.prepare('SELECT workspace_id,object_id,operation FROM sync_mutations WHERE id=?').get(mutationId) as {workspace_id:string;object_id:string;operation:string}|undefined
      if (!row) throw new Error('Pending mutation not found')
      this.db.prepare('INSERT INTO sync_outbox VALUES (?,?,?,?,?,?,?)').run(envelopeId, mutationId, row.workspace_id, row.object_id, row.operation, Buffer.from(ciphertext), timestamp())
      this.db.prepare('DELETE FROM sync_mutations WHERE id=?').run(mutationId)
    })
  }

  outbox(workspaceId: string): Array<{envelopeId:string;ciphertext:Uint8Array}> {
    return (this.db.prepare('SELECT envelope_id,ciphertext FROM sync_outbox WHERE workspace_id=? ORDER BY created_at').all(workspaceId) as Array<{envelope_id:string;ciphertext:Uint8Array}>).map((row)=>({envelopeId:row.envelope_id,ciphertext:new Uint8Array(row.ciphertext)}))
  }

  applyInbound(change: InboundChange): 'applied'|'conflict'|'ignored'|'replay' {
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM sync_inbox WHERE envelope_id=?').get(change.envelopeId)) return 'replay'
      this.db.prepare('INSERT INTO sync_inbox VALUES (?,?)').run(change.envelopeId, timestamp())
      const existing = this.head(change.workspaceId, change.objectId)
      if (existing?.operation === 'delete' && change.operation !== 'delete') return 'ignored'
      if (change.operation === 'delete') {
        this.db.prepare('DELETE FROM sync_conflicts WHERE workspace_id=? AND object_id=?').run(change.workspaceId, change.objectId)
        this.putHead(change)
        const retainUntil = new Date(Date.now() + 90 * 86_400_000).toISOString()
        this.db.prepare('INSERT INTO sync_tombstones VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,object_id) DO UPDATE SET change_id=excluded.change_id,retain_until=excluded.retain_until').run(change.workspaceId,change.objectId,change.id,retainUntil,timestamp())
        return 'applied'
      }
      const conflictRows=this.conflicts(change.workspaceId,change.objectId)
      if(conflictRows.length){
        if(conflictRows.every((variant)=>dominates(change.clock,variant.clock))){
          this.db.prepare('DELETE FROM sync_conflicts WHERE workspace_id=? AND object_id=?').run(change.workspaceId,change.objectId)
          this.putHead(change);return 'applied'
        }
        if(conflictRows.some((variant)=>dominates(variant.clock,change.clock)))return 'ignored'
        this.db.prepare('INSERT OR IGNORE INTO sync_conflicts VALUES (?,?,?,?,?,?,?)').run(change.workspaceId,change.objectId,change.id,change.objectKind,JSON.stringify(change.clock),JSON.stringify(change.payload),timestamp())
        return 'conflict'
      }
      if (!existing || dominates(change.clock, existing.clock)) { this.putHead(change); return 'applied' }
      if (dominates(existing.clock, change.clock)) return 'ignored'
      if (!['document','memory'].includes(change.objectKind)) {
        const winner = [existing.changeId, change.id].sort().at(-1)
        if (winner === change.id) this.putHead(change)
        return 'applied'
      }
      this.db.prepare('INSERT OR IGNORE INTO sync_conflicts VALUES (?,?,?,?,?,?,?)').run(change.workspaceId,change.objectId,existing.changeId,existing.objectKind,JSON.stringify(existing.clock),JSON.stringify(existing.payload),timestamp())
      this.db.prepare('INSERT OR IGNORE INTO sync_conflicts VALUES (?,?,?,?,?,?,?)').run(change.workspaceId,change.objectId,change.id,change.objectKind,JSON.stringify(change.clock),JSON.stringify(change.payload),timestamp())
      return 'conflict'
    })
  }

  head(workspaceId:string, objectId:string): SyncHead|undefined {
    const row=this.db.prepare('SELECT * FROM sync_heads WHERE workspace_id=? AND object_id=?').get(workspaceId,objectId) as Record<string,unknown>|undefined
    return row ? {workspaceId:String(row.workspace_id),objectId:String(row.object_id),objectKind:String(row.object_kind),operation:row.operation as SyncOperation,changeId:String(row.change_id),clock:JSON.parse(String(row.clock_json)) as CausalClock,payload:JSON.parse(String(row.payload_json))} : undefined
  }

  private putHead(change: LocalMutation): void {
    this.db.prepare('INSERT INTO sync_heads VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id,object_id) DO UPDATE SET object_kind=excluded.object_kind,operation=excluded.operation,change_id=excluded.change_id,clock_json=excluded.clock_json,payload_json=excluded.payload_json')
      .run(change.workspaceId,change.objectId,change.objectKind,change.operation,change.id,JSON.stringify(change.clock),JSON.stringify(change.payload))
  }

  conflicts(workspaceId:string, objectId:string): SyncHead[] {
    return (this.db.prepare('SELECT * FROM sync_conflicts WHERE workspace_id=? AND object_id=? ORDER BY change_id').all(workspaceId,objectId) as Array<Record<string,unknown>>).map((row)=>({workspaceId:String(row.workspace_id),objectId:String(row.object_id),objectKind:String(row.object_kind),operation:'upsert',changeId:String(row.change_id),clock:JSON.parse(String(row.clock_json)),payload:JSON.parse(String(row.payload_json))}))
  }

  acknowledgeTombstone(workspaceId:string, objectId:string, deviceId:string): void {
    const active=this.db.prepare("SELECT 1 FROM sync_devices WHERE id=? AND workspace_id=? AND status='active'").get(deviceId,workspaceId)
    if(!active)throw new Error('Only an active device can acknowledge a tombstone')
    this.db.prepare('INSERT OR REPLACE INTO sync_tombstone_acks VALUES (?,?,?,?)').run(workspaceId,objectId,deviceId,timestamp())
  }

  purgeEligibleTombstones(workspaceId:string, at=timestamp()): string[] {
    const active=(this.db.prepare("SELECT id FROM sync_devices WHERE workspace_id=? AND status='active'").all(workspaceId) as Array<{id:string}>).map((row)=>row.id)
    const candidates=this.db.prepare('SELECT object_id objectId FROM sync_tombstones WHERE workspace_id=? AND retain_until<=?').all(workspaceId,at) as Array<{objectId:string}>
    return candidates.filter(({objectId})=>active.every((deviceId)=>this.db.prepare('SELECT 1 FROM sync_tombstone_acks WHERE workspace_id=? AND object_id=? AND device_id=?').get(workspaceId,objectId,deviceId))).map((row)=>row.objectId)
  }
}
