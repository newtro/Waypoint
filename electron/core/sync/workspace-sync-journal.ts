import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {R0_PROTOCOL_CONTRACT} from './protocol-contract.js'
import type { CausalClock, InboundChange, LocalMutation, SyncOperation } from './sync-store.js'

const now=()=>new Date().toISOString()
const RETENTION_MS=R0_PROTOCOL_CONTRACT.retention.tombstoneMinimumDays*86_400_000

function dominates(left:CausalClock,right:CausalClock):boolean{const devices=new Set([...Object.keys(left),...Object.keys(right)]);let greater=false;for(const device of devices){const l=left[device]??0,r=right[device]??0;if(l<r)return false;if(l>r)greater=true}return greater}
function canonical(value:unknown):unknown{return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value}
function changeFingerprint(change:LocalMutation):string{return createHash('sha256').update(JSON.stringify(canonical({id:change.id,workspaceId:change.workspaceId,objectId:change.objectId,objectKind:change.objectKind,operation:change.operation,deviceId:change.deviceId,sequence:change.sequence,clock:change.clock,payload:change.payload,createdAt:change.createdAt}))).digest('hex')}

/** Uses the WorkspaceStore connection; callers supply the surrounding transaction. */
export class WorkspaceSyncJournal{
  constructor(private readonly db:DatabaseSync){this.migrate()}
  private migrate():void{this.db.exec(`
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
  `)}

  ensureWorkspace(workspaceId:string,status:'local_only'|'snapshot_required'='local_only'):void{
    this.db.prepare('INSERT OR IGNORE INTO sync_workspace_state VALUES (?,?,?,0,?)').run(workspaceId,randomUUID(),status,now())
  }

  status(workspaceId:string):Record<string,unknown>{
    const state=this.db.prepare('SELECT local_device_id localDeviceId,setup_status setupStatus,enabled,updated_at updatedAt FROM sync_workspace_state WHERE workspace_id=?').get(workspaceId) as Record<string,unknown>|undefined
    if(!state)throw new Error('Sync state not found for workspace')
    const count=(table:string)=>Number((this.db.prepare(`SELECT count(*) count FROM ${table} WHERE workspace_id=?`).get(workspaceId) as {count:number}).count)
    const conflictVariants=count('sync_conflicts'),conflicts=Number((this.db.prepare('SELECT count(DISTINCT object_id) count FROM sync_conflicts WHERE workspace_id=?').get(workspaceId) as {count:number}).count)
    return {...state,enabled:Boolean(state.enabled),pendingMutations:count('sync_mutations'),pendingEnvelopes:count('sync_outbox'),conflicts,conflictVariants,tombstones:count('sync_tombstones')}
  }

  configureDevice(workspaceId:string,deviceId:string):void{
    if(!deviceId.trim())throw new Error('Device identity required')
    const changed=this.db.prepare("UPDATE sync_workspace_state SET local_device_id=?,setup_status='device_pending_keys',updated_at=? WHERE workspace_id=?").run(deviceId,now(),workspaceId)
    if(!changed.changes)throw new Error('Workspace sync state not found')
  }

  enqueue(workspaceId:string,objectId:string,objectKind:string,operation:SyncOperation,payload:unknown,ownedIds:string[]=[]):LocalMutation{
    this.ensureWorkspace(workspaceId)
    if(operation==='upsert'&&this.db.prepare('SELECT 1 FROM sync_tombstones WHERE workspace_id=? AND object_id=?').get(workspaceId,objectId))throw new Error('Tombstoned object identity cannot be resurrected')
    const state=this.db.prepare('SELECT local_device_id deviceId FROM sync_workspace_state WHERE workspace_id=?').get(workspaceId) as {deviceId:string}
    const prior=this.db.prepare('SELECT sequence FROM sync_sequences WHERE device_id=?').get(state.deviceId) as {sequence:number}|undefined
    const sequence=(prior?.sequence??0)+1,clock={[state.deviceId]:sequence},id=randomUUID(),createdAt=now()
    this.db.prepare('INSERT INTO sync_sequences VALUES (?,?) ON CONFLICT(device_id) DO UPDATE SET sequence=excluded.sequence').run(state.deviceId,sequence)
    if(operation==='delete'){
      const purgeIds=[objectId,...ownedIds.filter((value)=>value!==objectId)],placeholders=purgeIds.map(()=>'?').join(',')
      this.db.prepare(`DELETE FROM sync_mutations WHERE workspace_id=? AND object_id IN (${placeholders}) AND operation='upsert'`).run(workspaceId,...purgeIds)
      this.db.prepare(`DELETE FROM sync_outbox WHERE workspace_id=? AND object_id IN (${placeholders}) AND operation='upsert'`).run(workspaceId,...purgeIds)
      const derivedIds=purgeIds.filter((value)=>value!==objectId)
      if(derivedIds.length){const derivedPlaceholders=derivedIds.map(()=>'?').join(',');this.db.prepare(`DELETE FROM sync_heads WHERE workspace_id=? AND object_id IN (${derivedPlaceholders})`).run(workspaceId,...derivedIds);this.db.prepare(`DELETE FROM sync_conflicts WHERE workspace_id=? AND object_id IN (${derivedPlaceholders})`).run(workspaceId,...derivedIds)}
      this.db.prepare('INSERT INTO sync_tombstones VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,object_id) DO UPDATE SET change_id=excluded.change_id,retain_until=excluded.retain_until,created_at=excluded.created_at').run(workspaceId,objectId,id,new Date(Date.now()+RETENTION_MS).toISOString(),createdAt)
    }
    this.db.prepare('INSERT INTO sync_mutations VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,workspaceId,objectId,objectKind,operation,state.deviceId,sequence,JSON.stringify(clock),JSON.stringify(payload),createdAt)
    const mutation={id,workspaceId,objectId,objectKind,operation,deviceId:state.deviceId,sequence,clock,payload,createdAt}
    this.db.prepare('INSERT INTO sync_applied_changes VALUES (?,?)').run(id,changeFingerprint(mutation))
    this.convergeHead(mutation)
    return mutation
  }

  pending(workspaceId:string):LocalMutation[]{return (this.db.prepare('SELECT * FROM sync_mutations WHERE workspace_id=? ORDER BY device_id,sequence').all(workspaceId) as Array<Record<string,unknown>>).map((row)=>({id:String(row.id),workspaceId:String(row.workspace_id),objectId:String(row.object_id),objectKind:String(row.object_kind),operation:row.operation as SyncOperation,deviceId:String(row.device_id),sequence:Number(row.sequence),clock:JSON.parse(String(row.clock_json)),payload:JSON.parse(String(row.payload_json)),createdAt:String(row.created_at)}))}
  head(workspaceId:string,objectId:string):Record<string,unknown>|undefined{const row=this.db.prepare('SELECT object_kind objectKind,operation,change_id changeId,clock_json clock,payload_json payload FROM sync_heads WHERE workspace_id=? AND object_id=?').get(workspaceId,objectId) as Record<string,unknown>|undefined;return row?{...row,clock:JSON.parse(String(row.clock)),payload:JSON.parse(String(row.payload))}:undefined}

  recordInbound(change:InboundChange):'applied'|'conflict'|'ignored'|'replay'{
    const fingerprint=changeFingerprint(change),envelopeFingerprint=createHash('sha256').update(`${change.envelopeId}:${fingerprint}`).digest('hex')
    const priorEnvelope=this.db.prepare('SELECT fingerprint FROM sync_envelope_fingerprints WHERE envelope_id=?').get(change.envelopeId) as {fingerprint:string}|undefined
    if(priorEnvelope){if(priorEnvelope.fingerprint!==envelopeFingerprint)throw new Error('Envelope ID collision with different content');return'replay'}
    const priorChange=this.db.prepare('SELECT fingerprint FROM sync_applied_changes WHERE change_id=?').get(change.id) as {fingerprint:string}|undefined
    if(priorChange){if(priorChange.fingerprint!==fingerprint)throw new Error('Change ID collision with different content');this.db.prepare('INSERT INTO sync_envelope_fingerprints VALUES (?,?)').run(change.envelopeId,envelopeFingerprint);this.db.prepare('INSERT INTO sync_inbox VALUES (?,?)').run(change.envelopeId,now());return'replay'}
    this.db.prepare('INSERT INTO sync_envelope_fingerprints VALUES (?,?)').run(change.envelopeId,envelopeFingerprint)
    this.db.prepare('INSERT INTO sync_applied_changes VALUES (?,?)').run(change.id,fingerprint)
    this.db.prepare('INSERT INTO sync_inbox VALUES (?,?)').run(change.envelopeId,now())
    const tombstoned=this.db.prepare('SELECT 1 FROM sync_tombstones WHERE workspace_id=? AND object_id=?').get(change.workspaceId,change.objectId)
    if(tombstoned&&change.operation!=='delete')return'ignored'
    if(change.operation==='delete'){
      this.convergeHead(change)
      this.db.prepare('INSERT INTO sync_tombstones VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,object_id) DO UPDATE SET change_id=excluded.change_id,retain_until=excluded.retain_until,created_at=excluded.created_at').run(change.workspaceId,change.objectId,change.id,new Date(Date.now()+RETENTION_MS).toISOString(),now());return'applied'
    }
    return this.convergeHead(change)
  }
  private convergeHead(change:LocalMutation):'applied'|'conflict'|'ignored'{
    const existing=this.db.prepare('SELECT object_kind objectKind,operation,change_id changeId,clock_json clock,payload_json payload FROM sync_heads WHERE workspace_id=? AND object_id=?').get(change.workspaceId,change.objectId) as {objectKind:string;operation:SyncOperation;changeId:string;clock:string;payload:string}|undefined
    if(existing?.operation==='delete'&&change.operation!=='delete')return'ignored'
    if(change.operation==='delete'){this.db.prepare('DELETE FROM sync_conflicts WHERE workspace_id=? AND object_id=?').run(change.workspaceId,change.objectId);this.putHead(change);return'applied'}
    const stored=(this.db.prepare('SELECT change_id changeId,object_kind objectKind,clock_json clock,payload_json payload FROM sync_conflicts WHERE workspace_id=? AND object_id=?').all(change.workspaceId,change.objectId) as Array<{changeId:string;objectKind:string;clock:string;payload:string}>).map((row)=>({...row,clockValue:JSON.parse(row.clock) as CausalClock}))
    if(stored.length){
      if(stored.every((variant)=>dominates(change.clock,variant.clockValue))){this.db.prepare('DELETE FROM sync_conflicts WHERE workspace_id=? AND object_id=?').run(change.workspaceId,change.objectId);this.putHead(change);return'applied'}
      if(stored.some((variant)=>dominates(variant.clockValue,change.clock)))return'ignored'
      this.db.prepare('INSERT OR IGNORE INTO sync_conflicts VALUES (?,?,?,?,?,?,?)').run(change.workspaceId,change.objectId,change.id,change.objectKind,JSON.stringify(change.clock),JSON.stringify(change.payload),now())
      const canonical=[...stored.map((variant)=>variant.changeId),change.id].sort()[0]
      if(canonical===change.id)this.putHead(change)
      return'conflict'
    }
    if(!existing){this.putHead(change);return'applied'}
    const currentClock=JSON.parse(existing.clock) as CausalClock
    if(dominates(change.clock,currentClock)){this.putHead(change);return'applied'}
    if(dominates(currentClock,change.clock))return'ignored'
    if(!['document','memory'].includes(change.objectKind)){if(change.id.localeCompare(existing.changeId)>0)this.putHead(change);return'applied'}
    this.db.prepare('INSERT OR IGNORE INTO sync_conflicts VALUES (?,?,?,?,?,?,?)').run(change.workspaceId,change.objectId,existing.changeId,existing.objectKind,existing.clock,existing.payload,now())
    this.db.prepare('INSERT OR IGNORE INTO sync_conflicts VALUES (?,?,?,?,?,?,?)').run(change.workspaceId,change.objectId,change.id,change.objectKind,JSON.stringify(change.clock),JSON.stringify(change.payload),now());if(change.id.localeCompare(existing.changeId)<0)this.putHead(change);return'conflict'
  }
  private putHead(change:LocalMutation):void{this.db.prepare('INSERT INTO sync_heads VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id,object_id) DO UPDATE SET object_kind=excluded.object_kind,operation=excluded.operation,change_id=excluded.change_id,clock_json=excluded.clock_json,payload_json=excluded.payload_json').run(change.workspaceId,change.objectId,change.objectKind,change.operation,change.id,JSON.stringify(change.clock),JSON.stringify(change.payload))}
}
