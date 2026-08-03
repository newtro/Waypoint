import { createHash, randomUUID } from 'node:crypto'
import { chmodSync,existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, rmSync,statSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ExportArchive, GraphEdge, GraphNode, ObjectKind, SearchResult, WorkspaceSummary } from './types.js'
import { WorkspaceSyncJournal } from './sync/workspace-sync-journal.js'
import type { InboundChange, LocalMutation } from './sync/sync-store.js'
import { archiveIntegrity, validateArchive } from './backup.js'
import { assertSupportedSchema, createMigrationSnapshot, CURRENT_SCHEMA_VERSION, runMigrations, schemaVersion } from './migrations.js'
import { MAX_ATTACHMENT_BYTES,MAX_ATTACHMENTS_PER_OWNER,MAX_ATTACHMENTS_PER_WORKSPACE,prepareAttachmentForProvider as prepareProviderAttachment,readAndValidateAttachment,validateAttachment,type AttachmentMetadata,type ProviderAttachmentPreparation } from './chat-attachments.js'
import {extractSuggestions,SUGGESTION_EXTRACTOR,SUGGESTION_SCAN_LIMITS} from './derived-suggestions.js'
import {composeDailyBriefing,localDayAt,type DailyBriefing,type BriefingSource} from './daily-briefing.js'
import {extractRuleDirectives,RULE_EXTRACTOR} from './learned-rules.js'

const now = () => new Date().toISOString()
const contentDigest=(value:string)=>createHash('sha256').update(value).digest('hex')

export class WorkspaceStore {
  private readonly db: DatabaseSync
  private readonly attachmentRoot: string
  private readonly syncJournal: WorkspaceSyncJournal

  constructor(readonly databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true })
    this.attachmentRoot = path.join(path.dirname(databasePath), 'attachments')
    mkdirSync(this.attachmentRoot, { recursive: true,mode:0o700 });chmodSync(this.attachmentRoot,0o700)
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    const priorVersion = assertSupportedSchema(this.db)
    createMigrationSnapshot(this.db, databasePath, priorVersion)
    this.migrate()
    this.syncJournal=new WorkspaceSyncJournal(this.db)
    for(const workspace of this.db.prepare('SELECT id FROM workspaces').all() as Array<{id:string}>)this.syncJournal.ensureWorkspace(workspace.id)
    this.reconcileInterruptedExecutions()
    this.reconcileAttachmentFiles()
  }

  close(): void { this.db.close() }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT OR IGNORE INTO schema_versions VALUES (1, '${now()}');
      CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, local_path TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, title TEXT NOT NULL, current_revision_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, source_object_id TEXT, ownership TEXT NOT NULL DEFAULT 'workspace-owned', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS relationships(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(workspace_id,from_id,to_id,type));
      CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, owner_id TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL, sha256 TEXT NOT NULL, relative_path TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS embeddings(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, object_id TEXT NOT NULL, object_kind TEXT NOT NULL, revision_id TEXT, provider TEXT NOT NULL, provider_version TEXT NOT NULL, model TEXT NOT NULL, model_digest TEXT NOT NULL, dimensions INTEGER NOT NULL, chunking_digest TEXT NOT NULL, vector_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, category TEXT NOT NULL, action TEXT NOT NULL, object_id TEXT, object_kind TEXT, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tombstones(object_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, object_kind TEXT NOT NULL, deleted_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS queued_work(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, context_object_id TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS security_profiles(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, roots_json TEXT NOT NULL, filesystem TEXT NOT NULL, network TEXT NOT NULL, tools_json TEXT NOT NULL, approval TEXT NOT NULL, max_duration_ms INTEGER NOT NULL, max_concurrency INTEGER NOT NULL, peer_eligible INTEGER NOT NULL, secret_names_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(workspace_id,name));
      CREATE TABLE IF NOT EXISTS executions(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL, parent_execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL, cli TEXT NOT NULL CHECK(cli IN ('codex','claude')), executable TEXT, cli_version TEXT, model TEXT, device TEXT NOT NULL, security_profile_id TEXT NOT NULL REFERENCES security_profiles(id), prompt_sha256 TEXT NOT NULL, status TEXT NOT NULL, depth INTEGER NOT NULL, started_at TEXT, finished_at TEXT, exit_code INTEGER, error_code TEXT, error_message TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS execution_events(id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, type TEXT NOT NULL, text TEXT, name TEXT, raw_type TEXT, created_at TEXT NOT NULL, UNIQUE(execution_id,sequence));
      CREATE TABLE IF NOT EXISTS memory_suggestions(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,source_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,source_role TEXT NOT NULL,category TEXT NOT NULL, title TEXT NOT NULL,body TEXT NOT NULL,source_excerpt TEXT NOT NULL,source_digest TEXT NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,confidence REAL NOT NULL,extractor TEXT NOT NULL,extractor_version TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),accepted_object_id TEXT,resolved_at TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commitments(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,suggestion_id TEXT NOT NULL UNIQUE REFERENCES memory_suggestions(id) ON DELETE CASCADE,source_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,title TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','completed')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT);
      CREATE TABLE IF NOT EXISTS briefing_dismissals(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,source_id TEXT NOT NULL,source_kind TEXT NOT NULL CHECK(source_kind IN ('commitment','document','memory')),local_day TEXT NOT NULL,dismissed_at TEXT NOT NULL,PRIMARY KEY(workspace_id,source_id,source_kind,local_day));
      CREATE INDEX IF NOT EXISTS idx_briefing_dismissals_day ON briefing_dismissals(workspace_id,local_day);
      CREATE TRIGGER IF NOT EXISTS delete_commitment_briefing_dismissal AFTER DELETE ON commitments BEGIN DELETE FROM briefing_dismissals WHERE workspace_id=OLD.workspace_id AND source_id=OLD.id AND source_kind='commitment'; END;
      CREATE TRIGGER IF NOT EXISTS delete_document_briefing_dismissal AFTER DELETE ON documents BEGIN DELETE FROM briefing_dismissals WHERE workspace_id=OLD.workspace_id AND source_id=OLD.id AND source_kind='document'; END;
      CREATE TRIGGER IF NOT EXISTS delete_memory_briefing_dismissal AFTER DELETE ON memories BEGIN DELETE FROM briefing_dismissals WHERE workspace_id=OLD.workspace_id AND source_id=OLD.id AND source_kind='memory'; END;
      CREATE TABLE IF NOT EXISTS rule_suggestions(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,statement TEXT NOT NULL,normalized TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,scope TEXT NOT NULL CHECK(scope='workspace'),confidence REAL NOT NULL,extractor TEXT NOT NULL,extractor_version TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),last_dry_run_digest TEXT,last_dry_run_at TEXT,resolved_at TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rule_suggestion_sources(suggestion_id TEXT NOT NULL REFERENCES rule_suggestions(id) ON DELETE CASCADE,message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,excerpt TEXT NOT NULL,source_digest TEXT NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,PRIMARY KEY(suggestion_id,message_id));
      CREATE TABLE IF NOT EXISTS learned_rules(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,suggestion_id TEXT NOT NULL UNIQUE REFERENCES rule_suggestions(id) ON DELETE CASCADE,statement TEXT NOT NULL,scope TEXT NOT NULL CHECK(scope='workspace'),version INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),prior_enabled INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rule_outcomes(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,rule_id TEXT REFERENCES learned_rules(id) ON DELETE CASCADE,suggestion_id TEXT REFERENCES rule_suggestions(id) ON DELETE CASCADE,action TEXT NOT NULL,match_count INTEGER NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS invalidate_rule_after_source_delete AFTER DELETE ON rule_suggestion_sources WHEN (SELECT count(*) FROM rule_suggestion_sources WHERE suggestion_id=OLD.suggestion_id)<2 BEGIN DELETE FROM rule_suggestions WHERE id=OLD.suggestion_id; END;
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(workspace_id UNINDEXED, object_id UNINDEXED, object_kind UNINDEXED, revision_id UNINDEXED, title, body);
    `)
    const memoryColumns = this.db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>
    if (!memoryColumns.some((column) => column.name === 'ownership')) this.db.exec("ALTER TABLE memories ADD COLUMN ownership TEXT NOT NULL DEFAULT 'workspace-owned'")
    const ftsColumns = this.db.prepare('PRAGMA table_info(search_fts)').all() as Array<{ name: string }>
    if (!ftsColumns.some((column) => column.name === 'workspace_id')) {
      this.db.exec('DROP TABLE search_fts; CREATE VIRTUAL TABLE search_fts USING fts5(workspace_id UNINDEXED, object_id UNINDEXED, object_kind UNINDEXED, revision_id UNINDEXED, title, body);')
      this.db.exec(`
        INSERT INTO search_fts SELECT d.workspace_id,d.id,'document',r.id,d.title,r.body FROM documents d JOIN revisions r ON r.id=d.current_revision_id;
        INSERT INTO search_fts SELECT c.workspace_id,m.id,'message',NULL,c.title,m.body FROM messages m JOIN chats c ON c.id=m.chat_id;
        INSERT INTO search_fts SELECT workspace_id,id,'memory',NULL,title,body FROM memories;
        INSERT OR IGNORE INTO schema_versions VALUES (2, '${now()}');
      `)
    }
    this.db.prepare('INSERT OR IGNORE INTO schema_versions VALUES (?,?)').run(2, now())
    this.db.prepare('INSERT OR IGNORE INTO schema_versions VALUES (?,?)').run(3, now())
    this.db.prepare('INSERT OR IGNORE INTO schema_versions VALUES (?,?)').run(4, now())
    runMigrations(this.db, schemaVersion(this.db), [{ version: 5, apply: (database) => database.exec(`
      CREATE TABLE app_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    `) }, { version: 6, apply: (database) => { const columns=database.prepare('PRAGMA table_info(executions)').all() as Array<{name:string}>;if(!columns.some((column)=>column.name==='source_message_id'))database.exec('ALTER TABLE executions ADD COLUMN source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL') } }, {version:7,apply:(database)=>WorkspaceSyncJournal.install(database)},{version:8,apply:(database)=>database.exec(`CREATE TABLE IF NOT EXISTS memory_suggestions(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,source_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,source_role TEXT NOT NULL,category TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,source_excerpt TEXT NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,confidence REAL NOT NULL,extractor TEXT NOT NULL,extractor_version TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),accepted_object_id TEXT,resolved_at TEXT,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS commitments(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,suggestion_id TEXT NOT NULL UNIQUE REFERENCES memory_suggestions(id) ON DELETE CASCADE,source_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,title TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','completed')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT);`)}])
    runMigrations(this.db,schemaVersion(this.db),[{version:9,apply:(database)=>{
      const columns=database.prepare('PRAGMA table_info(memory_suggestions)').all() as Array<{name:string}>
      if(columns.some((column)=>column.name==='source_digest'))return
      database.exec("ALTER TABLE memory_suggestions ADD COLUMN source_digest TEXT NOT NULL DEFAULT ''")
      const legacy=database.prepare('SELECT s.id,s.status,s.chat_id chatId,s.source_role sourceRole,s.source_excerpt sourceExcerpt,s.start_offset startOffset,s.end_offset endOffset,m.body,m.role,m.chat_id messageChatId FROM memory_suggestions s JOIN messages m ON m.id=s.source_message_id').all() as Array<Record<string,unknown>>
      const update=database.prepare('UPDATE memory_suggestions SET source_digest=? WHERE id=?'),remove=database.prepare("DELETE FROM memory_suggestions WHERE id=? AND status='pending'")
      for(const item of legacy){const body=String(item.body),exact=String(item.sourceExcerpt)===body.slice(Number(item.startOffset),Number(item.endOffset))&&String(item.sourceRole)===String(item.role)&&String(item.chatId)===String(item.messageChatId);if(exact)update.run(contentDigest(body),String(item.id));else if(item.status==='pending')remove.run(String(item.id));else update.run('legacy-unverified',String(item.id))}
    }}])
    runMigrations(this.db,schemaVersion(this.db),[{version:10,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS briefing_dismissals(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,source_id TEXT NOT NULL,source_kind TEXT NOT NULL CHECK(source_kind IN ('commitment','document','memory')),local_day TEXT NOT NULL,dismissed_at TEXT NOT NULL,PRIMARY KEY(workspace_id,source_id,source_kind,local_day));CREATE INDEX IF NOT EXISTS idx_briefing_dismissals_day ON briefing_dismissals(workspace_id,local_day);CREATE TRIGGER IF NOT EXISTS delete_commitment_briefing_dismissal AFTER DELETE ON commitments BEGIN DELETE FROM briefing_dismissals WHERE workspace_id=OLD.workspace_id AND source_id=OLD.id AND source_kind='commitment'; END;CREATE TRIGGER IF NOT EXISTS delete_document_briefing_dismissal AFTER DELETE ON documents BEGIN DELETE FROM briefing_dismissals WHERE workspace_id=OLD.workspace_id AND source_id=OLD.id AND source_kind='document'; END;CREATE TRIGGER IF NOT EXISTS delete_memory_briefing_dismissal AFTER DELETE ON memories BEGIN DELETE FROM briefing_dismissals WHERE workspace_id=OLD.workspace_id AND source_id=OLD.id AND source_kind='memory'; END;")}])
    runMigrations(this.db,schemaVersion(this.db),[{version:11,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS rule_suggestions(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,statement TEXT NOT NULL,normalized TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,scope TEXT NOT NULL CHECK(scope='workspace'),confidence REAL NOT NULL,extractor TEXT NOT NULL,extractor_version TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),last_dry_run_digest TEXT,last_dry_run_at TEXT,resolved_at TEXT,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS rule_suggestion_sources(suggestion_id TEXT NOT NULL REFERENCES rule_suggestions(id) ON DELETE CASCADE,message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,excerpt TEXT NOT NULL,source_digest TEXT NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,PRIMARY KEY(suggestion_id,message_id));CREATE TABLE IF NOT EXISTS learned_rules(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,suggestion_id TEXT NOT NULL UNIQUE REFERENCES rule_suggestions(id) ON DELETE CASCADE,statement TEXT NOT NULL,scope TEXT NOT NULL CHECK(scope='workspace'),version INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),prior_enabled INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS rule_outcomes(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,rule_id TEXT REFERENCES learned_rules(id) ON DELETE CASCADE,suggestion_id TEXT REFERENCES rule_suggestions(id) ON DELETE CASCADE,action TEXT NOT NULL,match_count INTEGER NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL);CREATE TRIGGER IF NOT EXISTS invalidate_rule_after_source_delete AFTER DELETE ON rule_suggestion_sources WHEN (SELECT count(*) FROM rule_suggestion_sources WHERE suggestion_id=OLD.suggestion_id)<2 BEGIN DELETE FROM rule_suggestions WHERE id=OLD.suggestion_id; END;")}])
    for (const workspace of this.db.prepare('SELECT id,local_path localPath FROM workspaces').all() as Array<{id:string;localPath:string}>) {
      const executionRoot=path.join(workspace.localPath,'waypoint-workspaces',workspace.id);mkdirSync(executionRoot,{recursive:true})
      const existing=this.db.prepare("SELECT id FROM security_profiles WHERE workspace_id=? AND name='Workspace — conservative'").get(workspace.id)
      if(existing)this.db.prepare("UPDATE security_profiles SET roots_json=? WHERE workspace_id=? AND name='Workspace — conservative'").run(JSON.stringify([executionRoot]),workspace.id)
      else this.createDefaultSecurityProfile(workspace.id, workspace.localPath)
    }
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = operation(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  createWorkspace(name: string, localPath: string): WorkspaceSummary {
    if (!name.trim() || !path.isAbsolute(localPath)) throw new Error('Workspace name and absolute local path are required')
    const workspace = { id: randomUUID(), name: name.trim(), localPath: path.resolve(localPath), createdAt: now() }
    this.transaction(() => {
      this.db.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspace.id, workspace.name, workspace.localPath, workspace.createdAt)
      this.syncJournal.ensureWorkspace(workspace.id)
      this.createDefaultSecurityProfile(workspace.id, workspace.localPath)
      this.activity(workspace.id, 'workspace', 'created', workspace.id, 'workspace', { localPath: workspace.localPath })
    })
    return workspace
  }

  syncStatus(workspaceId:string):Record<string,unknown>{return this.syncJournal.status(workspaceId)}
  configureSyncDevice(workspaceId:string,deviceId:string):void{this.syncJournal.configureDevice(workspaceId,deviceId)}
  pendingSyncChanges(workspaceId:string):LocalMutation[]{return this.syncJournal.pending(workspaceId)}
  markSyncChangeRelayed(workspaceId:string,mutationId:string):void{this.syncJournal.markRelayed(workspaceId,mutationId)}
  queueFullSyncSnapshot(workspaceId:string,recipientDeviceId?:string,withinTransaction=false):number{const operation=()=>{this.syncJournal.status(workspaceId);let count=0;const queue=(id:string,kind:string,payload:Record<string,unknown>)=>{const mutation=this.syncJournal.enqueue(workspaceId,id,kind,'upsert',payload);if(recipientDeviceId)this.syncJournal.targetMutation(workspaceId,mutation.id,recipientDeviceId);count++};for(const row of this.db.prepare('SELECT d.id,d.title,d.created_at createdAt,d.updated_at updatedAt,r.id revisionId,r.body FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=?').all(workspaceId) as Array<Record<string,unknown>>)queue(String(row.id),'document',row);for(const row of this.db.prepare('SELECT id,title,created_at createdAt,updated_at updatedAt FROM chats WHERE workspace_id=? ORDER BY created_at').all(workspaceId) as Array<Record<string,unknown>>)queue(String(row.id),'chat',row);for(const row of this.db.prepare('SELECT m.id,m.chat_id chatId,m.role,m.body,m.created_at createdAt FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=? ORDER BY m.created_at').all(workspaceId) as Array<Record<string,unknown>>)queue(String(row.id),'message',row);for(const row of this.db.prepare('SELECT id,title,body,source_object_id sourceObjectId,ownership,created_at createdAt,updated_at updatedAt FROM memories WHERE workspace_id=?').all(workspaceId) as Array<Record<string,unknown>>)queue(String(row.id),'memory',row);for(const row of this.db.prepare('SELECT id,from_id fromId,to_id toId,type,created_at createdAt FROM relationships WHERE workspace_id=?').all(workspaceId) as Array<Record<string,unknown>>)queue(String(row.id),'relationship',row);for(const row of this.db.prepare('SELECT id,owner_id ownerId,name,media_type mediaType,sha256,created_at createdAt FROM attachments WHERE workspace_id=?').all(workspaceId) as Array<Record<string,unknown>>){const bytes=this.readSyncAttachment(workspaceId,String(row.id));queue(String(row.id),'attachment',{...row,bytes:bytes.byteLength})}return count};return withinTransaction?operation():this.transaction(operation)}
  syncHead(workspaceId:string,objectId:string):Record<string,unknown>|undefined{return this.syncJournal.head(workspaceId,objectId)}
  queueReplacementSnapshot(workspaceId:string,requestId:string,recipientDeviceId:string):number{const liveIds=this.canonicalObjectIds(workspaceId);if(liveIds.length>100_000)throw new Error('Workspace snapshot object limit exceeded');const tombstoneIds=(this.db.prepare('SELECT object_id objectId FROM tombstones WHERE workspace_id=?').all(workspaceId) as Array<{objectId:string}>).map((row)=>row.objectId);return this.transaction(()=>{const count=this.queueFullSyncSnapshot(workspaceId,recipientDeviceId,true),mutation=this.syncJournal.enqueue(workspaceId,requestId,'snapshot','upsert',{id:requestId,targetDeviceId:recipientDeviceId,liveIds,tombstoneIds});this.syncJournal.targetMutation(workspaceId,mutation.id,recipientDeviceId);return count+1})}
  acceptSnapshotRequest(workspaceId:string,requestId:string,senderDeviceId:string):boolean{return this.syncJournal.consumeControlRequest(workspaceId,requestId,senderDeviceId)}
  recordSnapshotRequest(workspaceId:string,requestId:string,ownerDeviceId:string):void{this.syncJournal.recordSnapshotRequest(workspaceId,requestId,ownerDeviceId)}
  acceptSnapshotResponse(workspaceId:string,requestId:string,ownerDeviceId:string):boolean{return this.syncJournal.consumeSnapshotResponse(workspaceId,requestId,ownerDeviceId)}
  completeSnapshotResponse(workspaceId:string,requestId:string,ownerDeviceId:string):void{this.syncJournal.completeSnapshotResponse(workspaceId,requestId,ownerDeviceId)}
  removeSnapshotRequest(workspaceId:string,requestId:string):void{this.syncJournal.removeSnapshotRequest(workspaceId,requestId)}
  hasAppliedSyncChange(changeId:string):boolean{return this.syncJournal.hasAppliedChange(changeId)}
  syncMutationRecipient(workspaceId:string,mutationId:string):string|undefined{return this.syncJournal.mutationTarget(workspaceId,mutationId)}
  applyInboundReplacementSnapshot(change:InboundChange):void{const payload=change.payload as Record<string,unknown>,liveIds=Array.isArray(payload.liveIds)?payload.liveIds.map(String):[],tombstoneIds=Array.isArray(payload.tombstoneIds)?payload.tombstoneIds.map(String):[];if(payload.id!==change.objectId||liveIds.length>100_000||tombstoneIds.length>100_000||new Set(liveIds).size!==liveIds.length||new Set(tombstoneIds).size!==tombstoneIds.length)throw new Error('Replacement snapshot manifest is invalid');const removeFiles:string[]=[];this.transaction(()=>{const outcome=this.syncJournal.recordInbound(change);if(outcome==='replay')return;const keep=new Set(liveIds);for(const id of this.canonicalObjectIds(change.workspaceId))if(!keep.has(id)){this.syncJournal.cascadeTombstone(change.workspaceId,id,change.id);this.materializeInboundDelete(change.workspaceId,id,'any',removeFiles)}for(const id of tombstoneIds)this.syncJournal.cascadeTombstone(change.workspaceId,id,change.id)});for(const file of removeFiles)rmSync(this.attachmentPath(file),{force:true})}
  recordInboundSyncChange(change:InboundChange):'applied'|'conflict'|'ignored'|'replay'{this.syncJournal.status(change.workspaceId);return this.transaction(()=>this.syncJournal.recordInbound(change))}
  applyInboundSyncChange(change:InboundChange,attachmentChunkCount?:number):'applied'|'conflict'|'ignored'|'replay'{if(change.objectKind==='snapshot'){this.applyInboundReplacementSnapshot(change);return'applied'}this.syncJournal.status(change.workspaceId);const removeFiles:string[]=[];const result=this.transaction(()=>{const outcome=this.syncJournal.recordInbound(change);if(outcome==='replay'||outcome==='ignored')return outcome;const head=this.syncJournal.head(change.workspaceId,change.objectId);if(!head)return outcome;if(head.operation==='delete'){const payload=change.payload as Record<string,unknown>,cascadeIds=Array.isArray(payload?.cascadeIds)?payload.cascadeIds.map(String):[change.objectId];if(cascadeIds.length>10_000||!cascadeIds.includes(change.objectId)||new Set(cascadeIds).size!==cascadeIds.length)throw new Error('Inbound cascade deletion is invalid');for(const id of cascadeIds){this.syncJournal.cascadeTombstone(change.workspaceId,id,change.id);this.materializeInboundDelete(change.workspaceId,id,id===change.objectId?change.objectKind:'any',removeFiles)}}else this.materializeInboundUpsert(change.workspaceId,change.objectId,String(head.objectKind),head.payload as Record<string,unknown>,String(head.changeId),attachmentChunkCount);return outcome});for(const file of removeFiles)rmSync(this.attachmentPath(file),{force:true});return result}
  readSyncAttachment(workspaceId:string,attachmentId:string):Uint8Array{const row=this.db.prepare('SELECT relative_path FROM attachments WHERE id=? AND workspace_id=?').get(attachmentId,workspaceId) as {relative_path:string}|undefined;if(!row)throw new Error('Sync attachment not found');return new Uint8Array(readFileSync(this.attachmentPath(row.relative_path)))}
  acceptInboundAttachmentChunk(workspaceId:string,transferId:string,index:number,total:number,plaintext:Uint8Array):boolean{const result=this.syncJournal.acceptAttachmentChunk(workspaceId,transferId,index,total,plaintext);if(!result.complete||!result.manifest||!result.bytes)return false;const manifest=result.manifest,id=String(manifest.attachment_id),validated=validateAttachment(String(manifest.name),String(manifest.media_type),result.bytes);if(validated.sha256!==String(manifest.sha256)||validated.bytes!==Number(manifest.total_bytes))throw new Error('Inbound attachment metadata mismatch');const relativePath=`${id}-${validated.safeName}`,target=this.attachmentPath(relativePath),temporary=`${target}.sync-partial`;writeFileSync(temporary,result.bytes,{flag:'wx',mode:0o600});try{rmSync(target,{force:true});renameSync(temporary,target);this.transaction(()=>{this.assertInboundIdentityAvailable(workspaceId,id);this.db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,name=excluded.name,media_type=excluded.media_type,sha256=excluded.sha256,relative_path=excluded.relative_path').run(id,workspaceId,String(manifest.owner_id),validated.safeName,String(manifest.media_type),validated.sha256,relativePath,String(manifest.created_at));this.syncJournal.finishAttachment(transferId)})}catch(error){rmSync(temporary,{force:true});rmSync(target,{force:true});throw error}return true}
  missingInboundAttachmentChunks(workspaceId:string,transferId:string,total:number):number[]{return this.syncJournal.missingAttachmentChunks(workspaceId,transferId,total)}
  recordOutboundAttachmentMissing(workspaceId:string,transferId:string,peerDeviceId:string,indices:number[]):void{this.syncJournal.recordAttachmentMissing(workspaceId,transferId,peerDeviceId,indices)}
  requestedOutboundAttachmentChunks(workspaceId:string,transferId:string,peerDeviceId:string):number[]|undefined{return this.syncJournal.requestedAttachmentChunks(workspaceId,transferId,peerDeviceId)}
  clearOutboundAttachmentRequest(transferId:string,peerDeviceId:string):void{this.syncJournal.clearAttachmentRequest(transferId,peerDeviceId)}
  quarantineInboundEnvelope(workspaceId:string,envelopeId:string,senderDeviceId:string,reasonCode:string):void{this.syncJournal.quarantine(workspaceId,envelopeId,senderDeviceId,reasonCode)}

  private materializeInboundUpsert(workspaceId:string,objectId:string,kind:string,payload:Record<string,unknown>,changeId:string,attachmentChunkCount?:number):void{const id=String(payload.id),createdAt=String(payload.createdAt??now()),updatedAt=String(payload.updatedAt??createdAt);if(id!==objectId||id.length<1||id.length>128)throw new Error('Inbound object identity is invalid');this.assertInboundIdentityAvailable(workspaceId,id);if(kind==='chat'){this.db.prepare('INSERT INTO chats VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at').run(id,workspaceId,String(payload.title),createdAt,updatedAt);return}if(kind==='message'){const chatId=String(payload.chatId);if(!this.db.prepare('SELECT 1 FROM chats WHERE id=? AND workspace_id=?').get(chatId,workspaceId))throw new Error('Inbound message chat is unavailable');this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(id,chatId,String(payload.role),String(payload.body),createdAt);const title=String((this.db.prepare('SELECT title FROM chats WHERE id=?').get(chatId) as {title:string}).title);this.db.prepare("DELETE FROM search_fts WHERE object_id=? AND object_kind='message'").run(id);this.indexText(workspaceId,id,'message',undefined,title,String(payload.body));return}if(kind==='document'){const revisionId=String(payload.revisionId??changeId);this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,current_revision_id=excluded.current_revision_id,updated_at=excluded.updated_at').run(id,workspaceId,String(payload.title),revisionId,createdAt,updatedAt);this.db.prepare('INSERT OR REPLACE INTO revisions VALUES (?,?,?,?)').run(revisionId,id,String(payload.body),updatedAt);this.db.prepare("DELETE FROM search_fts WHERE object_id=? AND object_kind='document'").run(id);this.indexText(workspaceId,id,'document',revisionId,String(payload.title),String(payload.body));return}if(kind==='memory'){const sourceId=payload.sourceObjectId?String(payload.sourceObjectId):null;if(sourceId&&!this.objectKindInWorkspace(workspaceId,sourceId))throw new Error('Inbound memory source is unavailable');this.db.prepare('INSERT INTO memories VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,source_object_id=excluded.source_object_id,ownership=excluded.ownership,updated_at=excluded.updated_at').run(id,workspaceId,String(payload.title),String(payload.body),sourceId,String(payload.ownership??'workspace-owned'),createdAt,updatedAt);this.db.prepare("DELETE FROM search_fts WHERE object_id=? AND object_kind='memory'").run(id);this.indexText(workspaceId,id,'memory',undefined,String(payload.title),String(payload.body));return}if(kind==='relationship'){if(!this.objectKindInWorkspace(workspaceId,String(payload.fromId))||!this.objectKindInWorkspace(workspaceId,String(payload.toId)))throw new Error('Inbound relationship endpoint is unavailable');this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET from_id=excluded.from_id,to_id=excluded.to_id,type=excluded.type').run(id,workspaceId,String(payload.fromId),String(payload.toId),String(payload.type),createdAt);return}if(kind==='attachment'){if(!attachmentChunkCount||attachmentChunkCount>Math.ceil(MAX_ATTACHMENT_BYTES/(4*1024*1024))||!Number.isSafeInteger(payload.bytes)||Number(payload.bytes)<1||Number(payload.bytes)>MAX_ATTACHMENT_BYTES||!this.objectKindInWorkspace(workspaceId,String(payload.ownerId)))throw new Error('Inbound attachment manifest violates limits');const workspaceCount=Number((this.db.prepare('SELECT count(*) count FROM attachments WHERE workspace_id=?').get(workspaceId) as {count:number}).count),ownerCount=Number((this.db.prepare('SELECT count(*) count FROM attachments WHERE workspace_id=? AND owner_id=?').get(workspaceId,String(payload.ownerId)) as {count:number}).count);if(workspaceCount>=MAX_ATTACHMENTS_PER_WORKSPACE||ownerCount>=MAX_ATTACHMENTS_PER_OWNER)throw new Error('Inbound attachment count limit reached');this.syncJournal.stageAttachment(changeId,workspaceId,payload,attachmentChunkCount);return}throw new Error('Unsupported inbound object kind')}
  private materializeInboundDelete(workspaceId:string,objectId:string,kind:string,removeFiles:string[]):void{const attachments=this.db.prepare('SELECT relative_path FROM attachments WHERE workspace_id=? AND (id=? OR owner_id=?)').all(workspaceId,objectId,objectId) as Array<{relative_path:string}>;removeFiles.push(...attachments.map((item)=>item.relative_path));this.db.prepare('DELETE FROM briefing_dismissals WHERE workspace_id=? AND source_id=?').run(workspaceId,objectId);this.db.prepare('DELETE FROM attachments WHERE workspace_id=? AND (id=? OR owner_id=?)').run(workspaceId,objectId,objectId);this.db.prepare('DELETE FROM relationships WHERE workspace_id=? AND (id=? OR from_id=? OR to_id=?)').run(workspaceId,objectId,objectId,objectId);this.db.prepare('DELETE FROM embeddings WHERE workspace_id=? AND object_id=?').run(workspaceId,objectId);this.db.prepare('DELETE FROM search_fts WHERE workspace_id=? AND object_id=?').run(workspaceId,objectId);if(kind==='message'||kind==='any')this.db.prepare('DELETE FROM messages WHERE id=? AND EXISTS(SELECT 1 FROM chats WHERE id=messages.chat_id AND workspace_id=?)').run(objectId,workspaceId);const selected=kind==='document'?'documents':kind==='chat'?'chats':kind==='memory'?'memories':kind==='relationship'?'relationships':kind==='attachment'?'attachments':undefined,tables=kind==='any'?['documents','chats','memories','relationships','attachments']:selected?[selected]:[];for(const table of tables)this.db.prepare(`DELETE FROM ${table} WHERE id=? AND workspace_id=?`).run(objectId,workspaceId);this.db.prepare('INSERT OR REPLACE INTO tombstones VALUES (?,?,?,?)').run(objectId,workspaceId,kind,now())}
  private assertInboundIdentityAvailable(workspaceId:string,id:string):void{for(const table of['documents','chats','memories','relationships','attachments']){const row=this.db.prepare(`SELECT workspace_id workspaceId FROM ${table} WHERE id=?`).get(id) as {workspaceId:string}|undefined;if(row&&row.workspaceId!==workspaceId)throw new Error('Inbound object identity belongs to another workspace')}const message=this.db.prepare('SELECT c.workspace_id workspaceId FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=?').get(id) as {workspaceId:string}|undefined;if(message&&message.workspaceId!==workspaceId)throw new Error('Inbound object identity belongs to another workspace')}
  private canonicalObjectIds(workspaceId:string):string[]{const ids:string[]=[];for(const table of['documents','chats','memories','relationships','attachments'])ids.push(...(this.db.prepare(`SELECT id FROM ${table} WHERE workspace_id=?`).all(workspaceId) as Array<{id:string}>).map((row)=>row.id));ids.push(...(this.db.prepare('SELECT m.id FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=?').all(workspaceId) as Array<{id:string}>).map((row)=>row.id));return ids}

  private createDefaultSecurityProfile(workspaceId: string, workspaceRoot: string): string {
    const id = randomUUID(), executionRoot=path.join(path.resolve(workspaceRoot),'waypoint-workspaces',workspaceId)
    mkdirSync(executionRoot,{recursive:true})
    this.db.prepare('INSERT INTO security_profiles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, workspaceId, 'Workspace — conservative', JSON.stringify([executionRoot]), 'read-only', 'provider-only', '[]', 'always', 120000, 1, 0, '[]', now())
    return id
  }

  listSecurityProfiles(workspaceId: string): Array<{id:string;name:string;roots:string[];filesystem:'read-only'|'workspace-write';network:'provider-only'|'disabled';tools:string[];approval:'always'|'on-write';maxDurationMs:number;maxConcurrency:number;peerEligible:boolean;secretNames:string[]}> {
    const rows = this.db.prepare('SELECT id,name,roots_json roots,filesystem,network,tools_json tools,approval,max_duration_ms maxDurationMs,max_concurrency maxConcurrency,peer_eligible peerEligible,secret_names_json secretNames FROM security_profiles WHERE workspace_id=? ORDER BY created_at').all(workspaceId) as Array<Record<string,unknown>>
    return rows.map((row) => ({...row, id:String(row.id),name:String(row.name),roots:JSON.parse(String(row.roots)),tools:JSON.parse(String(row.tools)),secretNames:JSON.parse(String(row.secretNames)),filesystem:row.filesystem as 'read-only'|'workspace-write',network:row.network as 'provider-only'|'disabled',approval:row.approval as 'always'|'on-write',maxDurationMs:Number(row.maxDurationMs),maxConcurrency:Number(row.maxConcurrency),peerEligible:Boolean(row.peerEligible)}))
  }

  createExecution(input: {workspaceId:string;chatId:string;sourceMessageId?:string;parentExecutionId?:string;cli:'codex'|'claude';model?:string;securityProfileId:string;prompt:string;depth?:number}): string {
    this.assertObjectInWorkspace(input.workspaceId, input.chatId, 'chat')
    const profile = this.db.prepare('SELECT id FROM security_profiles WHERE id=? AND workspace_id=?').get(input.securityProfileId,input.workspaceId)
    if (!profile) throw new Error('Security profile not found in workspace')
    if(input.sourceMessageId&&!this.db.prepare("SELECT 1 FROM messages WHERE id=? AND chat_id=? AND role='user'").get(input.sourceMessageId,input.chatId))throw new Error('Execution source message not found in chat')
    if (input.parentExecutionId) {
      const parent = this.db.prepare('SELECT depth FROM executions WHERE id=? AND workspace_id=? AND chat_id=?').get(input.parentExecutionId,input.workspaceId,input.chatId) as {depth:number}|undefined
      if (!parent || (input.depth ?? 0) !== parent.depth + 1) throw new Error('Invalid execution lineage')
    }
    const id=randomUUID(), timestamp=now()
    this.transaction(()=>{
      this.db.prepare('INSERT INTO executions(id,workspace_id,chat_id,source_message_id,parent_execution_id,cli,model,device,security_profile_id,prompt_sha256,status,depth,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.workspaceId,input.chatId,input.sourceMessageId??null,input.parentExecutionId??null,input.cli,input.model??null,'local',input.securityProfileId,createHash('sha256').update(input.prompt).digest('hex'),'queued',input.depth??0,timestamp)
      this.activity(input.workspaceId,'ai','execution.queued',id,'execution',{cli:input.cli,chatId:input.chatId,profileId:input.securityProfileId,parentExecutionId:input.parentExecutionId??null})
    })
    return id
  }

  startExecution(id:string, workspaceId:string, executable:string, version?:string): void {
    const result=this.db.prepare("UPDATE executions SET status='running',executable=?,cli_version=?,started_at=? WHERE id=? AND workspace_id=? AND status='queued'").run(executable,version??null,now(),id,workspaceId)
    if (!result.changes) throw new Error('Execution is not queued in workspace')
  }

  failQueuedExecution(id:string,workspaceId:string,error:string):void {
    const changed=this.db.prepare("UPDATE executions SET status='failed',finished_at=?,error_code='startup_failed',error_message=? WHERE id=? AND workspace_id=? AND status='queued'").run(now(),error.slice(0,8192),id,workspaceId)
    if(!changed.changes)throw new Error('Execution is not queued in workspace')
    this.activity(workspaceId,'ai','execution.failed',id,'execution',{phase:'startup'})
  }

  appendExecutionEvent(id:string, workspaceId:string, event:{type:string;text?:string;name?:string;rawType?:string}): void {
    const run=this.db.prepare('SELECT id FROM executions WHERE id=? AND workspace_id=?').get(id,workspaceId)
    if (!run) throw new Error('Execution not found in workspace')
    const sequence=(this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 next FROM execution_events WHERE execution_id=?').get(id) as {next:number}).next
    this.db.prepare('INSERT INTO execution_events VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),id,sequence,event.type,event.text??null,event.name??null,event.rawType??null,now())
  }

  finishExecution(id:string, workspaceId:string, result:{status:'completed'|'failed'|'canceled'|'timed_out';exitCode:number|null;error?:string}, assistantBody?:string): void {
    this.transaction(()=>{
      const execution=this.db.prepare('SELECT chat_id chatId FROM executions WHERE id=? AND workspace_id=?').get(id,workspaceId) as {chatId:string}|undefined
      const changed=this.db.prepare("UPDATE executions SET status=?,finished_at=?,exit_code=?,error_code=?,error_message=? WHERE id=? AND workspace_id=? AND status='running'").run(result.status,now(),result.exitCode,result.status==='failed'||result.status==='timed_out'?result.status:null,result.error?.slice(0,8192)??null,id,workspaceId)
      if (!changed.changes||!execution) throw new Error('Execution is not running in workspace')
      if(result.status==='completed'&&assistantBody?.trim()){
        const chat=this.db.prepare('SELECT title FROM chats WHERE id=? AND workspace_id=?').get(execution.chatId,workspaceId) as {title:string}|undefined
        if(!chat)throw new Error('Execution chat was deleted')
        const messageId=randomUUID(),timestamp=now(),body=assistantBody.trim()
        this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(messageId,execution.chatId,'assistant',body,timestamp)
        this.syncJournal.enqueue(workspaceId,messageId,'message','upsert',{id:messageId,chatId:execution.chatId,role:'assistant',body,createdAt:timestamp,executionId:id})
        this.db.prepare('UPDATE chats SET updated_at=? WHERE id=?').run(timestamp,execution.chatId)
        this.indexText(workspaceId,messageId,'message',undefined,chat.title,body)
        this.activity(workspaceId,'content','message.created',messageId,'message',{role:'assistant',executionId:id})
      }
      this.activity(workspaceId,'ai',`execution.${result.status}`,id,'execution',{exitCode:result.exitCode})
    })
  }

  listExecutions(workspaceId:string, chatId?:string): Array<Record<string,unknown>> {
    const rows=this.db.prepare(`SELECT e.id,e.chat_id chatId,e.source_message_id sourceMessageId,e.parent_execution_id parentExecutionId,e.cli,e.executable,e.cli_version cliVersion,e.model,e.device,e.security_profile_id securityProfileId,e.prompt_sha256 promptSha256,e.status,e.depth,e.started_at startedAt,e.finished_at finishedAt,e.exit_code exitCode,e.error_code errorCode,e.error_message errorMessage,e.created_at createdAt,p.name profileName FROM executions e JOIN security_profiles p ON p.id=e.security_profile_id WHERE e.workspace_id=? ${chatId?'AND e.chat_id=?':''} ORDER BY e.created_at DESC,e.rowid DESC`).all(...(chatId?[workspaceId,chatId]:[workspaceId])) as Array<Record<string,unknown>>
    return rows.map((run)=>({...run,events:this.db.prepare('SELECT sequence,type,text,name,raw_type rawType,created_at createdAt FROM execution_events WHERE execution_id=? ORDER BY sequence').all(String(run.id))}))
  }

  executionExists(workspaceId: string, id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM executions WHERE id=? AND workspace_id=?').get(id,workspaceId))
  }

  activeExecutionIds(workspaceId?:string,chatId?:string):string[]{
    let sql="SELECT id FROM executions WHERE status IN ('queued','running')";const args:string[]=[]
    if(workspaceId){sql+=' AND workspace_id=?';args.push(workspaceId)}
    if(chatId){sql+=' AND chat_id=?';args.push(chatId)}
    return (this.db.prepare(sql).all(...args) as Array<{id:string}>).map((row)=>row.id)
  }

  private reconcileInterruptedExecutions():void{
    const interrupted=this.db.prepare("SELECT id,workspace_id workspaceId,status FROM executions WHERE status IN ('queued','running')").all() as Array<{id:string;workspaceId:string;status:string}>
    if(!interrupted.length)return
    this.transaction(()=>{for(const run of interrupted){this.db.prepare("UPDATE executions SET status='failed',finished_at=?,error_code='interrupted',error_message='Waypoint stopped before this run reached a terminal state' WHERE id=?").run(now(),run.id);this.activity(run.workspaceId,'ai','execution.failed',run.id,'execution',{phase:'startup-reconciliation',priorStatus:run.status})}})
  }

  listWorkspaces(): WorkspaceSummary[] {
    return (this.db.prepare('SELECT id,name,local_path localPath,created_at createdAt FROM workspaces ORDER BY created_at').all() as unknown) as WorkspaceSummary[]
  }

  listDocuments(workspaceId: string): Array<{ id: string; title: string; body: string; revisionId: string; updatedAt: string }> {
    return this.db.prepare('SELECT d.id,d.title,r.body,r.id revisionId,d.updated_at updatedAt FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=? ORDER BY d.updated_at DESC').all(workspaceId) as unknown as Array<{ id: string; title: string; body: string; revisionId: string; updatedAt: string }>
  }

  listChats(workspaceId: string): Array<{ id: string; title: string; updatedAt: string; messages: Array<{ id: string; role: string; body: string; createdAt: string }> }> {
    const chats = this.db.prepare('SELECT id,title,updated_at updatedAt FROM chats WHERE workspace_id=? ORDER BY updated_at DESC').all(workspaceId) as Array<{ id: string; title: string; updatedAt: string }>
    return chats.map((chat) => ({ ...chat, messages: this.db.prepare('SELECT id,role,body,created_at createdAt FROM messages WHERE chat_id=? ORDER BY created_at').all(chat.id) as Array<{ id: string; role: string; body: string; createdAt: string }> }))
  }

  listMemories(workspaceId: string): Array<{ id: string; title: string; body: string; sourceObjectId?: string; ownership: string; updatedAt: string }> {
    return this.db.prepare('SELECT id,title,body,source_object_id sourceObjectId,ownership,updated_at updatedAt FROM memories WHERE workspace_id=? ORDER BY updated_at DESC').all(workspaceId) as unknown as Array<{ id: string; title: string; body: string; sourceObjectId?: string; ownership: string; updatedAt: string }>
  }

  scanMemorySuggestions(workspaceId:string,chatId?:string):number{if(chatId)this.assertObjectInWorkspace(workspaceId,chatId,'chat');const rows=this.db.prepare(`SELECT m.id messageId,m.role,CASE WHEN length(m.body)<=? THEN m.body ELSE NULL END body,m.chat_id chatId FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=? ${chatId?'AND c.id=?':''} AND m.role!='system' ORDER BY m.created_at DESC LIMIT ?`).all(SUGGESTION_SCAN_LIMITS.maxMessageCharacters,...(chatId?[workspaceId,chatId]:[workspaceId]),SUGGESTION_SCAN_LIMITS.maxMessages) as Array<{messageId:string;role:string;body:string|null;chatId:string}>;let created=0,scannedCharacters=0;this.transaction(()=>{for(const row of rows){if(row.body===null)continue;if(scannedCharacters+row.body.length>SUGGESTION_SCAN_LIMITS.maxTotalCharacters)break;scannedCharacters+=row.body.length;const digest=contentDigest(row.body);for(const candidate of extractSuggestions(row.messageId,row.body)){if(candidate.confidence<SUGGESTION_EXTRACTOR.threshold||(candidate.category==='commitment'&&row.role!=='user'))continue;const result=this.db.prepare("INSERT OR IGNORE INTO memory_suggestions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',NULL,NULL,?)").run(randomUUID(),workspaceId,row.chatId,row.messageId,row.role,candidate.category,candidate.title,candidate.body,candidate.sourceExcerpt,digest,candidate.startOffset,candidate.endOffset,candidate.confidence,SUGGESTION_EXTRACTOR.provider,SUGGESTION_EXTRACTOR.version,candidate.fingerprint,now());created+=Number(result.changes);if(created>=SUGGESTION_EXTRACTOR.maxPerScan)break}if(created>=SUGGESTION_EXTRACTOR.maxPerScan)break}if(created)this.activity(workspaceId,'knowledge','suggestions.scanned',workspaceId,'workspace',{created,extractor:SUGGESTION_EXTRACTOR.provider,version:SUGGESTION_EXTRACTOR.version,scannedCharacters})});return created}

  listMemorySuggestions(workspaceId:string,status:'pending'|'accepted'|'rejected'='pending'):Array<Record<string,unknown>>{return this.db.prepare('SELECT id,chat_id chatId,source_message_id sourceMessageId,source_role sourceRole,category,title,body,source_excerpt sourceExcerpt,start_offset startOffset,end_offset endOffset,confidence,extractor,extractor_version extractorVersion,status,accepted_object_id acceptedObjectId,resolved_at resolvedAt,created_at createdAt FROM memory_suggestions WHERE workspace_id=? AND status=? ORDER BY confidence DESC,created_at DESC').all(workspaceId,status) as Array<Record<string,unknown>>}

  resolveMemorySuggestion(workspaceId:string,suggestionId:string,action:'accept'|'reject',edited?:{title:string;body:string}):{acceptedObjectId?:string;kind?:'memory'|'commitment'}{
    return this.transaction(()=>{
      const suggestion=this.db.prepare("SELECT s.*,m.body source_body,m.role current_source_role,m.chat_id current_chat_id FROM memory_suggestions s JOIN messages m ON m.id=s.source_message_id JOIN chats c ON c.id=m.chat_id WHERE s.id=? AND s.workspace_id=? AND c.workspace_id=? AND s.status='pending'").get(suggestionId,workspaceId,workspaceId) as Record<string,unknown>|undefined
      if(!suggestion)throw new Error('Pending suggestion or source not found')
      const sourceId=String(suggestion.source_message_id),sourceBody=String(suggestion.source_body),start=Number(suggestion.start_offset),end=Number(suggestion.end_offset)
      if(String(suggestion.source_digest)!==contentDigest(sourceBody)||String(suggestion.source_excerpt)!==sourceBody.slice(start,end)||String(suggestion.source_role)!==String(suggestion.current_source_role)||String(suggestion.chat_id)!==String(suggestion.current_chat_id))throw new Error('Suggestion source changed; scan the conversation again')
      if(action==='reject'){this.db.prepare("UPDATE memory_suggestions SET status='rejected',resolved_at=? WHERE id=? AND workspace_id=? AND status='pending'").run(now(),suggestionId,workspaceId);this.activity(workspaceId,'knowledge','suggestion.rejected',suggestionId,'suggestion',{category:suggestion.category});return{}}
      const title=(edited?.title??String(suggestion.title)).trim().slice(0,300)||'Memory',body=(edited?.body??String(suggestion.body)).slice(0,10_000),timestamp=now()
      if(!body.trim())throw new Error('Accepted suggestion body is required')
      if(String(suggestion.category)==='commitment'){const id=randomUUID();this.db.prepare('INSERT INTO commitments VALUES (?,?,?,?,?,?,?,?,?,NULL)').run(id,workspaceId,suggestionId,sourceId,title,body,'open',timestamp,timestamp);this.db.prepare("UPDATE memory_suggestions SET status='accepted',accepted_object_id=?,resolved_at=? WHERE id=? AND status='pending'").run(id,timestamp,suggestionId);this.activity(workspaceId,'knowledge','commitment.accepted',id,'commitment',{suggestionId,sourceMessageId:sourceId});return{acceptedObjectId:id,kind:'commitment'}}
      const id=randomUUID(),relationshipId=randomUUID()
      this.db.prepare('INSERT INTO memories(id,workspace_id,title,body,source_object_id,ownership,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,workspaceId,title,body,sourceId,'workspace-owned',timestamp,timestamp)
      this.syncJournal.enqueue(workspaceId,id,'memory','upsert',{id,title,body,sourceObjectId:sourceId,ownership:'workspace-owned',createdAt:timestamp,updatedAt:timestamp});this.indexText(workspaceId,id,'memory',undefined,title,body)
      this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(relationshipId,workspaceId,sourceId,id,'derived_from',timestamp);this.syncJournal.enqueue(workspaceId,relationshipId,'relationship','upsert',{id:relationshipId,fromId:sourceId,toId:id,type:'derived_from',createdAt:timestamp})
      this.db.prepare("UPDATE memory_suggestions SET status='accepted',accepted_object_id=?,resolved_at=? WHERE id=? AND status='pending'").run(id,timestamp,suggestionId);this.activity(workspaceId,'knowledge','suggestion.accepted',id,'memory',{suggestionId,category:suggestion.category,sourceMessageId:sourceId});return{acceptedObjectId:id,kind:'memory'}
    })
  }

  listCommitments(workspaceId:string):Array<Record<string,unknown>>{return this.db.prepare('SELECT c.id,c.suggestion_id suggestionId,c.source_message_id sourceMessageId,c.title,c.body,c.status,c.created_at createdAt,c.updated_at updatedAt,c.completed_at completedAt,s.source_excerpt sourceExcerpt FROM commitments c JOIN memory_suggestions s ON s.id=c.suggestion_id WHERE c.workspace_id=? ORDER BY CASE c.status WHEN \'open\' THEN 0 ELSE 1 END,c.updated_at DESC').all(workspaceId) as Array<Record<string,unknown>>}

  setCommitmentCompleted(workspaceId:string,commitmentId:string,completed:boolean):void{const timestamp=now(),result=this.db.prepare("UPDATE commitments SET status=?,updated_at=?,completed_at=? WHERE id=? AND workspace_id=?").run(completed?'completed':'open',timestamp,completed?timestamp:null,commitmentId,workspaceId);if(!result.changes)throw new Error('Commitment not found');this.activity(workspaceId,'knowledge',completed?'commitment.completed':'commitment.reopened',commitmentId,'commitment',{})}

  composeDailyBriefing(workspaceId:string,timezone:string,instant=now()):DailyBriefing{
    if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found')
    const localDay=localDayAt(instant,timezone)
    const commitments=this.db.prepare("SELECT c.id,'commitment' kind,c.title,substr(c.body,1,4000) detail,length(c.body)>4000 detailTruncated,0 missingSource,c.updated_at updatedAt FROM commitments c WHERE c.workspace_id=? AND c.status='open' AND NOT EXISTS(SELECT 1 FROM briefing_dismissals b WHERE b.workspace_id=c.workspace_id AND b.source_id=c.id AND b.source_kind='commitment' AND b.local_day=?) ORDER BY c.updated_at DESC,c.id ASC LIMIT 31").all(workspaceId,localDay) as unknown as BriefingSource[]
    const documents=(this.db.prepare("SELECT d.id,'document' kind,d.title,substr(COALESCE(r.body,''),1,4000) detail,length(COALESCE(r.body,''))>4000 detailTruncated,r.id IS NULL missingSource,d.updated_at updatedAt FROM documents d LEFT JOIN revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=? AND NOT EXISTS(SELECT 1 FROM briefing_dismissals b WHERE b.workspace_id=d.workspace_id AND b.source_id=d.id AND b.source_kind='document' AND b.local_day=?) ORDER BY d.updated_at DESC,d.id ASC LIMIT 51").all(workspaceId,localDay) as unknown as Array<Omit<BriefingSource,'missingSource'|'detailTruncated'>&{missingSource:number;detailTruncated:number}>).map((item):BriefingSource=>({...item,missingSource:Boolean(item.missingSource),detailTruncated:Boolean(item.detailTruncated)}))
    const memories=this.db.prepare("SELECT m.id,'memory' kind,m.title,substr(m.body,1,4000) detail,length(m.body)>4000 detailTruncated,0 missingSource,m.updated_at updatedAt FROM memories m WHERE m.workspace_id=? AND NOT EXISTS(SELECT 1 FROM briefing_dismissals b WHERE b.workspace_id=m.workspace_id AND b.source_id=m.id AND b.source_kind='memory' AND b.local_day=?) ORDER BY m.updated_at DESC,m.id ASC LIMIT 51").all(workspaceId,localDay) as unknown as BriefingSource[]
    const briefing=composeDailyBriefing([...commitments,...documents,...memories],new Set(),instant,timezone)
    const counts=this.db.prepare("SELECT (SELECT count(*) FROM commitments WHERE workspace_id=? AND status='open') openCommitments,(SELECT count(*) FROM documents WHERE workspace_id=?) documents,(SELECT count(*) FROM memories WHERE workspace_id=?) memories,(SELECT count(*) FROM documents d LEFT JOIN revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=? AND r.id IS NULL) missingSources,(SELECT count(*) FROM briefing_dismissals b WHERE b.workspace_id=? AND b.local_day=? AND ((b.source_kind='commitment' AND EXISTS(SELECT 1 FROM commitments c WHERE c.id=b.source_id AND c.workspace_id=b.workspace_id AND c.status='open')) OR (b.source_kind='document' AND EXISTS(SELECT 1 FROM documents d WHERE d.id=b.source_id AND d.workspace_id=b.workspace_id)) OR (b.source_kind='memory' AND EXISTS(SELECT 1 FROM memories m WHERE m.id=b.source_id AND m.workspace_id=b.workspace_id)))) dismissed").get(workspaceId,workspaceId,workspaceId,workspaceId,workspaceId,localDay) as {openCommitments:number;documents:number;memories:number;missingSources:number;dismissed:number}
    briefing.coverage={...counts,omittedByLimit:Math.max(0,counts.openCommitments+counts.documents+counts.memories-counts.dismissed-briefing.items.length)}
    if(counts.missingSources)briefing.omissions.push(`${counts.missingSources} local note source${counts.missingSources===1?' is':'s are'} missing its current revision; content could not be shown.`)
    return briefing
  }

  dismissBriefingItem(workspaceId:string,sourceId:string,sourceKind:'commitment'|'document'|'memory',localDay:string):void{const parsedDay=new Date(`${localDay}T12:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(localDay)||!Number.isFinite(parsedDay.valueOf())||parsedDay.toISOString().slice(0,10)!==localDay)throw new Error('Briefing day is invalid');const exists=sourceKind==='commitment'?this.db.prepare('SELECT 1 FROM commitments WHERE id=? AND workspace_id=?').get(sourceId,workspaceId):this.db.prepare(`SELECT 1 FROM ${sourceKind==='document'?'documents':'memories'} WHERE id=? AND workspace_id=?`).get(sourceId,workspaceId);if(!exists)throw new Error('Briefing source not found');this.transaction(()=>{const result=this.db.prepare('INSERT OR IGNORE INTO briefing_dismissals VALUES (?,?,?,?,?)').run(workspaceId,sourceId,sourceKind,localDay,now());if(result.changes)this.activity(workspaceId,'briefing','item.dismissed',sourceId,sourceKind,{localDay})})}

  scanRuleSuggestions(workspaceId:string):number{
    if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found')
    const rows=this.db.prepare("SELECT m.id messageId,m.chat_id chatId,CASE WHEN length(m.body)<=100000 THEN m.body ELSE NULL END body FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=? AND m.role='user' ORDER BY m.created_at DESC,m.id ASC LIMIT ?").all(workspaceId,RULE_EXTRACTOR.maxMessages) as Array<{messageId:string;chatId:string;body:string|null}>,groups=new Map<string,Array<{messageId:string;chatId:string;statement:string;excerpt:string;sourceDigest:string;startOffset:number;endOffset:number}>>()
    let characters=0
    for(const row of rows){if(row.body===null)continue;if(characters+row.body.length>RULE_EXTRACTOR.maxCharacters)break;characters+=row.body.length;for(const item of extractRuleDirectives(row.body)){const list=groups.get(item.normalized)??[];if(!list.some((source)=>source.messageId===row.messageId))list.push({...item,messageId:row.messageId,chatId:row.chatId});groups.set(item.normalized,list)}}
    let created=0
    this.transaction(()=>{this.reconcileRuleProvenance(workspaceId);for(const [normalized,sources] of [...groups].sort(([left],[right])=>left.localeCompare(right))){if(sources.length<2||created>=RULE_EXTRACTOR.maxCandidates)continue;const fingerprint=contentDigest(JSON.stringify([workspaceId,RULE_EXTRACTOR.provider,RULE_EXTRACTOR.version,normalized])),proposedId=randomUUID(),timestamp=now(),result=this.db.prepare("INSERT OR IGNORE INTO rule_suggestions VALUES (?,?,?,?,?,'workspace',?,?,?,'pending',NULL,NULL,NULL,?)").run(proposedId,workspaceId,sources[0].statement,normalized,fingerprint,RULE_EXTRACTOR.confidence,RULE_EXTRACTOR.provider,RULE_EXTRACTOR.version,timestamp),suggestion=this.db.prepare('SELECT id,status FROM rule_suggestions WHERE fingerprint=? AND workspace_id=?').get(fingerprint,workspaceId) as {id:string;status:string}|undefined;if(!suggestion||suggestion.status==='rejected')continue;for(const source of sources)this.db.prepare('INSERT OR IGNORE INTO rule_suggestion_sources VALUES (?,?,?,?,?,?,?)').run(suggestion.id,source.messageId,source.chatId,source.excerpt,source.sourceDigest,source.startOffset,source.endOffset);if(result.changes)created++}if(created)this.activity(workspaceId,'rules','suggestions.scanned',workspaceId,'workspace',{created,extractor:RULE_EXTRACTOR.provider,version:RULE_EXTRACTOR.version})})
    return created
  }

  listRuleSuggestions(workspaceId:string):Array<Record<string,unknown>>{return this.transaction(()=>{this.reconcileRuleProvenance(workspaceId);const rows=this.db.prepare("SELECT id,statement,scope,confidence,extractor,extractor_version extractorVersion,status,last_dry_run_at lastDryRunAt,created_at createdAt FROM rule_suggestions WHERE workspace_id=? AND status='pending' ORDER BY created_at DESC,id ASC").all(workspaceId) as Array<Record<string,unknown>>;return rows.map((row)=>({...row,sources:this.db.prepare('SELECT message_id messageId,chat_id chatId,excerpt,start_offset startOffset,end_offset endOffset FROM rule_suggestion_sources WHERE suggestion_id=? ORDER BY message_id').all(String(row.id))}))})}

  dryRunRuleSuggestion(workspaceId:string,suggestionId:string):{matchCount:number;sourceIds:string[]}{return this.transaction(()=>{this.reconcileRuleProvenance(workspaceId);const suggestion=this.db.prepare("SELECT * FROM rule_suggestions WHERE id=? AND workspace_id=? AND status='pending'").get(suggestionId,workspaceId) as Record<string,unknown>|undefined;if(!suggestion)throw new Error('Pending rule suggestion not found');const sources=this.currentRuleSources(suggestionId,workspaceId);if(sources.length<2)throw new Error('Rule suggestion no longer has enough valid sources');const digest=contentDigest(JSON.stringify(sources.map((item)=>[item.messageId,item.sourceDigest]))),timestamp=now();this.db.prepare('UPDATE rule_suggestions SET last_dry_run_digest=?,last_dry_run_at=? WHERE id=?').run(digest,timestamp,suggestionId);this.db.prepare('INSERT INTO rule_outcomes VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),workspaceId,null,suggestionId,'dry_run',sources.length,1,timestamp);return{matchCount:sources.length,sourceIds:sources.map((item)=>item.messageId)}})}

  resolveRuleSuggestion(workspaceId:string,suggestionId:string,action:'approve'|'reject'):void{this.transaction(()=>{this.reconcileRuleProvenance(workspaceId);const suggestion=this.db.prepare("SELECT * FROM rule_suggestions WHERE id=? AND workspace_id=? AND status='pending'").get(suggestionId,workspaceId) as Record<string,unknown>|undefined;if(!suggestion)throw new Error('Pending rule suggestion not found');const timestamp=now();if(action==='reject'){this.db.prepare("UPDATE rule_suggestions SET status='rejected',resolved_at=? WHERE id=?").run(timestamp,suggestionId);this.activity(workspaceId,'rules','suggestion.rejected',suggestionId,'rule_suggestion',{});return}const sources=this.currentRuleSources(suggestionId,workspaceId),digest=contentDigest(JSON.stringify(sources.map((item)=>[item.messageId,item.sourceDigest])));if(sources.length<2||!suggestion.last_dry_run_digest||String(suggestion.last_dry_run_digest)!==digest)throw new Error('Run a current dry run before approval');const ruleId=randomUUID();this.db.prepare('INSERT INTO learned_rules VALUES (?,?,?,?,?,?,?,?,?,?)').run(ruleId,workspaceId,suggestionId,String(suggestion.statement),'workspace',1,1,null,timestamp,timestamp);this.db.prepare("UPDATE rule_suggestions SET status='accepted',resolved_at=? WHERE id=?").run(timestamp,suggestionId);this.db.prepare('UPDATE rule_outcomes SET rule_id=? WHERE suggestion_id=? AND rule_id IS NULL').run(ruleId,suggestionId);this.db.prepare('INSERT INTO rule_outcomes VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),workspaceId,ruleId,suggestionId,'approved',sources.length,1,timestamp);this.activity(workspaceId,'rules','rule.approved',ruleId,'rule',{version:1,scope:'workspace'})})}

  listLearnedRules(workspaceId:string):Array<Record<string,unknown>>{return this.transaction(()=>{this.reconcileRuleProvenance(workspaceId);return(this.db.prepare('SELECT id,suggestion_id suggestionId,statement,scope,version,enabled,prior_enabled priorEnabled,created_at createdAt,updated_at updatedAt FROM learned_rules WHERE workspace_id=? ORDER BY updated_at DESC,id ASC').all(workspaceId) as Array<Record<string,unknown>>).map((row)=>({...row,enabled:Boolean(row.enabled),priorEnabled:row.priorEnabled==null?null:Boolean(row.priorEnabled),outcomes:this.db.prepare('SELECT action,match_count matchCount,version,created_at createdAt FROM rule_outcomes WHERE rule_id=? ORDER BY rowid DESC').all(String(row.id))}))})}

  setLearnedRuleEnabled(workspaceId:string,ruleId:string,enabled:boolean):void{this.transaction(()=>{this.reconcileRuleProvenance(workspaceId);const rule=this.db.prepare('SELECT enabled,version FROM learned_rules WHERE id=? AND workspace_id=?').get(ruleId,workspaceId) as {enabled:number;version:number}|undefined;if(!rule)throw new Error('Learned rule not found');if(Boolean(rule.enabled)===enabled)return;const timestamp=now();this.db.prepare('UPDATE learned_rules SET prior_enabled=enabled,enabled=?,updated_at=? WHERE id=?').run(enabled?1:0,timestamp,ruleId);this.db.prepare('INSERT INTO rule_outcomes VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),workspaceId,ruleId,null,enabled?'enabled':'disabled',0,rule.version,timestamp);this.activity(workspaceId,'rules',enabled?'rule.enabled':'rule.disabled',ruleId,'rule',{version:rule.version})})}

  revertLearnedRule(workspaceId:string,ruleId:string):void{this.transaction(()=>{this.reconcileRuleProvenance(workspaceId);const rule=this.db.prepare('SELECT enabled,prior_enabled priorEnabled,version FROM learned_rules WHERE id=? AND workspace_id=?').get(ruleId,workspaceId) as {enabled:number;priorEnabled:number|null;version:number}|undefined;if(!rule||rule.priorEnabled==null)throw new Error('No learned rule state to revert');const timestamp=now();this.db.prepare('UPDATE learned_rules SET enabled=?,prior_enabled=NULL,updated_at=? WHERE id=?').run(rule.priorEnabled,timestamp,ruleId);this.db.prepare('INSERT INTO rule_outcomes VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),workspaceId,ruleId,null,'reverted',0,rule.version,timestamp);this.activity(workspaceId,'rules','rule.reverted',ruleId,'rule',{version:rule.version})})}

  private reconcileRuleProvenance(workspaceId:string):void{const sources=this.db.prepare('SELECT rs.suggestion_id suggestionId,rs.message_id messageId,rs.source_digest sourceDigest,rs.excerpt,rs.start_offset startOffset,rs.end_offset endOffset,rs.chat_id sourceChatId,m.body,m.role,m.chat_id chatId FROM rule_suggestion_sources rs JOIN rule_suggestions s ON s.id=rs.suggestion_id LEFT JOIN messages m ON m.id=rs.message_id WHERE s.workspace_id=?').all(workspaceId) as Array<Record<string,unknown>>;for(const item of sources){const valid=item.body!=null&&item.role==='user'&&item.chatId===item.sourceChatId&&contentDigest(String(item.body))===item.sourceDigest&&String(item.body).slice(Number(item.startOffset),Number(item.endOffset))===item.excerpt;if(!valid)this.db.prepare('DELETE FROM rule_suggestion_sources WHERE suggestion_id=? AND message_id=?').run(String(item.suggestionId),String(item.messageId))}}

  private currentRuleSources(suggestionId:string,workspaceId:string):Array<{messageId:string;sourceDigest:string}>{const sources=this.db.prepare('SELECT rs.message_id messageId,rs.source_digest sourceDigest,rs.excerpt,rs.start_offset startOffset,rs.end_offset endOffset,m.body,m.role,m.chat_id chatId,rs.chat_id sourceChatId FROM rule_suggestion_sources rs JOIN messages m ON m.id=rs.message_id JOIN chats c ON c.id=m.chat_id WHERE rs.suggestion_id=? AND c.workspace_id=? ORDER BY rs.message_id').all(suggestionId,workspaceId) as Array<Record<string,unknown>>;return sources.filter((item)=>item.role==='user'&&item.chatId===item.sourceChatId&&contentDigest(String(item.body))===item.sourceDigest&&String(item.body).slice(Number(item.startOffset),Number(item.endOffset))===item.excerpt).map((item)=>({messageId:String(item.messageId),sourceDigest:String(item.sourceDigest)}))}

  createDocument(workspaceId: string, title: string, body: string): { id: string; revisionId: string } {
    const id = randomUUID(), revisionId = randomUUID(), timestamp = now()
    return this.transaction(() => {
      this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?)').run(id, workspaceId, title.trim() || 'Untitled', revisionId, timestamp, timestamp)
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(revisionId, id, body, timestamp)
      this.syncJournal.enqueue(workspaceId,id,'document','upsert',{id,title:title.trim()||'Untitled',revisionId,body,createdAt:timestamp,updatedAt:timestamp})
      this.indexText(workspaceId, id, 'document', revisionId, title, body)
      this.activity(workspaceId, 'content', 'document.created', id, 'document', {})
      return { id, revisionId }
    })
  }

  captureMessageAsDocument(workspaceId:string,messageId:string):{id:string;revisionId:string}{
    const message=this.db.prepare("SELECT m.body,c.title FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=? AND c.workspace_id=? AND m.role='assistant'").get(messageId,workspaceId) as {body:string;title:string}|undefined
    if(!message)throw new Error('Assistant message not found in workspace')
    const id=randomUUID(),revisionId=randomUUID(),relationshipId=randomUUID(),timestamp=now(),title=`From ${message.title}`
    return this.transaction(()=>{
      this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?)').run(id,workspaceId,title,revisionId,timestamp,timestamp)
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(revisionId,id,message.body,timestamp)
      this.indexText(workspaceId,id,'document',revisionId,title,message.body)
      this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(relationshipId,workspaceId,messageId,id,'captured_as',timestamp)
      this.syncJournal.enqueue(workspaceId,id,'document','upsert',{id,title,revisionId,body:message.body,createdAt:timestamp,updatedAt:timestamp})
      this.syncJournal.enqueue(workspaceId,relationshipId,'relationship','upsert',{id:relationshipId,fromId:messageId,toId:id,type:'captured_as'})
      this.activity(workspaceId,'content','document.created',id,'document',{})
      this.activity(workspaceId,'graph','relationship.created',relationshipId,'relationship',{fromId:messageId,toId:id,type:'captured_as'})
      return{id,revisionId}
    })
  }

  updateDocument(workspaceId: string, documentId: string, title: string, body: string): string {
    this.assertObjectInWorkspace(workspaceId, documentId, 'document')
    const document = this.db.prepare('SELECT workspace_id FROM documents WHERE id=?').get(documentId) as { workspace_id: string } | undefined
    if (!document) throw new Error('Document not found')
    const revisionId = randomUUID(), timestamp = now()
    return this.transaction(() => {
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(revisionId, documentId, body, timestamp)
      this.db.prepare('UPDATE documents SET title=?,current_revision_id=?,updated_at=? WHERE id=?').run(title.trim() || 'Untitled', revisionId, timestamp, documentId)
      this.db.prepare("DELETE FROM search_fts WHERE object_id=? AND object_kind='document'").run(documentId)
      this.indexText(document.workspace_id, documentId, 'document', revisionId, title, body)
      this.db.prepare('DELETE FROM embeddings WHERE object_id=?').run(documentId)
      this.syncJournal.enqueue(workspaceId,documentId,'document','upsert',{id:documentId,title:title.trim()||'Untitled',revisionId,body,updatedAt:timestamp})
      this.activity(document.workspace_id, 'content', 'document.updated', documentId, 'document', { revisionId })
      return revisionId
    })
  }

  createChat(workspaceId: string, title: string): string {
    const id = randomUUID(), timestamp = now()
    this.transaction(() => {
      this.db.prepare('INSERT INTO chats VALUES (?,?,?,?,?)').run(id, workspaceId, title.trim() || 'New chat', timestamp, timestamp)
      this.syncJournal.enqueue(workspaceId,id,'chat','upsert',{id,title:title.trim()||'New chat',createdAt:timestamp,updatedAt:timestamp})
      this.activity(workspaceId, 'content', 'chat.created', id, 'chat', {})
    })
    return id
  }

  captureChat(workspaceId: string, title: string, body: string): string {
    const id = randomUUID(), messageId = randomUUID(), timestamp = now(), normalizedTitle = title.trim() || 'New chat'
    this.transaction(() => {
      this.db.prepare('INSERT INTO chats VALUES (?,?,?,?,?)').run(id, workspaceId, normalizedTitle, timestamp, timestamp)
      this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(messageId, id, 'user', body, timestamp)
      this.syncJournal.enqueue(workspaceId,id,'chat','upsert',{id,title:normalizedTitle,createdAt:timestamp,updatedAt:timestamp})
      this.syncJournal.enqueue(workspaceId,messageId,'message','upsert',{id:messageId,chatId:id,role:'user',body,createdAt:timestamp})
      this.indexText(workspaceId, messageId, 'message', undefined, normalizedTitle, body)
      this.activity(workspaceId, 'content', 'chat.created', id, 'chat', {})
      this.activity(workspaceId, 'content', 'message.created', messageId, 'message', { role: 'user' })
    })
    return id
  }

  addMessage(workspaceId: string, chatId: string, role: 'user' | 'assistant' | 'system', body: string, attachmentIds: string[] = []): string {
    this.assertObjectInWorkspace(workspaceId, chatId, 'chat')
    const chat = this.db.prepare('SELECT workspace_id,title FROM chats WHERE id=?').get(chatId) as { workspace_id: string; title: string } | undefined
    if (!chat) throw new Error('Chat not found')
    const id = randomUUID(), timestamp = now()
    this.transaction(() => {
      if(attachmentIds.length>MAX_ATTACHMENTS_PER_OWNER||new Set(attachmentIds).size!==attachmentIds.length)throw new Error('Invalid message attachment selection')
      for(const attachmentId of attachmentIds){
        const attachment=this.db.prepare('SELECT id,name,media_type mediaType,sha256 FROM attachments WHERE id=? AND workspace_id=? AND owner_id=?').get(attachmentId,workspaceId,chatId) as {id:string;name:string;mediaType:string;sha256:string}|undefined
        if(!attachment)throw new Error('Pending chat attachment not found')
        this.db.prepare('UPDATE attachments SET owner_id=? WHERE id=?').run(id,attachmentId)
        this.syncJournal.enqueue(workspaceId,attachmentId,'attachment','upsert',{...attachment,ownerId:id})
      }
      this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(id, chatId, role, body, timestamp)
      this.db.prepare('UPDATE chats SET updated_at=? WHERE id=?').run(timestamp, chatId)
      this.syncJournal.enqueue(workspaceId,id,'message','upsert',{id,chatId,role,body,createdAt:timestamp})
      this.indexText(chat.workspace_id, id, 'message', undefined, chat.title, body)
      this.activity(chat.workspace_id, 'content', 'message.created', id, 'message', { role })
    })
    return id
  }

  createMemory(workspaceId: string, title: string, body: string, sourceObjectId?: string, ownership: 'workspace-owned'|'source-owned' = 'workspace-owned'): string {
    if (sourceObjectId) this.assertObjectInWorkspace(workspaceId, sourceObjectId)
    if (ownership === 'source-owned' && !sourceObjectId) throw new Error('Source-owned memory requires a source')
    const id = randomUUID(), timestamp = now()
    this.transaction(() => {
      this.db.prepare('INSERT INTO memories(id,workspace_id,title,body,source_object_id,ownership,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, workspaceId, title.trim() || 'Memory', body, sourceObjectId ?? null, ownership, timestamp, timestamp)
      this.syncJournal.enqueue(workspaceId,id,'memory','upsert',{id,title:title.trim()||'Memory',body,sourceObjectId:sourceObjectId??null,ownership,createdAt:timestamp,updatedAt:timestamp})
      this.indexText(workspaceId, id, 'memory', undefined, title, body)
      this.activity(workspaceId, 'content', 'memory.created', id, 'memory', { sourceObjectId: sourceObjectId ?? null })
    })
    return id
  }

  captureMemory(workspaceId: string, title: string, body: string, sourceObjectId?: string, ownership: 'workspace-owned'|'source-owned' = 'workspace-owned'): string {
    if (sourceObjectId) this.assertObjectInWorkspace(workspaceId, sourceObjectId)
    if (ownership === 'source-owned' && !sourceObjectId) throw new Error('Source-owned memory requires a source')
    const id = randomUUID(), timestamp = now(), normalizedTitle = title.trim() || 'Memory'
    this.transaction(() => {
      this.db.prepare('INSERT INTO memories(id,workspace_id,title,body,source_object_id,ownership,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, workspaceId, normalizedTitle, body, sourceObjectId ?? null, ownership, timestamp, timestamp)
      this.syncJournal.enqueue(workspaceId,id,'memory','upsert',{id,title:normalizedTitle,body,sourceObjectId:sourceObjectId??null,ownership,createdAt:timestamp,updatedAt:timestamp})
      this.indexText(workspaceId, id, 'memory', undefined, normalizedTitle, body)
      this.activity(workspaceId, 'content', 'memory.created', id, 'memory', { sourceObjectId: sourceObjectId ?? null })
      if (sourceObjectId) {
        const relationshipId = randomUUID()
        this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(relationshipId, workspaceId, sourceObjectId, id, 'supports', timestamp)
        this.syncJournal.enqueue(workspaceId,relationshipId,'relationship','upsert',{id:relationshipId,fromId:sourceObjectId,toId:id,type:'supports',createdAt:timestamp})
        this.activity(workspaceId, 'graph', 'relationship.created', relationshipId, 'relationship', { fromId: sourceObjectId, toId: id, type: 'supports' })
      }
    })
    return id
  }

  createRelationship(workspaceId: string, fromId: string, toId: string, type: string): string {
    this.assertObjectInWorkspace(workspaceId, fromId)
    this.assertObjectInWorkspace(workspaceId, toId)
    const id = randomUUID()
    this.transaction(() => {
      this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(id, workspaceId, fromId, toId, type, now())
      this.syncJournal.enqueue(workspaceId,id,'relationship','upsert',{id,fromId,toId,type})
      this.activity(workspaceId, 'graph', 'relationship.created', id, 'relationship', { fromId, toId, type })
    })
    return id
  }

  addAttachment(workspaceId: string, ownerId: string, name: string, mediaType: string, sourcePath: string): string {
    this.assertObjectInWorkspace(workspaceId, ownerId)
    const ownerCount=Number((this.db.prepare('SELECT count(*) count FROM attachments WHERE workspace_id=? AND owner_id=?').get(workspaceId,ownerId) as {count:number}).count),workspaceCount=Number((this.db.prepare('SELECT count(*) count FROM attachments WHERE workspace_id=?').get(workspaceId) as {count:number}).count)
    if(ownerCount>=MAX_ATTACHMENTS_PER_OWNER)throw new Error(`Attachment owner limit of ${MAX_ATTACHMENTS_PER_OWNER} reached`)
    if(workspaceCount>=MAX_ATTACHMENTS_PER_WORKSPACE)throw new Error(`Workspace attachment limit of ${MAX_ATTACHMENTS_PER_WORKSPACE} reached`)
    const validated=readAndValidateAttachment(sourcePath,name,mediaType),{bytes,sha256,safeName}=validated
    const id = randomUUID(), relativePath = `${id}-${safeName}`,createdAt=now()
    writeFileSync(this.attachmentPath(relativePath),bytes,{flag:'wx',mode:0o600})
    try {
      this.transaction(()=>{
        this.db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?)').run(id, workspaceId, ownerId, safeName, mediaType, sha256, relativePath, createdAt)
        this.syncJournal.enqueue(workspaceId,id,'attachment','upsert',{id,ownerId,name:safeName,mediaType,sha256,bytes:bytes.byteLength,createdAt})
      })
    } catch (error) { rmSync(path.join(this.attachmentRoot, relativePath), { force: true }); throw error }
    return id
  }

  listAttachments(workspaceId:string,ownerId?:string):AttachmentMetadata[]{
    if(ownerId)this.assertObjectInWorkspace(workspaceId,ownerId)
    const rows=this.db.prepare(`SELECT id,workspace_id workspaceId,owner_id ownerId,name,media_type mediaType,sha256,relative_path relativePath,created_at createdAt FROM attachments WHERE workspace_id=? ${ownerId?'AND owner_id=?':''} ORDER BY created_at`).all(...(ownerId?[workspaceId,ownerId]:[workspaceId])) as Array<Record<string,unknown>>
    return rows.map((row)=>{const ownerKind=this.objectKindInWorkspace(workspaceId,String(row.ownerId));if(!ownerKind)throw new Error('Attachment owner is missing');const file=this.attachmentPath(String(row.relativePath));if(!existsSync(file))throw new Error('Stored attachment file is missing');return{id:String(row.id),workspaceId,ownerId:String(row.ownerId),ownerKind,name:String(row.name),mediaType:String(row.mediaType),sha256:String(row.sha256),bytes:statSync(file).size,createdAt:String(row.createdAt)}})
  }

  listChatAttachments(workspaceId:string,chatId:string):AttachmentMetadata[]{
    this.assertObjectInWorkspace(workspaceId,chatId,'chat')
    const owners=[chatId,...(this.db.prepare('SELECT id FROM messages WHERE chat_id=?').all(chatId) as Array<{id:string}>).map((row)=>row.id)]
    const ownerSet=new Set(owners)
    return this.listAttachments(workspaceId).filter((attachment)=>ownerSet.has(attachment.ownerId))
  }

  deleteAttachment(workspaceId:string,attachmentId:string):void{
    const row=this.db.prepare('SELECT relative_path relativePath FROM attachments WHERE id=? AND workspace_id=?').get(attachmentId,workspaceId) as {relativePath:string}|undefined
    if(!row)throw new Error('Attachment not found in workspace')
    const source=this.attachmentPath(row.relativePath),staged=`${source}.deleting-${randomUUID()}`
    renameSync(source,staged)
    try{this.transaction(()=>{
      this.db.prepare('DELETE FROM attachments WHERE id=? AND workspace_id=?').run(attachmentId,workspaceId)
      this.syncJournal.enqueue(workspaceId,attachmentId,'attachment','delete',{id:attachmentId},[attachmentId])
      this.activity(workspaceId,'lifecycle','attachment.deleted',attachmentId,'attachment',{})
    })}catch(error){renameSync(staged,source);throw error}
    rmSync(staged,{force:true})
  }

  prepareAttachmentForProvider(workspaceId:string,attachmentId:string,capabilities:{inlineText:boolean;filePaths:boolean;acceptedMediaTypes:readonly string[];maxBytes:number}):ProviderAttachmentPreparation{
    const row=this.db.prepare('SELECT relative_path relativePath,owner_id ownerId FROM attachments WHERE id=? AND workspace_id=?').get(attachmentId,workspaceId) as {relativePath:string;ownerId:string}|undefined
    if(!row)throw new Error('Attachment not found in workspace')
    const metadata=this.listAttachments(workspaceId,row.ownerId).find((item)=>item.id===attachmentId)!
    return prepareProviderAttachment({metadata,absolutePath:this.attachmentPath(row.relativePath),capabilities})
  }

  searchText(workspaceId: string, query: string, limit = 20): SearchResult[] {
    if (!query.trim()) return []
    const expression = query.trim().split(/\s+/).map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ')
    const rows = this.db.prepare('SELECT object_id,object_kind,revision_id,title,snippet(search_fts,5,\'\',\'\',\'…\',16) excerpt,bm25(search_fts) rank FROM search_fts WHERE search_fts MATCH ? AND workspace_id=? ORDER BY rank LIMIT ?').all(expression, workspaceId, limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({ objectId: String(row.object_id), objectKind: row.object_kind as ObjectKind, revisionId: row.revision_id ? String(row.revision_id) : undefined, title: String(row.title), excerpt: String(row.excerpt), score: -Number(row.rank), method: 'text' }))
  }

  indexEmbedding(workspaceId: string, source: { objectId: string; objectKind: ObjectKind; revisionId?: string }, vector: number[], provenance: { provider: string; providerVersion: string; model: string; modelDigest: string; chunkingDigest: string }): void {
    this.assertObjectInWorkspace(workspaceId, source.objectId)
    if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) throw new Error('Valid embedding vector required')
    this.transaction(() => {
      this.db.prepare('DELETE FROM embeddings WHERE workspace_id=? AND object_id=?').run(workspaceId, source.objectId)
      this.db.prepare('INSERT INTO embeddings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), workspaceId, source.objectId, source.objectKind, source.revisionId ?? null, provenance.provider, provenance.providerVersion, provenance.model, provenance.modelDigest, vector.length, provenance.chunkingDigest, JSON.stringify(vector), now())
    })
  }

  semanticSearch(workspaceId: string, queryVector: number[], provenance: { provider: string; providerVersion: string; model: string; modelDigest: string; chunkingDigest: string }, limit = 20): SearchResult[] {
    const rows = this.db.prepare('SELECT * FROM embeddings WHERE workspace_id=? AND provider=? AND provider_version=? AND model=? AND model_digest=? AND chunking_digest=?').all(workspaceId, provenance.provider, provenance.providerVersion, provenance.model, provenance.modelDigest, provenance.chunkingDigest) as Array<Record<string, unknown>>
    return rows.map((row) => {
      const vector = JSON.parse(String(row.vector_json)) as number[]
      const score = cosine(queryVector, vector)
      const source = this.sourceTitle(String(row.object_id), String(row.object_kind) as ObjectKind)
      return { objectId: String(row.object_id), objectKind: row.object_kind as ObjectKind, revisionId: row.revision_id ? String(row.revision_id) : undefined, title: source.title, excerpt: source.excerpt, score, method: 'semantic' as const }
    }).filter((result) => Number.isFinite(result.score)).sort((a, b) => b.score - a.score).slice(0, limit)
  }

  graph(workspaceId: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const edges = this.db.prepare('SELECT id,from_id fromId,to_id toId,type FROM relationships WHERE workspace_id=?').all(workspaceId) as unknown as GraphEdge[]
    const ids = new Set(edges.flatMap((edge) => [edge.fromId, edge.toId]))
    const nodes = [...ids].map((id) => this.graphNode(id)).filter((node): node is GraphNode => Boolean(node))
    const surviving = new Set(nodes.map((node) => node.id))
    return { nodes, edges: edges.filter((edge) => surviving.has(edge.fromId) && surviving.has(edge.toId)) }
  }

  deleteMessage(workspaceId:string,messageId:string):void{
    this.assertObjectInWorkspace(workspaceId,messageId,'message')
    const stagedFiles:Array<{source:string;staged:string}>=[]
    try{this.transaction(()=>{
      const ownedIds=[messageId]
      for(;;){const placeholders=ownedIds.map(()=>'?').join(','),dependents=this.db.prepare(`SELECT id FROM memories WHERE workspace_id=? AND ownership='source-owned' AND source_object_id IN (${placeholders})`).all(workspaceId,...ownedIds) as Array<{id:string}>,additions=dependents.map((row)=>row.id).filter((id)=>!ownedIds.includes(id));if(!additions.length)break;ownedIds.push(...additions)}
      const placeholders=ownedIds.map(()=>'?').join(','),attachments=this.db.prepare(`SELECT id,relative_path relativePath FROM attachments WHERE workspace_id=? AND owner_id IN (${placeholders})`).all(workspaceId,...ownedIds) as Array<{id:string;relativePath:string}>
      const relationships=(this.db.prepare(`SELECT id FROM relationships WHERE workspace_id=? AND (from_id IN (${placeholders}) OR to_id IN (${placeholders}))`).all(workspaceId,...ownedIds,...ownedIds) as Array<{id:string}>).map((row)=>row.id)
      const commitmentIds=(this.db.prepare(`SELECT id FROM commitments WHERE workspace_id=? AND source_message_id IN (${placeholders})`).all(workspaceId,...ownedIds) as Array<{id:string}>).map((row)=>row.id)
      for(const attachment of attachments){const source=this.attachmentPath(attachment.relativePath),staged=`${source}.deleting-${randomUUID()}`;renameSync(source,staged);stagedFiles.push({source,staged})}
      this.db.prepare(`DELETE FROM relationships WHERE workspace_id=? AND (from_id IN (${placeholders}) OR to_id IN (${placeholders}))`).run(workspaceId,...ownedIds,...ownedIds)
      this.db.prepare(`DELETE FROM embeddings WHERE workspace_id=? AND object_id IN (${placeholders})`).run(workspaceId,...ownedIds)
      this.db.prepare(`DELETE FROM queued_work WHERE workspace_id=? AND context_object_id IN (${placeholders})`).run(workspaceId,...ownedIds)
      this.db.prepare(`DELETE FROM search_fts WHERE workspace_id=? AND object_id IN (${placeholders})`).run(workspaceId,...ownedIds)
      this.db.prepare(`DELETE FROM briefing_dismissals WHERE workspace_id=? AND source_id IN (${[...ownedIds,...commitmentIds].map(()=>'?').join(',')})`).run(workspaceId,...ownedIds,...commitmentIds)
      this.db.prepare(`DELETE FROM attachments WHERE workspace_id=? AND owner_id IN (${placeholders})`).run(workspaceId,...ownedIds)
      const detached=this.db.prepare(`SELECT id,title,body,ownership,created_at createdAt,updated_at updatedAt FROM memories WHERE workspace_id=? AND ownership='workspace-owned' AND source_object_id IN (${placeholders})`).all(workspaceId,...ownedIds) as Array<{id:string;title:string;body:string;ownership:string;createdAt:string;updatedAt:string}>
      this.db.prepare(`UPDATE memories SET source_object_id=NULL WHERE workspace_id=? AND ownership='workspace-owned' AND source_object_id IN (${placeholders})`).run(workspaceId,...ownedIds);for(const memory of detached)this.syncJournal.enqueue(workspaceId,memory.id,'memory','upsert',{...memory,sourceObjectId:null})
      const dependentMemoryIds=ownedIds.filter((id)=>id!==messageId);if(dependentMemoryIds.length)this.db.prepare(`DELETE FROM memories WHERE workspace_id=? AND id IN (${dependentMemoryIds.map(()=>'?').join(',')})`).run(workspaceId,...dependentMemoryIds)
      this.db.prepare('DELETE FROM messages WHERE id=?').run(messageId)
      for(const dependentId of dependentMemoryIds){this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(dependentId,workspaceId,'memory',now());this.syncJournal.enqueue(workspaceId,dependentId,'memory','delete',{id:dependentId},[dependentId]);this.activity(workspaceId,'lifecycle','deleted',dependentId,'memory',{})}
      this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(messageId,workspaceId,'message',now())
      const cascadeIds=[...ownedIds,...commitmentIds,...attachments.map((item)=>item.id),...relationships];this.syncJournal.enqueue(workspaceId,messageId,'message','delete',{id:messageId,cascade:true,cascadeIds},cascadeIds)
      this.activity(workspaceId,'lifecycle','deleted',messageId,'message',{})
    })}catch(error){for(const file of stagedFiles.reverse())renameSync(file.staged,file.source);throw error}
    for(const file of stagedFiles)rmSync(file.staged,{force:true})
  }

  deleteObject(workspaceId: string, objectKind: 'document' | 'chat' | 'memory', objectId: string): void {
    const stagedFiles: Array<{ source: string; staged: string }> = []
    try { this.transaction(() => {
      this.assertObjectInWorkspace(workspaceId, objectId, objectKind)
      const ownedIds = objectKind === 'chat'
        ? [objectId, ...(this.db.prepare('SELECT id FROM messages WHERE chat_id=?').all(objectId) as Array<{ id: string }>).map((message) => message.id)]
        : [objectId]
      for (;;) {
        const placeholders = ownedIds.map(() => '?').join(',')
        const dependents = this.db.prepare(`SELECT id FROM memories WHERE ownership='source-owned' AND source_object_id IN (${placeholders})`).all(...ownedIds) as Array<{ id: string }>
        const additions = dependents.map((row) => row.id).filter((id) => !ownedIds.includes(id))
        if (!additions.length) break
        ownedIds.push(...additions)
      }
      const placeholders = ownedIds.map(() => '?').join(',')
      const attachmentRows = this.db.prepare(`SELECT id,relative_path FROM attachments WHERE owner_id IN (${placeholders})`).all(...ownedIds) as Array<{ id:string;relative_path: string }>
      const relationshipIds=(this.db.prepare(`SELECT id FROM relationships WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`).all(...ownedIds,...ownedIds) as Array<{id:string}>).map((row)=>row.id)
      const commitmentIds=(this.db.prepare(`SELECT id FROM commitments WHERE workspace_id=? AND source_message_id IN (${placeholders})`).all(workspaceId,...ownedIds) as Array<{id:string}>).map((row)=>row.id)
      for (const attachment of attachmentRows) {
        const source = path.join(this.attachmentRoot, attachment.relative_path), staged = `${source}.deleting-${randomUUID()}`
        renameSync(source, staged); stagedFiles.push({ source, staged })
      }
      this.db.prepare(`DELETE FROM relationships WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`).run(...ownedIds, ...ownedIds)
      this.db.prepare(`DELETE FROM embeddings WHERE object_id IN (${placeholders})`).run(...ownedIds)
      this.db.prepare(`DELETE FROM queued_work WHERE context_object_id IN (${placeholders})`).run(...ownedIds)
      this.db.prepare(`DELETE FROM search_fts WHERE object_id IN (${placeholders})`).run(...ownedIds)
      this.db.prepare(`DELETE FROM briefing_dismissals WHERE workspace_id=? AND source_id IN (${[...ownedIds,...commitmentIds].map(()=>'?').join(',')})`).run(workspaceId,...ownedIds,...commitmentIds)
      this.db.prepare(`DELETE FROM attachments WHERE owner_id IN (${placeholders})`).run(...ownedIds)
      const dependentMemoryIds = ownedIds.filter((id) => id !== objectId && this.objectWorkspace(id, 'memory') === workspaceId)
      const detachedMemories=this.db.prepare(`SELECT id,title,body,ownership,created_at createdAt,updated_at updatedAt FROM memories WHERE workspace_id=? AND ownership='workspace-owned' AND source_object_id IN (${placeholders})`).all(workspaceId,...ownedIds) as Array<{id:string;title:string;body:string;ownership:string;createdAt:string;updatedAt:string}>
      this.db.prepare(`UPDATE memories SET source_object_id=NULL WHERE ownership='workspace-owned' AND source_object_id IN (${placeholders})`).run(...ownedIds)
      for(const memory of detachedMemories)this.syncJournal.enqueue(workspaceId,memory.id,'memory','upsert',{...memory,sourceObjectId:null})
      if (dependentMemoryIds.length) this.db.prepare(`DELETE FROM memories WHERE id IN (${dependentMemoryIds.map(() => '?').join(',')})`).run(...dependentMemoryIds)
      this.db.prepare(`DELETE FROM ${objectKind === 'document' ? 'documents' : objectKind === 'chat' ? 'chats' : 'memories'} WHERE id=?`).run(objectId)
      for (const dependentId of dependentMemoryIds) { this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(dependentId, workspaceId, 'memory', now());this.syncJournal.enqueue(workspaceId,dependentId,'memory','delete',{id:dependentId},[dependentId]); this.activity(workspaceId, 'lifecycle', 'deleted', dependentId, 'memory', {}) }
      this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(objectId, workspaceId, objectKind, now())
      const cascadeIds=[...ownedIds,...commitmentIds,...relationshipIds,...attachmentRows.map((row)=>row.id)];this.syncJournal.enqueue(workspaceId,objectId,objectKind,'delete',{id:objectId,cascade:true,cascadeIds},cascadeIds)
      this.activity(workspaceId, 'lifecycle', 'deleted', objectId, objectKind, {})
    }) } catch (error) {
      for (const file of stagedFiles.reverse()) renameSync(file.staged, file.source)
      throw error
    }
    for (const file of stagedFiles) rmSync(file.staged, { force: true })
  }

  listActivity(workspaceId: string): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT id,category,action,object_id objectId,object_kind objectKind,metadata_json metadata,created_at createdAt FROM activities WHERE workspace_id=? ORDER BY created_at DESC').all(workspaceId) as Array<Record<string, unknown>>
  }

  exportWorkspace(workspaceId: string): ExportArchive {
    const workspace = this.db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspaceId) as Record<string, unknown> | undefined
    if (!workspace) throw new Error('Workspace not found')
    const tables = ['documents','revisions','chats','messages','memories','memory_suggestions','commitments','rule_suggestions','rule_suggestion_sources','learned_rules','rule_outcomes','relationships','attachments','activities','tombstones','security_profiles','executions','execution_events']
    const objects: Record<string, unknown[]> = {}
    for (const table of tables) objects[table] = this.rowsForWorkspace(table, workspaceId)
    objects.attachments = (objects.attachments ?? []).map((value) => {
      const row = value as Record<string, unknown>
      const bytes=readFileSync(this.attachmentPath(String(row.relative_path))),validated=validateAttachment(String(row.name),String(row.media_type),bytes)
      if(validated.sha256!==String(row.sha256))throw new Error('Stored attachment integrity check failed')
      return { ...row, data_base64: bytes.toString('base64') }
    })
    const archive = { version: 3 as const, exportedAt: now(), workspace, objects }
    return { ...archive, integrity: archiveIntegrity(archive) }
  }

  restoreWorkspace(archive: ExportArchive, newName: string, newLocalPath: string): WorkspaceSummary {
    archive = validateArchive(archive)
    if (!newName.trim() || !path.isAbsolute(newLocalPath)) throw new Error('Workspace name and absolute local path are required')
    const workspace = { id: randomUUID(), name: newName.trim(), localPath: path.resolve(newLocalPath), createdAt: now() }
    const writtenFiles: string[] = []
    try { this.transaction(() => {
      this.db.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspace.id, workspace.name, workspace.localPath, workspace.createdAt)
      this.syncJournal.ensureWorkspace(workspace.id,'snapshot_required')
      this.createDefaultSecurityProfile(workspace.id, workspace.localPath)
      const idMap = new Map<string, string>()
      for (const table of ['documents','chats','memories'] as const) {
        for (const row of archive.objects[table] ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID())
      }
      for (const row of archive.objects.messages ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID())
      for (const row of archive.objects.memory_suggestions ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID())
      for (const row of archive.objects.commitments ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID())
      for (const row of archive.objects.rule_suggestions ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID())
      for (const row of archive.objects.learned_rules ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID())
      for (const row of archive.objects.tombstones ?? []) idMap.set(String((row as Record<string, unknown>).object_id), randomUUID())
      for (const row of archive.objects.executions ?? []) idMap.set(String((row as Record<string,unknown>).id),randomUUID())
      if((archive.objects.security_profiles??[]).length){
        this.db.prepare('DELETE FROM security_profiles WHERE workspace_id=?').run(workspace.id)
        const executionRoot=path.join(workspace.localPath,'waypoint-workspaces',workspace.id);mkdirSync(executionRoot,{recursive:true})
        for(const value of archive.objects.security_profiles){const row=value as Record<string,unknown>,id=randomUUID();idMap.set(String(row.id),id);this.db.prepare('INSERT INTO security_profiles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,workspace.id,String(row.name),JSON.stringify([executionRoot]),String(row.filesystem),String(row.network),String(row.tools_json),String(row.approval),Number(row.max_duration_ms),Number(row.max_concurrency),Number(row.peer_eligible),String(row.secret_names_json),String(row.created_at))}
      } else {
        const profile=this.db.prepare('SELECT id FROM security_profiles WHERE workspace_id=?').get(workspace.id) as {id:string};
        for(const run of archive.objects.executions??[]){const row=run as Record<string,unknown>;idMap.set(String(row.security_profile_id),profile.id)}
      }
      for (const rowValue of archive.objects.documents ?? []) {
        const row = rowValue as Record<string, unknown>, id = idMap.get(String(row.id))!
        const revisions = (archive.objects.revisions ?? []).filter((candidate) => String((candidate as Record<string, unknown>).document_id) === String(row.id)) as Array<Record<string, unknown>>
        const revisionMap = new Map(revisions.map((revision) => [String(revision.id), randomUUID()]))
        for (const [oldId, newId] of revisionMap) idMap.set(oldId, newId)
        const currentRevisionId = revisionMap.get(String(row.current_revision_id)) ?? revisionMap.values().next().value ?? randomUUID()
        this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?)').run(id, workspace.id, String(row.title), currentRevisionId, String(row.created_at), String(row.updated_at))
        if (revisions.length === 0) this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(currentRevisionId, id, '', workspace.createdAt)
        for (const revision of revisions) this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(revisionMap.get(String(revision.id))!, id, String(revision.body), String(revision.created_at))
        const current = revisions.find((revision) => String(revision.id) === String(row.current_revision_id))
        this.indexText(workspace.id, id, 'document', currentRevisionId, String(row.title), String(current?.body ?? ''))
      }
      for (const rowValue of archive.objects.chats ?? []) {
        const row = rowValue as Record<string, unknown>, id = idMap.get(String(row.id))!
        this.db.prepare('INSERT INTO chats VALUES (?,?,?,?,?)').run(id, workspace.id, String(row.title), String(row.created_at), String(row.updated_at))
        for (const messageValue of archive.objects.messages ?? []) {
          const message = messageValue as Record<string, unknown>
          if (String(message.chat_id) !== String(row.id)) continue
          const messageId = idMap.get(String(message.id))!
          this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(messageId, id, String(message.role), String(message.body), String(message.created_at))
          this.indexText(workspace.id, messageId, 'message', undefined, String(row.title), String(message.body))
        }
      }
      for(const value of [...(archive.objects.executions??[])].sort((left,right)=>Number((left as Record<string,unknown>).depth)-Number((right as Record<string,unknown>).depth))){
        const row=value as Record<string,unknown>,id=idMap.get(String(row.id))!,chatId=idMap.get(String(row.chat_id)),profileId=idMap.get(String(row.security_profile_id))
        if(!chatId||!profileId)continue
        const active=['queued','running'].includes(String(row.status)),status=active?'failed':String(row.status)
        this.db.prepare('INSERT INTO executions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,workspace.id,chatId,row.source_message_id?idMap.get(String(row.source_message_id))??null:null,row.parent_execution_id?idMap.get(String(row.parent_execution_id))??null:null,String(row.cli),row.executable==null?null:String(row.executable),row.cli_version==null?null:String(row.cli_version),row.model==null?null:String(row.model),String(row.device),profileId,String(row.prompt_sha256),status,Number(row.depth),row.started_at==null?null:String(row.started_at),active?now():row.finished_at==null?null:String(row.finished_at),row.exit_code==null?null:Number(row.exit_code),active?'restored_interrupted':row.error_code==null?null:String(row.error_code),active?'Archive captured a non-terminal run':row.error_message==null?null:String(row.error_message),String(row.created_at))
      }
      for(const value of archive.objects.execution_events??[]){const row=value as Record<string,unknown>,executionId=idMap.get(String(row.execution_id));if(executionId)this.db.prepare('INSERT INTO execution_events VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),executionId,Number(row.sequence),String(row.type),row.text==null?null:String(row.text),row.name==null?null:String(row.name),row.raw_type==null?null:String(row.raw_type),String(row.created_at))}
      for (const rowValue of archive.objects.memories ?? []) {
        const row = rowValue as Record<string, unknown>, id = idMap.get(String(row.id))!
        this.db.prepare('INSERT INTO memories(id,workspace_id,title,body,source_object_id,ownership,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, workspace.id, String(row.title), String(row.body), row.source_object_id ? idMap.get(String(row.source_object_id)) ?? null : null, String(row.ownership ?? 'workspace-owned'), String(row.created_at), String(row.updated_at))
        this.indexText(workspace.id, id, 'memory', undefined, String(row.title), String(row.body))
      }
      for(const value of archive.objects.memory_suggestions??[]){const row=value as Record<string,unknown>,id=idMap.get(String(row.id))!,chatId=idMap.get(String(row.chat_id)),messageId=idMap.get(String(row.source_message_id));if(!chatId||!messageId)continue;this.db.prepare('INSERT INTO memory_suggestions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,workspace.id,chatId,messageId,String(row.source_role),String(row.category),String(row.title),String(row.body),String(row.source_excerpt),String(row.source_digest),Number(row.start_offset),Number(row.end_offset),Number(row.confidence),String(row.extractor),String(row.extractor_version),createHash('sha256').update(`${workspace.id}:${String(row.fingerprint)}`).digest('hex'),String(row.status),row.accepted_object_id?idMap.get(String(row.accepted_object_id))??null:null,row.resolved_at==null?null:String(row.resolved_at),String(row.created_at))}
      for(const value of archive.objects.commitments??[]){const row=value as Record<string,unknown>,id=idMap.get(String(row.id))!,suggestionId=idMap.get(String(row.suggestion_id)),messageId=idMap.get(String(row.source_message_id));if(!suggestionId||!messageId)continue;this.db.prepare('INSERT INTO commitments VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,workspace.id,suggestionId,messageId,String(row.title),String(row.body),String(row.status),String(row.created_at),String(row.updated_at),row.completed_at==null?null:String(row.completed_at))}
      for(const value of archive.objects.rule_suggestions??[]){const row=value as Record<string,unknown>,id=idMap.get(String(row.id))!;this.db.prepare('INSERT INTO rule_suggestions VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)').run(id,workspace.id,String(row.statement),String(row.normalized),contentDigest(JSON.stringify([workspace.id,RULE_EXTRACTOR.provider,RULE_EXTRACTOR.version,String(row.normalized)])),String(row.scope),Number(row.confidence),String(row.extractor),String(row.extractor_version),String(row.status),row.resolved_at==null?null:String(row.resolved_at),String(row.created_at))}
      for(const value of archive.objects.rule_suggestion_sources??[]){const row=value as Record<string,unknown>,suggestionId=idMap.get(String(row.suggestion_id)),messageId=idMap.get(String(row.message_id)),chatId=idMap.get(String(row.chat_id));if(suggestionId&&messageId&&chatId)this.db.prepare('INSERT INTO rule_suggestion_sources VALUES (?,?,?,?,?,?,?)').run(suggestionId,messageId,chatId,String(row.excerpt),String(row.source_digest),Number(row.start_offset),Number(row.end_offset))}
      for(const value of archive.objects.learned_rules??[]){const row=value as Record<string,unknown>,id=idMap.get(String(row.id))!,suggestionId=idMap.get(String(row.suggestion_id));if(suggestionId)this.db.prepare('INSERT INTO learned_rules VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,workspace.id,suggestionId,String(row.statement),String(row.scope),Number(row.version),Number(row.enabled),row.prior_enabled==null?null:Number(row.prior_enabled),String(row.created_at),String(row.updated_at))}
      for(const value of archive.objects.rule_outcomes??[]){const row=value as Record<string,unknown>,ruleId=row.rule_id?idMap.get(String(row.rule_id))??null:null,suggestionId=row.suggestion_id?idMap.get(String(row.suggestion_id))??null:null;if(ruleId||suggestionId)this.db.prepare('INSERT INTO rule_outcomes VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),workspace.id,ruleId,suggestionId,String(row.action),Number(row.match_count),Number(row.version),String(row.created_at))}
      for (const edgeValue of archive.objects.relationships ?? []) {
        const edge = edgeValue as Record<string, unknown>, from = idMap.get(String(edge.from_id)), to = idMap.get(String(edge.to_id))
        if (from && to) { const relationshipId = randomUUID(); idMap.set(String(edge.id), relationshipId); this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(relationshipId, workspace.id, from, to, String(edge.type), String(edge.created_at)) }
      }
      if((archive.objects.attachments??[]).length>MAX_ATTACHMENTS_PER_WORKSPACE)throw new Error(`Workspace attachment limit of ${MAX_ATTACHMENTS_PER_WORKSPACE} exceeded`)
      const restoredOwnerCounts=new Map<string,number>()
      for (const attachmentValue of archive.objects.attachments ?? []) {
        const attachment = attachmentValue as Record<string, unknown>
        const owner = idMap.get(String(attachment.owner_id))
        if (!owner) throw new Error('Attachment archive owner is missing')
        const ownerCount=(restoredOwnerCounts.get(owner)??0)+1;if(ownerCount>MAX_ATTACHMENTS_PER_OWNER)throw new Error(`Attachment owner limit of ${MAX_ATTACHMENTS_PER_OWNER} exceeded`);restoredOwnerCounts.set(owner,ownerCount)
        const bytes = Buffer.from(String(attachment.data_base64 ?? ''), 'base64')
        const validated=validateAttachment(String(attachment.name),String(attachment.media_type),bytes),sha256 = validated.sha256
        if (sha256 !== String(attachment.sha256)) throw new Error('Attachment archive integrity check failed')
        const id = randomUUID(), relativePath = `${id}-${validated.safeName}`;idMap.set(String(attachment.id),id)
        const targetPath = path.join(this.attachmentRoot, relativePath)
        writeFileSync(targetPath, bytes, { flag: 'wx',mode:0o600 })
        writtenFiles.push(targetPath)
        this.db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?)').run(id, workspace.id, owner, validated.safeName, String(attachment.media_type), sha256, relativePath, String(attachment.created_at))
      }
      for (const tombstoneValue of archive.objects.tombstones ?? []) {
        const tombstone = tombstoneValue as Record<string, unknown>, mapped = idMap.get(String(tombstone.object_id))!
        this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(mapped, workspace.id, String(tombstone.object_kind), String(tombstone.deleted_at))
      }
      for (const activityValue of archive.objects.activities ?? []) {
        const archived = activityValue as Record<string, unknown>, oldObjectId = archived.object_id ? String(archived.object_id) : undefined
        const mappedObjectId = oldObjectId === String((archive.workspace as Record<string, unknown>).id) ? workspace.id : oldObjectId ? idMap.get(oldObjectId) ?? null : null
        const metadata = remapArchiveValue(JSON.parse(String(archived.metadata_json ?? '{}')) as unknown, idMap, String((archive.workspace as Record<string, unknown>).id), workspace.id)
        this.db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), workspace.id, String(archived.category), String(archived.action), mappedObjectId, archived.object_kind ? String(archived.object_kind) : null, JSON.stringify(metadata), String(archived.created_at))
      }
      this.activity(workspace.id, 'lifecycle', 'workspace.restored', workspace.id, 'workspace', { archiveVersion: archive.version })
    }) } catch (error) {
      for (const file of writtenFiles) rmSync(file, { force: true })
      throw error
    }
    return workspace
  }

  counts(): Record<string, number> {
    const tables = ['workspaces','documents','revisions','chats','messages','memories','memory_suggestions','commitments','rule_suggestions','rule_suggestion_sources','learned_rules','rule_outcomes','relationships','attachments','embeddings','activities','tombstones','queued_work','security_profiles','executions','execution_events','search_fts']
    return Object.fromEntries(tables.map((table) => [table, Number((this.db.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: number }).count)]))
  }

  localDiagnostics(workspaceId: string): {
    schemaVersion: number; expectedSchemaVersion: number; integrity: 'ok'|'corrupt'; foreignKeyViolations:number;
    missingFiles: number; orphanFiles: number; digestMismatches: number; indexedObjects: number; expectedObjects: number;
  } {
    if (!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) throw new Error('Workspace not found')
    const integrityRows = this.db.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>
    const integrity = integrityRows.length === 1 && Object.values(integrityRows[0])[0] === 'ok' ? 'ok' : 'corrupt'
    const foreignKeyViolations=(this.db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length
    const attachments = this.db.prepare('SELECT relative_path,sha256 FROM attachments WHERE workspace_id=?').all(workspaceId) as Array<{relative_path:string;sha256:string}>
    const referenced = new Set((this.db.prepare('SELECT relative_path FROM attachments').all() as Array<{relative_path:string}>).map((row)=>row.relative_path))
    let missingFiles = 0, digestMismatches = 0
    for (const attachment of attachments) {
      const file = path.join(this.attachmentRoot, attachment.relative_path)
      if (!existsSync(file)) { missingFiles += 1; continue }
      if (createHash('sha256').update(readFileSync(file)).digest('hex') !== attachment.sha256) digestMismatches += 1
    }
    const orphanFiles = readdirSync(this.attachmentRoot).filter((entry) => !entry.includes('.deleting-') && !referenced.has(entry)).length
    const indexedObjects = Number((this.db.prepare('SELECT count(*) count FROM search_fts WHERE workspace_id=?').get(workspaceId) as {count:number}).count)
    const expectedObjects = Number((this.db.prepare(`SELECT
      (SELECT count(*) FROM documents WHERE workspace_id=?) +
      (SELECT count(*) FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=?) +
      (SELECT count(*) FROM memories WHERE workspace_id=?) count`).get(workspaceId,workspaceId,workspaceId) as {count:number}).count)
    return { schemaVersion: schemaVersion(this.db), expectedSchemaVersion: CURRENT_SCHEMA_VERSION, integrity, foreignKeyViolations, missingFiles, orphanFiles, digestMismatches, indexedObjects, expectedObjects }
  }

  rebuildTextIndex(workspaceId: string): void {
    if (!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) throw new Error('Workspace not found')
    this.transaction(() => {
      this.db.prepare('DELETE FROM search_fts WHERE workspace_id=?').run(workspaceId)
      this.db.prepare("INSERT INTO search_fts SELECT d.workspace_id,d.id,'document',r.id,d.title,r.body FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=?").run(workspaceId)
      this.db.prepare("INSERT INTO search_fts SELECT c.workspace_id,m.id,'message',NULL,c.title,m.body FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=?").run(workspaceId)
      this.db.prepare("INSERT INTO search_fts SELECT workspace_id,id,'memory',NULL,title,body FROM memories WHERE workspace_id=?").run(workspaceId)
      this.activity(workspaceId, 'maintenance', 'search.rebuilt', workspaceId, 'workspace', {})
    })
  }

  private activity(workspaceId: string, category: string, action: string, objectId: string, objectKind: string, metadata: Record<string, unknown>): void {
    this.db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), workspaceId, category, action, objectId, objectKind, JSON.stringify(metadata), now())
  }
  private indexText(workspaceId: string, objectId: string, kind: ObjectKind, revisionId: string | undefined, title: string, body: string): void { this.db.prepare('INSERT INTO search_fts VALUES (?,?,?,?,?,?)').run(workspaceId, objectId, kind, revisionId ?? null, title, body) }
  private attachmentPath(relativePath:string):string{if(relativePath!==path.basename(relativePath)||relativePath.includes('\0'))throw new Error('Stored attachment path is invalid');return path.join(this.attachmentRoot,relativePath)}
  private objectKindInWorkspace(workspaceId:string,id:string):'document'|'chat'|'message'|'memory'|undefined{
    for(const [table,kind] of [['documents','document'],['chats','chat'],['memories','memory']] as const)if(this.db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND workspace_id=?`).get(id,workspaceId))return kind
    if(this.db.prepare('SELECT 1 FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=? AND c.workspace_id=?').get(id,workspaceId))return'message'
    return undefined
  }
  private objectWorkspace(id: string, expectedKind?: string): string | undefined {
    const sources = expectedKind === 'document' ? [['documents', 'workspace_id']] : expectedKind === 'chat' ? [['chats', 'workspace_id']] : expectedKind === 'memory' ? [['memories', 'workspace_id']] : [
      ['documents', 'workspace_id'], ['chats', 'workspace_id'], ['memories', 'workspace_id'],
    ]
    for (const [table, column] of sources) {
      const row = this.db.prepare(`SELECT ${column} workspace_id FROM ${table} WHERE id=?`).get(id) as { workspace_id: string } | undefined
      if (row) return row.workspace_id
    }
    if (!expectedKind || expectedKind === 'message') {
      const row = this.db.prepare('SELECT c.workspace_id FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=?').get(id) as { workspace_id: string } | undefined
      if (row) return row.workspace_id
    }
    return undefined
  }
  private assertObjectInWorkspace(workspaceId: string, id: string, expectedKind?: string): void {
    if (this.objectWorkspace(id, expectedKind) !== workspaceId) throw new Error('Object not found in workspace')
  }
  private sourceTitle(id: string, kind: ObjectKind): { title: string; excerpt: string } {
    if (kind === 'document') { const row = this.db.prepare('SELECT d.title,r.body FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.id=?').get(id) as { title: string; body: string }; return { title: row.title, excerpt: row.body.slice(0, 180) } }
    if (kind === 'memory') { const row = this.db.prepare('SELECT title,body FROM memories WHERE id=?').get(id) as { title: string; body: string }; return { title: row.title, excerpt: row.body.slice(0, 180) } }
    if (kind === 'message') { const row = this.db.prepare('SELECT c.title,m.body FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=?').get(id) as { title: string; body: string }; return { title: row.title, excerpt: row.body.slice(0, 180) } }
    const row = this.db.prepare('SELECT title FROM chats WHERE id=?').get(id) as { title: string }; return { title: row.title, excerpt: '' }
  }
  private graphNode(id: string): GraphNode | undefined {
    for (const [table, kind] of [['documents','document'],['chats','chat'],['memories','memory']] as const) {
      const row = this.db.prepare(`SELECT title FROM ${table} WHERE id=?`).get(id) as { title: string } | undefined
      if (row) return { id, kind, title: row.title }
    }
    const message=this.db.prepare('SELECT c.title FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=?').get(id) as {title:string}|undefined
    if(message)return{id,kind:'message',title:`Message in ${message.title}`}
    return undefined
  }
  private rowsForWorkspace(table: string, workspaceId: string): unknown[] {
    if (table === 'revisions') return this.db.prepare('SELECT r.* FROM revisions r JOIN documents d ON d.id=r.document_id WHERE d.workspace_id=?').all(workspaceId)
    if (table === 'messages') return this.db.prepare('SELECT m.* FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=?').all(workspaceId)
    if (table === 'rule_suggestion_sources') return this.db.prepare('SELECT rs.* FROM rule_suggestion_sources rs JOIN rule_suggestions s ON s.id=rs.suggestion_id WHERE s.workspace_id=?').all(workspaceId)
    if (table === 'execution_events') return this.db.prepare('SELECT ee.* FROM execution_events ee JOIN executions e ON e.id=ee.execution_id WHERE e.workspace_id=?').all(workspaceId)
    return this.db.prepare(`SELECT * FROM ${table} WHERE workspace_id=?`).all(workspaceId)
  }

  private reconcileAttachmentFiles(): void {
    const referenced = new Set((this.db.prepare('SELECT relative_path FROM attachments').all() as Array<{ relative_path: string }>).map((row) => row.relative_path))
    const suffix = /\.deleting-[0-9a-f-]{36}$/
    for (const entry of readdirSync(this.attachmentRoot)) {
      const fullPath = path.join(this.attachmentRoot, entry), original = entry.replace(suffix, '')
      if (suffix.test(entry)) {
        if (referenced.has(original) && !existsSync(path.join(this.attachmentRoot, original))) renameSync(fullPath, path.join(this.attachmentRoot, original))
        else rmSync(fullPath, { force: true })
      } else if (!referenced.has(entry)) rmSync(fullPath, { force: true })
    }
  }
}

function cosine(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return Number.NaN
  let dot = 0, leftMagnitude = 0, rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) { dot += left[index] * right[index]; leftMagnitude += left[index] ** 2; rightMagnitude += right[index] ** 2 }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : Number.NaN
}

function remapArchiveValue(value: unknown, idMap: Map<string, string>, oldWorkspaceId: string, newWorkspaceId: string): unknown {
  if (typeof value === 'string') return value === oldWorkspaceId ? newWorkspaceId : idMap.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => remapArchiveValue(item, idMap, oldWorkspaceId, newWorkspaceId))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapArchiveValue(item, idMap, oldWorkspaceId, newWorkspaceId)]))
  return value
}
