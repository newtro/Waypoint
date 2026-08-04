import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ActivityFamily, ActivitySnapshotView, ActivityTimelineItem, ExportArchive, FixturePlaybookView, GraphEdge, GraphNode, MeetingView, ObjectKind, SearchResult, WorkspaceSummary } from './types.js';
import { WorkspaceSyncJournal } from './sync/workspace-sync-journal.js';
import type { InboundChange, LocalMutation } from './sync/sync-store.js';
import { archiveIntegrity, validateArchive } from './backup.js';
import { assertSupportedSchema, createMigrationSnapshot, CURRENT_SCHEMA_VERSION, runMigrations, schemaVersion } from './migrations.js';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_OWNER, MAX_ATTACHMENTS_PER_WORKSPACE, prepareAttachmentForProvider as prepareProviderAttachment, readAndValidateAttachment, validateAttachment, type AttachmentMetadata, type ProviderAttachmentPreparation } from './chat-attachments.js';
import { extractSuggestions, SUGGESTION_EXTRACTOR, SUGGESTION_SCAN_LIMITS } from './derived-suggestions.js';
import { composeDailyBriefing, localDayAt, type DailyBriefing, type BriefingSource } from './daily-briefing.js';
import { extractRuleDirectives, RULE_EXTRACTOR } from './learned-rules.js';
import { ACTIVITY_FAMILIES, activityFamily, safeActivityDetails } from './activity-timeline.js';
import { validateMeetingAudio, validateTranscript } from './meeting-audio.js';
import { assertPlaybookDefinition, FIXTURE_CONNECTOR, fixtureDryRun, nextDailyOccurrence, playbookDefinitionDigest, playbookDefinitionJson } from './fixture-automations.js';
import {parseExecutionBudget,securityProfileDigest} from './execution-budget.js';
import {createLocalEventEnvelope,LOCAL_TRIGGER_AUTHORITY,LOCAL_TRIGGER_LIMITS,localTriggerDryRun,suggestedTriggerRule,type LocalTriggerPayload} from './proactive-triggers.js';
import type {ToolReceipt,ToolRequest,ToolResult} from './tool-gateway.js';
import {FAILURE_TTL_MS,MAX_FAILURES_PER_TOOL,type ToolFailureIdentity,type ToolFailureMatch} from './tool-failure-learning.js';
import {summarizeUsage,validateOpenRouterSettings,type OpenRouterSettings,type ProviderUsageReceipt} from './openrouter-provider.js';
import { captureDecision, defaultActivityCapturePolicy, validateActivityCapturePolicy, type ActivityCapturePolicy, type ActivityFrameContext } from './activity-capture.js';
import { createRemoteJob, defaultWorkerPolicy, issueJobLease, jobRequestDigest, validateRemoteJob, validateWorkerPolicy, type CrossDeviceCapability, type RemoteJobEnvelope, type WorkerPolicy } from './cross-device-control.js';

const now = () => new Date().toISOString();
const contentDigest = (value: string) => createHash('sha256').update(value).digest('hex');
function canonicalIso(value:string){const parsed=Date.parse(value);return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(parsed)&&new Date(parsed).toISOString()===value}
const TOOL_IDENTITIES=['workspace.list_files','workspace.read_file','workspace.search','workspace.write_file','terminal.run','local_cli.run','waypoint.command'] as const;
function validToolFailureFields(value:{tool:string;capabilityVersion:string;fingerprint:string;context:string;errorClass:string;remediation:string;overrideReason:string;outcome:string;sourceReceiptId:string;expiresAt:string;createdAt:string;updatedAt:string;supersededByReceiptId?:string}){const created=Date.parse(value.createdAt),updated=Date.parse(value.updatedAt),expires=Date.parse(value.expiresAt);return(TOOL_IDENTITIES as readonly string[]).includes(value.tool)&&value.capabilityVersion.length>=1&&value.capabilityVersion.length<=120&&/^[a-f0-9]{64}$/.test(value.fingerprint)&&/^[a-f0-9]{64}$/.test(value.context)&&value.errorClass.length>=1&&value.errorClass.length<=80&&value.remediation.length<=300&&value.overrideReason.length<=300&&/^[A-Za-z0-9_-]{1,128}$/.test(value.sourceReceiptId)&&['active','superseded'].includes(value.outcome)&&canonicalIso(value.createdAt)&&canonicalIso(value.updatedAt)&&canonicalIso(value.expiresAt)&&created<=updated&&created<expires&&(value.outcome==='active'?!value.supersededByReceiptId:Boolean(value.supersededByReceiptId&&/^[A-Za-z0-9_-]{1,128}$/.test(value.supersededByReceiptId)))}

export class WorkspaceStore {
  private readonly db: DatabaseSync;
  private readonly attachmentRoot: string;
  private readonly meetingRoot: string;
  private readonly syncJournal: WorkspaceSyncJournal;

  constructor(readonly databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.attachmentRoot = path.join(path.dirname(databasePath), 'attachments');
    mkdirSync(this.attachmentRoot, { recursive: true, mode: 0o700 });
    chmodSync(this.attachmentRoot, 0o700);
    this.meetingRoot = path.join(path.dirname(databasePath), 'meeting-audio');
    mkdirSync(this.meetingRoot, { recursive: true, mode: 0o700 });
    chmodSync(this.meetingRoot, 0o700);
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    const priorVersion = assertSupportedSchema(this.db);
    createMigrationSnapshot(this.db, databasePath, priorVersion);
    this.migrate();
    this.syncJournal = new WorkspaceSyncJournal(this.db);
    for (const workspace of this.db.prepare('SELECT id FROM workspaces').all() as Array<{ id: string }>) this.syncJournal.ensureWorkspace(workspace.id);
    this.reconcileInterruptedExecutions();
    this.reconcileInterruptedToolReceipts();
    this.reconcileInterruptedHostedRuns();
    this.reconcileInterruptedMeetings();
    this.reconcileAttachmentFiles();
    this.reconcileMeetingFiles();
  }

  close(): void {
    this.db.close();
  }

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
      CREATE TABLE IF NOT EXISTS document_chunks(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,revision_id TEXT NOT NULL,attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,chunk_index INTEGER NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,text TEXT NOT NULL,text_digest TEXT NOT NULL,policy TEXT NOT NULL,policy_version TEXT NOT NULL,policy_digest TEXT NOT NULL,generation_digest TEXT NOT NULL,provider TEXT NOT NULL,provider_version TEXT NOT NULL,model TEXT NOT NULL,model_digest TEXT NOT NULL,dimensions INTEGER NOT NULL,vector_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(document_id,generation_digest,chunk_index));
      CREATE TABLE IF NOT EXISTS document_import_sources(document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,revision_id TEXT NOT NULL,attachment_id TEXT NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE CASCADE,source_digest TEXT NOT NULL,text_digest TEXT NOT NULL,extractor TEXT NOT NULL,extractor_version TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_trigger_settings(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,kill_switch INTEGER NOT NULL CHECK(kill_switch IN (0,1)),updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_events(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,schema_version INTEGER NOT NULL,source TEXT NOT NULL CHECK(source='webhook.fixture.local'),event_type TEXT NOT NULL,occurred_at TEXT NOT NULL,received_at TEXT NOT NULL,idempotency_key TEXT NOT NULL,payload_json TEXT NOT NULL,payload_digest TEXT NOT NULL,authority_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status='quarantined'),UNIQUE(workspace_id,source,idempotency_key));
      CREATE TABLE IF NOT EXISTS local_trigger_rules(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,source_event_id TEXT NOT NULL UNIQUE REFERENCES local_events(id) ON DELETE CASCADE,statement TEXT NOT NULL,version INTEGER NOT NULL,definition_json TEXT NOT NULL,definition_digest TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('suggested','paused','killed')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_trigger_runs(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,rule_id TEXT NOT NULL REFERENCES local_trigger_rules(id) ON DELETE CASCADE,event_id TEXT NOT NULL REFERENCES local_events(id) ON DELETE CASCADE,status TEXT NOT NULL CHECK(status IN ('dry_run','retrying','dead_letter')),attempt INTEGER NOT NULL,proposed_effects INTEGER NOT NULL CHECK(proposed_effects=0),run_digest TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(rule_id,event_id,run_digest,status,attempt));
      CREATE TABLE IF NOT EXISTS external_inbound_events(id TEXT PRIMARY KEY,source_event_id TEXT NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,channel_id TEXT NOT NULL,event_type TEXT NOT NULL,occurred_at TEXT NOT NULL,received_at TEXT NOT NULL,payload_json TEXT NOT NULL,payload_digest TEXT NOT NULL,status TEXT NOT NULL CHECK(status='quarantined'),created_at TEXT NOT NULL,UNIQUE(workspace_id,channel_id,source_event_id));
      CREATE TABLE IF NOT EXISTS tool_gateway_settings(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,stopped INTEGER NOT NULL CHECK(stopped IN (0,1)),deny_patterns_json TEXT NOT NULL,suppress_commit INTEGER NOT NULL CHECK(suppress_commit IN (0,1)),suppress_push INTEGER NOT NULL CHECK(suppress_push IN (0,1)),updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tool_gateway_receipts(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,origin TEXT NOT NULL CHECK(origin IN ('ui','ai')),tool TEXT NOT NULL,status TEXT NOT NULL,capability_version TEXT NOT NULL,device TEXT NOT NULL CHECK(device='local'),profile_name TEXT NOT NULL,policy_digest TEXT NOT NULL,summary TEXT NOT NULL,code TEXT,notification TEXT,rollback_ref TEXT,output_bytes INTEGER NOT NULL,truncated INTEGER NOT NULL CHECK(truncated IN (0,1)),started_at TEXT NOT NULL,finished_at TEXT NOT NULL,duration_ms INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_tool_gateway_receipts_workspace ON tool_gateway_receipts(workspace_id,started_at DESC,id);
      CREATE TABLE IF NOT EXISTS tool_failure_knowledge(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,client_scope TEXT NOT NULL CHECK(client_scope='local-personal'),source_receipt_id TEXT NOT NULL REFERENCES tool_gateway_receipts(id) ON DELETE CASCADE,tool TEXT NOT NULL,capability_version TEXT NOT NULL,parameter_fingerprint TEXT NOT NULL,context_digest TEXT NOT NULL,error_class TEXT NOT NULL,remediation TEXT,override_reason TEXT,outcome TEXT NOT NULL CHECK(outcome IN ('active','superseded')),expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,superseded_by_receipt_id TEXT,UNIQUE(workspace_id,client_scope,tool,capability_version,parameter_fingerprint,context_digest));
      CREATE INDEX IF NOT EXISTS idx_tool_failure_active ON tool_failure_knowledge(workspace_id,tool,outcome,expires_at,updated_at DESC);
      CREATE TABLE IF NOT EXISTS provider_settings(provider TEXT PRIMARY KEY CHECK(provider='openrouter'),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),live_requests_enabled INTEGER NOT NULL CHECK(live_requests_enabled IN (0,1)),strategic_model TEXT NOT NULL,everyday_model TEXT NOT NULL,fallback_provider TEXT CHECK(fallback_provider IN ('codex','claude')),monthly_cap_micros INTEGER NOT NULL,ytd_cap_micros INTEGER NOT NULL,per_request_cap_micros INTEGER NOT NULL,warning_percent INTEGER NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_usage_receipts(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,provider TEXT NOT NULL CHECK(provider='openrouter'),model TEXT NOT NULL,route_role TEXT NOT NULL CHECK(route_role IN ('strategic','everyday')),status TEXT NOT NULL CHECK(status IN ('completed','failed','canceled','blocked')),cost_micros INTEGER NOT NULL,prompt_tokens INTEGER NOT NULL,completion_tokens INTEGER NOT NULL,request_digest TEXT NOT NULL,response_id TEXT,error_code TEXT,fallback_provider TEXT CHECK(fallback_provider IN ('codex','claude')),started_at TEXT NOT NULL,finished_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_provider_usage_workspace_time ON provider_usage_receipts(workspace_id,finished_at DESC,id);
      CREATE TABLE IF NOT EXISTS hosted_runs(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,route_role TEXT NOT NULL CHECK(route_role IN ('strategic','everyday')),model TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','canceled')),started_at TEXT,finished_at TEXT,error_code TEXT,usage_receipt_id TEXT REFERENCES provider_usage_receipts(id) ON DELETE SET NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hosted_run_events(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES hosted_runs(id) ON DELETE CASCADE,sequence INTEGER NOT NULL,type TEXT NOT NULL,text TEXT,created_at TEXT NOT NULL,UNIQUE(run_id,sequence));
      CREATE INDEX IF NOT EXISTS idx_document_chunks_search ON document_chunks(workspace_id,provider,provider_version,model,model_digest,policy_digest);
      CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, category TEXT NOT NULL, action TEXT NOT NULL, object_id TEXT, object_kind TEXT, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_activities_workspace_created ON activities(workspace_id,created_at DESC,id);
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
      CREATE TABLE IF NOT EXISTS meetings(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,title TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('recording','ready','failed')),consent_acknowledged_at TEXT NOT NULL,consent_version TEXT NOT NULL,audio_relative_path TEXT,media_type TEXT,bytes INTEGER NOT NULL DEFAULT 0,sha256 TEXT,transcript TEXT,transcript_status TEXT NOT NULL CHECK(transcript_status IN ('none','draft','reviewed')),speaker_handling TEXT NOT NULL CHECK(speaker_handling='uncertain'),failure_code TEXT,created_at TEXT NOT NULL,ended_at TEXT);
      CREATE TABLE IF NOT EXISTS fixture_playbooks(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,title TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('paused','killed')),timezone TEXT NOT NULL,hour INTEGER NOT NULL,minute INTEGER NOT NULL,definition_json TEXT NOT NULL,definition_digest TEXT NOT NULL,permission_json TEXT NOT NULL,last_dry_run_digest TEXT,last_dry_run_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixture_playbook_runs(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,playbook_id TEXT NOT NULL REFERENCES fixture_playbooks(id) ON DELETE CASCADE,idempotency_key TEXT,status TEXT NOT NULL CHECK(status IN ('dry_run','completed','retrying','dead_letter')),attempt INTEGER NOT NULL,input_count INTEGER NOT NULL,output_count INTEGER NOT NULL,proposed_effects INTEGER NOT NULL CHECK(proposed_effects=0),permission_json TEXT NOT NULL,created_at TEXT NOT NULL,finished_at TEXT,UNIQUE(playbook_id,idempotency_key));
      CREATE TRIGGER IF NOT EXISTS invalidate_rule_after_source_delete AFTER DELETE ON rule_suggestion_sources WHEN (SELECT count(*) FROM rule_suggestion_sources WHERE suggestion_id=OLD.suggestion_id)<2 BEGIN DELETE FROM rule_suggestions WHERE id=OLD.suggestion_id; END;
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(workspace_id UNINDEXED, object_id UNINDEXED, object_kind UNINDEXED, revision_id UNINDEXED, title, body);
    `);
    const memoryColumns = this.db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>;
    if (!memoryColumns.some((column) => column.name === 'ownership')) this.db.exec("ALTER TABLE memories ADD COLUMN ownership TEXT NOT NULL DEFAULT 'workspace-owned'");
    const ftsColumns = this.db.prepare('PRAGMA table_info(search_fts)').all() as Array<{ name: string }>;
    if (!ftsColumns.some((column) => column.name === 'workspace_id')) {
      this.db.exec('DROP TABLE search_fts; CREATE VIRTUAL TABLE search_fts USING fts5(workspace_id UNINDEXED, object_id UNINDEXED, object_kind UNINDEXED, revision_id UNINDEXED, title, body);');
      this.db.exec(`
        INSERT INTO search_fts SELECT d.workspace_id,d.id,'document',r.id,d.title,r.body FROM documents d JOIN revisions r ON r.id=d.current_revision_id;
        INSERT INTO search_fts SELECT c.workspace_id,m.id,'message',NULL,c.title,m.body FROM messages m JOIN chats c ON c.id=m.chat_id;
        INSERT INTO search_fts SELECT workspace_id,id,'memory',NULL,title,body FROM memories;
        INSERT OR IGNORE INTO schema_versions VALUES (2, '${now()}');
      `);
    }
    this.db.prepare('INSERT OR IGNORE INTO schema_versions VALUES (?,?)').run(2, now());
    this.db.prepare('INSERT OR IGNORE INTO schema_versions VALUES (?,?)').run(3, now());
    this.db.prepare('INSERT OR IGNORE INTO schema_versions VALUES (?,?)').run(4, now());
    runMigrations(this.db, schemaVersion(this.db), [
      {
        version: 5,
        apply: (database) =>
          database.exec(`
      CREATE TABLE app_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    `),
      },
      {
        version: 6,
        apply: (database) => {
          const columns = database.prepare('PRAGMA table_info(executions)').all() as Array<{ name: string }>;
          if (!columns.some((column) => column.name === 'source_message_id')) database.exec('ALTER TABLE executions ADD COLUMN source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL');
        },
      },
      {
        version: 7,
        apply: (database) => WorkspaceSyncJournal.install(database),
      },
      {
        version: 8,
        apply: (database) => database.exec(`CREATE TABLE IF NOT EXISTS memory_suggestions(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,source_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,source_role TEXT NOT NULL,category TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,source_excerpt TEXT NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,confidence REAL NOT NULL,extractor TEXT NOT NULL,extractor_version TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),accepted_object_id TEXT,resolved_at TEXT,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS commitments(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,suggestion_id TEXT NOT NULL UNIQUE REFERENCES memory_suggestions(id) ON DELETE CASCADE,source_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,title TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','completed')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT);`),
      },
    ]);
    runMigrations(this.db, schemaVersion(this.db), [
      {
        version: 9,
        apply: (database) => {
          const columns = database.prepare('PRAGMA table_info(memory_suggestions)').all() as Array<{ name: string }>;
          if (columns.some((column) => column.name === 'source_digest')) return;
          database.exec("ALTER TABLE memory_suggestions ADD COLUMN source_digest TEXT NOT NULL DEFAULT ''");
          const legacy = database.prepare('SELECT s.id,s.status,s.chat_id chatId,s.source_role sourceRole,s.source_excerpt sourceExcerpt,s.start_offset startOffset,s.end_offset endOffset,m.body,m.role,m.chat_id messageChatId FROM memory_suggestions s JOIN messages m ON m.id=s.source_message_id').all() as Array<Record<string, unknown>>;
          const update = database.prepare('UPDATE memory_suggestions SET source_digest=? WHERE id=?'),
            remove = database.prepare("DELETE FROM memory_suggestions WHERE id=? AND status='pending'");
          for (const item of legacy) {
            const body = String(item.body),
              exact = String(item.sourceExcerpt) === body.slice(Number(item.startOffset), Number(item.endOffset)) && String(item.sourceRole) === String(item.role) && String(item.chatId) === String(item.messageChatId);
            if (exact) update.run(contentDigest(body), String(item.id));
            else if (item.status === 'pending') remove.run(String(item.id));
            else update.run('legacy-unverified', String(item.id));
          }
        },
      },
    ]);
    runMigrations(this.db, schemaVersion(this.db), [
      {
        version: 10,
        apply: (database) => database.exec("CREATE TABLE IF NOT EXISTS briefing_dismissals(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,source_id TEXT NOT NULL,source_kind TEXT NOT NULL CHECK(source_kind IN ('commitment','document','memory')),local_day TEXT NOT NULL,dismissed_at TEXT NOT NULL,PRIMARY KEY(workspace_id,source_id,source_kind,local_day));CREATE INDEX IF NOT EXISTS idx_briefing_dismissals_day ON briefing_dismissals(workspace_id,local_day);CREATE TRIGGER IF NOT EXISTS delete_commitment_briefing_dismissal AFTER DELETE ON commitments BEGIN DELETE FROM briefing_dismissals WHERE workspace_id=OLD.workspace_id AND source_id=OLD.id AND source_kind='commitment'; END;CREATE TRIGGER IF NOT EXISTS delete_document_briefing_dismissal AFTER DELETE ON documents BEGIN DELETE FROM briefing_dismissals WHERE workspace_id=OLD.workspace_id AND source_id=OLD.id AND source_kind='document'; END;CREATE TRIGGER IF NOT EXISTS delete_memory_briefing_dismissal AFTER DELETE ON memories BEGIN DELETE FROM briefing_dismissals WHERE workspace_id=OLD.workspace_id AND source_id=OLD.id AND source_kind='memory'; END;"),
      },
    ]);
    runMigrations(this.db, schemaVersion(this.db), [
      {
        version: 11,
        apply: (database) => database.exec("CREATE TABLE IF NOT EXISTS rule_suggestions(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,statement TEXT NOT NULL,normalized TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,scope TEXT NOT NULL CHECK(scope='workspace'),confidence REAL NOT NULL,extractor TEXT NOT NULL,extractor_version TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),last_dry_run_digest TEXT,last_dry_run_at TEXT,resolved_at TEXT,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS rule_suggestion_sources(suggestion_id TEXT NOT NULL REFERENCES rule_suggestions(id) ON DELETE CASCADE,message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,excerpt TEXT NOT NULL,source_digest TEXT NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,PRIMARY KEY(suggestion_id,message_id));CREATE TABLE IF NOT EXISTS learned_rules(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,suggestion_id TEXT NOT NULL UNIQUE REFERENCES rule_suggestions(id) ON DELETE CASCADE,statement TEXT NOT NULL,scope TEXT NOT NULL CHECK(scope='workspace'),version INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),prior_enabled INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS rule_outcomes(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,rule_id TEXT REFERENCES learned_rules(id) ON DELETE CASCADE,suggestion_id TEXT REFERENCES rule_suggestions(id) ON DELETE CASCADE,action TEXT NOT NULL,match_count INTEGER NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL);CREATE TRIGGER IF NOT EXISTS invalidate_rule_after_source_delete AFTER DELETE ON rule_suggestion_sources WHEN (SELECT count(*) FROM rule_suggestion_sources WHERE suggestion_id=OLD.suggestion_id)<2 BEGIN DELETE FROM rule_suggestions WHERE id=OLD.suggestion_id; END;"),
      },
    ]);
    runMigrations(this.db, schemaVersion(this.db), [
      {
        version: 12,
        apply: (database) => database.exec('CREATE INDEX IF NOT EXISTS idx_activities_workspace_created ON activities(workspace_id,created_at DESC,id)'),
      },
    ]);
    runMigrations(this.db, schemaVersion(this.db), [
      {
        version: 13,
        apply: (database) => database.exec("CREATE TABLE IF NOT EXISTS meetings(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,title TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('recording','ready','failed')),consent_acknowledged_at TEXT NOT NULL,consent_version TEXT NOT NULL,audio_relative_path TEXT,media_type TEXT,bytes INTEGER NOT NULL DEFAULT 0,sha256 TEXT,transcript TEXT,transcript_status TEXT NOT NULL CHECK(transcript_status IN ('none','draft','reviewed')),speaker_handling TEXT NOT NULL CHECK(speaker_handling='uncertain'),failure_code TEXT,created_at TEXT NOT NULL,ended_at TEXT)"),
      },
    ]);
    runMigrations(this.db, schemaVersion(this.db), [
      {
        version: 14,
        apply: (database) => database.exec("CREATE TABLE IF NOT EXISTS fixture_playbooks(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,title TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('paused','killed')),timezone TEXT NOT NULL,hour INTEGER NOT NULL,minute INTEGER NOT NULL,definition_json TEXT NOT NULL,definition_digest TEXT NOT NULL,permission_json TEXT NOT NULL,last_dry_run_digest TEXT,last_dry_run_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS fixture_playbook_runs(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,playbook_id TEXT NOT NULL REFERENCES fixture_playbooks(id) ON DELETE CASCADE,idempotency_key TEXT,status TEXT NOT NULL CHECK(status IN ('dry_run','completed','retrying','dead_letter')),attempt INTEGER NOT NULL,input_count INTEGER NOT NULL,output_count INTEGER NOT NULL,proposed_effects INTEGER NOT NULL CHECK(proposed_effects=0),permission_json TEXT NOT NULL,created_at TEXT NOT NULL,finished_at TEXT,UNIQUE(playbook_id,idempotency_key))"),
      },
    ]);
    runMigrations(this.db, schemaVersion(this.db), [
      {
        version: 15,
        apply: (database) => database.exec("CREATE TABLE IF NOT EXISTS document_chunks(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,revision_id TEXT NOT NULL,attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,chunk_index INTEGER NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,text TEXT NOT NULL,text_digest TEXT NOT NULL,policy TEXT NOT NULL,policy_version TEXT NOT NULL,policy_digest TEXT NOT NULL,generation_digest TEXT NOT NULL,provider TEXT NOT NULL,provider_version TEXT NOT NULL,model TEXT NOT NULL,model_digest TEXT NOT NULL,dimensions INTEGER NOT NULL,vector_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(document_id,generation_digest,chunk_index));CREATE INDEX IF NOT EXISTS idx_document_chunks_search ON document_chunks(workspace_id,provider,provider_version,model,model_digest,policy_digest);CREATE TABLE IF NOT EXISTS document_import_sources(document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,revision_id TEXT NOT NULL,attachment_id TEXT NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE CASCADE,source_digest TEXT NOT NULL,text_digest TEXT NOT NULL,extractor TEXT NOT NULL,extractor_version TEXT NOT NULL,created_at TEXT NOT NULL)"),
      },
    ]);
    runMigrations(this.db,schemaVersion(this.db),[{version:16,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS local_trigger_settings(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,kill_switch INTEGER NOT NULL CHECK(kill_switch IN (0,1)),updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS local_events(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,schema_version INTEGER NOT NULL,source TEXT NOT NULL CHECK(source='webhook.fixture.local'),event_type TEXT NOT NULL,occurred_at TEXT NOT NULL,received_at TEXT NOT NULL,idempotency_key TEXT NOT NULL,payload_json TEXT NOT NULL,payload_digest TEXT NOT NULL,authority_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status='quarantined'),UNIQUE(workspace_id,source,idempotency_key));CREATE TABLE IF NOT EXISTS local_trigger_rules(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,source_event_id TEXT NOT NULL UNIQUE REFERENCES local_events(id) ON DELETE CASCADE,statement TEXT NOT NULL,version INTEGER NOT NULL,definition_json TEXT NOT NULL,definition_digest TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('suggested','paused','killed')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS local_trigger_runs(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,rule_id TEXT NOT NULL REFERENCES local_trigger_rules(id) ON DELETE CASCADE,event_id TEXT NOT NULL REFERENCES local_events(id) ON DELETE CASCADE,status TEXT NOT NULL CHECK(status IN ('dry_run','retrying','dead_letter')),attempt INTEGER NOT NULL,proposed_effects INTEGER NOT NULL CHECK(proposed_effects=0),run_digest TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(rule_id,event_id,run_digest,status,attempt))")}]);
    runMigrations(this.db,schemaVersion(this.db),[{version:17,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS external_inbound_events(id TEXT PRIMARY KEY,source_event_id TEXT NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,channel_id TEXT NOT NULL,event_type TEXT NOT NULL,occurred_at TEXT NOT NULL,received_at TEXT NOT NULL,payload_json TEXT NOT NULL,payload_digest TEXT NOT NULL,status TEXT NOT NULL CHECK(status='quarantined'),created_at TEXT NOT NULL,UNIQUE(workspace_id,channel_id,source_event_id))")}]);
    runMigrations(this.db,schemaVersion(this.db),[{version:18,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS tool_gateway_settings(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,stopped INTEGER NOT NULL CHECK(stopped IN (0,1)),deny_patterns_json TEXT NOT NULL,suppress_commit INTEGER NOT NULL CHECK(suppress_commit IN (0,1)),suppress_push INTEGER NOT NULL CHECK(suppress_push IN (0,1)),updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS tool_gateway_receipts(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,origin TEXT NOT NULL CHECK(origin IN ('ui','ai')),tool TEXT NOT NULL,status TEXT NOT NULL,capability_version TEXT NOT NULL,device TEXT NOT NULL CHECK(device='local'),profile_name TEXT NOT NULL,policy_digest TEXT NOT NULL,summary TEXT NOT NULL,code TEXT,notification TEXT,rollback_ref TEXT,output_bytes INTEGER NOT NULL,truncated INTEGER NOT NULL CHECK(truncated IN (0,1)),started_at TEXT NOT NULL,finished_at TEXT NOT NULL,duration_ms INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS idx_tool_gateway_receipts_workspace ON tool_gateway_receipts(workspace_id,started_at DESC,id)")},{version:19,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS tool_failure_knowledge(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,client_scope TEXT NOT NULL CHECK(client_scope='local-personal'),source_receipt_id TEXT NOT NULL REFERENCES tool_gateway_receipts(id) ON DELETE CASCADE,tool TEXT NOT NULL,capability_version TEXT NOT NULL,parameter_fingerprint TEXT NOT NULL,context_digest TEXT NOT NULL,error_class TEXT NOT NULL,remediation TEXT,override_reason TEXT,outcome TEXT NOT NULL CHECK(outcome IN ('active','superseded')),expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,superseded_by_receipt_id TEXT,UNIQUE(workspace_id,client_scope,tool,capability_version,parameter_fingerprint,context_digest));CREATE INDEX IF NOT EXISTS idx_tool_failure_active ON tool_failure_knowledge(workspace_id,tool,outcome,expires_at,updated_at DESC)")},{version:20,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS provider_settings(provider TEXT PRIMARY KEY CHECK(provider='openrouter'),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),live_requests_enabled INTEGER NOT NULL CHECK(live_requests_enabled IN (0,1)),strategic_model TEXT NOT NULL,everyday_model TEXT NOT NULL,fallback_provider TEXT CHECK(fallback_provider IN ('codex','claude')),monthly_cap_micros INTEGER NOT NULL,ytd_cap_micros INTEGER NOT NULL,per_request_cap_micros INTEGER NOT NULL,warning_percent INTEGER NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS provider_usage_receipts(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,provider TEXT NOT NULL CHECK(provider='openrouter'),model TEXT NOT NULL,route_role TEXT NOT NULL CHECK(route_role IN ('strategic','everyday')),status TEXT NOT NULL CHECK(status IN ('completed','failed','canceled','blocked')),cost_micros INTEGER NOT NULL,prompt_tokens INTEGER NOT NULL,completion_tokens INTEGER NOT NULL,request_digest TEXT NOT NULL,response_id TEXT,error_code TEXT,fallback_provider TEXT CHECK(fallback_provider IN ('codex','claude')),started_at TEXT NOT NULL,finished_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS idx_provider_usage_workspace_time ON provider_usage_receipts(workspace_id,finished_at DESC,id)")}]);
    runMigrations(this.db,schemaVersion(this.db),[{version:21,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS hosted_runs(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,route_role TEXT NOT NULL CHECK(route_role IN ('strategic','everyday')),model TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','canceled')),started_at TEXT,finished_at TEXT,error_code TEXT,usage_receipt_id TEXT REFERENCES provider_usage_receipts(id) ON DELETE SET NULL,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS hosted_run_events(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES hosted_runs(id) ON DELETE CASCADE,sequence INTEGER NOT NULL,type TEXT NOT NULL,text TEXT,created_at TEXT NOT NULL,UNIQUE(run_id,sequence))")}]);
    runMigrations(this.db,schemaVersion(this.db),[{version:22,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS activity_capture_settings(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),paused INTEGER NOT NULL CHECK(paused IN (0,1)),retention_days INTEGER NOT NULL CHECK(retention_days IN (90,183,365)),sync_raw INTEGER NOT NULL CHECK(sync_raw IN (0,1)),exclusions_json TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS activity_snapshots(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,attachment_id TEXT NOT NULL UNIQUE,captured_at TEXT NOT NULL,device_id TEXT NOT NULL,display_id TEXT NOT NULL,app_bundle_id TEXT NOT NULL,app_process TEXT NOT NULL,app_title TEXT,policy_version INTEGER NOT NULL,source_sha256 TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS idx_activity_snapshots_timeline ON activity_snapshots(workspace_id,captured_at DESC,id)")}]);
    runMigrations(this.db,schemaVersion(this.db),[{version:23,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS device_control_settings(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,worker_enabled INTEGER NOT NULL CHECK(worker_enabled IN (0,1)),preferred_device_id TEXT,failover INTEGER NOT NULL CHECK(failover IN (0,1)),allowed_capabilities_json TEXT NOT NULL,max_duration_ms INTEGER NOT NULL,max_concurrency INTEGER NOT NULL CHECK(max_concurrency=1),updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS remote_jobs(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,controller_device_id TEXT NOT NULL,target_device_id TEXT NOT NULL,capability TEXT NOT NULL,instruction TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_digest TEXT NOT NULL,profile_digest TEXT NOT NULL,key_epoch INTEGER NOT NULL,timeout_ms INTEGER NOT NULL,origin TEXT NOT NULL CHECK(origin='user'),status TEXT NOT NULL CHECK(status IN ('queued','leased','running','completed','failed','canceled','timed_out')),lease_id TEXT,lease_expires_at TEXT,result_summary TEXT,error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(workspace_id,controller_device_id,idempotency_key));CREATE INDEX IF NOT EXISTS idx_remote_jobs_target ON remote_jobs(workspace_id,target_device_id,status,created_at);CREATE TABLE IF NOT EXISTS remote_job_events(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES remote_jobs(id) ON DELETE CASCADE,sequence INTEGER NOT NULL,type TEXT NOT NULL,summary TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(job_id,sequence))")}]);
    runMigrations(this.db,schemaVersion(this.db),[{version:24,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS chat_model_preferences(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,provider TEXT NOT NULL CHECK(provider IN ('codex','claude')),model TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(workspace_id,provider))")}]);
    runMigrations(this.db,schemaVersion(this.db),[{version:25,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS voice_preferences(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,mode TEXT NOT NULL CHECK(mode IN ('push_to_talk','hands_free')),microphone_id TEXT NOT NULL,output_voice TEXT NOT NULL CHECK(output_voice='system'),updated_at TEXT NOT NULL)")}]);
    runMigrations(this.db,schemaVersion(this.db),[{version:26,apply:(database)=>{const columns=database.prepare('PRAGMA table_info(voice_preferences)').all()as Array<{name:string}>;if(!columns.some((item)=>item.name==='engine'))database.exec("ALTER TABLE voice_preferences ADD COLUMN engine TEXT NOT NULL DEFAULT 'fast_local' CHECK(engine IN ('fast_local','full_duplex_experimental'))");database.exec("CREATE TABLE IF NOT EXISTS voice_engine_metrics(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,engine TEXT NOT NULL CHECK(engine IN ('fast_local','full_duplex_experimental')),first_audio_ms INTEGER,interruption_ms INTEGER,turn_end_ms INTEGER,fixture INTEGER NOT NULL CHECK(fixture IN (0,1)),measured_at TEXT NOT NULL,PRIMARY KEY(workspace_id,engine))")}}]);
    runMigrations(this.db,schemaVersion(this.db),[{version:27,apply:(database)=>database.exec("CREATE TABLE IF NOT EXISTS reflection_runs(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,status TEXT NOT NULL CHECK(status IN ('queued','reviewing','proposed','stale','accepted','rejected','cancelled','failed','killed')),provider TEXT NOT NULL,provider_version TEXT NOT NULL,policy_version TEXT NOT NULL,budget_json TEXT NOT NULL,omissions_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS reflection_sources(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES reflection_runs(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,source_id TEXT NOT NULL,source_kind TEXT NOT NULL CHECK(source_kind IN ('memory','document')),source_digest TEXT NOT NULL,source_updated_at TEXT NOT NULL,UNIQUE(run_id,source_id));CREATE TABLE IF NOT EXISTS reflection_proposals(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES reflection_runs(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('duplicate','stale','contradiction','relationship','rule')),title TEXT NOT NULL,before_body TEXT NOT NULL,proposed_body TEXT NOT NULL,rationale TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('proposed','accepted','edited','rejected','stale','rolled_back')),accepted_object_id TEXT,created_at TEXT NOT NULL,resolved_at TEXT);CREATE TABLE IF NOT EXISTS reflection_proposal_sources(proposal_id TEXT NOT NULL REFERENCES reflection_proposals(id) ON DELETE CASCADE,source_row_id TEXT NOT NULL REFERENCES reflection_sources(id) ON DELETE CASCADE,PRIMARY KEY(proposal_id,source_row_id));CREATE INDEX IF NOT EXISTS idx_reflection_runs_workspace ON reflection_runs(workspace_id,created_at DESC);CREATE INDEX IF NOT EXISTS idx_reflection_proposals_run ON reflection_proposals(run_id,status,created_at);CREATE TRIGGER IF NOT EXISTS reflection_source_removed AFTER DELETE ON reflection_sources BEGIN UPDATE reflection_runs SET status='stale',updated_at=datetime('now') WHERE id=OLD.run_id AND status IN ('queued','reviewing','proposed');UPDATE reflection_proposals SET status='stale',resolved_at=datetime('now') WHERE run_id=OLD.run_id AND status='proposed';END;CREATE TRIGGER IF NOT EXISTS reflection_memory_source_deleted AFTER DELETE ON memories BEGIN DELETE FROM memories WHERE id IN (SELECT p.accepted_object_id FROM reflection_proposals p JOIN reflection_proposal_sources ps ON ps.proposal_id=p.id JOIN reflection_sources s ON s.id=ps.source_row_id WHERE s.source_id=OLD.id AND s.source_kind='memory' AND p.accepted_object_id IS NOT NULL);UPDATE reflection_runs SET status='stale',updated_at=datetime('now') WHERE id IN (SELECT run_id FROM reflection_sources WHERE source_id=OLD.id AND source_kind='memory') AND status IN ('queued','reviewing','proposed');UPDATE reflection_proposals SET status='stale',resolved_at=datetime('now') WHERE run_id IN (SELECT run_id FROM reflection_sources WHERE source_id=OLD.id AND source_kind='memory') AND status='proposed';DELETE FROM reflection_sources WHERE source_id=OLD.id AND source_kind='memory';DELETE FROM memories WHERE source_object_id=OLD.id AND ownership='source-owned';END;CREATE TRIGGER IF NOT EXISTS reflection_document_source_deleted AFTER DELETE ON documents BEGIN DELETE FROM memories WHERE id IN (SELECT p.accepted_object_id FROM reflection_proposals p JOIN reflection_proposal_sources ps ON ps.proposal_id=p.id JOIN reflection_sources s ON s.id=ps.source_row_id WHERE s.source_id=OLD.id AND s.source_kind='document' AND p.accepted_object_id IS NOT NULL);UPDATE reflection_runs SET status='stale',updated_at=datetime('now') WHERE id IN (SELECT run_id FROM reflection_sources WHERE source_id=OLD.id AND source_kind='document') AND status IN ('queued','reviewing','proposed');UPDATE reflection_proposals SET status='stale',resolved_at=datetime('now') WHERE run_id IN (SELECT run_id FROM reflection_sources WHERE source_id=OLD.id AND source_kind='document') AND status='proposed';DELETE FROM reflection_sources WHERE source_id=OLD.id AND source_kind='document';DELETE FROM memories WHERE source_object_id=OLD.id AND ownership='source-owned';END") }]);
    this.db.exec("CREATE TRIGGER IF NOT EXISTS reflection_run_queued_on_insert AFTER INSERT ON reflection_runs BEGIN UPDATE reflection_runs SET status='queued' WHERE id=NEW.id; END;CREATE TRIGGER IF NOT EXISTS reflection_run_stale_with_proposal AFTER UPDATE OF status ON reflection_proposals WHEN NEW.status='stale' BEGIN UPDATE reflection_runs SET status='stale',updated_at=datetime('now') WHERE id=NEW.run_id; END");
    this.db.prepare("UPDATE reflection_runs SET status='failed',omissions_json=?,updated_at=? WHERE status IN ('queued','reviewing')").run(JSON.stringify(['Interrupted by application restart before a terminal CLI result.']),now());
    for (const workspace of this.db.prepare('SELECT id,local_path localPath FROM workspaces').all() as Array<{ id: string; localPath: string }>) {
      const executionRoot = path.join(workspace.localPath, 'waypoint-workspaces', workspace.id);
      mkdirSync(executionRoot, { recursive: true });
      const existing = this.db.prepare("SELECT id FROM security_profiles WHERE workspace_id=? AND name='Workspace — conservative'").get(workspace.id);
      if (existing) this.db.prepare("UPDATE security_profiles SET roots_json=? WHERE workspace_id=? AND name='Workspace — conservative'").run(JSON.stringify([executionRoot]), workspace.id);
      else this.createDefaultSecurityProfile(workspace.id, workspace.localPath);
      this.ensureAutonomousDeveloperProfile(workspace.id, workspace.localPath);
    }
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private reconcileInterruptedMeetings(): void {
    const timestamp = now();
    this.transaction(() => {
      const rows = this.db.prepare("SELECT id,workspace_id workspaceId FROM meetings WHERE status='recording'").all() as Array<{ id: string; workspaceId: string }>;
      for (const row of rows) {
        this.db.prepare("UPDATE meetings SET status='failed',failure_code='interrupted',ended_at=? WHERE id=?").run(timestamp, row.id);
        this.activity(row.workspaceId, 'meeting', 'recording.failed', row.id, 'meeting', {});
      }
    });
  }
  private reconcileInterruptedToolReceipts():void{const timestamp=now(),rows=this.db.prepare("SELECT id,workspace_id workspaceId FROM tool_gateway_receipts WHERE status='running'").all() as Array<{id:string;workspaceId:string}>;for(const row of rows){this.db.prepare("UPDATE tool_gateway_receipts SET status='failed',summary='Waypoint stopped before the tool reached a terminal state',code='interrupted',finished_at=?,duration_ms=max(0,unixepoch(?)*1000-unixepoch(started_at)*1000) WHERE id=?").run(timestamp,timestamp,row.id);this.activity(row.workspaceId,'ai','tool.failed',row.id,'tool_receipt',{tool:'unknown',origin:'recovery',status:'failed',code:'interrupted'})}}
  private reconcileInterruptedHostedRuns():void{const timestamp=now(),rows=this.db.prepare("SELECT id FROM hosted_runs WHERE status IN ('queued','running')").all() as Array<{id:string}>;for(const row of rows){this.db.prepare("UPDATE hosted_runs SET status='failed',finished_at=?,error_code='interrupted' WHERE id=?").run(timestamp,row.id);const sequence=Number((this.db.prepare('SELECT coalesce(max(sequence),0)+1 next FROM hosted_run_events WHERE run_id=?').get(row.id) as {next:number}).next);this.db.prepare("INSERT INTO hosted_run_events VALUES (?,?,?,?,?,?)").run(randomUUID(),row.id,sequence,'terminal','Waypoint restarted before the hosted request completed',timestamp)}}

  createWorkspace(name: string, localPath: string): WorkspaceSummary {
    if (!name.trim() || !path.isAbsolute(localPath)) throw new Error('Workspace name and absolute local path are required');
    const workspace = {
      id: randomUUID(),
      name: name.trim(),
      localPath: path.resolve(localPath),
      createdAt: now(),
    };
    this.transaction(() => {
      this.db.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspace.id, workspace.name, workspace.localPath, workspace.createdAt);
      this.syncJournal.ensureWorkspace(workspace.id);
      this.createDefaultSecurityProfile(workspace.id, workspace.localPath);
      this.activity(workspace.id, 'workspace', 'created', workspace.id, 'workspace', { localPath: workspace.localPath });
    });
    return workspace;
  }

  syncStatus(workspaceId: string): Record<string, unknown> {
    return this.syncJournal.status(workspaceId);
  }
  configureSyncDevice(workspaceId: string, deviceId: string): void {
    this.syncJournal.configureDevice(workspaceId, deviceId);
  }
  pendingSyncChanges(workspaceId: string): LocalMutation[] {
    return this.syncJournal.pending(workspaceId);
  }
  markSyncChangeRelayed(workspaceId: string, mutationId: string): void {
    this.syncJournal.markRelayed(workspaceId, mutationId);
  }
  queueFullSyncSnapshot(workspaceId: string, recipientDeviceId?: string, withinTransaction = false): number {
    const operation = () => {
      this.syncJournal.status(workspaceId);
      let count = 0;
      const queue = (id: string, kind: string, payload: Record<string, unknown>) => {
        const mutation = this.syncJournal.enqueue(workspaceId, id, kind, 'upsert', payload);
        if (recipientDeviceId) this.syncJournal.targetMutation(workspaceId, mutation.id, recipientDeviceId);
        count++;
      };
      for (const row of this.db.prepare('SELECT d.id,d.title,d.created_at createdAt,d.updated_at updatedAt,r.id revisionId,r.body FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=?').all(workspaceId) as Array<Record<string, unknown>>) queue(String(row.id), 'document', row);
      for (const row of this.db.prepare('SELECT id,title,created_at createdAt,updated_at updatedAt FROM chats WHERE workspace_id=? ORDER BY created_at').all(workspaceId) as Array<Record<string, unknown>>) queue(String(row.id), 'chat', row);
      for (const row of this.db.prepare('SELECT m.id,m.chat_id chatId,m.role,m.body,m.created_at createdAt FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=? ORDER BY m.created_at').all(workspaceId) as Array<Record<string, unknown>>) queue(String(row.id), 'message', row);
      for (const row of this.db.prepare('SELECT id,title,body,source_object_id sourceObjectId,ownership,created_at createdAt,updated_at updatedAt FROM memories WHERE workspace_id=? AND NOT EXISTS (SELECT 1 FROM meetings mt WHERE mt.id=memories.source_object_id)').all(workspaceId) as Array<Record<string, unknown>>) queue(String(row.id), 'memory', row);
      for (const row of this.db.prepare('SELECT id,from_id fromId,to_id toId,type,created_at createdAt FROM relationships r WHERE workspace_id=? AND NOT EXISTS (SELECT 1 FROM meetings mt WHERE mt.id=r.from_id OR mt.id=r.to_id) AND NOT EXISTS (SELECT 1 FROM memories lm JOIN meetings mt ON mt.id=lm.source_object_id WHERE lm.id=r.from_id OR lm.id=r.to_id)').all(workspaceId) as Array<Record<string, unknown>>) queue(String(row.id), 'relationship', row);
      if(this.activityCapturePolicy(workspaceId).syncRaw)for(const row of this.db.prepare('SELECT s.id,s.attachment_id attachmentId,s.captured_at capturedAt,s.device_id deviceId,s.display_id displayId,s.app_bundle_id appBundleId,s.app_process appProcess,s.app_title appTitle,s.policy_version policyVersion,s.source_sha256 sourceSha256,s.expires_at expiresAt,s.created_at createdAt FROM activity_snapshots s WHERE s.workspace_id=?').all(workspaceId) as Array<Record<string,unknown>>)queue(String(row.id),'activity_snapshot',row)
      for(const row of this.db.prepare('SELECT id FROM remote_jobs WHERE workspace_id=?').all(workspaceId) as Array<{id:string}>){const payload=this.remoteJobSyncPayload(workspaceId,row.id);if(payload)queue(row.id,'remote_job',payload)}
      for (const row of this.db.prepare('SELECT id,owner_id ownerId,name,media_type mediaType,sha256,created_at createdAt FROM attachments WHERE workspace_id=?').all(workspaceId) as Array<Record<string, unknown>>) {
        const bytes = this.readSyncAttachment(workspaceId, String(row.id));
        queue(String(row.id), 'attachment', {
          ...row,
          bytes: bytes.byteLength,
        });
      }
      for(const row of this.db.prepare('SELECT id FROM tool_failure_knowledge WHERE workspace_id=?').all(workspaceId) as Array<{id:string}>){const payload=this.toolFailureSyncPayload(workspaceId,row.id);if(payload)queue(row.id,'tool_failure',payload)}
      for(const row of this.db.prepare('SELECT id,model,route_role role,status,cost_micros costMicros,prompt_tokens promptTokens,completion_tokens completionTokens,request_digest requestDigest,response_id responseId,error_code errorCode,fallback_provider fallbackProvider,started_at createdAt,finished_at updatedAt FROM provider_usage_receipts WHERE workspace_id=? ORDER BY started_at,id').all(workspaceId) as Array<Record<string,unknown>>) queue(String(row.id),'provider_usage',row)
      return count;
    };
    return withinTransaction ? operation() : this.transaction(operation);
  }
  syncHead(workspaceId: string, objectId: string): Record<string, unknown> | undefined {
    return this.syncJournal.head(workspaceId, objectId);
  }
  queueReplacementSnapshot(workspaceId: string, requestId: string, recipientDeviceId: string): number {
    const liveIds = this.canonicalObjectIds(workspaceId);
    if (liveIds.length > 100_000) throw new Error('Workspace snapshot object limit exceeded');
    const tombstoneIds = (this.db.prepare('SELECT object_id objectId FROM tombstones WHERE workspace_id=?').all(workspaceId) as Array<{ objectId: string }>).map((row) => row.objectId);
    return this.transaction(() => {
      const count = this.queueFullSyncSnapshot(workspaceId, recipientDeviceId, true),
        mutation = this.syncJournal.enqueue(workspaceId, requestId, 'snapshot', 'upsert', {
          id: requestId,
          targetDeviceId: recipientDeviceId,
          liveIds,
          tombstoneIds,
        });
      this.syncJournal.targetMutation(workspaceId, mutation.id, recipientDeviceId);
      return count + 1;
    });
  }
  acceptSnapshotRequest(workspaceId: string, requestId: string, senderDeviceId: string): boolean {
    return this.syncJournal.consumeControlRequest(workspaceId, requestId, senderDeviceId);
  }
  recordSnapshotRequest(workspaceId: string, requestId: string, ownerDeviceId: string): void {
    this.syncJournal.recordSnapshotRequest(workspaceId, requestId, ownerDeviceId);
  }
  acceptSnapshotResponse(workspaceId: string, requestId: string, ownerDeviceId: string): boolean {
    return this.syncJournal.consumeSnapshotResponse(workspaceId, requestId, ownerDeviceId);
  }
  completeSnapshotResponse(workspaceId: string, requestId: string, ownerDeviceId: string): void {
    this.syncJournal.completeSnapshotResponse(workspaceId, requestId, ownerDeviceId);
  }
  removeSnapshotRequest(workspaceId: string, requestId: string): void {
    this.syncJournal.removeSnapshotRequest(workspaceId, requestId);
  }
  hasAppliedSyncChange(changeId: string): boolean {
    return this.syncJournal.hasAppliedChange(changeId);
  }
  syncMutationRecipient(workspaceId: string, mutationId: string): string | undefined {
    return this.syncJournal.mutationTarget(workspaceId, mutationId);
  }
  applyInboundReplacementSnapshot(change: InboundChange): void {
    const payload = change.payload as Record<string, unknown>,
      liveIds = Array.isArray(payload.liveIds) ? payload.liveIds.map(String) : [],
      tombstoneIds = Array.isArray(payload.tombstoneIds) ? payload.tombstoneIds.map(String) : [];
    if (payload.id !== change.objectId || liveIds.length > 100_000 || tombstoneIds.length > 100_000 || new Set(liveIds).size !== liveIds.length || new Set(tombstoneIds).size !== tombstoneIds.length) throw new Error('Replacement snapshot manifest is invalid');
    const removeFiles: string[] = [];
    this.transaction(() => {
      const outcome = this.syncJournal.recordInbound(change);
      if (outcome === 'replay') return;
      const keep = new Set(liveIds);
      for (const id of this.canonicalObjectIds(change.workspaceId))
        if (!keep.has(id)) {
          this.syncJournal.cascadeTombstone(change.workspaceId, id, change.id);
          this.materializeInboundDelete(change.workspaceId, id, 'any', removeFiles);
        }
      for (const id of tombstoneIds) this.syncJournal.cascadeTombstone(change.workspaceId, id, change.id);
    });
    for (const file of removeFiles) rmSync(this.attachmentPath(file), { force: true });
  }
  recordInboundSyncChange(change: InboundChange): 'applied' | 'conflict' | 'ignored' | 'replay' {
    this.syncJournal.status(change.workspaceId);
    return this.transaction(() => this.syncJournal.recordInbound(change));
  }
  applyInboundSyncChange(change: InboundChange, attachmentChunkCount?: number): 'applied' | 'conflict' | 'ignored' | 'replay' {
    if (change.objectKind === 'snapshot') {
      this.applyInboundReplacementSnapshot(change);
      return 'applied';
    }
    this.syncJournal.status(change.workspaceId);
    const removeFiles: string[] = [];
    const result = this.transaction(() => {
      const outcome = this.syncJournal.recordInbound(change);
      if (outcome === 'replay' || outcome === 'ignored') return outcome;
      if(change.objectKind==='remote_job'&&change.operation==='upsert'&&String((change.payload as Record<string,unknown>).status)==='canceled'){this.materializeInboundUpsert(change.workspaceId,change.objectId,'remote_job',change.payload as Record<string,unknown>,change.id,attachmentChunkCount,change.deviceId);return outcome}
      const head = this.syncJournal.head(change.workspaceId, change.objectId);
      if (!head) return outcome;
      if (head.operation === 'delete') {
        const payload = change.payload as Record<string, unknown>,
          cascadeIds = Array.isArray(payload?.cascadeIds) ? payload.cascadeIds.map(String) : [change.objectId];
        if (cascadeIds.length > 10_000 || !cascadeIds.includes(change.objectId) || new Set(cascadeIds).size !== cascadeIds.length) throw new Error('Inbound cascade deletion is invalid');
        for (const id of cascadeIds) {
          this.syncJournal.cascadeTombstone(change.workspaceId, id, change.id);
          this.materializeInboundDelete(change.workspaceId, id, id === change.objectId ? change.objectKind : 'any', removeFiles);
        }
      } else {if(String(head.objectKind)==='remote_job'&&String(head.changeId)!==change.id)return outcome;this.materializeInboundUpsert(change.workspaceId, change.objectId, String(head.objectKind), head.payload as Record<string, unknown>, String(head.changeId), attachmentChunkCount,change.deviceId)}
      return outcome;
    });
    for (const file of removeFiles) rmSync(this.attachmentPath(file), { force: true });
    return result;
  }
  readSyncAttachment(workspaceId: string, attachmentId: string): Uint8Array {
    const row = this.db.prepare('SELECT relative_path FROM attachments WHERE id=? AND workspace_id=?').get(attachmentId, workspaceId) as { relative_path: string } | undefined;
    if (!row) throw new Error('Sync attachment not found');
    return new Uint8Array(readFileSync(this.attachmentPath(row.relative_path)));
  }
  acceptInboundAttachmentChunk(workspaceId: string, transferId: string, index: number, total: number, plaintext: Uint8Array): boolean {
    const result = this.syncJournal.acceptAttachmentChunk(workspaceId, transferId, index, total, plaintext);
    if (!result.complete || !result.manifest || !result.bytes) return false;
    const manifest = result.manifest,
      id = String(manifest.attachment_id),
      validated = validateAttachment(String(manifest.name), String(manifest.media_type), result.bytes);
    if (validated.sha256 !== String(manifest.sha256) || validated.bytes !== Number(manifest.total_bytes)) throw new Error('Inbound attachment metadata mismatch');
    const activityOwner=this.db.prepare('SELECT attachment_id attachmentId,source_sha256 sourceSha256 FROM activity_snapshots WHERE id=? AND workspace_id=?').get(String(manifest.owner_id),workspaceId) as {attachmentId:string;sourceSha256:string}|undefined;if(activityOwner&&(id!==activityOwner.attachmentId||validated.sha256!==activityOwner.sourceSha256||validated.safeName!=='activity.png'||String(manifest.media_type)!=='image/png'))throw new Error('Inbound activity attachment provenance changed during transfer');
    const relativePath = `${id}-${validated.safeName}`,
      target = this.attachmentPath(relativePath),
      temporary = `${target}.sync-partial`;
    writeFileSync(temporary, result.bytes, { flag: 'wx', mode: 0o600 });
    try {
      rmSync(target, { force: true });
      renameSync(temporary, target);
      this.transaction(() => {
        this.assertInboundIdentityAvailable(workspaceId, id);
        this.db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,name=excluded.name,media_type=excluded.media_type,sha256=excluded.sha256,relative_path=excluded.relative_path').run(id, workspaceId, String(manifest.owner_id), validated.safeName, String(manifest.media_type), validated.sha256, relativePath, String(manifest.created_at));
        this.syncJournal.finishAttachment(transferId);
      });
    } catch (error) {
      rmSync(temporary, { force: true });
      rmSync(target, { force: true });
      throw error;
    }
    return true;
  }
  missingInboundAttachmentChunks(workspaceId: string, transferId: string, total: number): number[] {
    return this.syncJournal.missingAttachmentChunks(workspaceId, transferId, total);
  }
  recordOutboundAttachmentMissing(workspaceId: string, transferId: string, peerDeviceId: string, indices: number[]): void {
    this.syncJournal.recordAttachmentMissing(workspaceId, transferId, peerDeviceId, indices);
  }
  requestedOutboundAttachmentChunks(workspaceId: string, transferId: string, peerDeviceId: string): number[] | undefined {
    return this.syncJournal.requestedAttachmentChunks(workspaceId, transferId, peerDeviceId);
  }
  clearOutboundAttachmentRequest(transferId: string, peerDeviceId: string): void {
    this.syncJournal.clearAttachmentRequest(transferId, peerDeviceId);
  }
  quarantineInboundEnvelope(workspaceId: string, envelopeId: string, senderDeviceId: string, reasonCode: string): void {
    this.syncJournal.quarantine(workspaceId, envelopeId, senderDeviceId, reasonCode);
  }

  private materializeInboundUpsert(workspaceId: string, objectId: string, kind: string, payload: Record<string, unknown>, changeId: string, attachmentChunkCount?: number,senderDeviceId?:string): void {
    const id = String(payload.id),
      createdAt = String(payload.createdAt ?? now()),
      updatedAt = String(payload.updatedAt ?? createdAt);
    if (id !== objectId || id.length < 1 || id.length > 128) throw new Error('Inbound object identity is invalid');
    this.assertInboundIdentityAvailable(workspaceId, id);
    if (kind === 'chat') {
      this.db.prepare('INSERT INTO chats VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at').run(id, workspaceId, String(payload.title), createdAt, updatedAt);
      return;
    }
    if (kind === 'message') {
      const chatId = String(payload.chatId);
      if (!this.db.prepare('SELECT 1 FROM chats WHERE id=? AND workspace_id=?').get(chatId, workspaceId)) throw new Error('Inbound message chat is unavailable');
      this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(id, chatId, String(payload.role), String(payload.body), createdAt);
      const title = String(
        (
          this.db.prepare('SELECT title FROM chats WHERE id=?').get(chatId) as {
            title: string;
          }
        ).title,
      );
      this.db.prepare("DELETE FROM search_fts WHERE object_id=? AND object_kind='message'").run(id);
      this.indexText(workspaceId, id, 'message', undefined, title, String(payload.body));
      return;
    }
    if (kind === 'document') {
      const revisionId = String(payload.revisionId ?? changeId);
      this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,current_revision_id=excluded.current_revision_id,updated_at=excluded.updated_at').run(id, workspaceId, String(payload.title), revisionId, createdAt, updatedAt);
      this.db.prepare('INSERT OR REPLACE INTO revisions VALUES (?,?,?,?)').run(revisionId, id, String(payload.body), updatedAt);
      this.db.prepare("DELETE FROM search_fts WHERE object_id=? AND object_kind='document'").run(id);
      this.indexText(workspaceId, id, 'document', revisionId, String(payload.title), String(payload.body));
      return;
    }
    if (kind === 'memory') {
      const sourceId = payload.sourceObjectId ? String(payload.sourceObjectId) : null;
      if (sourceId && !this.objectKindInWorkspace(workspaceId, sourceId)) throw new Error('Inbound memory source is unavailable');
      this.db.prepare('INSERT INTO memories VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,source_object_id=excluded.source_object_id,ownership=excluded.ownership,updated_at=excluded.updated_at').run(id, workspaceId, String(payload.title), String(payload.body), sourceId, String(payload.ownership ?? 'workspace-owned'), createdAt, updatedAt);
      this.db.prepare("DELETE FROM search_fts WHERE object_id=? AND object_kind='memory'").run(id);
      this.indexText(workspaceId, id, 'memory', undefined, String(payload.title), String(payload.body));
      return;
    }
    if (kind === 'relationship') {
      if (!this.objectKindInWorkspace(workspaceId, String(payload.fromId)) || !this.objectKindInWorkspace(workspaceId, String(payload.toId))) throw new Error('Inbound relationship endpoint is unavailable');
      this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET from_id=excluded.from_id,to_id=excluded.to_id,type=excluded.type').run(id, workspaceId, String(payload.fromId), String(payload.toId), String(payload.type), createdAt);
      return;
    }
    if (kind === 'attachment') {
      if (!attachmentChunkCount || attachmentChunkCount > Math.ceil(MAX_ATTACHMENT_BYTES / (4 * 1024 * 1024)) || !Number.isSafeInteger(payload.bytes) || Number(payload.bytes) < 1 || Number(payload.bytes) > MAX_ATTACHMENT_BYTES || !this.objectKindInWorkspace(workspaceId, String(payload.ownerId))) throw new Error('Inbound attachment manifest violates limits');
      const activityOwner=this.db.prepare('SELECT attachment_id attachmentId,source_sha256 sourceSha256 FROM activity_snapshots WHERE id=? AND workspace_id=?').get(String(payload.ownerId),workspaceId) as {attachmentId:string;sourceSha256:string}|undefined;if(activityOwner&&(String(payload.id)!==activityOwner.attachmentId||String(payload.sha256)!==activityOwner.sourceSha256||String(payload.name)!=='activity.png'||String(payload.mediaType)!=='image/png'))throw new Error('Inbound activity attachment provenance is invalid');
      const workspaceCount = Number((this.db.prepare('SELECT count(*) count FROM attachments WHERE workspace_id=?').get(workspaceId) as { count: number }).count),
        ownerCount = Number((this.db.prepare('SELECT count(*) count FROM attachments WHERE workspace_id=? AND owner_id=?').get(workspaceId, String(payload.ownerId)) as { count: number }).count);
      if (workspaceCount >= MAX_ATTACHMENTS_PER_WORKSPACE || ownerCount >= MAX_ATTACHMENTS_PER_OWNER) throw new Error('Inbound attachment count limit reached');
      this.syncJournal.stageAttachment(changeId, workspaceId, payload, attachmentChunkCount);
      return;
    }
    if(kind==='activity_snapshot'){
      if(!this.activityCapturePolicy(workspaceId).syncRaw)throw new Error('Inbound raw activity sync is disabled');
      if(Number(payload.policyVersion)!==1||!canonicalIso(String(payload.capturedAt))||!canonicalIso(String(payload.expiresAt))||Date.parse(String(payload.expiresAt))<=Date.parse(String(payload.capturedAt))||!/^[a-f0-9]{64}$/.test(String(payload.sourceSha256))||![payload.deviceId,payload.displayId,payload.appBundleId,payload.appProcess].every((value)=>/^[A-Za-z0-9._-]{1,200}$/.test(String(value)))||String(payload.appTitle??'').length>300)throw new Error('Inbound activity snapshot provenance is invalid');const attachmentId=String(payload.attachmentId??`pending-${id}`);this.db.prepare('INSERT INTO activity_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET captured_at=excluded.captured_at,device_id=excluded.device_id,display_id=excluded.display_id,app_bundle_id=excluded.app_bundle_id,app_process=excluded.app_process,app_title=excluded.app_title,source_sha256=excluded.source_sha256,expires_at=excluded.expires_at').run(id,workspaceId,attachmentId,String(payload.capturedAt),String(payload.deviceId),String(payload.displayId),String(payload.appBundleId),String(payload.appProcess),payload.appTitle==null?null:String(payload.appTitle),1,String(payload.sourceSha256),String(payload.expiresAt),createdAt);return
    }
    if(kind==='remote_job'){const envelope=validateRemoteJob(payload.envelope),status=String(payload.status),updatedAt=String(payload.updatedAt),resultSummary=payload.resultSummary==null?null:String(payload.resultSummary),errorCode=payload.errorCode==null?null:String(payload.errorCode),leaseId=payload.leaseId==null?null:String(payload.leaseId),leaseExpiresAt=payload.leaseExpiresAt==null?null:String(payload.leaseExpiresAt);if(envelope.workspaceId!==workspaceId||envelope.id!==objectId||!senderDeviceId||!canonicalIso(updatedAt)||!['queued','leased','running','completed','failed','canceled','timed_out'].includes(status)||resultSummary&&resultSummary.length>1000||errorCode&&errorCode.length>80||leaseId&&!/^[A-Za-z0-9-]{16,128}$/.test(leaseId)||leaseExpiresAt&&!canonicalIso(leaseExpiresAt)||status==='queued'&&senderDeviceId!==envelope.controllerDeviceId||status!=='queued'&&status!=='canceled'&&senderDeviceId!==envelope.targetDeviceId||status==='canceled'&&![envelope.controllerDeviceId,envelope.targetDeviceId].includes(senderDeviceId))throw new Error('Inbound remote job authority is invalid');const existing=this.db.prepare('SELECT request_digest requestDigest,status FROM remote_jobs WHERE id=? AND workspace_id=?').get(objectId,workspaceId) as {requestDigest:string;status:string}|undefined,digest=jobRequestDigest(envelope);if(existing&&existing.requestDigest!==digest)throw new Error('Inbound remote job identity changed');if(existing?.status==='canceled'&&status!=='canceled')return;this.db.prepare('INSERT INTO remote_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,lease_id=excluded.lease_id,lease_expires_at=excluded.lease_expires_at,result_summary=excluded.result_summary,error_code=excluded.error_code,updated_at=excluded.updated_at').run(envelope.id,workspaceId,envelope.controllerDeviceId,envelope.targetDeviceId,envelope.capability,envelope.instruction,envelope.idempotencyKey,digest,envelope.profileDigest,envelope.keyEpoch,envelope.timeoutMs,'user',status,leaseId,leaseExpiresAt,resultSummary,errorCode,envelope.createdAt,updatedAt);this.addRemoteJobEvent(envelope.id,status,resultSummary??errorCode??status,updatedAt);return}
    if(kind==='tool_failure'){
      const tool=String(payload.tool),capabilityVersion=String(payload.capabilityVersion),fingerprint=String(payload.parameterFingerprint),context=String(payload.contextDigest),errorClass=String(payload.errorClass),outcome=String(payload.outcome),sourceReceiptId=String(payload.sourceReceiptId),expiresAt=String(payload.expiresAt)
      if(!validToolFailureFields({tool,capabilityVersion,fingerprint,context,errorClass,remediation:String(payload.remediation??''),overrideReason:String(payload.overrideReason??''),outcome,sourceReceiptId,expiresAt,createdAt,updatedAt,supersededByReceiptId:payload.supersededByReceiptId==null?undefined:String(payload.supersededByReceiptId)}))throw new Error('Inbound tool failure knowledge is invalid')
      const sourceReceipt=this.db.prepare('SELECT tool,status,capability_version capabilityVersion FROM tool_gateway_receipts WHERE id=? AND workspace_id=?').get(sourceReceiptId,workspaceId) as {tool:string;status:string;capabilityVersion:string}|undefined;if(sourceReceipt&&(sourceReceipt.tool!==tool||!['failed','timed_out'].includes(sourceReceipt.status)||capabilityVersion!==sourceReceipt.capabilityVersion&&!capabilityVersion.startsWith(`${sourceReceipt.capabilityVersion}/fingerprint:`)))throw new Error('Inbound tool failure receipt provenance is invalid');if(!sourceReceipt)this.db.prepare('INSERT INTO tool_gateway_receipts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(sourceReceiptId,workspaceId,'ai',tool,'failed',capabilityVersion,'local','Synced failure provenance',String(payload.policyDigest??'unknown').slice(0,64),`Synced ${errorClass}`.slice(0,500),errorClass,null,null,0,0,createdAt,updatedAt,0)
      if(outcome==='superseded'){const supersededId=String(payload.supersededByReceiptId),receiptTool=String(payload.supersededReceiptTool),receiptStatus=String(payload.supersededReceiptStatus),receiptCapability=String(payload.supersededReceiptCapabilityVersion),existing=this.db.prepare('SELECT tool,status,capability_version capabilityVersion FROM tool_gateway_receipts WHERE id=? AND workspace_id=?').get(supersededId,workspaceId) as {tool:string;status:string;capabilityVersion:string}|undefined;if(receiptTool!==tool||receiptStatus!=='completed'||capabilityVersion!==receiptCapability&&!capabilityVersion.startsWith(`${receiptCapability}/fingerprint:`)||existing&&(existing.tool!==receiptTool||existing.status!=='completed'||existing.capabilityVersion!==receiptCapability))throw new Error('Inbound tool failure supersession provenance is invalid');if(!existing)this.db.prepare('INSERT INTO tool_gateway_receipts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(supersededId,workspaceId,'ai',receiptTool,'completed',receiptCapability,'local','Synced success provenance','synced',`Synced success for ${tool}`.slice(0,500),null,null,null,0,0,updatedAt,updatedAt,0)}
      this.db.prepare("INSERT INTO tool_failure_knowledge VALUES (?,?,'local-personal',?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_receipt_id=excluded.source_receipt_id,error_class=excluded.error_class,remediation=excluded.remediation,override_reason=excluded.override_reason,outcome=excluded.outcome,expires_at=excluded.expires_at,updated_at=excluded.updated_at,superseded_by_receipt_id=excluded.superseded_by_receipt_id").run(id,workspaceId,sourceReceiptId,tool,capabilityVersion,fingerprint,context,errorClass,payload.remediation==null?null:String(payload.remediation),payload.overrideReason==null?null:String(payload.overrideReason),outcome,expiresAt,createdAt,updatedAt,payload.supersededByReceiptId==null?null:String(payload.supersededByReceiptId));return
    }
    if(kind==='provider_usage'){const receipt:ProviderUsageReceipt={id,workspaceId,provider:'openrouter',model:String(payload.model),role:String(payload.role) as ProviderUsageReceipt['role'],status:String(payload.status) as ProviderUsageReceipt['status'],costMicros:Number(payload.costMicros),promptTokens:Number(payload.promptTokens),completionTokens:Number(payload.completionTokens),requestDigest:String(payload.requestDigest),responseId:payload.responseId==null?undefined:String(payload.responseId),errorCode:payload.errorCode==null?undefined:String(payload.errorCode),fallbackProvider:payload.fallbackProvider as ProviderUsageReceipt['fallbackProvider'],startedAt:createdAt,finishedAt:updatedAt};this.db.prepare('DELETE FROM provider_usage_receipts WHERE id=? AND workspace_id=?').run(id,workspaceId);this.saveProviderUsage(receipt,false);return}
    throw new Error('Unsupported inbound object kind');
  }
  private materializeInboundDelete(workspaceId: string, objectId: string, kind: string, removeFiles: string[]): void {
    const attachments = this.db.prepare('SELECT relative_path FROM attachments WHERE workspace_id=? AND (id=? OR owner_id=?)').all(workspaceId, objectId, objectId) as Array<{ relative_path: string }>;
    removeFiles.push(...attachments.map((item) => item.relative_path));
    this.db.prepare('DELETE FROM briefing_dismissals WHERE workspace_id=? AND source_id=?').run(workspaceId, objectId);
    this.db.prepare('DELETE FROM attachments WHERE workspace_id=? AND (id=? OR owner_id=?)').run(workspaceId, objectId, objectId);
    this.db.prepare('DELETE FROM relationships WHERE workspace_id=? AND (id=? OR from_id=? OR to_id=?)').run(workspaceId, objectId, objectId, objectId);
    this.db.prepare('DELETE FROM embeddings WHERE workspace_id=? AND object_id=?').run(workspaceId, objectId);
    this.db.prepare('DELETE FROM search_fts WHERE workspace_id=? AND object_id=?').run(workspaceId, objectId);
    if (kind === 'message' || kind === 'any') this.db.prepare('DELETE FROM messages WHERE id=? AND EXISTS(SELECT 1 FROM chats WHERE id=messages.chat_id AND workspace_id=?)').run(objectId, workspaceId);
    const selected = kind === 'document' ? 'documents' : kind === 'chat' ? 'chats' : kind === 'memory' ? 'memories' : kind === 'relationship' ? 'relationships' : kind === 'attachment' ? 'attachments' : kind==='activity_snapshot'?'activity_snapshots':kind==='remote_job'?'remote_jobs':kind==='tool_failure'?'tool_failure_knowledge':kind==='provider_usage'?'provider_usage_receipts':undefined,
      tables = kind === 'any' ? ['documents', 'chats', 'memories', 'relationships', 'attachments','activity_snapshots','remote_jobs','tool_failure_knowledge','provider_usage_receipts'] : selected ? [selected] : [];
    for (const table of tables) this.db.prepare(`DELETE FROM ${table} WHERE id=? AND workspace_id=?`).run(objectId, workspaceId);
    this.db.prepare('INSERT OR REPLACE INTO tombstones VALUES (?,?,?,?)').run(objectId, workspaceId, kind, now());
  }
  private assertInboundIdentityAvailable(workspaceId: string, id: string): void {
    for (const table of ['documents', 'chats', 'memories', 'relationships', 'attachments','activity_snapshots','remote_jobs','tool_failure_knowledge','provider_usage_receipts']) {
      const row = this.db.prepare(`SELECT workspace_id workspaceId FROM ${table} WHERE id=?`).get(id) as { workspaceId: string } | undefined;
      if (row && row.workspaceId !== workspaceId) throw new Error('Inbound object identity belongs to another workspace');
    }
    const message = this.db.prepare('SELECT c.workspace_id workspaceId FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=?').get(id) as { workspaceId: string } | undefined;
    if (message && message.workspaceId !== workspaceId) throw new Error('Inbound object identity belongs to another workspace');
  }
  private canonicalObjectIds(workspaceId: string): string[] {
    const ids: string[] = [];
    for (const table of ['documents', 'chats', 'attachments','activity_snapshots','remote_jobs']) ids.push(...(this.db.prepare(`SELECT id FROM ${table} WHERE workspace_id=?`).all(workspaceId) as Array<{ id: string }>).map((row) => row.id));
    ids.push(...(this.db.prepare('SELECT id FROM memories WHERE workspace_id=? AND NOT EXISTS (SELECT 1 FROM meetings mt WHERE mt.id=memories.source_object_id)').all(workspaceId) as Array<{ id: string }>).map((row) => row.id));
    ids.push(...(this.db.prepare('SELECT id FROM relationships r WHERE workspace_id=? AND NOT EXISTS (SELECT 1 FROM meetings mt WHERE mt.id=r.from_id OR mt.id=r.to_id) AND NOT EXISTS (SELECT 1 FROM memories lm JOIN meetings mt ON mt.id=lm.source_object_id WHERE lm.id=r.from_id OR lm.id=r.to_id)').all(workspaceId) as Array<{ id: string }>).map((row) => row.id));
    ids.push(...(this.db.prepare('SELECT m.id FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=?').all(workspaceId) as Array<{ id: string }>).map((row) => row.id));
    ids.push(...(this.db.prepare('SELECT id FROM tool_failure_knowledge WHERE workspace_id=?').all(workspaceId) as Array<{id:string}>).map((row)=>row.id));
    ids.push(...(this.db.prepare('SELECT id FROM provider_usage_receipts WHERE workspace_id=?').all(workspaceId) as Array<{id:string}>).map((row)=>row.id));
    return ids;
  }

  private createDefaultSecurityProfile(workspaceId: string, workspaceRoot: string): string {
    const id = randomUUID(),
      executionRoot = path.join(path.resolve(workspaceRoot), 'waypoint-workspaces', workspaceId);
    mkdirSync(executionRoot, { recursive: true });
    this.db.prepare('INSERT INTO security_profiles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, workspaceId, 'Workspace — conservative', JSON.stringify([executionRoot]), 'read-only', 'provider-only', '[]', 'always', 120000, 1, 0, '[]', now());
    return id;
  }

  private ensureAutonomousDeveloperProfile(workspaceId:string,workspaceRoot:string):string{
    const existing=this.db.prepare("SELECT id FROM security_profiles WHERE workspace_id=? AND name='Autonomous developer'").get(workspaceId) as {id:string}|undefined;if(existing)return existing.id
    const id=randomUUID(),executionRoot=path.join(path.resolve(workspaceRoot),'waypoint-workspaces',workspaceId);mkdirSync(executionRoot,{recursive:true});this.db.prepare('INSERT INTO security_profiles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,workspaceId,'Autonomous developer',JSON.stringify([executionRoot]),'workspace-write','provider-only',JSON.stringify(['tool-gateway','terminal','local-cli']),'on-write',120000,1,0,'[]',now());return id
  }

  listSecurityProfiles(workspaceId: string): Array<{
    id: string;
    name: string;
    roots: string[];
    filesystem: 'read-only' | 'workspace-write';
    network: 'provider-only' | 'disabled';
    tools: string[];
    approval: 'always' | 'on-write';
    maxDurationMs: number;
    maxConcurrency: number;
    peerEligible: boolean;
    secretNames: string[];
  }> {
    const rows = this.db.prepare('SELECT id,name,roots_json roots,filesystem,network,tools_json tools,approval,max_duration_ms maxDurationMs,max_concurrency maxConcurrency,peer_eligible peerEligible,secret_names_json secretNames FROM security_profiles WHERE workspace_id=? ORDER BY created_at').all(workspaceId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      id: String(row.id),
      name: String(row.name),
      roots: JSON.parse(String(row.roots)),
      tools: JSON.parse(String(row.tools)),
      secretNames: JSON.parse(String(row.secretNames)),
      filesystem: row.filesystem as 'read-only' | 'workspace-write',
      network: row.network as 'provider-only' | 'disabled',
      approval: row.approval as 'always' | 'on-write',
      maxDurationMs: Number(row.maxDurationMs),
      maxConcurrency: Number(row.maxConcurrency),
      peerEligible: Boolean(row.peerEligible),
    }));
  }

  createExecution(input: { workspaceId: string; chatId: string; sourceMessageId?: string; parentExecutionId?: string; cli: 'codex' | 'claude'; routedCliVersion?:string;model?: string; securityProfileId: string; prompt: string; depth?: number;taskType?:'analyze'|'summarize'|'critique';budgetReceipt:string }): string {
    this.assertObjectInWorkspace(input.workspaceId, input.chatId, 'chat');
    const profile = this.db.prepare('SELECT id FROM security_profiles WHERE id=? AND workspace_id=?').get(input.securityProfileId, input.workspaceId);
    if (!profile) throw new Error('Security profile not found in workspace');
    if (input.sourceMessageId && !this.db.prepare("SELECT 1 FROM messages WHERE id=? AND chat_id=? AND role='user'").get(input.sourceMessageId, input.chatId)) throw new Error('Execution source message not found in chat');
    {const receipt=parseExecutionBudget(input.budgetReceipt),effectiveProfile=this.listSecurityProfiles(input.workspaceId).find((item)=>item.id===input.securityProfileId),kind=input.parentExecutionId?'child':'root';if(!receipt||receipt.kind!==kind||!effectiveProfile||receipt.profileDigest!==securityProfileDigest(effectiveProfile)||receipt.maxDurationMs!==Math.min(effectiveProfile.maxDurationMs,kind==='child'?60_000:120_000)||Buffer.byteLength(input.prompt,'utf8')>receipt.maxPromptBytes)throw new Error('Execution budget receipt is invalid')}
    if (input.parentExecutionId) {
      const parent = this.db.prepare('SELECT depth FROM executions WHERE id=? AND workspace_id=? AND chat_id=?').get(input.parentExecutionId, input.workspaceId, input.chatId) as { depth: number } | undefined;
      if (!parent || (input.depth ?? 0) !== parent.depth + 1) throw new Error('Invalid execution lineage');
    }
    const id = randomUUID(),
      timestamp = now();
    this.transaction(() => {
      this.db.prepare('INSERT INTO executions(id,workspace_id,chat_id,source_message_id,parent_execution_id,cli,cli_version,model,device,security_profile_id,prompt_sha256,status,depth,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, input.workspaceId, input.chatId, input.sourceMessageId ?? null, input.parentExecutionId ?? null, input.cli,input.routedCliVersion??null, input.model ?? null, 'local', input.securityProfileId, createHash('sha256').update(input.prompt).digest('hex'), 'queued', input.depth ?? 0, timestamp);
      let sequence=1;this.db.prepare('INSERT INTO execution_events VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),id,sequence++,'policy',null,'budget:local-v1',input.budgetReceipt,timestamp);
      if(input.taskType)this.db.prepare('INSERT INTO execution_events VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),id,sequence,'agent',null,`task:${input.taskType}`,'bounded-child-v1',timestamp);
      this.activity(input.workspaceId, 'ai', 'execution.queued', id, 'execution', { cli: input.cli, device: 'local',routePolicyVersion:1 });
    });
    return id;
  }

  startExecution(id: string, workspaceId: string, executable: string, version?: string): void {
    const result = this.db.prepare("UPDATE executions SET status='running',executable=?,cli_version=?,started_at=? WHERE id=? AND workspace_id=? AND status='queued'").run(executable, version ?? null, now(), id, workspaceId);
    if (!result.changes) throw new Error('Execution is not queued in workspace');
  }

  failQueuedExecution(id: string, workspaceId: string, error: string): void {
    const changed = this.db.prepare("UPDATE executions SET status='failed',finished_at=?,error_code='startup_failed',error_message=? WHERE id=? AND workspace_id=? AND status='queued'").run(now(), error.slice(0, 8192), id, workspaceId);
    if (!changed.changes) throw new Error('Execution is not queued in workspace');
    this.activity(workspaceId, 'ai', 'execution.failed', id, 'execution', {
      phase: 'startup',
    });
  }

  appendExecutionEvent(id: string, workspaceId: string, event: { type: string; text?: string; name?: string; rawType?: string }): void {
    const run = this.db.prepare('SELECT id FROM executions WHERE id=? AND workspace_id=?').get(id, workspaceId);
    if (!run) throw new Error('Execution not found in workspace');
    const sequence = (this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 next FROM execution_events WHERE execution_id=?').get(id) as { next: number }).next;
    this.db.prepare('INSERT INTO execution_events VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), id, sequence, event.type, event.text ?? null, event.name ?? null, event.rawType ?? null, now());
  }

  finishExecution(
    id: string,
    workspaceId: string,
    result: {
      status: 'completed' | 'failed' | 'canceled' | 'timed_out';
      exitCode: number | null;
      error?: string;
    },
    assistantBody?: string,
  ): void {
    this.transaction(() => {
      const execution = this.db.prepare('SELECT chat_id chatId FROM executions WHERE id=? AND workspace_id=?').get(id, workspaceId) as { chatId: string } | undefined;
      const changed = this.db.prepare("UPDATE executions SET status=?,finished_at=?,exit_code=?,error_code=?,error_message=? WHERE id=? AND workspace_id=? AND status='running'").run(result.status, now(), result.exitCode, result.status === 'failed' || result.status === 'timed_out' ? result.status : null, result.error?.slice(0, 8192) ?? null, id, workspaceId);
      if (!changed.changes || !execution) throw new Error('Execution is not running in workspace');
      if (result.status === 'completed' && assistantBody?.trim()) {
        const chat = this.db.prepare('SELECT title FROM chats WHERE id=? AND workspace_id=?').get(execution.chatId, workspaceId) as { title: string } | undefined;
        if (!chat) throw new Error('Execution chat was deleted');
        const messageId = randomUUID(),
          timestamp = now(),
          body = assistantBody.trim();
        this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(messageId, execution.chatId, 'assistant', body, timestamp);
        this.syncJournal.enqueue(workspaceId, messageId, 'message', 'upsert', {
          id: messageId,
          chatId: execution.chatId,
          role: 'assistant',
          body,
          createdAt: timestamp,
          executionId: id,
        });
        this.db.prepare('UPDATE chats SET updated_at=? WHERE id=?').run(timestamp, execution.chatId);
        this.indexText(workspaceId, messageId, 'message', undefined, chat.title, body);
        this.activity(workspaceId, 'content', 'message.created', messageId, 'message', { role: 'assistant', executionId: id });
      }
      this.activity(workspaceId, 'ai', `execution.${result.status}`, id, 'execution', { exitCode: result.exitCode });
    });
  }

  listExecutions(workspaceId: string, chatId?: string): Array<Record<string, unknown>> {
    const rows = this.db.prepare(`SELECT e.id,e.chat_id chatId,e.source_message_id sourceMessageId,e.parent_execution_id parentExecutionId,e.cli,e.executable,e.cli_version cliVersion,e.model,e.device,e.security_profile_id securityProfileId,e.prompt_sha256 promptSha256,e.status,e.depth,e.started_at startedAt,e.finished_at finishedAt,e.exit_code exitCode,e.error_code errorCode,e.error_message errorMessage,e.created_at createdAt,p.name profileName FROM executions e JOIN security_profiles p ON p.id=e.security_profile_id WHERE e.workspace_id=? ${chatId ? 'AND e.chat_id=?' : ''} ORDER BY e.created_at DESC,e.rowid DESC`).all(...(chatId ? [workspaceId, chatId] : [workspaceId])) as Array<Record<string, unknown>>;
    return rows.map((run) => ({
      ...run,
      assistantMessageId:(this.db.prepare("SELECT object_id id FROM activities WHERE workspace_id=? AND action='message.created' AND json_extract(metadata_json,'$.executionId')=? ORDER BY created_at DESC LIMIT 1").get(workspaceId,String(run.id)) as {id?:string}|undefined)?.id,
      events: this.db.prepare('SELECT sequence,type,text,name,raw_type rawType,created_at createdAt FROM execution_events WHERE execution_id=? ORDER BY sequence').all(String(run.id)),
      budget: (()=>{const row=this.db.prepare("SELECT raw_type rawType FROM execution_events WHERE execution_id=? AND type='policy' AND name='budget:local-v1' ORDER BY sequence LIMIT 1").get(String(run.id)) as {rawType?:string}|undefined;return parseExecutionBudget(row?.rawType)})(),
    }));
  }

  executionExists(workspaceId: string, id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM executions WHERE id=? AND workspace_id=?').get(id, workspaceId));
  }
  executionIsQueued(workspaceId:string,id:string):boolean{return Boolean(this.db.prepare("SELECT 1 FROM executions WHERE id=? AND workspace_id=? AND status='queued'").get(id,workspaceId))}
  cancelQueuedExecution(workspaceId:string,id:string):boolean{const changed=this.db.prepare("UPDATE executions SET status='canceled',finished_at=?,error_code='canceled_before_start',error_message=NULL WHERE id=? AND workspace_id=? AND status='queued'").run(now(),id,workspaceId);if(changed.changes)this.activity(workspaceId,'ai','execution.canceled',id,'execution',{phase:'queued'});return Boolean(changed.changes)}

  activeExecutionIds(workspaceId?: string, chatId?: string): string[] {
    let sql = "SELECT id FROM executions WHERE status IN ('queued','running')";
    const args: string[] = [];
    if (workspaceId) {
      sql += ' AND workspace_id=?';
      args.push(workspaceId);
    }
    if (chatId) {
      sql += ' AND chat_id=?';
      args.push(chatId);
    }
    return (this.db.prepare(sql).all(...args) as Array<{ id: string }>).map((row) => row.id);
  }

  private reconcileInterruptedExecutions(): void {
    const interrupted = this.db.prepare("SELECT id,workspace_id workspaceId,status FROM executions WHERE status IN ('queued','running')").all() as Array<{ id: string; workspaceId: string; status: string }>;
    if (!interrupted.length) return;
    this.transaction(() => {
      for (const run of interrupted) {
        this.db.prepare("UPDATE executions SET status='failed',finished_at=?,error_code='interrupted',error_message='Waypoint stopped before this run reached a terminal state' WHERE id=?").run(now(), run.id);
        this.activity(run.workspaceId, 'ai', 'execution.failed', run.id, 'execution', { phase: 'startup-reconciliation', priorStatus: run.status });
      }
    });
  }

  listWorkspaces(): WorkspaceSummary[] {
    return this.db.prepare('SELECT id,name,local_path localPath,created_at createdAt FROM workspaces ORDER BY created_at').all() as unknown as WorkspaceSummary[];
  }

  listDocuments(workspaceId: string): Array<{
    id: string;
    title: string;
    body: string;
    revisionId: string;
    updatedAt: string;
  }> {
    return this.db.prepare('SELECT d.id,d.title,r.body,r.id revisionId,d.updated_at updatedAt FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=? ORDER BY d.updated_at DESC').all(workspaceId) as unknown as Array<{
      id: string;
      title: string;
      body: string;
      revisionId: string;
      updatedAt: string;
    }>;
  }

  listChats(workspaceId: string): Array<{
    id: string;
    title: string;
    updatedAt: string;
    messages: Array<{
      id: string;
      role: string;
      body: string;
      createdAt: string;
    }>;
  }> {
    const chats = this.db.prepare('SELECT id,title,updated_at updatedAt FROM chats WHERE workspace_id=? ORDER BY updated_at DESC').all(workspaceId) as Array<{
      id: string;
      title: string;
      updatedAt: string;
    }>;
    return chats.map((chat) => ({
      ...chat,
      messages: this.db.prepare('SELECT id,role,body,created_at createdAt FROM messages WHERE chat_id=? ORDER BY created_at').all(chat.id) as Array<{
        id: string;
        role: string;
        body: string;
        createdAt: string;
      }>,
    }));
  }

  listMemories(workspaceId: string): Array<{
    id: string;
    title: string;
    body: string;
    sourceObjectId?: string;
    ownership: string;
    updatedAt: string;
  }> {
    return this.db.prepare('SELECT id,title,body,source_object_id sourceObjectId,ownership,updated_at updatedAt FROM memories WHERE workspace_id=? ORDER BY updated_at DESC').all(workspaceId) as unknown as Array<{
      id: string;
      title: string;
      body: string;
      sourceObjectId?: string;
      ownership: string;
      updatedAt: string;
    }>;
  }

  scanMemorySuggestions(workspaceId: string, chatId?: string): number {
    if (chatId) this.assertObjectInWorkspace(workspaceId, chatId, 'chat');
    const rows = this.db.prepare(`SELECT m.id messageId,m.role,CASE WHEN length(m.body)<=? THEN m.body ELSE NULL END body,m.chat_id chatId FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=? ${chatId ? 'AND c.id=?' : ''} AND m.role!='system' ORDER BY m.created_at DESC LIMIT ?`).all(SUGGESTION_SCAN_LIMITS.maxMessageCharacters, ...(chatId ? [workspaceId, chatId] : [workspaceId]), SUGGESTION_SCAN_LIMITS.maxMessages) as Array<{
      messageId: string;
      role: string;
      body: string | null;
      chatId: string;
    }>;
    let created = 0,
      scannedCharacters = 0;
    this.transaction(() => {
      for (const row of rows) {
        if (row.body === null) continue;
        if (scannedCharacters + row.body.length > SUGGESTION_SCAN_LIMITS.maxTotalCharacters) break;
        scannedCharacters += row.body.length;
        const digest = contentDigest(row.body);
        for (const candidate of extractSuggestions(row.messageId, row.body)) {
          if (candidate.confidence < SUGGESTION_EXTRACTOR.threshold || (candidate.category === 'commitment' && row.role !== 'user')) continue;
          const result = this.db.prepare("INSERT OR IGNORE INTO memory_suggestions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',NULL,NULL,?)").run(randomUUID(), workspaceId, row.chatId, row.messageId, row.role, candidate.category, candidate.title, candidate.body, candidate.sourceExcerpt, digest, candidate.startOffset, candidate.endOffset, candidate.confidence, SUGGESTION_EXTRACTOR.provider, SUGGESTION_EXTRACTOR.version, candidate.fingerprint, now());
          created += Number(result.changes);
          if (created >= SUGGESTION_EXTRACTOR.maxPerScan) break;
        }
        if (created >= SUGGESTION_EXTRACTOR.maxPerScan) break;
      }
      if (created)
        this.activity(workspaceId, 'knowledge', 'suggestions.scanned', workspaceId, 'workspace', {
          created,
          extractor: SUGGESTION_EXTRACTOR.provider,
          version: SUGGESTION_EXTRACTOR.version,
          scannedCharacters,
        });
    });
    return created;
  }

  listMemorySuggestions(workspaceId: string, status: 'pending' | 'accepted' | 'rejected' = 'pending'): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT id,chat_id chatId,source_message_id sourceMessageId,source_role sourceRole,category,title,body,source_excerpt sourceExcerpt,start_offset startOffset,end_offset endOffset,confidence,extractor,extractor_version extractorVersion,status,accepted_object_id acceptedObjectId,resolved_at resolvedAt,created_at createdAt FROM memory_suggestions WHERE workspace_id=? AND status=? ORDER BY confidence DESC,created_at DESC').all(workspaceId, status) as Array<Record<string, unknown>>;
  }

  resolveMemorySuggestion(workspaceId: string, suggestionId: string, action: 'accept' | 'reject', edited?: { title: string; body: string }): { acceptedObjectId?: string; kind?: 'memory' | 'commitment' } {
    return this.transaction(() => {
      const suggestion = this.db.prepare("SELECT s.*,m.body source_body,m.role current_source_role,m.chat_id current_chat_id FROM memory_suggestions s JOIN messages m ON m.id=s.source_message_id JOIN chats c ON c.id=m.chat_id WHERE s.id=? AND s.workspace_id=? AND c.workspace_id=? AND s.status='pending'").get(suggestionId, workspaceId, workspaceId) as Record<string, unknown> | undefined;
      if (!suggestion) throw new Error('Pending suggestion or source not found');
      const sourceId = String(suggestion.source_message_id),
        sourceBody = String(suggestion.source_body),
        start = Number(suggestion.start_offset),
        end = Number(suggestion.end_offset);
      if (String(suggestion.source_digest) !== contentDigest(sourceBody) || String(suggestion.source_excerpt) !== sourceBody.slice(start, end) || String(suggestion.source_role) !== String(suggestion.current_source_role) || String(suggestion.chat_id) !== String(suggestion.current_chat_id)) throw new Error('Suggestion source changed; scan the conversation again');
      if (action === 'reject') {
        this.db.prepare("UPDATE memory_suggestions SET status='rejected',resolved_at=? WHERE id=? AND workspace_id=? AND status='pending'").run(now(), suggestionId, workspaceId);
        this.activity(workspaceId, 'knowledge', 'suggestion.rejected', suggestionId, 'suggestion', { category: suggestion.category });
        return {};
      }
      const title = (edited?.title ?? String(suggestion.title)).trim().slice(0, 300) || 'Memory',
        body = (edited?.body ?? String(suggestion.body)).slice(0, 10_000),
        timestamp = now();
      if (!body.trim()) throw new Error('Accepted suggestion body is required');
      if (String(suggestion.category) === 'commitment') {
        const id = randomUUID();
        this.db.prepare('INSERT INTO commitments VALUES (?,?,?,?,?,?,?,?,?,NULL)').run(id, workspaceId, suggestionId, sourceId, title, body, 'open', timestamp, timestamp);
        this.db.prepare("UPDATE memory_suggestions SET status='accepted',accepted_object_id=?,resolved_at=? WHERE id=? AND status='pending'").run(id, timestamp, suggestionId);
        this.activity(workspaceId, 'knowledge', 'commitment.accepted', id, 'commitment', { suggestionId, sourceMessageId: sourceId });
        return { acceptedObjectId: id, kind: 'commitment' };
      }
      const id = randomUUID(),
        relationshipId = randomUUID();
      this.db.prepare('INSERT INTO memories(id,workspace_id,title,body,source_object_id,ownership,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, workspaceId, title, body, sourceId, 'workspace-owned', timestamp, timestamp);
      this.syncJournal.enqueue(workspaceId, id, 'memory', 'upsert', {
        id,
        title,
        body,
        sourceObjectId: sourceId,
        ownership: 'workspace-owned',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.indexText(workspaceId, id, 'memory', undefined, title, body);
      this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(relationshipId, workspaceId, sourceId, id, 'derived_from', timestamp);
      this.syncJournal.enqueue(workspaceId, relationshipId, 'relationship', 'upsert', {
        id: relationshipId,
        fromId: sourceId,
        toId: id,
        type: 'derived_from',
        createdAt: timestamp,
      });
      this.db.prepare("UPDATE memory_suggestions SET status='accepted',accepted_object_id=?,resolved_at=? WHERE id=? AND status='pending'").run(id, timestamp, suggestionId);
      this.activity(workspaceId, 'knowledge', 'suggestion.accepted', id, 'memory', {
        suggestionId,
        category: suggestion.category,
        sourceMessageId: sourceId,
      });
      return { acceptedObjectId: id, kind: 'memory' };
    });
  }

  listCommitments(workspaceId: string): Array<Record<string, unknown>> {
    return this.db.prepare("SELECT c.id,c.suggestion_id suggestionId,c.source_message_id sourceMessageId,c.title,c.body,c.status,c.created_at createdAt,c.updated_at updatedAt,c.completed_at completedAt,s.source_excerpt sourceExcerpt FROM commitments c JOIN memory_suggestions s ON s.id=c.suggestion_id WHERE c.workspace_id=? ORDER BY CASE c.status WHEN 'open' THEN 0 ELSE 1 END,c.updated_at DESC").all(workspaceId) as Array<Record<string, unknown>>;
  }

  setCommitmentCompleted(workspaceId: string, commitmentId: string, completed: boolean): void {
    const timestamp = now(),
      result = this.db.prepare('UPDATE commitments SET status=?,updated_at=?,completed_at=? WHERE id=? AND workspace_id=?').run(completed ? 'completed' : 'open', timestamp, completed ? timestamp : null, commitmentId, workspaceId);
    if (!result.changes) throw new Error('Commitment not found');
    this.activity(workspaceId, 'knowledge', completed ? 'commitment.completed' : 'commitment.reopened', commitmentId, 'commitment', {});
  }

  composeDailyBriefing(workspaceId: string, timezone: string, instant = now()): DailyBriefing {
    if (!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) throw new Error('Workspace not found');
    const localDay = localDayAt(instant, timezone);
    const commitments = this.db.prepare("SELECT c.id,'commitment' kind,c.title,substr(c.body,1,4000) detail,length(c.body)>4000 detailTruncated,0 missingSource,c.updated_at updatedAt FROM commitments c WHERE c.workspace_id=? AND c.status='open' AND NOT EXISTS(SELECT 1 FROM briefing_dismissals b WHERE b.workspace_id=c.workspace_id AND b.source_id=c.id AND b.source_kind='commitment' AND b.local_day=?) ORDER BY c.updated_at DESC,c.id ASC LIMIT 31").all(workspaceId, localDay) as unknown as BriefingSource[];
    const documents = (
      this.db.prepare("SELECT d.id,'document' kind,d.title,substr(COALESCE(r.body,''),1,4000) detail,length(COALESCE(r.body,''))>4000 detailTruncated,r.id IS NULL missingSource,d.updated_at updatedAt FROM documents d LEFT JOIN revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=? AND NOT EXISTS(SELECT 1 FROM briefing_dismissals b WHERE b.workspace_id=d.workspace_id AND b.source_id=d.id AND b.source_kind='document' AND b.local_day=?) ORDER BY d.updated_at DESC,d.id ASC LIMIT 51").all(workspaceId, localDay) as unknown as Array<
        Omit<BriefingSource, 'missingSource' | 'detailTruncated'> & {
          missingSource: number;
          detailTruncated: number;
        }
      >
    ).map((item): BriefingSource => ({
      ...item,
      missingSource: Boolean(item.missingSource),
      detailTruncated: Boolean(item.detailTruncated),
    }));
    const memories = this.db.prepare("SELECT m.id,'memory' kind,m.title,substr(m.body,1,4000) detail,length(m.body)>4000 detailTruncated,0 missingSource,m.updated_at updatedAt FROM memories m WHERE m.workspace_id=? AND NOT EXISTS(SELECT 1 FROM briefing_dismissals b WHERE b.workspace_id=m.workspace_id AND b.source_id=m.id AND b.source_kind='memory' AND b.local_day=?) ORDER BY m.updated_at DESC,m.id ASC LIMIT 51").all(workspaceId, localDay) as unknown as BriefingSource[];
    const briefing = composeDailyBriefing([...commitments, ...documents, ...memories], new Set(), instant, timezone);
    const counts = this.db.prepare("SELECT (SELECT count(*) FROM commitments WHERE workspace_id=? AND status='open') openCommitments,(SELECT count(*) FROM documents WHERE workspace_id=?) documents,(SELECT count(*) FROM memories WHERE workspace_id=?) memories,(SELECT count(*) FROM documents d LEFT JOIN revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=? AND r.id IS NULL) missingSources,(SELECT count(*) FROM briefing_dismissals b WHERE b.workspace_id=? AND b.local_day=? AND ((b.source_kind='commitment' AND EXISTS(SELECT 1 FROM commitments c WHERE c.id=b.source_id AND c.workspace_id=b.workspace_id AND c.status='open')) OR (b.source_kind='document' AND EXISTS(SELECT 1 FROM documents d WHERE d.id=b.source_id AND d.workspace_id=b.workspace_id)) OR (b.source_kind='memory' AND EXISTS(SELECT 1 FROM memories m WHERE m.id=b.source_id AND m.workspace_id=b.workspace_id)))) dismissed").get(workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, localDay) as {
      openCommitments: number;
      documents: number;
      memories: number;
      missingSources: number;
      dismissed: number;
    };
    briefing.coverage = {
      ...counts,
      omittedByLimit: Math.max(0, counts.openCommitments + counts.documents + counts.memories - counts.dismissed - briefing.items.length),
    };
    if (counts.missingSources) briefing.omissions.push(`${counts.missingSources} local note source${counts.missingSources === 1 ? ' is' : 's are'} missing its current revision; content could not be shown.`);
    return briefing;
  }

  dismissBriefingItem(workspaceId: string, sourceId: string, sourceKind: 'commitment' | 'document' | 'memory', localDay: string): void {
    const parsedDay = new Date(`${localDay}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDay) || !Number.isFinite(parsedDay.valueOf()) || parsedDay.toISOString().slice(0, 10) !== localDay) throw new Error('Briefing day is invalid');
    const exists = sourceKind === 'commitment' ? this.db.prepare('SELECT 1 FROM commitments WHERE id=? AND workspace_id=?').get(sourceId, workspaceId) : this.db.prepare(`SELECT 1 FROM ${sourceKind === 'document' ? 'documents' : 'memories'} WHERE id=? AND workspace_id=?`).get(sourceId, workspaceId);
    if (!exists) throw new Error('Briefing source not found');
    this.transaction(() => {
      const result = this.db.prepare('INSERT OR IGNORE INTO briefing_dismissals VALUES (?,?,?,?,?)').run(workspaceId, sourceId, sourceKind, localDay, now());
      if (result.changes) this.activity(workspaceId, 'briefing', 'item.dismissed', sourceId, sourceKind, { localDay });
    });
  }

  scanRuleSuggestions(workspaceId: string): number {
    if (!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) throw new Error('Workspace not found');
    const rows = this.db.prepare("SELECT m.id messageId,m.chat_id chatId,CASE WHEN length(m.body)<=100000 THEN m.body ELSE NULL END body FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=? AND m.role='user' ORDER BY m.created_at DESC,m.id ASC LIMIT ?").all(workspaceId, RULE_EXTRACTOR.maxMessages) as Array<{
        messageId: string;
        chatId: string;
        body: string | null;
      }>,
      groups = new Map<
        string,
        Array<{
          messageId: string;
          chatId: string;
          statement: string;
          excerpt: string;
          sourceDigest: string;
          startOffset: number;
          endOffset: number;
        }>
      >();
    let characters = 0;
    for (const row of rows) {
      if (row.body === null) continue;
      if (characters + row.body.length > RULE_EXTRACTOR.maxCharacters) break;
      characters += row.body.length;
      for (const item of extractRuleDirectives(row.body)) {
        const list = groups.get(item.normalized) ?? [];
        if (!list.some((source) => source.messageId === row.messageId)) list.push({ ...item, messageId: row.messageId, chatId: row.chatId });
        groups.set(item.normalized, list);
      }
    }
    let created = 0;
    this.transaction(() => {
      this.reconcileRuleProvenance(workspaceId);
      for (const [normalized, sources] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
        if (sources.length < 2 || created >= RULE_EXTRACTOR.maxCandidates) continue;
        const fingerprint = contentDigest(JSON.stringify([workspaceId, RULE_EXTRACTOR.provider, RULE_EXTRACTOR.version, normalized])),
          proposedId = randomUUID(),
          timestamp = now(),
          result = this.db.prepare("INSERT OR IGNORE INTO rule_suggestions VALUES (?,?,?,?,?,'workspace',?,?,?,'pending',NULL,NULL,NULL,?)").run(proposedId, workspaceId, sources[0].statement, normalized, fingerprint, RULE_EXTRACTOR.confidence, RULE_EXTRACTOR.provider, RULE_EXTRACTOR.version, timestamp),
          suggestion = this.db.prepare('SELECT id,status FROM rule_suggestions WHERE fingerprint=? AND workspace_id=?').get(fingerprint, workspaceId) as { id: string; status: string } | undefined;
        if (!suggestion || suggestion.status === 'rejected') continue;
        for (const source of sources) this.db.prepare('INSERT OR IGNORE INTO rule_suggestion_sources VALUES (?,?,?,?,?,?,?)').run(suggestion.id, source.messageId, source.chatId, source.excerpt, source.sourceDigest, source.startOffset, source.endOffset);
        if (result.changes) created++;
      }
      if (created)
        this.activity(workspaceId, 'rules', 'suggestions.scanned', workspaceId, 'workspace', {
          created,
          extractor: RULE_EXTRACTOR.provider,
          version: RULE_EXTRACTOR.version,
        });
    });
    return created;
  }

  listRuleSuggestions(workspaceId: string): Array<Record<string, unknown>> {
    return this.transaction(() => {
      this.reconcileRuleProvenance(workspaceId);
      const rows = this.db.prepare("SELECT id,statement,scope,confidence,extractor,extractor_version extractorVersion,status,last_dry_run_at lastDryRunAt,created_at createdAt FROM rule_suggestions WHERE workspace_id=? AND status='pending' ORDER BY created_at DESC,id ASC").all(workspaceId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        ...row,
        sources: this.db.prepare('SELECT message_id messageId,chat_id chatId,excerpt,start_offset startOffset,end_offset endOffset FROM rule_suggestion_sources WHERE suggestion_id=? ORDER BY message_id').all(String(row.id)),
      }));
    });
  }

  dryRunRuleSuggestion(workspaceId: string, suggestionId: string): { matchCount: number; sourceIds: string[] } {
    return this.transaction(() => {
      this.reconcileRuleProvenance(workspaceId);
      const suggestion = this.db.prepare("SELECT * FROM rule_suggestions WHERE id=? AND workspace_id=? AND status='pending'").get(suggestionId, workspaceId) as Record<string, unknown> | undefined;
      if (!suggestion) throw new Error('Pending rule suggestion not found');
      const sources = this.currentRuleSources(suggestionId, workspaceId);
      if (sources.length < 2) throw new Error('Rule suggestion no longer has enough valid sources');
      const digest = contentDigest(JSON.stringify(sources.map((item) => [item.messageId, item.sourceDigest]))),
        timestamp = now();
      this.db.prepare('UPDATE rule_suggestions SET last_dry_run_digest=?,last_dry_run_at=? WHERE id=?').run(digest, timestamp, suggestionId);
      this.db.prepare('INSERT INTO rule_outcomes VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), workspaceId, null, suggestionId, 'dry_run', sources.length, 1, timestamp);
      return {
        matchCount: sources.length,
        sourceIds: sources.map((item) => item.messageId),
      };
    });
  }

  resolveRuleSuggestion(workspaceId: string, suggestionId: string, action: 'approve' | 'reject'): void {
    this.transaction(() => {
      this.reconcileRuleProvenance(workspaceId);
      const suggestion = this.db.prepare("SELECT * FROM rule_suggestions WHERE id=? AND workspace_id=? AND status='pending'").get(suggestionId, workspaceId) as Record<string, unknown> | undefined;
      if (!suggestion) throw new Error('Pending rule suggestion not found');
      const timestamp = now();
      if (action === 'reject') {
        this.db.prepare("UPDATE rule_suggestions SET status='rejected',resolved_at=? WHERE id=?").run(timestamp, suggestionId);
        this.activity(workspaceId, 'rules', 'suggestion.rejected', suggestionId, 'rule_suggestion', {});
        return;
      }
      const sources = this.currentRuleSources(suggestionId, workspaceId),
        digest = contentDigest(JSON.stringify(sources.map((item) => [item.messageId, item.sourceDigest])));
      if (sources.length < 2 || !suggestion.last_dry_run_digest || String(suggestion.last_dry_run_digest) !== digest) throw new Error('Run a current dry run before approval');
      const ruleId = randomUUID();
      this.db.prepare('INSERT INTO learned_rules VALUES (?,?,?,?,?,?,?,?,?,?)').run(ruleId, workspaceId, suggestionId, String(suggestion.statement), 'workspace', 1, 1, null, timestamp, timestamp);
      this.db.prepare("UPDATE rule_suggestions SET status='accepted',resolved_at=? WHERE id=?").run(timestamp, suggestionId);
      this.db.prepare('UPDATE rule_outcomes SET rule_id=? WHERE suggestion_id=? AND rule_id IS NULL').run(ruleId, suggestionId);
      this.db.prepare('INSERT INTO rule_outcomes VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), workspaceId, ruleId, suggestionId, 'approved', sources.length, 1, timestamp);
      this.activity(workspaceId, 'rules', 'rule.approved', ruleId, 'rule', {
        version: 1,
        scope: 'workspace',
      });
    });
  }

  listLearnedRules(workspaceId: string): Array<Record<string, unknown>> {
    return this.transaction(() => {
      this.reconcileRuleProvenance(workspaceId);
      return (this.db.prepare('SELECT id,suggestion_id suggestionId,statement,scope,version,enabled,prior_enabled priorEnabled,created_at createdAt,updated_at updatedAt FROM learned_rules WHERE workspace_id=? ORDER BY updated_at DESC,id ASC').all(workspaceId) as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        enabled: Boolean(row.enabled),
        priorEnabled: row.priorEnabled == null ? null : Boolean(row.priorEnabled),
        outcomes: this.db.prepare('SELECT action,match_count matchCount,version,created_at createdAt FROM rule_outcomes WHERE rule_id=? ORDER BY rowid DESC').all(String(row.id)),
      }));
    });
  }

  setLearnedRuleEnabled(workspaceId: string, ruleId: string, enabled: boolean): void {
    this.transaction(() => {
      this.reconcileRuleProvenance(workspaceId);
      const rule = this.db.prepare('SELECT enabled,version FROM learned_rules WHERE id=? AND workspace_id=?').get(ruleId, workspaceId) as { enabled: number; version: number } | undefined;
      if (!rule) throw new Error('Learned rule not found');
      if (Boolean(rule.enabled) === enabled) return;
      const timestamp = now();
      this.db.prepare('UPDATE learned_rules SET prior_enabled=enabled,enabled=?,updated_at=? WHERE id=?').run(enabled ? 1 : 0, timestamp, ruleId);
      this.db.prepare('INSERT INTO rule_outcomes VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), workspaceId, ruleId, null, enabled ? 'enabled' : 'disabled', 0, rule.version, timestamp);
      this.activity(workspaceId, 'rules', enabled ? 'rule.enabled' : 'rule.disabled', ruleId, 'rule', { version: rule.version });
    });
  }

  revertLearnedRule(workspaceId: string, ruleId: string): void {
    this.transaction(() => {
      this.reconcileRuleProvenance(workspaceId);
      const rule = this.db.prepare('SELECT enabled,prior_enabled priorEnabled,version FROM learned_rules WHERE id=? AND workspace_id=?').get(ruleId, workspaceId) as { enabled: number; priorEnabled: number | null; version: number } | undefined;
      if (!rule || rule.priorEnabled == null) throw new Error('No learned rule state to revert');
      const timestamp = now();
      this.db.prepare('UPDATE learned_rules SET enabled=?,prior_enabled=NULL,updated_at=? WHERE id=?').run(rule.priorEnabled, timestamp, ruleId);
      this.db.prepare('INSERT INTO rule_outcomes VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), workspaceId, ruleId, null, 'reverted', 0, rule.version, timestamp);
      this.activity(workspaceId, 'rules', 'rule.reverted', ruleId, 'rule', {
        version: rule.version,
      });
    });
  }

  private reconcileRuleProvenance(workspaceId: string): void {
    const sources = this.db.prepare('SELECT rs.suggestion_id suggestionId,rs.message_id messageId,rs.source_digest sourceDigest,rs.excerpt,rs.start_offset startOffset,rs.end_offset endOffset,rs.chat_id sourceChatId,m.body,m.role,m.chat_id chatId FROM rule_suggestion_sources rs JOIN rule_suggestions s ON s.id=rs.suggestion_id LEFT JOIN messages m ON m.id=rs.message_id WHERE s.workspace_id=?').all(workspaceId) as Array<Record<string, unknown>>;
    for (const item of sources) {
      const valid = item.body != null && item.role === 'user' && item.chatId === item.sourceChatId && contentDigest(String(item.body)) === item.sourceDigest && String(item.body).slice(Number(item.startOffset), Number(item.endOffset)) === item.excerpt;
      if (!valid) this.db.prepare('DELETE FROM rule_suggestion_sources WHERE suggestion_id=? AND message_id=?').run(String(item.suggestionId), String(item.messageId));
    }
  }

  private currentRuleSources(suggestionId: string, workspaceId: string): Array<{ messageId: string; sourceDigest: string }> {
    const sources = this.db.prepare('SELECT rs.message_id messageId,rs.source_digest sourceDigest,rs.excerpt,rs.start_offset startOffset,rs.end_offset endOffset,m.body,m.role,m.chat_id chatId,rs.chat_id sourceChatId FROM rule_suggestion_sources rs JOIN messages m ON m.id=rs.message_id JOIN chats c ON c.id=m.chat_id WHERE rs.suggestion_id=? AND c.workspace_id=? ORDER BY rs.message_id').all(suggestionId, workspaceId) as Array<Record<string, unknown>>;
    return sources
      .filter((item) => item.role === 'user' && item.chatId === item.sourceChatId && contentDigest(String(item.body)) === item.sourceDigest && String(item.body).slice(Number(item.startOffset), Number(item.endOffset)) === item.excerpt)
      .map((item) => ({
        messageId: String(item.messageId),
        sourceDigest: String(item.sourceDigest),
      }));
  }

  createDocument(workspaceId: string, title: string, body: string): { id: string; revisionId: string } {
    const id = randomUUID(),
      revisionId = randomUUID(),
      timestamp = now();
    return this.transaction(() => {
      this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?)').run(id, workspaceId, title.trim() || 'Untitled', revisionId, timestamp, timestamp);
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(revisionId, id, body, timestamp);
      this.syncJournal.enqueue(workspaceId, id, 'document', 'upsert', {
        id,
        title: title.trim() || 'Untitled',
        revisionId,
        body,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.indexText(workspaceId, id, 'document', revisionId, title, body);
      this.activity(workspaceId, 'content', 'document.created', id, 'document', {});
      return { id, revisionId };
    });
  }

  captureMessageAsDocument(workspaceId: string, messageId: string): { id: string; revisionId: string } {
    const message = this.db.prepare("SELECT m.body,c.title FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=? AND c.workspace_id=? AND m.role='assistant'").get(messageId, workspaceId) as { body: string; title: string } | undefined;
    if (!message) throw new Error('Assistant message not found in workspace');
    const id = randomUUID(),
      revisionId = randomUUID(),
      relationshipId = randomUUID(),
      timestamp = now(),
      title = `From ${message.title}`;
    return this.transaction(() => {
      this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?)').run(id, workspaceId, title, revisionId, timestamp, timestamp);
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(revisionId, id, message.body, timestamp);
      this.indexText(workspaceId, id, 'document', revisionId, title, message.body);
      this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(relationshipId, workspaceId, messageId, id, 'captured_as', timestamp);
      this.syncJournal.enqueue(workspaceId, id, 'document', 'upsert', {
        id,
        title,
        revisionId,
        body: message.body,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.syncJournal.enqueue(workspaceId, relationshipId, 'relationship', 'upsert', {
        id: relationshipId,
        fromId: messageId,
        toId: id,
        type: 'captured_as',
      });
      this.activity(workspaceId, 'content', 'document.created', id, 'document', {});
      this.activity(workspaceId, 'graph', 'relationship.created', relationshipId, 'relationship', { fromId: messageId, toId: id, type: 'captured_as' });
      return { id, revisionId };
    });
  }

  updateDocument(workspaceId: string, documentId: string, title: string, body: string): string {
    this.assertObjectInWorkspace(workspaceId, documentId, 'document');
    const document = this.db.prepare('SELECT workspace_id FROM documents WHERE id=?').get(documentId) as { workspace_id: string } | undefined;
    if (!document) throw new Error('Document not found');
    const revisionId = randomUUID(),
      timestamp = now();
    return this.transaction(() => {
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(revisionId, documentId, body, timestamp);
      this.db.prepare('UPDATE documents SET title=?,current_revision_id=?,updated_at=? WHERE id=?').run(title.trim() || 'Untitled', revisionId, timestamp, documentId);
      this.db.prepare("DELETE FROM search_fts WHERE object_id=? AND object_kind='document'").run(documentId);
      this.indexText(document.workspace_id, documentId, 'document', revisionId, title, body);
      this.db.prepare('DELETE FROM embeddings WHERE object_id=?').run(documentId);
      this.db.prepare('DELETE FROM document_chunks WHERE workspace_id=? AND document_id=?').run(workspaceId,documentId);
      this.syncJournal.enqueue(workspaceId, documentId, 'document', 'upsert', {
        id: documentId,
        title: title.trim() || 'Untitled',
        revisionId,
        body,
        updatedAt: timestamp,
      });
      this.activity(document.workspace_id, 'content', 'document.updated', documentId, 'document', { revisionId });
      return revisionId;
    });
  }

  createChat(workspaceId: string, title: string): string {
    const id = randomUUID(),
      timestamp = now();
    this.transaction(() => {
      this.db.prepare('INSERT INTO chats VALUES (?,?,?,?,?)').run(id, workspaceId, title.trim() || 'New chat', timestamp, timestamp);
      this.syncJournal.enqueue(workspaceId, id, 'chat', 'upsert', {
        id,
        title: title.trim() || 'New chat',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.activity(workspaceId, 'content', 'chat.created', id, 'chat', {});
    });
    return id;
  }

  captureChat(workspaceId: string, title: string, body: string): string {
    const id = randomUUID(),
      messageId = randomUUID(),
      timestamp = now(),
      normalizedTitle = title.trim() || 'New chat';
    this.transaction(() => {
      this.db.prepare('INSERT INTO chats VALUES (?,?,?,?,?)').run(id, workspaceId, normalizedTitle, timestamp, timestamp);
      this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(messageId, id, 'user', body, timestamp);
      this.syncJournal.enqueue(workspaceId, id, 'chat', 'upsert', {
        id,
        title: normalizedTitle,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.syncJournal.enqueue(workspaceId, messageId, 'message', 'upsert', {
        id: messageId,
        chatId: id,
        role: 'user',
        body,
        createdAt: timestamp,
      });
      this.indexText(workspaceId, messageId, 'message', undefined, normalizedTitle, body);
      this.activity(workspaceId, 'content', 'chat.created', id, 'chat', {});
      this.activity(workspaceId, 'content', 'message.created', messageId, 'message', { role: 'user' });
    });
    return id;
  }

  addMessage(workspaceId: string, chatId: string, role: 'user' | 'assistant' | 'system', body: string, attachmentIds: string[] = []): string {
    this.assertObjectInWorkspace(workspaceId, chatId, 'chat');
    const chat = this.db.prepare('SELECT workspace_id,title FROM chats WHERE id=?').get(chatId) as { workspace_id: string; title: string } | undefined;
    if (!chat) throw new Error('Chat not found');
    const id = randomUUID(),
      timestamp = now();
    this.transaction(() => {
      if (attachmentIds.length > MAX_ATTACHMENTS_PER_OWNER || new Set(attachmentIds).size !== attachmentIds.length) throw new Error('Invalid message attachment selection');
      for (const attachmentId of attachmentIds) {
        const attachment = this.db.prepare('SELECT id,name,media_type mediaType,sha256 FROM attachments WHERE id=? AND workspace_id=? AND owner_id=?').get(attachmentId, workspaceId, chatId) as { id: string; name: string; mediaType: string; sha256: string } | undefined;
        if (!attachment) throw new Error('Pending chat attachment not found');
        this.db.prepare('UPDATE attachments SET owner_id=? WHERE id=?').run(id, attachmentId);
        this.syncJournal.enqueue(workspaceId, attachmentId, 'attachment', 'upsert', { ...attachment, ownerId: id });
      }
      this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(id, chatId, role, body, timestamp);
      this.db.prepare('UPDATE chats SET updated_at=? WHERE id=?').run(timestamp, chatId);
      this.syncJournal.enqueue(workspaceId, id, 'message', 'upsert', {
        id,
        chatId,
        role,
        body,
        createdAt: timestamp,
      });
      this.indexText(chat.workspace_id, id, 'message', undefined, chat.title, body);
      this.activity(chat.workspace_id, 'content', 'message.created', id, 'message', { role });
    });
    return id;
  }

  createMemory(workspaceId: string, title: string, body: string, sourceObjectId?: string, ownership: 'workspace-owned' | 'source-owned' = 'workspace-owned'): string {
    if (sourceObjectId) this.assertObjectInWorkspace(workspaceId, sourceObjectId);
    if (ownership === 'source-owned' && !sourceObjectId) throw new Error('Source-owned memory requires a source');
    const id = randomUUID(),
      timestamp = now();
    this.transaction(() => {
      this.db.prepare('INSERT INTO memories(id,workspace_id,title,body,source_object_id,ownership,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, workspaceId, title.trim() || 'Memory', body, sourceObjectId ?? null, ownership, timestamp, timestamp);
      this.syncJournal.enqueue(workspaceId, id, 'memory', 'upsert', {
        id,
        title: title.trim() || 'Memory',
        body,
        sourceObjectId: sourceObjectId ?? null,
        ownership,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.indexText(workspaceId, id, 'memory', undefined, title, body);
      this.activity(workspaceId, 'content', 'memory.created', id, 'memory', {
        sourceObjectId: sourceObjectId ?? null,
      });
    });
    return id;
  }

  captureMemory(workspaceId: string, title: string, body: string, sourceObjectId?: string, ownership: 'workspace-owned' | 'source-owned' = 'workspace-owned'): string {
    if (sourceObjectId) this.assertObjectInWorkspace(workspaceId, sourceObjectId);
    if (ownership === 'source-owned' && !sourceObjectId) throw new Error('Source-owned memory requires a source');
    const id = randomUUID(),
      timestamp = now(),
      normalizedTitle = title.trim() || 'Memory';
    this.transaction(() => {
      this.db.prepare('INSERT INTO memories(id,workspace_id,title,body,source_object_id,ownership,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, workspaceId, normalizedTitle, body, sourceObjectId ?? null, ownership, timestamp, timestamp);
      this.syncJournal.enqueue(workspaceId, id, 'memory', 'upsert', {
        id,
        title: normalizedTitle,
        body,
        sourceObjectId: sourceObjectId ?? null,
        ownership,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.indexText(workspaceId, id, 'memory', undefined, normalizedTitle, body);
      this.activity(workspaceId, 'content', 'memory.created', id, 'memory', {
        sourceObjectId: sourceObjectId ?? null,
      });
      if (sourceObjectId) {
        const relationshipId = randomUUID();
        this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(relationshipId, workspaceId, sourceObjectId, id, 'supports', timestamp);
        this.syncJournal.enqueue(workspaceId, relationshipId, 'relationship', 'upsert', {
          id: relationshipId,
          fromId: sourceObjectId,
          toId: id,
          type: 'supports',
          createdAt: timestamp,
        });
        this.activity(workspaceId, 'graph', 'relationship.created', relationshipId, 'relationship', { fromId: sourceObjectId, toId: id, type: 'supports' });
      }
    });
    return id;
  }

  createRelationship(workspaceId: string, fromId: string, toId: string, type: string): string {
    this.assertObjectInWorkspace(workspaceId, fromId);
    this.assertObjectInWorkspace(workspaceId, toId);
    const id = randomUUID();
    this.transaction(() => {
      this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(id, workspaceId, fromId, toId, type, now());
      this.syncJournal.enqueue(workspaceId, id, 'relationship', 'upsert', {
        id,
        fromId,
        toId,
        type,
      });
      this.activity(workspaceId, 'graph', 'relationship.created', id, 'relationship', { fromId, toId, type });
    });
    return id;
  }

  addAttachment(workspaceId: string, ownerId: string, name: string, mediaType: string, sourcePath: string): string {
    this.assertObjectInWorkspace(workspaceId, ownerId);
    const ownerCount = Number((this.db.prepare('SELECT count(*) count FROM attachments WHERE workspace_id=? AND owner_id=?').get(workspaceId, ownerId) as { count: number }).count),
      workspaceCount = Number((this.db.prepare('SELECT count(*) count FROM attachments WHERE workspace_id=?').get(workspaceId) as { count: number }).count);
    if (ownerCount >= MAX_ATTACHMENTS_PER_OWNER) throw new Error(`Attachment owner limit of ${MAX_ATTACHMENTS_PER_OWNER} reached`);
    if (workspaceCount >= MAX_ATTACHMENTS_PER_WORKSPACE) throw new Error(`Workspace attachment limit of ${MAX_ATTACHMENTS_PER_WORKSPACE} reached`);
    const validated = readAndValidateAttachment(sourcePath, name, mediaType),
      { bytes, sha256, safeName } = validated;
    const id = randomUUID(),
      relativePath = `${id}-${safeName}`,
      createdAt = now();
    writeFileSync(this.attachmentPath(relativePath), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
    try {
      this.transaction(() => {
        this.db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?)').run(id, workspaceId, ownerId, safeName, mediaType, sha256, relativePath, createdAt);
        this.syncJournal.enqueue(workspaceId, id, 'attachment', 'upsert', {
          id,
          ownerId,
          name: safeName,
          mediaType,
          sha256,
          bytes: bytes.byteLength,
          createdAt,
        });
      });
    } catch (error) {
      rmSync(path.join(this.attachmentRoot, relativePath), { force: true });
      throw error;
    }
    return id;
  }

  listAttachments(workspaceId: string, ownerId?: string): AttachmentMetadata[] {
    if (ownerId) this.assertObjectInWorkspace(workspaceId, ownerId);
    const rows = this.db.prepare(`SELECT id,workspace_id workspaceId,owner_id ownerId,name,media_type mediaType,sha256,relative_path relativePath,created_at createdAt FROM attachments WHERE workspace_id=? ${ownerId ? 'AND owner_id=?' : ''} ORDER BY created_at`).all(...(ownerId ? [workspaceId, ownerId] : [workspaceId])) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const ownerKind = this.objectKindInWorkspace(workspaceId, String(row.ownerId));
      if (!ownerKind) throw new Error('Attachment owner is missing');
      const file = this.attachmentPath(String(row.relativePath));
      if (!existsSync(file)) throw new Error('Stored attachment file is missing');
      return {
        id: String(row.id),
        workspaceId,
        ownerId: String(row.ownerId),
        ownerKind,
        name: String(row.name),
        mediaType: String(row.mediaType),
        sha256: String(row.sha256),
        bytes: statSync(file).size,
        createdAt: String(row.createdAt),
      };
    });
  }

  listChatAttachments(workspaceId: string, chatId: string): AttachmentMetadata[] {
    this.assertObjectInWorkspace(workspaceId, chatId, 'chat');
    const owners = [chatId, ...(this.db.prepare('SELECT id FROM messages WHERE chat_id=?').all(chatId) as Array<{ id: string }>).map((row) => row.id)];
    const ownerSet = new Set(owners);
    return this.listAttachments(workspaceId).filter((attachment) => ownerSet.has(attachment.ownerId));
  }

  registerDocumentImportSource(workspaceId:string,source:{documentId:string;revisionId:string;attachmentId:string;sourceDigest:string;textDigest:string;extractor:string;extractorVersion:string}):void{const row=this.db.prepare('SELECT d.current_revision_id revisionId,r.body,a.sha256 sourceDigest FROM documents d JOIN revisions r ON r.id=d.current_revision_id JOIN attachments a ON a.id=? AND a.workspace_id=d.workspace_id AND a.owner_id=d.id WHERE d.id=? AND d.workspace_id=?').get(source.attachmentId,source.documentId,workspaceId) as {revisionId:string;body:string;sourceDigest:string}|undefined;if(!row||row.revisionId!==source.revisionId||row.sourceDigest!==source.sourceDigest||contentDigest(row.body)!==source.textDigest||!source.extractor||source.extractor.length>100||!source.extractorVersion||source.extractorVersion.length>100)throw new Error('Imported document source provenance is invalid');this.db.prepare('INSERT INTO document_import_sources VALUES (?,?,?,?,?,?,?,?,?)').run(source.documentId,workspaceId,source.revisionId,source.attachmentId,source.sourceDigest,source.textDigest,source.extractor,source.extractorVersion,now())}
  documentSource(workspaceId:string,documentId:string):{metadata:AttachmentMetadata;bytes:Buffer;absolutePath:string;revisionId:string;sourceDigest:string;textDigest:string;extractor:string;extractorVersion:string}{this.assertObjectInWorkspace(workspaceId,documentId,'document');const binding=this.db.prepare('SELECT revision_id revisionId,attachment_id attachmentId,source_digest sourceDigest,text_digest textDigest,extractor,extractor_version extractorVersion FROM document_import_sources WHERE workspace_id=? AND document_id=?').get(workspaceId,documentId) as Record<string,unknown>|undefined;if(!binding)throw new Error('Imported document source provenance is missing');const metadata=this.listAttachments(workspaceId,documentId).find((item)=>item.id===String(binding.attachmentId));if(!metadata)throw new Error('Imported document source attachment is missing');const row=this.db.prepare('SELECT relative_path relativePath FROM attachments WHERE id=? AND workspace_id=? AND owner_id=?').get(metadata.id,workspaceId,documentId) as {relativePath:string}|undefined;if(!row)throw new Error('Imported document source attachment is invalid');const absolutePath=this.attachmentPath(row.relativePath);return{metadata,bytes:readFileSync(absolutePath),absolutePath,revisionId:String(binding.revisionId),sourceDigest:String(binding.sourceDigest),textDigest:String(binding.textDigest),extractor:String(binding.extractor),extractorVersion:String(binding.extractorVersion)}}

  deleteAttachment(workspaceId: string, attachmentId: string): void {
    const row = this.db.prepare('SELECT relative_path relativePath FROM attachments WHERE id=? AND workspace_id=?').get(attachmentId, workspaceId) as { relativePath: string } | undefined;
    if (!row) throw new Error('Attachment not found in workspace');
    const source = this.attachmentPath(row.relativePath),
      staged = `${source}.deleting-${randomUUID()}`;
    renameSync(source, staged);
    try {
      this.transaction(() => {
        this.db.prepare('DELETE FROM attachments WHERE id=? AND workspace_id=?').run(attachmentId, workspaceId);
        this.syncJournal.enqueue(workspaceId, attachmentId, 'attachment', 'delete', { id: attachmentId }, [attachmentId]);
        this.activity(workspaceId, 'lifecycle', 'attachment.deleted', attachmentId, 'attachment', {});
      });
    } catch (error) {
      renameSync(staged, source);
      throw error;
    }
    rmSync(staged, { force: true });
  }

  prepareAttachmentForProvider(
    workspaceId: string,
    attachmentId: string,
    capabilities: {
      inlineText: boolean;
      filePaths: boolean;
      acceptedMediaTypes: readonly string[];
      maxBytes: number;
    },
  ): ProviderAttachmentPreparation {
    const row = this.db.prepare('SELECT relative_path relativePath,owner_id ownerId FROM attachments WHERE id=? AND workspace_id=?').get(attachmentId, workspaceId) as { relativePath: string; ownerId: string } | undefined;
    if (!row) throw new Error('Attachment not found in workspace');
    const metadata = this.listAttachments(workspaceId, row.ownerId).find((item) => item.id === attachmentId)!;
    return prepareProviderAttachment({
      metadata,
      absolutePath: this.attachmentPath(row.relativePath),
      capabilities,
    });
  }

  searchText(workspaceId: string, query: string, limit = 20): SearchResult[] {
    if (!query.trim()) return [];
    const expression = query
      .trim()
      .split(/\s+/)
      .map((token) => `"${token.replaceAll('"', '""')}"`)
      .join(' AND ');
    const rows = this.db.prepare("SELECT object_id,object_kind,revision_id,title,snippet(search_fts,5,'','','…',16) excerpt,bm25(search_fts) rank FROM search_fts WHERE search_fts MATCH ? AND workspace_id=? ORDER BY rank LIMIT ?").all(expression, workspaceId, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      objectId: String(row.object_id),
      objectKind: row.object_kind as ObjectKind,
      revisionId: row.revision_id ? String(row.revision_id) : undefined,
      title: String(row.title),
      excerpt: String(row.excerpt),
      score: -Number(row.rank),
      method: 'text',
    }));
  }

  indexEmbedding(
    workspaceId: string,
    source: { objectId: string; objectKind: ObjectKind; revisionId?: string },
    vector: number[],
    provenance: {
      provider: string;
      providerVersion: string;
      model: string;
      modelDigest: string;
      chunkingDigest: string;
    },
  ): void {
    this.assertObjectInWorkspace(workspaceId, source.objectId);
    if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) throw new Error('Valid embedding vector required');
    this.transaction(() => {
      this.db.prepare('DELETE FROM embeddings WHERE workspace_id=? AND object_id=? AND provider=? AND provider_version=? AND model=? AND model_digest=? AND chunking_digest=?').run(workspaceId,source.objectId,provenance.provider,provenance.providerVersion,provenance.model,provenance.modelDigest,provenance.chunkingDigest);
      this.db.prepare('INSERT INTO embeddings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), workspaceId, source.objectId, source.objectKind, source.revisionId ?? null, provenance.provider, provenance.providerVersion, provenance.model, provenance.modelDigest, vector.length, provenance.chunkingDigest, JSON.stringify(vector), now());
      const stale=this.db.prepare('SELECT id FROM embeddings WHERE workspace_id=? AND object_id=? ORDER BY created_at DESC,rowid DESC LIMIT -1 OFFSET 2').all(workspaceId,source.objectId) as Array<{id:string}>;
      for(const row of stale)this.db.prepare('DELETE FROM embeddings WHERE id=?').run(row.id);
    });
  }

  replaceDocumentChunkGeneration(workspaceId:string,source:{documentId:string;revisionId:string;attachmentId:string},chunks:Array<{index:number;startOffset:number;endOffset:number;text:string;textDigest:string;policy:string;policyVersion:string;policyDigest:string;vector:number[]}>,provenance:{provider:string;providerVersion:string;model:string;modelDigest:string}):{generationDigest:string;chunkCount:number}{
    this.assertObjectInWorkspace(workspaceId,source.documentId,'document');
    const document=this.db.prepare('SELECT d.current_revision_id revisionId,r.body FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.id=? AND d.workspace_id=?').get(source.documentId,workspaceId) as {revisionId:string;body:string}|undefined,binding=this.db.prepare('SELECT revision_id revisionId,attachment_id attachmentId,text_digest textDigest FROM document_import_sources WHERE workspace_id=? AND document_id=?').get(workspaceId,source.documentId) as {revisionId:string;attachmentId:string;textDigest:string}|undefined;
    if(!document||document.revisionId!==source.revisionId||!binding||binding.revisionId!==source.revisionId||binding.attachmentId!==source.attachmentId||binding.textDigest!==contentDigest(document.body))throw new Error('Document chunk source provenance is stale or invalid');
    if(!chunks.length||chunks.length>2_000||chunks.some((chunk,index)=>chunk.index!==index||chunk.startOffset<0||chunk.endOffset<=chunk.startOffset||chunk.text.length>1_200||chunk.textDigest!==contentDigest(chunk.text)||document.body.slice(chunk.startOffset,chunk.endOffset)!==chunk.text||!chunk.vector.length||chunk.vector.length>65_536||chunk.vector.some((value)=>!Number.isFinite(value))))throw new Error('Document chunks violate bounded provenance');
    const dimensions=chunks[0].vector.length;if(chunks.some((chunk)=>chunk.vector.length!==dimensions))throw new Error('Document chunk vector dimensions differ');
    const policy=chunks[0];if(chunks.some((chunk)=>chunk.policy!==policy.policy||chunk.policyVersion!==policy.policyVersion||chunk.policyDigest!==policy.policyDigest))throw new Error('Document chunk policy cannot mix within a generation');
    const generationDigest=contentDigest(JSON.stringify({revisionId:source.revisionId,attachmentId:source.attachmentId,provider:provenance.provider,providerVersion:provenance.providerVersion,model:provenance.model,modelDigest:provenance.modelDigest,policy:policy.policy,policyVersion:policy.policyVersion,policyDigest:policy.policyDigest,dimensions})),timestamp=now();
    this.transaction(()=>{this.db.prepare('DELETE FROM document_chunks WHERE workspace_id=? AND document_id=? AND generation_digest=?').run(workspaceId,source.documentId,generationDigest);const insert=this.db.prepare('INSERT INTO document_chunks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');for(const chunk of chunks)insert.run(randomUUID(),workspaceId,source.documentId,source.revisionId,source.attachmentId,chunk.index,chunk.startOffset,chunk.endOffset,chunk.text,chunk.textDigest,chunk.policy,chunk.policyVersion,chunk.policyDigest,generationDigest,provenance.provider,provenance.providerVersion,provenance.model,provenance.modelDigest,dimensions,JSON.stringify(chunk.vector),timestamp);const generations=this.db.prepare('SELECT generation_digest digest,MAX(rowid) newest FROM document_chunks WHERE workspace_id=? AND document_id=? GROUP BY generation_digest ORDER BY newest DESC').all(workspaceId,source.documentId) as Array<{digest:string}>;for(const stale of generations.slice(2))this.db.prepare('DELETE FROM document_chunks WHERE workspace_id=? AND document_id=? AND generation_digest=?').run(workspaceId,source.documentId,stale.digest);this.activity(workspaceId,'maintenance','document.indexed',source.documentId,'document',{chunkCount:chunks.length,provider:provenance.provider,model:provenance.model})});
    return{generationDigest,chunkCount:chunks.length};
  }

  documentIndexStatus(workspaceId:string,documentId:string):{state:'indexed'|'not_indexed';chunkCount:number;sourceAvailable:boolean;sourceName?:string;provider?:string;model?:string;modelDigest?:string;policy?:string;generationDigest?:string;retainedGenerations:number}{
    this.assertObjectInWorkspace(workspaceId,documentId,'document');const rows=this.db.prepare('SELECT generation_digest generationDigest,provider,model,model_digest modelDigest,policy,count(*) chunkCount,MAX(rowid) newest FROM document_chunks WHERE workspace_id=? AND document_id=? GROUP BY generation_digest ORDER BY newest DESC').all(workspaceId,documentId) as Array<Record<string,unknown>>,row=rows[0],source=this.db.prepare('SELECT a.name FROM document_import_sources s JOIN attachments a ON a.id=s.attachment_id WHERE s.workspace_id=? AND s.document_id=?').get(workspaceId,documentId) as {name:string}|undefined;return row?{state:'indexed',chunkCount:Number(row.chunkCount),sourceAvailable:Boolean(source),sourceName:source?.name,provider:String(row.provider),model:String(row.model),modelDigest:String(row.modelDigest),policy:String(row.policy),generationDigest:String(row.generationDigest),retainedGenerations:rows.length}:{state:'not_indexed',chunkCount:0,sourceAvailable:Boolean(source),sourceName:source?.name,retainedGenerations:0};
  }

  rollbackDocumentIndex(workspaceId:string,documentId:string){this.assertObjectInWorkspace(workspaceId,documentId,'document');const generations=this.db.prepare('SELECT generation_digest digest,MAX(rowid) newest FROM document_chunks WHERE workspace_id=? AND document_id=? GROUP BY generation_digest ORDER BY newest DESC').all(workspaceId,documentId) as Array<{digest:string}>;if(generations.length<2)throw new Error('No prior complete document index generation is retained');this.transaction(()=>{this.db.prepare('DELETE FROM document_chunks WHERE workspace_id=? AND document_id=? AND generation_digest=?').run(workspaceId,documentId,generations[0].digest);this.activity(workspaceId,'maintenance','document.index_rolled_back',documentId,'document',{})});return this.documentIndexStatus(workspaceId,documentId)}

  semanticSearch(
    workspaceId: string,
    queryVector: number[],
    provenance: {
      provider: string;
      providerVersion: string;
      model: string;
      modelDigest: string;
      chunkingDigest: string;
    },
    limit = 20,
  ): SearchResult[] {
    const rows = this.db.prepare('SELECT * FROM embeddings WHERE workspace_id=? AND provider=? AND provider_version=? AND model=? AND model_digest=? AND chunking_digest=?').all(workspaceId, provenance.provider, provenance.providerVersion, provenance.model, provenance.modelDigest, provenance.chunkingDigest) as Array<Record<string, unknown>>;
    const ordinary=rows
      .map((row) => {
        const vector = JSON.parse(String(row.vector_json)) as number[];
        const score = cosine(queryVector, vector);
        const source = this.sourceTitle(String(row.object_id), String(row.object_kind) as ObjectKind);
        return {
          objectId: String(row.object_id),
          objectKind: row.object_kind as ObjectKind,
          revisionId: row.revision_id ? String(row.revision_id) : undefined,
          title: source.title,
          excerpt: source.excerpt,
          score,
          method: 'semantic' as const,
        };
      })
      .filter((result) => Number.isFinite(result.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const chunks=this.db.prepare('SELECT document_id objectId,revision_id revisionId,text,vector_json vector FROM document_chunks WHERE workspace_id=? AND provider=? AND provider_version=? AND model=? AND model_digest=? AND policy_digest=?').all(workspaceId,provenance.provider,provenance.providerVersion,provenance.model,provenance.modelDigest,provenance.chunkingDigest) as Array<Record<string,unknown>>,chunkResults=chunks.map((row)=>{const vector=JSON.parse(String(row.vector)) as number[],score=cosine(queryVector,vector),source=this.sourceTitle(String(row.objectId),'document');return{objectId:String(row.objectId),objectKind:'document' as const,revisionId:String(row.revisionId),title:source.title,excerpt:String(row.text).slice(0,500),score,method:'semantic' as const}}).filter((item)=>Number.isFinite(item.score));return[...ordinary,...chunkResults].sort((left,right)=>right.score-left.score).slice(0,limit);
  }

  graph(workspaceId: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const edges = this.db.prepare('SELECT id,from_id fromId,to_id toId,type FROM relationships WHERE workspace_id=?').all(workspaceId) as unknown as GraphEdge[];
    const ids = new Set(edges.flatMap((edge) => [edge.fromId, edge.toId]));
    const nodes = [...ids].map((id) => this.graphNode(id)).filter((node): node is GraphNode => Boolean(node));
    const surviving = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: edges.filter((edge) => surviving.has(edge.fromId) && surviving.has(edge.toId)),
    };
  }

  deleteMessage(workspaceId: string, messageId: string): void {
    this.assertObjectInWorkspace(workspaceId, messageId, 'message');
    const stagedFiles: Array<{ source: string; staged: string }> = [];
    try {
      this.transaction(() => {
        const ownedIds = [messageId];
        for (;;) {
          const placeholders = ownedIds.map(() => '?').join(','),
            dependents = this.db.prepare(`SELECT id FROM memories WHERE workspace_id=? AND ownership='source-owned' AND source_object_id IN (${placeholders})`).all(workspaceId, ...ownedIds) as Array<{ id: string }>,
            additions = dependents.map((row) => row.id).filter((id) => !ownedIds.includes(id));
          if (!additions.length) break;
          ownedIds.push(...additions);
        }
        const placeholders = ownedIds.map(() => '?').join(','),
          attachments = this.db.prepare(`SELECT id,relative_path relativePath FROM attachments WHERE workspace_id=? AND owner_id IN (${placeholders})`).all(workspaceId, ...ownedIds) as Array<{
            id: string;
            relativePath: string;
          }>;
        const relationships = (this.db.prepare(`SELECT id FROM relationships WHERE workspace_id=? AND (from_id IN (${placeholders}) OR to_id IN (${placeholders}))`).all(workspaceId, ...ownedIds, ...ownedIds) as Array<{ id: string }>).map((row) => row.id);
        const commitmentIds = (this.db.prepare(`SELECT id FROM commitments WHERE workspace_id=? AND source_message_id IN (${placeholders})`).all(workspaceId, ...ownedIds) as Array<{ id: string }>).map((row) => row.id);
        for (const attachment of attachments) {
          const source = this.attachmentPath(attachment.relativePath),
            staged = `${source}.deleting-${randomUUID()}`;
          renameSync(source, staged);
          stagedFiles.push({ source, staged });
        }
        this.db.prepare(`DELETE FROM relationships WHERE workspace_id=? AND (from_id IN (${placeholders}) OR to_id IN (${placeholders}))`).run(workspaceId, ...ownedIds, ...ownedIds);
        this.db.prepare(`DELETE FROM embeddings WHERE workspace_id=? AND object_id IN (${placeholders})`).run(workspaceId, ...ownedIds);
        this.db.prepare(`DELETE FROM queued_work WHERE workspace_id=? AND context_object_id IN (${placeholders})`).run(workspaceId, ...ownedIds);
        this.db.prepare(`DELETE FROM search_fts WHERE workspace_id=? AND object_id IN (${placeholders})`).run(workspaceId, ...ownedIds);
        this.db.prepare(`DELETE FROM briefing_dismissals WHERE workspace_id=? AND source_id IN (${[...ownedIds, ...commitmentIds].map(() => '?').join(',')})`).run(workspaceId, ...ownedIds, ...commitmentIds);
        this.db.prepare(`DELETE FROM attachments WHERE workspace_id=? AND owner_id IN (${placeholders})`).run(workspaceId, ...ownedIds);
        const detached = this.db.prepare(`SELECT id,title,body,ownership,created_at createdAt,updated_at updatedAt FROM memories WHERE workspace_id=? AND ownership='workspace-owned' AND source_object_id IN (${placeholders})`).all(workspaceId, ...ownedIds) as Array<{
          id: string;
          title: string;
          body: string;
          ownership: string;
          createdAt: string;
          updatedAt: string;
        }>;
        this.db.prepare(`UPDATE memories SET source_object_id=NULL WHERE workspace_id=? AND ownership='workspace-owned' AND source_object_id IN (${placeholders})`).run(workspaceId, ...ownedIds);
        for (const memory of detached)
          this.syncJournal.enqueue(workspaceId, memory.id, 'memory', 'upsert', {
            ...memory,
            sourceObjectId: null,
          });
        const dependentMemoryIds = ownedIds.filter((id) => id !== messageId);
        if (dependentMemoryIds.length) this.db.prepare(`DELETE FROM memories WHERE workspace_id=? AND id IN (${dependentMemoryIds.map(() => '?').join(',')})`).run(workspaceId, ...dependentMemoryIds);
        this.db.prepare('DELETE FROM messages WHERE id=?').run(messageId);
        for (const dependentId of dependentMemoryIds) {
          this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(dependentId, workspaceId, 'memory', now());
          this.syncJournal.enqueue(workspaceId, dependentId, 'memory', 'delete', { id: dependentId }, [dependentId]);
          this.activity(workspaceId, 'lifecycle', 'deleted', dependentId, 'memory', {});
        }
        this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(messageId, workspaceId, 'message', now());
        const cascadeIds = [...ownedIds, ...commitmentIds, ...attachments.map((item) => item.id), ...relationships];
        this.syncJournal.enqueue(workspaceId, messageId, 'message', 'delete', { id: messageId, cascade: true, cascadeIds }, cascadeIds);
        this.activity(workspaceId, 'lifecycle', 'deleted', messageId, 'message', {});
      });
    } catch (error) {
      for (const file of stagedFiles.reverse()) renameSync(file.staged, file.source);
      throw error;
    }
    for (const file of stagedFiles) rmSync(file.staged, { force: true });
  }

  deleteObject(workspaceId: string, objectKind: 'document' | 'chat' | 'memory', objectId: string): void {
    const stagedFiles: Array<{ source: string; staged: string }> = [];
    try {
      this.transaction(() => {
        this.assertObjectInWorkspace(workspaceId, objectId, objectKind);
        if(objectKind==='memory'||objectKind==='document')this.db.prepare("UPDATE reflection_runs SET status='stale',updated_at=? WHERE workspace_id=? AND id IN (SELECT run_id FROM reflection_sources WHERE source_id=? AND source_kind=?)").run(now(),workspaceId,objectId,objectKind);
        const ownedIds = objectKind === 'chat' ? [objectId, ...(this.db.prepare('SELECT id FROM messages WHERE chat_id=?').all(objectId) as Array<{ id: string }>).map((message) => message.id)] : [objectId];
        for (;;) {
          const placeholders = ownedIds.map(() => '?').join(',');
          const dependents = this.db.prepare(`SELECT id FROM memories WHERE ownership='source-owned' AND source_object_id IN (${placeholders})`).all(...ownedIds) as Array<{ id: string }>;
          const additions = dependents.map((row) => row.id).filter((id) => !ownedIds.includes(id));
          if (!additions.length) break;
          ownedIds.push(...additions);
        }
        const placeholders = ownedIds.map(() => '?').join(',');
        const attachmentRows = this.db.prepare(`SELECT id,relative_path FROM attachments WHERE owner_id IN (${placeholders})`).all(...ownedIds) as Array<{ id: string; relative_path: string }>;
        const relationshipIds = (this.db.prepare(`SELECT id FROM relationships WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`).all(...ownedIds, ...ownedIds) as Array<{ id: string }>).map((row) => row.id);
        const commitmentIds = (this.db.prepare(`SELECT id FROM commitments WHERE workspace_id=? AND source_message_id IN (${placeholders})`).all(workspaceId, ...ownedIds) as Array<{ id: string }>).map((row) => row.id);
        for (const attachment of attachmentRows) {
          const source = path.join(this.attachmentRoot, attachment.relative_path),
            staged = `${source}.deleting-${randomUUID()}`;
          renameSync(source, staged);
          stagedFiles.push({ source, staged });
        }
        this.db.prepare(`DELETE FROM relationships WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`).run(...ownedIds, ...ownedIds);
        this.db.prepare(`DELETE FROM embeddings WHERE object_id IN (${placeholders})`).run(...ownedIds);
        this.db.prepare(`DELETE FROM queued_work WHERE context_object_id IN (${placeholders})`).run(...ownedIds);
        this.db.prepare(`DELETE FROM search_fts WHERE object_id IN (${placeholders})`).run(...ownedIds);
        this.db.prepare(`DELETE FROM briefing_dismissals WHERE workspace_id=? AND source_id IN (${[...ownedIds, ...commitmentIds].map(() => '?').join(',')})`).run(workspaceId, ...ownedIds, ...commitmentIds);
        this.db.prepare(`DELETE FROM attachments WHERE owner_id IN (${placeholders})`).run(...ownedIds);
        const dependentMemoryIds = ownedIds.filter((id) => id !== objectId && this.objectWorkspace(id, 'memory') === workspaceId);
        const detachedMemories = this.db.prepare(`SELECT id,title,body,ownership,created_at createdAt,updated_at updatedAt FROM memories WHERE workspace_id=? AND ownership='workspace-owned' AND source_object_id IN (${placeholders})`).all(workspaceId, ...ownedIds) as Array<{
          id: string;
          title: string;
          body: string;
          ownership: string;
          createdAt: string;
          updatedAt: string;
        }>;
        this.db.prepare(`UPDATE memories SET source_object_id=NULL WHERE ownership='workspace-owned' AND source_object_id IN (${placeholders})`).run(...ownedIds);
        for (const memory of detachedMemories)
          this.syncJournal.enqueue(workspaceId, memory.id, 'memory', 'upsert', {
            ...memory,
            sourceObjectId: null,
          });
        if (dependentMemoryIds.length) this.db.prepare(`DELETE FROM memories WHERE id IN (${dependentMemoryIds.map(() => '?').join(',')})`).run(...dependentMemoryIds);
        this.db.prepare(`DELETE FROM ${objectKind === 'document' ? 'documents' : objectKind === 'chat' ? 'chats' : 'memories'} WHERE id=?`).run(objectId);
        for (const dependentId of dependentMemoryIds) {
          this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(dependentId, workspaceId, 'memory', now());
          this.syncJournal.enqueue(workspaceId, dependentId, 'memory', 'delete', { id: dependentId }, [dependentId]);
          this.activity(workspaceId, 'lifecycle', 'deleted', dependentId, 'memory', {});
        }
        this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(objectId, workspaceId, objectKind, now());
        const cascadeIds = [...ownedIds, ...commitmentIds, ...relationshipIds, ...attachmentRows.map((row) => row.id)];
        this.syncJournal.enqueue(workspaceId, objectId, objectKind, 'delete', { id: objectId, cascade: true, cascadeIds }, cascadeIds);
        this.activity(workspaceId, 'lifecycle', 'deleted', objectId, objectKind, {});
      });
    } catch (error) {
      for (const file of stagedFiles.reverse()) renameSync(file.staged, file.source);
      throw error;
    }
    for (const file of stagedFiles) rmSync(file.staged, { force: true });
  }

  createMeeting(workspaceId: string, title: string, consentVersion = 'local-consent-v1'): string {
    if (!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) throw new Error('Workspace not found');
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length > 300) throw new Error('Meeting title is invalid');
    const id = randomUUID(),
      timestamp = now();
    this.transaction(() => {
      this.db.prepare("INSERT INTO meetings VALUES (?,?,?,'recording',?,?,NULL,NULL,0,NULL,NULL,'none','uncertain',NULL,?,NULL)").run(id, workspaceId, cleanTitle, timestamp, consentVersion, timestamp);
      this.activity(workspaceId, 'meeting', 'recording.started', id, 'meeting', { version: 1 });
    });
    return id;
  }

  private validatedLocalEvent(workspaceId:string,eventId:string){const row=this.db.prepare('SELECT id,schema_version schemaVersion,source,event_type eventType,occurred_at occurredAt,received_at receivedAt,idempotency_key idempotencyKey,payload_json payloadJson,payload_digest payloadDigest,authority_json authorityJson,status FROM local_events WHERE workspace_id=? AND id=?').get(workspaceId,eventId) as Record<string,unknown>|undefined;if(!row)throw new Error('Local fixture event not found');let payload:LocalTriggerPayload;try{payload=JSON.parse(String(row.payloadJson)) as LocalTriggerPayload}catch{throw new Error('Stored local event provenance is invalid')}const expected=createLocalEventEnvelope({workspaceId,eventType:String(row.eventType),idempotencyKey:String(row.idempotencyKey),payload,occurredAt:String(row.occurredAt),receivedAt:String(row.receivedAt)});if(Number(row.schemaVersion)!==1||row.source!==expected.source||row.payloadDigest!==expected.payloadDigest||row.authorityJson!==JSON.stringify(LOCAL_TRIGGER_AUTHORITY)||row.status!=='quarantined')throw new Error('Stored local event provenance is invalid');return{id:String(row.id),eventType:expected.eventType,payloadDigest:expected.payloadDigest,occurredAt:String(row.occurredAt),receivedAt:String(row.receivedAt)}}

  private validatedLocalTriggerRule(workspaceId:string,ruleId:string){const row=this.db.prepare('SELECT id,source_event_id sourceEventId,statement,version,definition_json definitionJson,definition_digest definitionDigest,status,created_at createdAt,updated_at updatedAt FROM local_trigger_rules WHERE workspace_id=? AND id=?').get(workspaceId,ruleId) as Record<string,unknown>|undefined;if(!row)throw new Error('Local trigger rule not found');const event=this.validatedLocalEvent(workspaceId,String(row.sourceEventId)),expected=suggestedTriggerRule(workspaceId,event.eventType),status=String(row.status);if(Number(row.version)!==1||row.statement!==expected.statement||row.definitionJson!==JSON.stringify(expected.definition)||row.definitionDigest!==expected.digest||!['suggested','paused','killed'].includes(status))throw new Error('Stored local trigger provenance is invalid');return{id:String(row.id),sourceEventId:String(row.sourceEventId),statement:expected.statement,version:1,definitionJson:JSON.stringify(expected.definition),definitionDigest:expected.digest,status:status as 'suggested'|'paused'|'killed',createdAt:String(row.createdAt),updatedAt:String(row.updatedAt),event}}

  createLocalWebhookFixture(workspaceId:string,eventType:string,idempotencyKey:string,payload:LocalTriggerPayload):string{if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');const counts=this.db.prepare('SELECT (SELECT count(*) FROM local_events WHERE workspace_id=?) events,(SELECT count(*) FROM local_trigger_rules WHERE workspace_id=?) rules').get(workspaceId,workspaceId) as {events:number;rules:number};if(counts.events>=LOCAL_TRIGGER_LIMITS.maxEvents||counts.rules>=LOCAL_TRIGGER_LIMITS.maxRules)throw new Error('Local trigger workspace limit reached');if(this.db.prepare('SELECT 1 FROM local_events WHERE workspace_id=? AND source=? AND idempotency_key=?').get(workspaceId,LOCAL_TRIGGER_AUTHORITY.source,idempotencyKey))throw new Error('Local fixture replay rejected');const event=createLocalEventEnvelope({workspaceId,eventType,idempotencyKey,payload}),rule=suggestedTriggerRule(workspaceId,event.eventType),ruleId=randomUUID(),timestamp=now();this.transaction(()=>{this.db.prepare("INSERT INTO local_events VALUES (?,?,?,?,?,?,?,?,?,?,?,'quarantined')").run(event.id,workspaceId,event.schemaVersion,event.source,event.eventType,event.occurredAt,event.receivedAt,event.idempotencyKey,JSON.stringify(event.payload),event.payloadDigest,JSON.stringify(event.authority));this.db.prepare("INSERT INTO local_trigger_rules VALUES (?,?,?,?,?,?,?,'suggested',?,?)").run(ruleId,workspaceId,event.id,rule.statement,1,JSON.stringify(rule.definition),rule.digest,timestamp,timestamp);this.activity(workspaceId,'automation','trigger.event_observed',event.id,'local_event',{source:event.source,eventType:event.eventType,status:'quarantined'});this.activity(workspaceId,'automation','trigger.rule_suggested',ruleId,'local_trigger_rule',{version:1,status:'suggested'})});return event.id}

  listLocalTriggerLab(workspaceId:string){if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');const setting=this.db.prepare('SELECT kill_switch killSwitch FROM local_trigger_settings WHERE workspace_id=?').get(workspaceId) as {killSwitch:number}|undefined,eventIds=this.db.prepare('SELECT id FROM local_events WHERE workspace_id=? ORDER BY received_at DESC LIMIT 500').all(workspaceId) as Array<{id:string}>,ruleIds=this.db.prepare('SELECT id FROM local_trigger_rules WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100').all(workspaceId) as Array<{id:string}>,events=eventIds.map((item)=>this.validatedLocalEvent(workspaceId,item.id)),rules=ruleIds.map((item)=>this.validatedLocalTriggerRule(workspaceId,item.id));return{killSwitch:Boolean(setting?.killSwitch),authority:LOCAL_TRIGGER_AUTHORITY,events:events.map((row)=>({id:row.id,eventType:row.eventType,occurredAt:row.occurredAt,receivedAt:row.receivedAt,payloadDigest:row.payloadDigest,status:'quarantined' as const})),rules:rules.map((row)=>({id:row.id,sourceEventId:row.sourceEventId,statement:row.statement,version:row.version,definitionDigest:row.definitionDigest,status:row.status,createdAt:row.createdAt,updatedAt:row.updatedAt,runs:(this.db.prepare('SELECT id,event_id eventId,status,attempt,proposed_effects proposedEffects,run_digest digest,created_at createdAt FROM local_trigger_runs WHERE workspace_id=? AND rule_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50').all(workspaceId,row.id) as Array<Record<string,unknown>>).map((run)=>{const status=String(run.status),attempt=Number(run.attempt),createdAt=String(run.createdAt),valid=status==='dry_run'&&attempt===1||status==='retrying'&&(attempt===1||attempt===2)||status==='dead_letter'&&attempt===3,expected=localTriggerDryRun({workspaceId,ruleId:row.id,ruleVersion:row.version,ruleDigest:row.definitionDigest,eventId:row.event.id,eventDigest:row.event.payloadDigest,eventType:row.event.eventType,definitionJson:row.definitionJson,killSwitch:false});if(!valid||run.eventId!==row.event.id||Number(run.proposedEffects)!==0||run.digest!==expected.digest||!Number.isFinite(new Date(createdAt).valueOf()))throw new Error('Stored local trigger run provenance is invalid');return{id:String(run.id),status:status as 'dry_run'|'retrying'|'dead_letter',attempt,proposedEffects:0 as const,digest:expected.digest,createdAt}})}))}}

  approveLocalTriggerRule(workspaceId:string,ruleId:string):void{if(this.validatedLocalTriggerRule(workspaceId,ruleId).status!=='suggested')throw new Error('Suggested local trigger rule not found');const result=this.db.prepare("UPDATE local_trigger_rules SET status='paused',updated_at=? WHERE id=? AND workspace_id=? AND status='suggested'").run(now(),ruleId,workspaceId);if(result.changes!==1)throw new Error('Suggested local trigger rule not found');this.activity(workspaceId,'automation','trigger.rule_approved',ruleId,'local_trigger_rule',{status:'paused',authority:'simulation-only'})}

  dryRunLocalTriggerRule(workspaceId:string,ruleId:string,simulateFailure=false){const row=this.validatedLocalTriggerRule(workspaceId,ruleId);if(row.status!=='paused')throw new Error('Approved paused local trigger rule not found');const eventId=row.event.id,setting=this.db.prepare('SELECT kill_switch killSwitch FROM local_trigger_settings WHERE workspace_id=?').get(workspaceId) as {killSwitch:number}|undefined,result=localTriggerDryRun({workspaceId,ruleId,ruleVersion:row.version,ruleDigest:row.definitionDigest,eventId,eventDigest:row.event.payloadDigest,eventType:row.event.eventType,definitionJson:row.definitionJson,killSwitch:Boolean(setting?.killSwitch)}),completed=this.db.prepare("SELECT attempt FROM local_trigger_runs WHERE workspace_id=? AND rule_id=? AND event_id=? AND run_digest=? AND status='dry_run'").get(workspaceId,ruleId,eventId,result.digest) as {attempt:number}|undefined;if(!simulateFailure&&completed)return{...result,idempotent:true,status:'dry_run' as const,attempt:completed.attempt};const priorFailure=this.db.prepare("SELECT status,attempt FROM local_trigger_runs WHERE workspace_id=? AND rule_id=? AND event_id=? AND run_digest=? AND status IN ('retrying','dead_letter') ORDER BY attempt DESC LIMIT 1").get(workspaceId,ruleId,eventId,result.digest) as {status:string;attempt:number}|undefined;if(simulateFailure&&priorFailure?.status==='dead_letter')return{...result,idempotent:true,status:'dead_letter' as const,attempt:3};const attempt=simulateFailure?(priorFailure?.attempt??0)+1:1,status=simulateFailure?(attempt>=3?'dead_letter':'retrying'):'dry_run',id=randomUUID();if((this.db.prepare('SELECT count(*) count FROM local_trigger_runs WHERE workspace_id=? AND rule_id=?').get(workspaceId,ruleId) as {count:number}).count>=LOCAL_TRIGGER_LIMITS.maxRunsPerRule)throw new Error('Local trigger run history limit reached');this.db.prepare('INSERT INTO local_trigger_runs VALUES (?,?,?,?,?,?,?,?,?)').run(id,workspaceId,ruleId,eventId,status,attempt,0,result.digest,now());this.activity(workspaceId,'automation',`trigger.${status}`,id,'local_trigger_run',{status,attempt,proposedEffects:0});return{...result,idempotent:false,status,attempt}}

  setLocalTriggerKillSwitch(workspaceId:string,enabled:boolean):void{if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');this.db.prepare('INSERT INTO local_trigger_settings VALUES (?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET kill_switch=excluded.kill_switch,updated_at=excluded.updated_at').run(workspaceId,enabled?1:0,now());this.activity(workspaceId,'automation',enabled?'trigger.kill_enabled':'trigger.kill_disabled',workspaceId,'workspace',{enabled})}

  deleteLocalTriggerEvent(workspaceId:string,eventId:string):void{const result=this.db.prepare('DELETE FROM local_events WHERE id=? AND workspace_id=?').run(eventId,workspaceId);if(result.changes!==1)throw new Error('Local fixture event not found');this.activity(workspaceId,'automation','trigger.event_deleted',eventId,'local_event',{})}

  importExternalInboundEvent(workspaceId:string,input:{eventId:string;channelId:string;eventType:string;occurredAt:string;receivedAt:string;payload:LocalTriggerPayload}){if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');if(!/^[A-Za-z0-9_-]{16,128}$/.test(input.eventId)||!/^[A-Za-z0-9_-]{16,128}$/.test(input.channelId))throw new Error('Inbound webhook provenance is invalid');const occurred=Date.parse(input.occurredAt),received=Date.parse(input.receivedAt),current=Date.now();if(!Number.isFinite(occurred)||!Number.isFinite(received)||new Date(occurred).toISOString()!==input.occurredAt||new Date(received).toISOString()!==input.receivedAt||occurred>received+LOCAL_TRIGGER_LIMITS.maxClockSkewMs||received>current+LOCAL_TRIGGER_LIMITS.maxClockSkewMs||current-received>7*86_400_000+LOCAL_TRIGGER_LIMITS.maxClockSkewMs)throw new Error('Inbound webhook timestamp is invalid or expired');const validated=createLocalEventEnvelope({workspaceId,eventType:input.eventType,idempotencyKey:input.eventId,payload:input.payload,occurredAt:input.occurredAt,receivedAt:input.occurredAt}),prior=this.db.prepare('SELECT id,workspace_id workspaceId,channel_id channelId,event_type eventType,occurred_at occurredAt,received_at receivedAt,payload_digest payloadDigest FROM external_inbound_events WHERE workspace_id=? AND channel_id=? AND source_event_id=?').get(workspaceId,input.channelId,input.eventId) as Record<string,unknown>|undefined;if(prior){if(prior.eventType!==validated.eventType||prior.occurredAt!==input.occurredAt||prior.receivedAt!==input.receivedAt||prior.payloadDigest!==validated.payloadDigest)throw new Error('Inbound webhook event identifier collision');return{eventId:String(prior.id),sourceEventId:input.eventId,idempotent:true}}const id=randomUUID();this.db.prepare("INSERT INTO external_inbound_events VALUES (?,?,?,?,?,?,?,?,?,'quarantined',?)").run(id,input.eventId,workspaceId,input.channelId,validated.eventType,input.occurredAt,input.receivedAt,JSON.stringify(validated.payload),validated.payloadDigest,now());this.activity(workspaceId,'automation','webhook.event_quarantined',id,'external_inbound_event',{channelId:input.channelId,status:'quarantined',proposedEffects:0});return{eventId:id,sourceEventId:input.eventId,idempotent:false}}

  listExternalInboundEvents(workspaceId:string){if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');return(this.db.prepare('SELECT id,source_event_id sourceEventId,channel_id channelId,event_type eventType,occurred_at occurredAt,received_at receivedAt,payload_json payloadJson,payload_digest payloadDigest,status,created_at createdAt FROM external_inbound_events WHERE workspace_id=? ORDER BY received_at DESC LIMIT 500').all(workspaceId) as Array<Record<string,unknown>>).map((row)=>{let payload:LocalTriggerPayload;try{payload=JSON.parse(String(row.payloadJson)) as LocalTriggerPayload}catch{throw new Error('Stored inbound webhook provenance is invalid')}const occurredAt=String(row.occurredAt),receivedAt=String(row.receivedAt),occurred=Date.parse(occurredAt),received=Date.parse(receivedAt),sourceEventId=String(row.sourceEventId),validated=createLocalEventEnvelope({workspaceId,eventType:String(row.eventType),idempotencyKey:sourceEventId,payload,occurredAt,receivedAt:occurredAt});if(!/^[A-Za-z0-9_-]{16,128}$/.test(sourceEventId)||!Number.isFinite(received)||new Date(received).toISOString()!==receivedAt||occurred>received+LOCAL_TRIGGER_LIMITS.maxClockSkewMs||validated.payloadDigest!==row.payloadDigest||row.status!=='quarantined')throw new Error('Stored inbound webhook provenance is invalid');return{id:String(row.id),sourceEventId,channelId:String(row.channelId),eventType:validated.eventType,occurredAt,receivedAt,payload:validated.payload,payloadDigest:validated.payloadDigest,status:'quarantined' as const,createdAt:String(row.createdAt),proposedEffects:0 as const}})}

  deleteExternalInboundEvent(workspaceId:string,eventId:string){const result=this.db.prepare('DELETE FROM external_inbound_events WHERE workspace_id=? AND id=?').run(workspaceId,eventId);if(result.changes!==1)throw new Error('Inbound webhook event not found');this.activity(workspaceId,'automation','webhook.event_deleted',eventId,'external_inbound_event',{status:'deleted'})}

  createFixturePlaybook(workspaceId: string, title: string, timezone: string, hour: number, minute: number): string {
    if (!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) throw new Error('Workspace not found');
    const clean = title.trim();
    if (!clean || clean.length > 200) throw new Error('Playbook title is invalid');
    nextDailyOccurrence(timezone, hour, minute, now());
    const id = randomUUID(),
      timestamp = now(),
      version = 1,
      definition = playbookDefinitionJson(),
      definitionDigest = playbookDefinitionDigest({
        workspaceId,
        version,
        timezone,
        hour,
        minute,
        definition,
      }),
      permission = JSON.stringify(FIXTURE_CONNECTOR);
    this.transaction(() => {
      this.db.prepare("INSERT INTO fixture_playbooks VALUES (?,?,?,?,'paused',?,?,?,?,?,?,NULL,NULL,?,?)").run(id, workspaceId, clean, version, timezone, hour, minute, definition, definitionDigest, permission, timestamp, timestamp);
      this.activity(workspaceId, 'automation', 'playbook.created', id, 'playbook', { version });
    });
    return id;
  }

  listFixturePlaybooks(workspaceId: string, afterIso = now()): FixturePlaybookView[] {
    if (!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) throw new Error('Workspace not found');
    const rows = this.db.prepare('SELECT id,workspace_id workspaceId,title,version,status,timezone,hour,minute,definition_json definitionJson,definition_digest definitionDigest,permission_json permissionJson,last_dry_run_at lastDryRunAt,created_at createdAt,updated_at updatedAt FROM fixture_playbooks WHERE workspace_id=? ORDER BY created_at DESC').all(workspaceId) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      assertPlaybookDefinition(String(row.definitionJson));
      if (String(row.permissionJson) !== JSON.stringify(FIXTURE_CONNECTOR) || String(row.definitionDigest) !== playbookDefinitionDigest({ workspaceId, version: Number(row.version), timezone: String(row.timezone), hour: Number(row.hour), minute: Number(row.minute), definition: String(row.definitionJson) })) throw new Error('Stored playbook authority or provenance is invalid');
      return {
        id: String(row.id),
        workspaceId,
        title: String(row.title),
        version: Number(row.version),
        definition: JSON.parse(String(row.definitionJson)) as FixturePlaybookView['definition'],
        permission: JSON.parse(String(row.permissionJson)) as FixturePlaybookView['permission'],
        status: String(row.status) as 'paused' | 'killed',
        timezone: String(row.timezone),
        hour: Number(row.hour),
        minute: Number(row.minute),
        nextOccurrence: nextDailyOccurrence(String(row.timezone), Number(row.hour), Number(row.minute), afterIso),
        lastDryRunAt: row.lastDryRunAt == null ? undefined : String(row.lastDryRunAt),
        createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt),
        runs: this.db.prepare('SELECT id,status,attempt,input_count inputCount,output_count outputCount,proposed_effects proposedEffects,created_at createdAt,finished_at finishedAt FROM fixture_playbook_runs WHERE playbook_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 50').all(String(row.id), workspaceId) as unknown as FixturePlaybookView['runs'],
      };
    });
  }

  dryRunFixturePlaybook(workspaceId: string, playbookId: string): ReturnType<typeof fixtureDryRun> {
    const row = this.db.prepare('SELECT version,timezone,hour,minute,definition_json definitionJson,definition_digest definitionDigest,permission_json permissionJson,status FROM fixture_playbooks WHERE id=? AND workspace_id=?').get(playbookId, workspaceId) as { version:number;timezone:string;hour:number;minute:number;definitionJson: string; definitionDigest: string; permissionJson:string;status: string } | undefined;
    if (!row) throw new Error('Playbook not found');
    assertPlaybookDefinition(row.definitionJson);
    if(row.permissionJson!==JSON.stringify(FIXTURE_CONNECTOR)||row.definitionDigest!==playbookDefinitionDigest({workspaceId,version:row.version,timezone:row.timezone,hour:row.hour,minute:row.minute,definition:row.definitionJson}))throw new Error('Stored playbook authority or provenance is invalid');
    if (row.status === 'killed') throw new Error('Playbook kill switch is active');
    const preview = fixtureDryRun(),
      digest = contentDigest(JSON.stringify([row.definitionDigest, preview.digest])),
      timestamp = now();
    this.transaction(() => {
      this.db.prepare('UPDATE fixture_playbooks SET last_dry_run_digest=?,last_dry_run_at=?,updated_at=? WHERE id=?').run(digest, timestamp, timestamp, playbookId);
      this.db.prepare("INSERT INTO fixture_playbook_runs VALUES (?,?,?,?, 'dry_run',1,?,?,0,?,?,?)").run(randomUUID(), workspaceId, playbookId, null, preview.inputCount, preview.deduplicatedCount, JSON.stringify(preview.permissionSnapshot), timestamp, timestamp);
      this.activity(workspaceId, 'automation', 'playbook.dry_run', playbookId, 'playbook', { version: 1 });
    });
    return { ...preview, digest };
  }

  runFixturePlaybook(
    workspaceId: string,
    playbookId: string,
    dryRunDigest: string,
    simulateFailure = false,
  ): {
    runId: string;
    status: 'completed' | 'retrying' | 'dead_letter';
    idempotent: boolean;
  } {
    const row = this.db.prepare('SELECT version,timezone,hour,minute,status,last_dry_run_digest lastDryRunDigest,definition_json definitionJson,definition_digest definitionDigest,permission_json permissionJson FROM fixture_playbooks WHERE id=? AND workspace_id=?').get(playbookId, workspaceId) as
      | {
          version:number;timezone:string;hour:number;minute:number;
          status: string;
          lastDryRunDigest: string | null;
          definitionJson: string;
          definitionDigest:string;
          permissionJson: string;
        }
      | undefined;
    if (!row) throw new Error('Playbook not found');
    assertPlaybookDefinition(row.definitionJson);
    if(row.permissionJson!==JSON.stringify(FIXTURE_CONNECTOR)||row.definitionDigest!==playbookDefinitionDigest({workspaceId,version:row.version,timezone:row.timezone,hour:row.hour,minute:row.minute,definition:row.definitionJson}))throw new Error('Stored playbook authority or provenance is invalid');
    if (row.status === 'killed') throw new Error('Playbook kill switch is active');
    if (!row.lastDryRunDigest || row.lastDryRunDigest !== dryRunDigest) throw new Error('Run a current dry run before manual execution');
    if (row.permissionJson !== JSON.stringify(FIXTURE_CONNECTOR)) throw new Error('Playbook permission snapshot is invalid');
    const existing = this.db.prepare('SELECT id,status,attempt FROM fixture_playbook_runs WHERE playbook_id=? AND idempotency_key=?').get(playbookId, dryRunDigest) as { id: string; status: string; attempt: number } | undefined;
    if (existing?.status === 'completed' || existing?.status === 'dead_letter')
      return {
        runId: existing.id,
        status: existing.status,
        idempotent: true,
      } as {
        runId: string;
        status: 'completed' | 'dead_letter';
        idempotent: true;
      };
    const preview = fixtureDryRun(),
      runId = existing?.id ?? randomUUID(),
      attempt = (existing?.attempt ?? 0) + 1,
      status = simulateFailure ? (attempt >= 3 ? 'dead_letter' : 'retrying') : 'completed',
      timestamp = now();
    this.transaction(() => {
      if (existing) this.db.prepare('UPDATE fixture_playbook_runs SET status=?,attempt=?,finished_at=? WHERE id=?').run(status, attempt, status === 'retrying' ? null : timestamp, runId);
      else this.db.prepare('INSERT INTO fixture_playbook_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(runId, workspaceId, playbookId, dryRunDigest, status, attempt, preview.inputCount, status === 'completed' ? preview.deduplicatedCount : 0, 0, JSON.stringify(preview.permissionSnapshot), timestamp, status === 'retrying' ? null : timestamp);
      this.activity(workspaceId, 'automation', `playbook.${status}`, playbookId, 'playbook', { version: 1 });
    });
    return { runId, status, idempotent: false };
  }

  killFixturePlaybook(workspaceId: string, playbookId: string): void {
    const timestamp = now(),
      result = this.db.prepare("UPDATE fixture_playbooks SET status='killed',last_dry_run_digest=NULL,updated_at=? WHERE id=? AND workspace_id=?").run(timestamp, playbookId, workspaceId);
    if (!result.changes) throw new Error('Playbook not found');
    this.activity(workspaceId, 'automation', 'playbook.killed', playbookId, 'playbook', { version: 1 });
  }
  enableFixtureSchedule(): never {
    throw new Error('Background schedule activation requires separate user authorization and is unavailable in the fixture lab');
  }
  deleteFixturePlaybook(workspaceId: string, playbookId: string): void {
    const result = this.db.prepare('DELETE FROM fixture_playbooks WHERE id=? AND workspace_id=?').run(playbookId, workspaceId);
    if (!result.changes) throw new Error('Playbook not found');
    this.activity(workspaceId, 'automation', 'playbook.deleted', playbookId, 'playbook', {});
  }

  finalizeMeetingAudio(workspaceId: string, meetingId: string, mediaType: string, bytes: Buffer): void {
    const meeting = this.db.prepare('SELECT status FROM meetings WHERE id=? AND workspace_id=?').get(meetingId, workspaceId) as { status: string } | undefined;
    if (!meeting || meeting.status !== 'recording') throw new Error('Active meeting recording not found');
    const validated = validateMeetingAudio(mediaType, bytes),
      relativePath = `${meetingId}.${validated.extension}`,
      target = this.meetingAudioPath(relativePath);
    writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    try {
      this.transaction(() => {
        this.db.prepare("UPDATE meetings SET status='ready',audio_relative_path=?,media_type=?,bytes=?,sha256=?,ended_at=? WHERE id=? AND workspace_id=? AND status='recording'").run(relativePath, mediaType, bytes.length, validated.sha256, now(), meetingId, workspaceId);
        this.activity(workspaceId, 'meeting', 'recording.completed', meetingId, 'meeting', { version: 1 });
      });
    } catch (error) {
      rmSync(target, { force: true });
      throw error;
    }
  }

  failMeeting(workspaceId: string, meetingId: string, failureCode: 'permission_denied' | 'device_lost' | 'interrupted' | 'disk_pressure' | 'capture_failed' | 'size_limit'): void {
    this.transaction(() => {
      const result = this.db.prepare("UPDATE meetings SET status='failed',failure_code=?,ended_at=? WHERE id=? AND workspace_id=? AND status='recording'").run(failureCode, now(), meetingId, workspaceId);
      if (result.changes) this.activity(workspaceId, 'meeting', 'recording.failed', meetingId, 'meeting', {});
    });
  }

  listMeetings(workspaceId: string): MeetingView[] {
    return this.db.prepare('SELECT id,workspace_id workspaceId,title,status,consent_acknowledged_at consentAcknowledgedAt,consent_version consentVersion,media_type mediaType,bytes,sha256,transcript,transcript_status transcriptStatus,speaker_handling speakerHandling,failure_code failureCode,created_at createdAt,ended_at endedAt FROM meetings WHERE workspace_id=? ORDER BY created_at DESC').all(workspaceId) as unknown as MeetingView[];
  }

  updateMeetingTranscript(workspaceId: string, meetingId: string, transcript: string, reviewed: boolean): void {
    const meeting = this.db.prepare('SELECT status FROM meetings WHERE id=? AND workspace_id=?').get(meetingId, workspaceId) as { status: string } | undefined;
    if (!meeting || meeting.status !== 'ready') throw new Error('Completed meeting not found');
    const value = validateTranscript(transcript),
      status = reviewed ? 'reviewed' : 'draft',
      result = this.db.prepare('UPDATE meetings SET transcript=?,transcript_status=? WHERE id=? AND workspace_id=?').run(value, status, meetingId, workspaceId);
    if (!result.changes) throw new Error('Meeting not found');
    this.activity(workspaceId, 'meeting', reviewed ? 'transcript.reviewed' : 'transcript.draft_saved', meetingId, 'meeting', { version: 1 });
  }

  saveMeetingTranscriptToMemory(workspaceId: string, meetingId: string): string {
    const meeting = this.db.prepare("SELECT title,transcript FROM meetings WHERE id=? AND workspace_id=? AND transcript_status='reviewed'").get(meetingId, workspaceId) as { title: string; transcript: string } | undefined;
    if (!meeting) throw new Error('Review the transcript before saving it to knowledge');
    const existing = this.db.prepare("SELECT id FROM memories WHERE workspace_id=? AND source_object_id=? AND ownership='source-owned'").get(workspaceId, meetingId) as { id: string } | undefined,
      id = existing?.id ?? randomUUID(),
      timestamp = now(),
      title = `Meeting: ${meeting.title}`;
    this.transaction(() => {
      if (existing) {
        this.db.prepare('UPDATE memories SET title=?,body=?,updated_at=? WHERE id=?').run(title, meeting.transcript, timestamp, id);
        this.db.prepare('DELETE FROM search_fts WHERE workspace_id=? AND object_id=?').run(workspaceId, id);
      } else {
        this.db.prepare("INSERT INTO memories VALUES (?,?,?,?,?,'source-owned',?,?)").run(id, workspaceId, title, meeting.transcript, meetingId, timestamp, timestamp);
        this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(randomUUID(), workspaceId, meetingId, id, 'transcribed_as', timestamp);
      }
      this.indexText(workspaceId, id, 'memory', undefined, title, meeting.transcript);
      this.activity(workspaceId, 'meeting', existing ? 'transcript.knowledge_updated' : 'transcript.saved_to_knowledge', id, 'memory', { version: 1 });
    });
    return id;
  }

  meetingAudio(workspaceId: string, meetingId: string): { path: string; mediaType: string; title: string } {
    const row = this.db.prepare("SELECT title,audio_relative_path relativePath,media_type mediaType,sha256 FROM meetings WHERE id=? AND workspace_id=? AND status='ready'").get(meetingId, workspaceId) as
      | {
          title: string;
          relativePath: string;
          mediaType: string;
          sha256: string;
        }
      | undefined;
    if (!row || !row.relativePath) throw new Error('Meeting audio not found');
    const file = this.meetingAudioPath(row.relativePath);
    if (!existsSync(file)) throw new Error('Stored meeting audio file is missing');
    const validated = validateMeetingAudio(row.mediaType, readFileSync(file));
    if (validated.sha256 !== row.sha256) throw new Error('Stored meeting audio integrity check failed');
    return { path: file, mediaType: row.mediaType, title: row.title };
  }

  deleteMeeting(workspaceId: string, meetingId: string): void {
    const row = this.db.prepare('SELECT audio_relative_path relativePath FROM meetings WHERE id=? AND workspace_id=?').get(meetingId, workspaceId) as { relativePath: string | null } | undefined;
    if (!row) throw new Error('Meeting not found');
    const source = row.relativePath ? this.meetingAudioPath(row.relativePath) : undefined,
      staged = source ? `${source}.deleting-${randomUUID()}` : undefined;
    if (source && existsSync(source)) renameSync(source, staged!);
    try {
      this.transaction(() => {
        const memories = this.db.prepare("SELECT id FROM memories WHERE workspace_id=? AND source_object_id=? AND ownership='source-owned'").all(workspaceId, meetingId) as Array<{ id: string }>;
        for (const memory of memories) {
          this.db.prepare('DELETE FROM search_fts WHERE workspace_id=? AND object_id=?').run(workspaceId, memory.id);
          this.db.prepare('DELETE FROM relationships WHERE workspace_id=? AND (from_id=? OR to_id=?)').run(workspaceId, memory.id, memory.id);
          this.db.prepare('DELETE FROM memories WHERE id=?').run(memory.id);
        }
        this.db.prepare('DELETE FROM relationships WHERE workspace_id=? AND (from_id=? OR to_id=?)').run(workspaceId, meetingId, meetingId);
        this.db.prepare('DELETE FROM meetings WHERE id=? AND workspace_id=?').run(meetingId, workspaceId);
        this.activity(workspaceId, 'meeting', 'meeting.deleted', meetingId, 'meeting', {});
      });
    } catch (error) {
      if (source && staged && existsSync(staged)) renameSync(staged, source);
      throw error;
    }
    if (staged) rmSync(staged, { force: true });
  }

  listActivity(
    workspaceId: string,
    filters: {
      families?: ActivityFamily[];
      query?: string;
      limit?: number;
    } = {},
  ): ActivityTimelineItem[] {
    if (!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) throw new Error('Workspace not found');
    if (filters.limit !== undefined && !Number.isFinite(filters.limit)) throw new Error('Activity limit is invalid');
    if (filters.families?.some((family) => !ACTIVITY_FAMILIES.includes(family))) throw new Error('Activity family is invalid');
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 250), 1), 500),
      query = (filters.query ?? '').trim().toLocaleLowerCase(),
      families = new Set(filters.families ?? []);
    const rows = this.db.prepare('SELECT id,category,action,object_id objectId,object_kind objectKind,metadata_json metadata,created_at createdAt FROM activities WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 500').all(workspaceId) as Array<Record<string, unknown>>;
    const timeline: ActivityTimelineItem[] = [];
    for (const row of rows) {
      const family = activityFamily(String(row.category));
      if (families.size && !families.has(family)) continue;
      const objectId = row.objectId ? String(row.objectId) : undefined,
        objectKind = String(row.objectKind),
        object = this.activityObject(workspaceId, objectId, objectKind),
        action = String(row.action);
      if (query && ![family, String(row.category), action, objectKind, object.title ?? ''].some((value) => value.toLocaleLowerCase().includes(query))) continue;
      timeline.push({
        id: String(row.id),
        category: String(row.category),
        family,
        action,
        objectId,
        objectKind,
        objectState: action === 'deleted' || action.endsWith('.deleted') ? 'deleted' : object.title ? 'available' : 'historical',
        objectTitle: object.title,
        targetId: object.targetId,
        targetKind: object.targetKind,
        details: safeActivityDetails(String(row.metadata)),
        createdAt: String(row.createdAt),
      });
      if (timeline.length >= limit) break;
    }
    return timeline;
  }

  recordSyncActivity(workspaceId: string, action: 'device.initialized' | 'device.enrolled' | 'device.approved' | 'device.revoked' | 'key.rotated' | 'sync.completed', details: Record<string, unknown> = {}): void {
    if (!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) throw new Error('Workspace not found');
    this.activity(workspaceId, 'sync', action, workspaceId, 'workspace', details);
  }

  openRouterSettings():OpenRouterSettings{const row=this.db.prepare("SELECT enabled,live_requests_enabled liveRequestsEnabled,strategic_model strategicModel,everyday_model everydayModel,fallback_provider fallbackProvider,monthly_cap_micros monthlyCapMicros,ytd_cap_micros ytdCapMicros,per_request_cap_micros perRequestCapMicros,warning_percent warningPercent FROM provider_settings WHERE provider='openrouter'").get() as Record<string,unknown>|undefined;return row?{enabled:Boolean(row.enabled),liveRequestsEnabled:Boolean(row.liveRequestsEnabled),strategicModel:String(row.strategicModel),everydayModel:String(row.everydayModel),fallbackProvider:row.fallbackProvider as 'codex'|'claude'|undefined,monthlyCapMicros:Number(row.monthlyCapMicros),ytdCapMicros:Number(row.ytdCapMicros),perRequestCapMicros:Number(row.perRequestCapMicros),warningPercent:Number(row.warningPercent)}:{enabled:false,liveRequestsEnabled:false,strategicModel:'',everydayModel:'',fallbackProvider:'codex',monthlyCapMicros:5_000_000,ytdCapMicros:25_000_000,perRequestCapMicros:100_000,warningPercent:80}}
  setOpenRouterSettings(value:OpenRouterSettings):OpenRouterSettings{const next=validateOpenRouterSettings(value),timestamp=now();this.db.prepare("INSERT INTO provider_settings VALUES ('openrouter',?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET enabled=excluded.enabled,live_requests_enabled=excluded.live_requests_enabled,strategic_model=excluded.strategic_model,everyday_model=excluded.everyday_model,fallback_provider=excluded.fallback_provider,monthly_cap_micros=excluded.monthly_cap_micros,ytd_cap_micros=excluded.ytd_cap_micros,per_request_cap_micros=excluded.per_request_cap_micros,warning_percent=excluded.warning_percent,updated_at=excluded.updated_at").run(next.enabled?1:0,next.liveRequestsEnabled?1:0,next.strategicModel,next.everydayModel,next.fallbackProvider??null,next.monthlyCapMicros,next.ytdCapMicros,next.perRequestCapMicros??100_000,next.warningPercent,timestamp);return next}
  chatModelPreferences(workspaceId:string):Record<'codex'|'claude',string>{if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');const result={codex:'',claude:''};for(const row of this.db.prepare('SELECT provider,model FROM chat_model_preferences WHERE workspace_id=?').all(workspaceId) as Array<{provider:'codex'|'claude';model:string}>)result[row.provider]=row.model;return result}
  setChatModelPreference(workspaceId:string,provider:'codex'|'claude',model:string){if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');if(!['codex','claude'].includes(provider)||model.length>200||!/^[A-Za-z0-9._:/-]*$/.test(model))throw new Error('Chat model preference is invalid');this.db.prepare('INSERT INTO chat_model_preferences VALUES (?,?,?,?) ON CONFLICT(workspace_id,provider) DO UPDATE SET model=excluded.model,updated_at=excluded.updated_at').run(workspaceId,provider,model,now());return this.chatModelPreferences(workspaceId)}
  voicePreferences(workspaceId:string){if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');const row=this.db.prepare('SELECT mode,microphone_id microphoneId,output_voice outputVoice,engine FROM voice_preferences WHERE workspace_id=?').get(workspaceId)as{mode:'push_to_talk'|'hands_free';microphoneId:string;outputVoice:'system';engine:'fast_local'|'full_duplex_experimental'}|undefined;return row??{mode:'push_to_talk' as const,microphoneId:'',outputVoice:'system' as const,engine:'fast_local' as const}}
  setVoicePreferences(workspaceId:string,value:{mode:string;microphoneId:string;outputVoice:string;engine?:string}){if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');const engine=value.engine??this.voicePreferences(workspaceId).engine;if(!['push_to_talk','hands_free'].includes(value.mode)||value.microphoneId.length>512||value.outputVoice!=='system'||!['fast_local','full_duplex_experimental'].includes(engine))throw new Error('Voice preferences are invalid');this.db.prepare('INSERT INTO voice_preferences(workspace_id,mode,microphone_id,output_voice,updated_at,engine) VALUES (?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET mode=excluded.mode,microphone_id=excluded.microphone_id,output_voice=excluded.output_voice,updated_at=excluded.updated_at,engine=excluded.engine').run(workspaceId,value.mode,value.microphoneId,value.outputVoice,now(),engine);return this.voicePreferences(workspaceId)}
  saveProviderUsage(receipt:ProviderUsageReceipt,sync=true):void{if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(receipt.workspaceId))throw new Error('Workspace not found');if(!/^[a-f0-9]{64}$/.test(receipt.requestDigest)||receipt.model.length<3||receipt.model.length>200||!['strategic','everyday'].includes(receipt.role)||!['completed','failed','canceled','blocked'].includes(receipt.status)||![receipt.costMicros,receipt.promptTokens,receipt.completionTokens].every((value)=>Number.isSafeInteger(value)&&value>=0)||!canonicalIso(receipt.startedAt)||!canonicalIso(receipt.finishedAt))throw new Error('Provider usage receipt is invalid');this.db.prepare('INSERT INTO provider_usage_receipts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(receipt.id,receipt.workspaceId,'openrouter',receipt.model,receipt.role,receipt.status,receipt.costMicros,receipt.promptTokens,receipt.completionTokens,receipt.requestDigest,receipt.responseId??null,receipt.errorCode??null,receipt.fallbackProvider??null,receipt.startedAt,receipt.finishedAt);if(sync)this.syncJournal.enqueue(receipt.workspaceId,receipt.id,'provider_usage','upsert',{model:receipt.model,role:receipt.role,status:receipt.status,costMicros:receipt.costMicros,promptTokens:receipt.promptTokens,completionTokens:receipt.completionTokens,requestDigest:receipt.requestDigest,responseId:receipt.responseId,errorCode:receipt.errorCode,fallbackProvider:receipt.fallbackProvider,createdAt:receipt.startedAt,updatedAt:receipt.finishedAt})}
  providerUsage(workspaceId?:string){const rows=this.db.prepare(`SELECT id,workspace_id workspaceId,provider,model,route_role role,status,cost_micros costMicros,prompt_tokens promptTokens,completion_tokens completionTokens,request_digest requestDigest,response_id responseId,error_code errorCode,fallback_provider fallbackProvider,started_at startedAt,finished_at finishedAt FROM provider_usage_receipts${workspaceId?' WHERE workspace_id=?':''} ORDER BY finished_at DESC,id DESC`).all(...(workspaceId?[workspaceId]:[])) as ProviderUsageReceipt[];return{receipts:rows,summary:summarizeUsage(rows,this.openRouterSettings())}}
  createHostedRun(workspaceId:string,chatId:string,sourceMessageId:string,role:'strategic'|'everyday',model:string){this.assertObjectInWorkspace(workspaceId,chatId,'chat');if(!this.db.prepare('SELECT 1 FROM messages WHERE id=? AND chat_id=?').get(sourceMessageId,chatId))throw new Error('Source message not found in chat');const id=randomUUID(),timestamp=now();this.db.prepare("INSERT INTO hosted_runs(id,workspace_id,chat_id,source_message_id,route_role,model,status,created_at) VALUES (?,?,?,?,?,?,'queued',?)").run(id,workspaceId,chatId,sourceMessageId,role,model,timestamp);this.db.prepare("INSERT INTO hosted_run_events VALUES (?,?,1,'policy','Protected key + explicit activation + reserved spending cap',?)").run(randomUUID(),id,timestamp);return id}
  startHostedRun(workspaceId:string,id:string){const timestamp=now(),changed=this.db.prepare("UPDATE hosted_runs SET status='running',started_at=? WHERE id=? AND workspace_id=? AND status='queued'").run(timestamp,id,workspaceId);if(!changed.changes)throw new Error('Hosted run is not queued');this.addHostedRunEvent(workspaceId,id,'provider','OpenRouter request started')}
  addHostedRunEvent(workspaceId:string,id:string,type:'provider'|'progress'|'terminal',message:string){if(message.length>500)message=message.slice(0,500);const row=this.db.prepare('SELECT 1 FROM hosted_runs WHERE id=? AND workspace_id=?').get(id,workspaceId);if(!row)throw new Error('Hosted run not found');const sequence=Number((this.db.prepare('SELECT coalesce(max(sequence),0)+1 next FROM hosted_run_events WHERE run_id=?').get(id) as {next:number}).next);this.db.prepare('INSERT INTO hosted_run_events VALUES (?,?,?,?,?,?)').run(randomUUID(),id,sequence,type,message,now())}
  finishHostedRun(workspaceId:string,id:string,status:'completed'|'failed'|'canceled',receipt:ProviderUsageReceipt,assistantText?:string){const row=this.db.prepare("SELECT chat_id chatId FROM hosted_runs WHERE id=? AND workspace_id=? AND status='running'").get(id,workspaceId) as {chatId:string}|undefined;if(!row)throw new Error('Hosted run is not running');this.saveProviderUsage(receipt);this.db.prepare("UPDATE hosted_runs SET status=?,finished_at=?,error_code=?,usage_receipt_id=? WHERE id=? AND workspace_id=? AND status='running'").run(status,now(),receipt.errorCode??null,receipt.id,id,workspaceId);if(status==='completed'&&assistantText){const messageId=this.addMessage(workspaceId,row.chatId,'assistant',assistantText);this.activity(workspaceId,'ai','hosted.message.created',messageId,'message',{hostedRunId:id})}this.addHostedRunEvent(workspaceId,id,'terminal',status==='completed'?`Completed · ${(receipt.costMicros/1_000_000).toFixed(6)} USD`:status)}
  listHostedRuns(workspaceId:string,chatId?:string){return(this.db.prepare(`SELECT id,chat_id chatId,source_message_id sourceMessageId,route_role routeRole,model,status,started_at startedAt,finished_at finishedAt,error_code errorCode,created_at createdAt FROM hosted_runs WHERE workspace_id=?${chatId?' AND chat_id=?':''} ORDER BY created_at DESC`).all(...(chatId?[workspaceId,chatId]:[workspaceId])) as Array<Record<string,unknown>>).map((run)=>({...run,cli:'openrouter',device:'hosted',depth:0,assistantMessageId:(this.db.prepare("SELECT object_id id FROM activities WHERE workspace_id=? AND action='hosted.message.created' AND json_extract(metadata_json,'$.hostedRunId')=? ORDER BY created_at DESC LIMIT 1").get(workspaceId,String(run.id)) as {id?:string}|undefined)?.id,events:this.db.prepare('SELECT sequence,type,text,created_at createdAt FROM hosted_run_events WHERE run_id=? ORDER BY sequence').all(String(run.id))}))}

  deviceControlPolicy(workspaceId:string):WorkerPolicy{if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');const row=this.db.prepare('SELECT worker_enabled enabled,preferred_device_id preferredDeviceId,failover,allowed_capabilities_json allowedCapabilities,max_duration_ms maxDurationMs,max_concurrency maxConcurrency FROM device_control_settings WHERE workspace_id=?').get(workspaceId) as Record<string,unknown>|undefined;return row?validateWorkerPolicy({version:1,enabled:Boolean(row.enabled),preferredDeviceId:row.preferredDeviceId??undefined,failover:Boolean(row.failover),allowedCapabilities:JSON.parse(String(row.allowedCapabilities)),maxDurationMs:Number(row.maxDurationMs),maxConcurrency:Number(row.maxConcurrency)}):defaultWorkerPolicy()}
  setDeviceControlPolicy(workspaceId:string,input:WorkerPolicy):WorkerPolicy{const policy=validateWorkerPolicy(input);if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');this.db.prepare('INSERT INTO device_control_settings VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET worker_enabled=excluded.worker_enabled,preferred_device_id=excluded.preferred_device_id,failover=excluded.failover,allowed_capabilities_json=excluded.allowed_capabilities_json,max_duration_ms=excluded.max_duration_ms,max_concurrency=excluded.max_concurrency,updated_at=excluded.updated_at').run(workspaceId,policy.enabled?1:0,policy.preferredDeviceId??null,policy.failover?1:0,JSON.stringify(policy.allowedCapabilities),policy.maxDurationMs,1,now());this.activity(workspaceId,'sync',policy.enabled?'worker.enabled':'worker.disabled',workspaceId,'workspace',{scope:'workspace',version:1});return policy}
  createRemoteJobRecord(input:{workspaceId:string;controllerDeviceId:string;targetDeviceId:string;capability:CrossDeviceCapability;instruction:string;idempotencyKey:string;profileDigest:string;keyEpoch:number;timeoutMs:number}):RemoteJobEnvelope{const job=createRemoteJob({...input,origin:'user'}),digest=jobRequestDigest(job),timestamp=job.createdAt,prior=this.db.prepare('SELECT id,request_digest requestDigest FROM remote_jobs WHERE workspace_id=? AND controller_device_id=? AND idempotency_key=?').get(job.workspaceId,job.controllerDeviceId,job.idempotencyKey) as {id:string;requestDigest:string}|undefined;if(prior){if(prior.requestDigest!==digest)throw new Error('remote_job_idempotency_conflict');return this.remoteJobEnvelope(job.workspaceId,prior.id)}this.transaction(()=>{this.db.prepare('INSERT INTO remote_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(job.id,job.workspaceId,job.controllerDeviceId,job.targetDeviceId,job.capability,job.instruction,job.idempotencyKey,digest,job.profileDigest,job.keyEpoch,job.timeoutMs,'user','queued',null,null,null,null,timestamp,timestamp);this.addRemoteJobEvent(job.id,'queued','Queued for selected trusted device',timestamp);const mutation=this.syncJournal.enqueue(job.workspaceId,job.id,'remote_job','upsert',this.remoteJobSyncPayload(job.workspaceId,job.id)!);this.syncJournal.targetMutation(job.workspaceId,mutation.id,job.targetDeviceId);this.activity(job.workspaceId,'sync','remote_job.queued',job.id,'remote_job',{device:'peer',version:1})});return job}
  private remoteJobEnvelope(workspaceId:string,id:string):RemoteJobEnvelope{const row=this.db.prepare('SELECT id,workspace_id workspaceId,controller_device_id controllerDeviceId,target_device_id targetDeviceId,capability,instruction,idempotency_key idempotencyKey,profile_digest profileDigest,key_epoch keyEpoch,created_at createdAt,timeout_ms timeoutMs,origin FROM remote_jobs WHERE id=? AND workspace_id=?').get(id,workspaceId) as Omit<RemoteJobEnvelope,'version'>|undefined;if(!row)throw new Error('Remote job not found');return validateRemoteJob({...row,version:1})}
  private remoteJobSyncPayload(workspaceId:string,id:string):Record<string,unknown>|undefined{const row=this.db.prepare('SELECT status,lease_id leaseId,lease_expires_at leaseExpiresAt,result_summary resultSummary,error_code errorCode,updated_at updatedAt FROM remote_jobs WHERE id=? AND workspace_id=?').get(id,workspaceId) as Record<string,unknown>|undefined;if(!row)return undefined;const envelope=this.remoteJobEnvelope(workspaceId,id);return{id,createdAt:envelope.createdAt,envelope,status:String(row.status),leaseId:row.leaseId??undefined,leaseExpiresAt:row.leaseExpiresAt??undefined,resultSummary:row.resultSummary??undefined,errorCode:row.errorCode??undefined,updatedAt:String(row.updatedAt)}}
  private addRemoteJobEvent(jobId:string,type:string,summary:string,at=now()):void{summary=summary.replace(/[\r\n]+/g,' ').slice(0,500);const sequence=Number((this.db.prepare('SELECT coalesce(max(sequence),0)+1 next FROM remote_job_events WHERE job_id=?').get(jobId) as {next:number}).next);this.db.prepare('INSERT OR IGNORE INTO remote_job_events VALUES (?,?,?,?,?,?)').run(randomUUID(),jobId,sequence,type.slice(0,40),summary,at)}
  listRemoteJobs(workspaceId:string){return(this.db.prepare('SELECT id,controller_device_id controllerDeviceId,target_device_id targetDeviceId,capability,status,lease_id leaseId,lease_expires_at leaseExpiresAt,result_summary resultSummary,error_code errorCode,created_at createdAt,updated_at updatedAt FROM remote_jobs WHERE workspace_id=? ORDER BY created_at DESC,id').all(workspaceId) as Array<Record<string,unknown>>).map((row)=>({...row,events:this.db.prepare('SELECT sequence,type,summary,created_at createdAt FROM remote_job_events WHERE job_id=? ORDER BY sequence').all(String(row.id))}))}
  claimRemoteJob(workspaceId:string,targetDeviceId:string,keyEpoch:number,targetProfileDigest:string):{job:RemoteJobEnvelope;leaseId:string}|undefined{const policy=this.deviceControlPolicy(workspaceId);if(!policy.enabled||this.toolGatewaySettings(workspaceId).stopped||!/^[a-f0-9]{64}$/.test(targetProfileDigest))return undefined;const row=this.db.prepare("SELECT id FROM remote_jobs WHERE workspace_id=? AND target_device_id=? AND status='queued' AND key_epoch=? ORDER BY created_at,id LIMIT 1").get(workspaceId,targetDeviceId,keyEpoch) as {id:string}|undefined;if(!row)return undefined;const job=this.remoteJobEnvelope(workspaceId,row.id);if(!policy.allowedCapabilities.includes(job.capability))return undefined;const lease=issueJobLease(job,new Date(),targetProfileDigest),changed=this.db.prepare("UPDATE remote_jobs SET status='leased',lease_id=?,lease_expires_at=?,updated_at=? WHERE id=? AND workspace_id=? AND status='queued'").run(lease.leaseId,lease.expiresAt,lease.issuedAt,job.id,workspaceId);if(!changed.changes)return undefined;this.addRemoteJobEvent(job.id,'leased','Exclusive lease bound to current target policy',lease.issuedAt);this.syncJournal.enqueue(workspaceId,job.id,'remote_job','upsert',this.remoteJobSyncPayload(workspaceId,job.id)!);return{job,leaseId:lease.leaseId}}
  startRemoteJob(workspaceId:string,id:string,leaseId:string):void{const timestamp=now(),changed=this.db.prepare("UPDATE remote_jobs SET status='running',updated_at=? WHERE id=? AND workspace_id=? AND status='leased' AND lease_id=? AND lease_expires_at>?").run(timestamp,id,workspaceId,leaseId,timestamp);if(!changed.changes)throw new Error('remote_job_lease_unavailable');this.addRemoteJobEvent(id,'running','Target-local policy accepted the job',timestamp);this.syncJournal.enqueue(workspaceId,id,'remote_job','upsert',this.remoteJobSyncPayload(workspaceId,id)!)}
  finishRemoteJob(workspaceId:string,id:string,leaseId:string,status:'completed'|'failed',summary:string,errorCode?:string):void{summary=summary.replace(/[\r\n]+/g,' ').slice(0,1000);if(!summary)throw new Error('remote_job_result_invalid');const timestamp=now(),changed=this.db.prepare("UPDATE remote_jobs SET status=?,result_summary=?,error_code=?,updated_at=? WHERE id=? AND workspace_id=? AND status='running' AND lease_id=? AND lease_expires_at>?").run(status,summary,errorCode?.slice(0,80)??null,timestamp,id,workspaceId,leaseId,timestamp);if(!changed.changes)throw new Error('remote_job_terminal_race');this.addRemoteJobEvent(id,status,summary,timestamp);this.syncJournal.enqueue(workspaceId,id,'remote_job','upsert',this.remoteJobSyncPayload(workspaceId,id)!);this.activity(workspaceId,'sync',`remote_job.${status}`,id,'remote_job',{device:'peer',version:1})}
  cancelRemoteJob(workspaceId:string,id:string):boolean{const timestamp=now(),changed=this.db.prepare("UPDATE remote_jobs SET status='canceled',error_code='user_canceled',updated_at=? WHERE id=? AND workspace_id=? AND status IN ('queued','leased','running')").run(timestamp,id,workspaceId);if(!changed.changes)return false;this.addRemoteJobEvent(id,'canceled','Canceled by user or global stop',timestamp);this.syncJournal.enqueue(workspaceId,id,'remote_job','upsert',this.remoteJobSyncPayload(workspaceId,id)!);return true}
  cancelAllRemoteJobs(workspaceId:string):number{const ids=(this.db.prepare("SELECT id FROM remote_jobs WHERE workspace_id=? AND status IN ('queued','leased','running')").all(workspaceId) as Array<{id:string}>).map((row)=>row.id);for(const id of ids)this.cancelRemoteJob(workspaceId,id);return ids.length}
  recoverRemoteJobs(workspaceId:string,at=now()):number{const rows=this.db.prepare("SELECT id FROM remote_jobs WHERE workspace_id=? AND status IN ('leased','running') AND lease_expires_at<=?").all(workspaceId,at) as Array<{id:string}>;for(const row of rows){this.db.prepare("UPDATE remote_jobs SET status='timed_out',error_code='lease_expired',updated_at=? WHERE id=?").run(at,row.id);this.addRemoteJobEvent(row.id,'timed_out','Lease expired; no automatic failover was performed',at);this.syncJournal.enqueue(workspaceId,row.id,'remote_job','upsert',this.remoteJobSyncPayload(workspaceId,row.id)!)}return rows.length}
  deleteRemoteJob(workspaceId:string,id:string):void{if(!this.db.prepare('SELECT 1 FROM remote_jobs WHERE id=? AND workspace_id=?').get(id,workspaceId))throw new Error('Remote job not found');this.transaction(()=>{this.db.prepare('DELETE FROM remote_jobs WHERE id=? AND workspace_id=?').run(id,workspaceId);this.syncJournal.enqueue(workspaceId,id,'remote_job','delete',{id,cascade:true,cascadeIds:[id]});this.activity(workspaceId,'lifecycle','remote_job.deleted',id,'remote_job',{scope:'workspace',version:1})})}

  activityCapturePolicy(workspaceId:string):ActivityCapturePolicy{if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');const row=this.db.prepare('SELECT enabled,paused,retention_days retentionDays,sync_raw syncRaw,exclusions_json exclusions FROM activity_capture_settings WHERE workspace_id=?').get(workspaceId) as Record<string,unknown>|undefined;if(!row)return defaultActivityCapturePolicy();return validateActivityCapturePolicy({version:1,enabled:Boolean(row.enabled),paused:Boolean(row.paused),retentionDays:Number(row.retentionDays),syncRaw:Boolean(row.syncRaw),exclusions:JSON.parse(String(row.exclusions))})}
  setActivityCapturePolicy(workspaceId:string,input:ActivityCapturePolicy):ActivityCapturePolicy{const policy=validateActivityCapturePolicy(input),timestamp=now();this.transaction(()=>{if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');this.db.prepare('INSERT INTO activity_capture_settings VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET enabled=excluded.enabled,paused=excluded.paused,retention_days=excluded.retention_days,sync_raw=excluded.sync_raw,exclusions_json=excluded.exclusions_json,updated_at=excluded.updated_at').run(workspaceId,policy.enabled?1:0,policy.paused?1:0,policy.retentionDays,policy.syncRaw?1:0,JSON.stringify(policy.exclusions),timestamp);this.activity(workspaceId,'maintenance',policy.enabled?(policy.paused?'capture.paused':'capture.resumed'):'capture.stopped',workspaceId,'workspace',{scope:'workspace',version:1})});return policy}
  captureActivitySnapshot(workspaceId:string,context:ActivityFrameContext,bytes:Uint8Array,beforeCommit?:()=>void):{accepted:boolean;reason?:string;snapshot?:ActivitySnapshotView}{const policy=this.activityCapturePolicy(workspaceId),decision=captureDecision(policy,context,bytes);if(!decision.accepted){this.activity(workspaceId,'maintenance','capture.skipped',workspaceId,'workspace',{scope:'workspace',version:1});return{accepted:false,reason:decision.reason}}const validated=validateAttachment('activity.png','image/png',bytes);if(validated.sha256!==decision.sha256)throw new Error('activity_snapshot_digest_invalid');const id=randomUUID(),attachmentId=randomUUID(),relativePath=`${attachmentId}-activity.png`,createdAt=now();writeFileSync(this.attachmentPath(relativePath),bytes,{flag:'wx',mode:0o600});try{beforeCommit?.();this.transaction(()=>{const latest=this.activityCapturePolicy(workspaceId),committed=captureDecision(latest,context,bytes);if(!committed.accepted)throw new Error(`activity_capture_${committed.reason}`);this.db.prepare('INSERT INTO activity_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,workspaceId,attachmentId,context.capturedAt,context.deviceId,context.displayId,context.appBundleId.toLowerCase(),context.appProcess.toLowerCase(),context.appTitle?.slice(0,300)??null,1,committed.sha256,committed.expiresAt,createdAt);this.db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?)').run(attachmentId,workspaceId,id,'activity.png','image/png',committed.sha256,relativePath,createdAt);if(latest.syncRaw){this.syncJournal.enqueue(workspaceId,id,'activity_snapshot','upsert',{id,attachmentId,capturedAt:context.capturedAt,deviceId:context.deviceId,displayId:context.displayId,appBundleId:context.appBundleId.toLowerCase(),appProcess:context.appProcess.toLowerCase(),appTitle:context.appTitle?.slice(0,300),policyVersion:1,sourceSha256:committed.sha256,expiresAt:committed.expiresAt,createdAt});this.syncJournal.enqueue(workspaceId,attachmentId,'attachment','upsert',{id:attachmentId,ownerId:id,name:'activity.png',mediaType:'image/png',sha256:committed.sha256,bytes:bytes.byteLength,createdAt})}this.activity(workspaceId,'maintenance','capture.saved',id,'activity_snapshot',{device:'local',version:1})})}catch(error){rmSync(this.attachmentPath(relativePath),{force:true});throw error}return{accepted:true,snapshot:this.listActivitySnapshots(workspaceId).find((item)=>item.id===id)}}
  listActivitySnapshots(workspaceId:string,query=''):ActivitySnapshotView[]{this.purgeExpiredActivitySnapshots(workspaceId);query=query.trim().toLowerCase();if(query.length>100)throw new Error('activity_query_invalid');const rows=this.db.prepare("SELECT s.id,s.captured_at capturedAt,s.device_id deviceId,s.display_id displayId,s.app_bundle_id appBundleId,s.app_process appProcess,s.app_title appTitle,s.expires_at expiresAt,a.relative_path relativePath FROM activity_snapshots s JOIN attachments a ON a.id=s.attachment_id WHERE s.workspace_id=? ORDER BY s.captured_at DESC,s.id").all(workspaceId) as Array<Record<string,unknown>>;return rows.filter((row)=>!query||[row.appBundleId,row.appProcess,row.appTitle,row.deviceId].some((value)=>String(value??'').toLowerCase().includes(query))).map((row)=>({id:String(row.id),capturedAt:String(row.capturedAt),deviceId:String(row.deviceId),displayId:String(row.displayId),appBundleId:String(row.appBundleId),appProcess:String(row.appProcess),...(row.appTitle?{appTitle:String(row.appTitle)}:{}),expiresAt:String(row.expiresAt),bytes:statSync(this.attachmentPath(String(row.relativePath))).size,synced:this.syncJournal.head(workspaceId,String(row.id))?.objectKind==='activity_snapshot'}))}
  readActivitySnapshot(workspaceId:string,id:string):{mediaType:'image/png';dataBase64:string}{const row=this.db.prepare("SELECT a.name,a.media_type mediaType,a.sha256,a.relative_path relativePath FROM activity_snapshots s JOIN attachments a ON a.id=s.attachment_id WHERE s.id=? AND s.workspace_id=?").get(id,workspaceId) as Record<string,unknown>|undefined;if(!row)throw new Error('Activity snapshot not found');const bytes=readFileSync(this.attachmentPath(String(row.relativePath))),validated=validateAttachment(String(row.name),String(row.mediaType),bytes);if(validated.sha256!==String(row.sha256)||row.mediaType!=='image/png')throw new Error('Activity snapshot integrity check failed');return{mediaType:'image/png',dataBase64:bytes.toString('base64')}}
  deleteActivitySnapshot(workspaceId:string,id:string):void{const row=this.db.prepare('SELECT s.attachment_id attachmentId,a.relative_path relativePath FROM activity_snapshots s JOIN attachments a ON a.id=s.attachment_id WHERE s.id=? AND s.workspace_id=?').get(id,workspaceId) as {attachmentId:string;relativePath:string}|undefined;if(!row)throw new Error('Activity snapshot not found');this.transaction(()=>{this.db.prepare('DELETE FROM activity_snapshots WHERE id=? AND workspace_id=?').run(id,workspaceId);this.db.prepare('DELETE FROM attachments WHERE id=? AND workspace_id=?').run(row.attachmentId,workspaceId);this.syncJournal.enqueue(workspaceId,row.attachmentId,'attachment','delete',{id:row.attachmentId,cascade:true,cascadeIds:[row.attachmentId]});this.syncJournal.enqueue(workspaceId,id,'activity_snapshot','delete',{id,cascade:true,cascadeIds:[id,row.attachmentId]},[row.attachmentId]);this.activity(workspaceId,'maintenance','capture.deleted',id,'activity_snapshot',{scope:'workspace',version:1})});rmSync(this.attachmentPath(row.relativePath),{force:true})}
  deleteAllActivitySnapshots(workspaceId:string):number{const ids=(this.db.prepare('SELECT id FROM activity_snapshots WHERE workspace_id=?').all(workspaceId) as Array<{id:string}>).map((row)=>row.id);for(const id of ids)this.deleteActivitySnapshot(workspaceId,id);return ids.length}
  purgeExpiredActivitySnapshots(workspaceId:string,at=now()):number{const ids=(this.db.prepare('SELECT id FROM activity_snapshots WHERE workspace_id=? AND expires_at<=? ORDER BY expires_at,id').all(workspaceId,at) as Array<{id:string}>).map((row)=>row.id);for(const id of ids)this.deleteActivitySnapshot(workspaceId,id);return ids.length}
  activityCaptureStorage(workspaceId:string){const items=this.listActivitySnapshots(workspaceId);return{count:items.length,bytes:items.reduce((sum,item)=>sum+item.bytes,0)}}

  exportWorkspace(workspaceId: string): ExportArchive {
    const workspace = this.db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspaceId) as Record<string, unknown> | undefined;
    if (!workspace) throw new Error('Workspace not found');
    const tables = ['documents', 'revisions', 'chats', 'messages', 'memories', 'memory_suggestions', 'commitments', 'rule_suggestions', 'rule_suggestion_sources', 'learned_rules', 'rule_outcomes', 'relationships', 'reflection_runs', 'reflection_sources', 'reflection_proposals', 'reflection_proposal_sources', 'attachments', 'document_import_sources', 'meetings', 'fixture_playbooks', 'fixture_playbook_runs', 'local_trigger_settings', 'local_events', 'local_trigger_rules', 'local_trigger_runs', 'external_inbound_events','tool_gateway_settings','tool_gateway_receipts','tool_failure_knowledge','provider_usage_receipts','hosted_runs','hosted_run_events','activity_capture_settings','activity_snapshots','device_control_settings','remote_jobs','remote_job_events', 'activities', 'tombstones', 'security_profiles', 'executions', 'execution_events'];
    const objects: Record<string, unknown[]> = {};
    for (const table of tables) objects[table] = this.rowsForWorkspace(table, workspaceId);
    if(!this.activityCapturePolicy(workspaceId).syncRaw){const snapshotIds=new Set((objects.activity_snapshots??[]).map((row)=>String((row as Record<string,unknown>).id)));objects.attachments=(objects.attachments??[]).filter((row)=>!snapshotIds.has(String((row as Record<string,unknown>).owner_id)));objects.activity_snapshots=[]}
    objects.attachments = (objects.attachments ?? []).map((value) => {
      const row = value as Record<string, unknown>;
      const bytes = readFileSync(this.attachmentPath(String(row.relative_path))),
        validated = validateAttachment(String(row.name), String(row.media_type), bytes);
      if (validated.sha256 !== String(row.sha256)) throw new Error('Stored attachment integrity check failed');
      return { ...row, data_base64: bytes.toString('base64') };
    });
    objects.meetings = (objects.meetings ?? []).map((value) => {
      const row = value as Record<string, unknown>;
      if (!row.audio_relative_path) return row;
      const bytes = readFileSync(this.meetingAudioPath(String(row.audio_relative_path))),
        validated = validateMeetingAudio(String(row.media_type), bytes);
      if (validated.sha256 !== String(row.sha256)) throw new Error('Stored meeting audio integrity check failed');
      return { ...row, audio_data_base64: bytes.toString('base64') };
    });
    const archive = {
      version: 3 as const,
      exportedAt: now(),
      workspace,
      objects,
    };
    return { ...archive, integrity: archiveIntegrity(archive) };
  }

  restoreWorkspace(archive: ExportArchive, newName: string, newLocalPath: string): WorkspaceSummary {
    archive = validateArchive(archive);
    if (!newName.trim() || !path.isAbsolute(newLocalPath)) throw new Error('Workspace name and absolute local path are required');
    const workspace = {
      id: randomUUID(),
      name: newName.trim(),
      localPath: path.resolve(newLocalPath),
      createdAt: now(),
    };
    const writtenFiles: string[] = [];
    try {
      this.transaction(() => {
        this.db.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspace.id, workspace.name, workspace.localPath, workspace.createdAt);
        this.syncJournal.ensureWorkspace(workspace.id, 'snapshot_required');
      this.createDefaultSecurityProfile(workspace.id, workspace.localPath);
      this.ensureAutonomousDeveloperProfile(workspace.id, workspace.localPath);
        const idMap = new Map<string, string>();
        for (const table of ['documents', 'chats', 'memories'] as const) {
          for (const row of archive.objects[table] ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID());
        }
        for (const row of archive.objects.messages ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID());
        for (const row of archive.objects.memory_suggestions ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID());
        for (const row of archive.objects.commitments ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID());
        for (const row of archive.objects.rule_suggestions ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID());
        for (const row of archive.objects.learned_rules ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID());
        for (const row of archive.objects.meetings ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID());
        for (const row of archive.objects.fixture_playbooks ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID());
        for (const row of archive.objects.tombstones ?? []) idMap.set(String((row as Record<string, unknown>).object_id), randomUUID());
        for (const row of archive.objects.executions ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID());
        for (const row of archive.objects.hosted_runs ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID());
        for(const row of archive.objects.activity_snapshots??[])idMap.set(String((row as Record<string,unknown>).id),randomUUID());
        for(const row of archive.objects.remote_jobs??[])idMap.set(String((row as Record<string,unknown>).id),randomUUID());
        for(const table of ['reflection_runs','reflection_sources','reflection_proposals'] as const)for(const row of archive.objects[table]??[])idMap.set(String((row as Record<string,unknown>).id),randomUUID());
        if ((archive.objects.security_profiles ?? []).length) {
          this.db.prepare('DELETE FROM security_profiles WHERE workspace_id=?').run(workspace.id);
          const executionRoot = path.join(workspace.localPath, 'waypoint-workspaces', workspace.id);
          mkdirSync(executionRoot, { recursive: true });
          for (const value of archive.objects.security_profiles) {
            const row = value as Record<string, unknown>,
              id = randomUUID();
            idMap.set(String(row.id), id);
            this.db.prepare('INSERT INTO security_profiles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, workspace.id, String(row.name), JSON.stringify([executionRoot]), String(row.filesystem), String(row.network), String(row.tools_json), String(row.approval), Number(row.max_duration_ms), Number(row.max_concurrency), Number(row.peer_eligible), String(row.secret_names_json), String(row.created_at));
          }
        } else {
          const profile = this.db.prepare('SELECT id FROM security_profiles WHERE workspace_id=?').get(workspace.id) as { id: string };
          for (const run of archive.objects.executions ?? []) {
            const row = run as Record<string, unknown>;
            idMap.set(String(row.security_profile_id), profile.id);
          }
        }
        for (const rowValue of archive.objects.documents ?? []) {
          const row = rowValue as Record<string, unknown>,
            id = idMap.get(String(row.id))!;
          const revisions = (archive.objects.revisions ?? []).filter((candidate) => String((candidate as Record<string, unknown>).document_id) === String(row.id)) as Array<Record<string, unknown>>;
          const revisionMap = new Map(revisions.map((revision) => [String(revision.id), randomUUID()]));
          for (const [oldId, newId] of revisionMap) idMap.set(oldId, newId);
          const currentRevisionId = revisionMap.get(String(row.current_revision_id)) ?? revisionMap.values().next().value ?? randomUUID();
          this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?)').run(id, workspace.id, String(row.title), currentRevisionId, String(row.created_at), String(row.updated_at));
          if (revisions.length === 0) this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(currentRevisionId, id, '', workspace.createdAt);
          for (const revision of revisions) this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(revisionMap.get(String(revision.id))!, id, String(revision.body), String(revision.created_at));
          const current = revisions.find((revision) => String(revision.id) === String(row.current_revision_id));
          this.indexText(workspace.id, id, 'document', currentRevisionId, String(row.title), String(current?.body ?? ''));
        }
        for (const rowValue of archive.objects.chats ?? []) {
          const row = rowValue as Record<string, unknown>,
            id = idMap.get(String(row.id))!;
          this.db.prepare('INSERT INTO chats VALUES (?,?,?,?,?)').run(id, workspace.id, String(row.title), String(row.created_at), String(row.updated_at));
          for (const messageValue of archive.objects.messages ?? []) {
            const message = messageValue as Record<string, unknown>;
            if (String(message.chat_id) !== String(row.id)) continue;
            const messageId = idMap.get(String(message.id))!;
            this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(messageId, id, String(message.role), String(message.body), String(message.created_at));
            this.indexText(workspace.id, messageId, 'message', undefined, String(row.title), String(message.body));
          }
        }
        for (const value of [...(archive.objects.executions ?? [])].sort((left, right) => Number((left as Record<string, unknown>).depth) - Number((right as Record<string, unknown>).depth))) {
          const row = value as Record<string, unknown>,
            id = idMap.get(String(row.id))!,
            chatId = idMap.get(String(row.chat_id)),
            profileId = idMap.get(String(row.security_profile_id));
          if (!chatId || !profileId) continue;
          const active = ['queued', 'running'].includes(String(row.status)),
            status = active ? 'failed' : String(row.status);
          this.db.prepare('INSERT INTO executions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, workspace.id, chatId, row.source_message_id ? (idMap.get(String(row.source_message_id)) ?? null) : null, row.parent_execution_id ? (idMap.get(String(row.parent_execution_id)) ?? null) : null, String(row.cli), row.executable == null ? null : String(row.executable), row.cli_version == null ? null : String(row.cli_version), row.model == null ? null : String(row.model), String(row.device), profileId, String(row.prompt_sha256), status, Number(row.depth), row.started_at == null ? null : String(row.started_at), active ? now() : row.finished_at == null ? null : String(row.finished_at), row.exit_code == null ? null : Number(row.exit_code), active ? 'restored_interrupted' : row.error_code == null ? null : String(row.error_code), active ? 'Archive captured a non-terminal run' : row.error_message == null ? null : String(row.error_message), String(row.created_at));
        }
        for (const value of archive.objects.execution_events ?? []) {
          const row = value as Record<string, unknown>,
            executionId = idMap.get(String(row.execution_id));
          if (executionId) this.db.prepare('INSERT INTO execution_events VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), executionId, Number(row.sequence), String(row.type), row.text == null ? null : String(row.text), row.name == null ? null : String(row.name), row.raw_type == null ? null : String(row.raw_type), String(row.created_at));
        }
        for(const value of archive.objects.tool_gateway_settings??[]){const row=value as Record<string,unknown>,patterns=JSON.parse(String(row.deny_patterns_json));if(!Array.isArray(patterns)||patterns.length>100||patterns.some((item)=>typeof item!=='string'||item.length>300))throw new Error('Tool gateway settings archive is invalid');for(const pattern of patterns)try{new RegExp(pattern,'i')}catch{throw new Error('Tool gateway settings archive is invalid')}this.db.prepare('INSERT INTO tool_gateway_settings VALUES (?,?,?,?,?,?)').run(workspace.id,0,JSON.stringify(patterns),Number(row.suppress_commit)===1?1:0,Number(row.suppress_push)===1?1:0,String(row.updated_at))}
        const restoredToolReceipts=new Map<string,string>();for(const value of archive.objects.tool_gateway_receipts??[]){const row=value as Record<string,unknown>,origin=String(row.origin),status=String(row.status),tool=String(row.tool),restoredId=randomUUID();if(!['ui','ai'].includes(origin)||!['completed','failed','canceled','timed_out','denied'].includes(status)||!(TOOL_IDENTITIES as readonly string[]).includes(tool)||String(row.summary).length>500)throw new Error('Tool gateway receipt archive is invalid');this.db.prepare('INSERT INTO tool_gateway_receipts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(restoredId,workspace.id,origin,tool,status,String(row.capability_version),'local',String(row.profile_name),String(row.policy_digest),String(row.summary),row.code==null?null:String(row.code),row.notification==null?null:String(row.notification),row.rollback_ref==null?null:String(row.rollback_ref),Number(row.output_bytes),Number(row.truncated)===1?1:0,String(row.started_at),String(row.finished_at),Number(row.duration_ms));restoredToolReceipts.set(String(row.id),restoredId)}
        for(const value of archive.objects.tool_failure_knowledge??[]){const row=value as Record<string,unknown>,fingerprint=String(row.parameter_fingerprint),context=String(row.context_digest),outcome=String(row.outcome),tool=String(row.tool),capabilityVersion=String(row.capability_version),sourceReceiptId=String(row.source_receipt_id),source=restoredToolReceipts.get(sourceReceiptId),supersededOriginal=row.superseded_by_receipt_id==null?undefined:String(row.superseded_by_receipt_id),superseded=supersededOriginal?restoredToolReceipts.get(supersededOriginal):undefined;if(!validToolFailureFields({tool,capabilityVersion,fingerprint,context,errorClass:String(row.error_class),remediation:String(row.remediation??''),overrideReason:String(row.override_reason??''),outcome,sourceReceiptId,expiresAt:String(row.expires_at),createdAt:String(row.created_at),updatedAt:String(row.updated_at),supersededByReceiptId:supersededOriginal}))throw new Error('Tool failure knowledge archive is invalid');if(!source)continue;const receipt=this.db.prepare('SELECT tool,status,capability_version capabilityVersion FROM tool_gateway_receipts WHERE id=? AND workspace_id=?').get(source,workspace.id) as {tool:string;status:string;capabilityVersion:string}|undefined;if(!receipt||receipt.tool!==tool||!['failed','timed_out'].includes(receipt.status)||capabilityVersion!==receipt.capabilityVersion&&!capabilityVersion.startsWith(`${receipt.capabilityVersion}/fingerprint:`)||supersededOriginal&&!superseded)throw new Error('Tool failure knowledge archive is invalid');this.db.prepare("INSERT INTO tool_failure_knowledge(id,workspace_id,client_scope,source_receipt_id,tool,capability_version,parameter_fingerprint,context_digest,error_class,remediation,override_reason,outcome,expires_at,created_at,updated_at,superseded_by_receipt_id) VALUES (?,?,'local-personal',?,?,?,?,?,?,?,?,?,?,?,?,?)").run(randomUUID(),workspace.id,source,tool,capabilityVersion,fingerprint,context,String(row.error_class),row.remediation==null?null:String(row.remediation),row.override_reason==null?null:String(row.override_reason),outcome,String(row.expires_at),String(row.created_at),String(row.updated_at),superseded??null)}
        for(const link of this.db.prepare("SELECT f.tool,f.capability_version capabilityVersion,r.tool receiptTool,r.status receiptStatus,r.capability_version receiptCapability FROM tool_failure_knowledge f LEFT JOIN tool_gateway_receipts r ON r.id=f.superseded_by_receipt_id AND r.workspace_id=f.workspace_id WHERE f.workspace_id=? AND f.outcome='superseded'").all(workspace.id) as Array<Record<string,unknown>>){const capability=String(link.capabilityVersion),receiptCapability=String(link.receiptCapability);if(link.receiptStatus!=='completed'||link.receiptTool!==link.tool||capability!==receiptCapability&&!capability.startsWith(`${receiptCapability}/fingerprint:`))throw new Error('Tool failure supersession archive provenance is invalid')}
        for(const value of archive.objects.provider_usage_receipts??[]){const row=value as Record<string,unknown>,receipt:ProviderUsageReceipt={id:randomUUID(),workspaceId:workspace.id,provider:'openrouter',model:String(row.model),role:String(row.route_role) as 'strategic'|'everyday',status:String(row.status) as ProviderUsageReceipt['status'],costMicros:Number(row.cost_micros),promptTokens:Number(row.prompt_tokens),completionTokens:Number(row.completion_tokens),requestDigest:String(row.request_digest),responseId:row.response_id==null?undefined:String(row.response_id),errorCode:row.error_code==null?undefined:String(row.error_code),fallbackProvider:row.fallback_provider as 'codex'|'claude'|undefined,startedAt:String(row.started_at),finishedAt:String(row.finished_at)};if(!['strategic','everyday'].includes(receipt.role)||!['completed','failed','canceled','blocked'].includes(receipt.status)||!canonicalIso(receipt.startedAt)||!canonicalIso(receipt.finishedAt))throw new Error('Provider usage archive is invalid');this.saveProviderUsage(receipt)}
        for(const value of archive.objects.hosted_runs??[]){const row=value as Record<string,unknown>,id=idMap.get(String(row.id)),chatId=idMap.get(String(row.chat_id)),sourceId=row.source_message_id?idMap.get(String(row.source_message_id)):undefined,archivedStatus=String(row.status),status=['queued','running'].includes(archivedStatus)?'failed':archivedStatus;if(!id||!chatId||!['completed','failed','canceled'].includes(status)||!['strategic','everyday'].includes(String(row.route_role)))throw new Error('Hosted run archive is invalid');this.db.prepare('INSERT INTO hosted_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,workspace.id,chatId,sourceId??null,String(row.route_role),String(row.model),status,row.started_at==null?null:String(row.started_at),['queued','running'].includes(archivedStatus)?now():row.finished_at==null?null:String(row.finished_at),['queued','running'].includes(archivedStatus)?'restored_interrupted':row.error_code==null?null:String(row.error_code),null,String(row.created_at))}
        for(const value of archive.objects.hosted_run_events??[]){const row=value as Record<string,unknown>,runId=idMap.get(String(row.run_id));if(runId)this.db.prepare('INSERT INTO hosted_run_events VALUES (?,?,?,?,?,?)').run(randomUUID(),runId,Number(row.sequence),String(row.type),row.text==null?null:String(row.text),String(row.created_at))}
        for(const value of archive.objects.device_control_settings??[]){const row=value as Record<string,unknown>,caps=JSON.parse(String(row.allowed_capabilities_json));this.setDeviceControlPolicy(workspace.id,validateWorkerPolicy({version:1,enabled:false,preferredDeviceId:row.preferred_device_id??undefined,failover:false,allowedCapabilities:caps,maxDurationMs:Number(row.max_duration_ms),maxConcurrency:1}))}
        for(const value of archive.objects.remote_jobs??[]){const row=value as Record<string,unknown>,id=idMap.get(String(row.id))!,archived=String(row.status),status=['queued','leased','running'].includes(archived)?'failed':archived,envelope=validateRemoteJob({version:1,id,workspaceId:workspace.id,controllerDeviceId:String(row.controller_device_id),targetDeviceId:String(row.target_device_id),capability:String(row.capability),instruction:String(row.instruction),idempotencyKey:String(row.idempotency_key),profileDigest:String(row.profile_digest),keyEpoch:Number(row.key_epoch),createdAt:String(row.created_at),timeoutMs:Number(row.timeout_ms),origin:'user'});if(!['completed','failed','canceled','timed_out'].includes(status))throw new Error('Remote job archive is invalid');this.db.prepare('INSERT INTO remote_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,workspace.id,envelope.controllerDeviceId,envelope.targetDeviceId,envelope.capability,envelope.instruction,envelope.idempotencyKey,jobRequestDigest(envelope),envelope.profileDigest,envelope.keyEpoch,envelope.timeoutMs,'user',status,null,null,row.result_summary==null?null:String(row.result_summary),['queued','leased','running'].includes(archived)?'restored_interrupted':row.error_code==null?null:String(row.error_code),envelope.createdAt,String(row.updated_at))}
        for(const value of archive.objects.remote_job_events??[]){const row=value as Record<string,unknown>,jobId=idMap.get(String(row.job_id));if(jobId)this.db.prepare('INSERT INTO remote_job_events VALUES (?,?,?,?,?,?)').run(randomUUID(),jobId,Number(row.sequence),String(row.type).slice(0,40),String(row.summary).slice(0,500),String(row.created_at))}
        for (const value of archive.objects.fixture_playbooks ?? []) {
          const row = value as Record<string, unknown>,
            id = idMap.get(String(row.id))!,
            status = String(row.status),
            timezone = String(row.timezone),
            hour = Number(row.hour),
            minute = Number(row.minute),
            version = Number(row.version);
          if (!['paused', 'killed'].includes(status) || String(row.definition_json) !== playbookDefinitionJson() || String(row.permission_json) !== JSON.stringify(FIXTURE_CONNECTOR)) throw new Error('Fixture playbook archive authority is invalid');
          nextDailyOccurrence(timezone, hour, minute, now());
          const definitionDigest = playbookDefinitionDigest({
            workspaceId: workspace.id,
            version,
            timezone,
            hour,
            minute,
            definition: playbookDefinitionJson(),
          });
          this.db.prepare('INSERT INTO fixture_playbooks VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)').run(id, workspace.id, String(row.title), version, status, timezone, hour, minute, playbookDefinitionJson(), definitionDigest, JSON.stringify(FIXTURE_CONNECTOR), String(row.created_at), String(row.updated_at));
        }
        for (const value of archive.objects.fixture_playbook_runs ?? []) {
          const row = value as Record<string, unknown>,
            playbookId = idMap.get(String(row.playbook_id)),
            status = String(row.status);
          if (!playbookId || !['dry_run', 'completed', 'retrying', 'dead_letter'].includes(status) || Number(row.proposed_effects) !== 0 || String(row.permission_json) !== JSON.stringify(fixtureDryRun().permissionSnapshot)) throw new Error('Fixture playbook run archive is invalid');
          this.db.prepare('INSERT INTO fixture_playbook_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), workspace.id, playbookId, null, status, Number(row.attempt), Number(row.input_count), Number(row.output_count), 0, String(row.permission_json), String(row.created_at), row.finished_at == null ? null : String(row.finished_at));
        }
        for (const value of archive.objects.meetings ?? []) {
          const row = value as Record<string, unknown>,
            id = idMap.get(String(row.id))!,
            audio = row.audio_data_base64 == null ? undefined : Buffer.from(String(row.audio_data_base64), 'base64'),
            archivedStatus = String(row.status);
          if (!['recording', 'ready', 'failed'].includes(archivedStatus)) throw new Error('Meeting archive status is invalid');
          if (archivedStatus === 'ready' && !audio) throw new Error('Ready meeting archive audio is missing');
          let relativePath: string | null = null;
          if (audio) {
            const validated = validateMeetingAudio(String(row.media_type), audio);
            if (validated.sha256 !== String(row.sha256)) throw new Error('Meeting archive integrity check failed');
            relativePath = `${id}.${validated.extension}`;
            const target = this.meetingAudioPath(relativePath);
            writeFileSync(target, audio, { flag: 'wx', mode: 0o600 });
            writtenFiles.push(target);
          }
          const status = archivedStatus === 'recording' ? 'failed' : archivedStatus,
            failureCode = archivedStatus === 'recording' ? 'interrupted' : row.failure_code == null ? null : String(row.failure_code);
          this.db.prepare('INSERT INTO meetings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, workspace.id, String(row.title), status, String(row.consent_acknowledged_at), String(row.consent_version), relativePath, row.media_type == null ? null : String(row.media_type), audio?.length ?? 0, row.sha256 == null ? null : String(row.sha256), row.transcript == null ? null : String(row.transcript), String(row.transcript_status), String(row.speaker_handling), failureCode, String(row.created_at), archivedStatus === 'recording' ? now() : row.ended_at == null ? null : String(row.ended_at));
        }
        for (const rowValue of archive.objects.memories ?? []) {
          const row = rowValue as Record<string, unknown>,
            id = idMap.get(String(row.id))!;
          this.db.prepare('INSERT INTO memories(id,workspace_id,title,body,source_object_id,ownership,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, workspace.id, String(row.title), String(row.body), row.source_object_id ? (idMap.get(String(row.source_object_id)) ?? null) : null, String(row.ownership ?? 'workspace-owned'), String(row.created_at), String(row.updated_at));
          this.indexText(workspace.id, id, 'memory', undefined, String(row.title), String(row.body));
        }
        for (const value of archive.objects.memory_suggestions ?? []) {
          const row = value as Record<string, unknown>,
            id = idMap.get(String(row.id))!,
            chatId = idMap.get(String(row.chat_id)),
            messageId = idMap.get(String(row.source_message_id));
          if (!chatId || !messageId) continue;
          this.db.prepare('INSERT INTO memory_suggestions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
            id,
            workspace.id,
            chatId,
            messageId,
            String(row.source_role),
            String(row.category),
            String(row.title),
            String(row.body),
            String(row.source_excerpt),
            String(row.source_digest),
            Number(row.start_offset),
            Number(row.end_offset),
            Number(row.confidence),
            String(row.extractor),
            String(row.extractor_version),
            createHash('sha256')
              .update(`${workspace.id}:${String(row.fingerprint)}`)
              .digest('hex'),
            String(row.status),
            row.accepted_object_id ? (idMap.get(String(row.accepted_object_id)) ?? null) : null,
            row.resolved_at == null ? null : String(row.resolved_at),
            String(row.created_at),
          );
        }
        for (const value of archive.objects.commitments ?? []) {
          const row = value as Record<string, unknown>,
            id = idMap.get(String(row.id))!,
            suggestionId = idMap.get(String(row.suggestion_id)),
            messageId = idMap.get(String(row.source_message_id));
          if (!suggestionId || !messageId) continue;
          this.db.prepare('INSERT INTO commitments VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, workspace.id, suggestionId, messageId, String(row.title), String(row.body), String(row.status), String(row.created_at), String(row.updated_at), row.completed_at == null ? null : String(row.completed_at));
        }
        for (const value of archive.objects.rule_suggestions ?? []) {
          const row = value as Record<string, unknown>,
            id = idMap.get(String(row.id))!;
          this.db.prepare('INSERT INTO rule_suggestions VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)').run(id, workspace.id, String(row.statement), String(row.normalized), contentDigest(JSON.stringify([workspace.id, RULE_EXTRACTOR.provider, RULE_EXTRACTOR.version, String(row.normalized)])), String(row.scope), Number(row.confidence), String(row.extractor), String(row.extractor_version), String(row.status), row.resolved_at == null ? null : String(row.resolved_at), String(row.created_at));
        }
        for (const value of archive.objects.rule_suggestion_sources ?? []) {
          const row = value as Record<string, unknown>,
            suggestionId = idMap.get(String(row.suggestion_id)),
            messageId = idMap.get(String(row.message_id)),
            chatId = idMap.get(String(row.chat_id));
          if (suggestionId && messageId && chatId) this.db.prepare('INSERT INTO rule_suggestion_sources VALUES (?,?,?,?,?,?,?)').run(suggestionId, messageId, chatId, String(row.excerpt), String(row.source_digest), Number(row.start_offset), Number(row.end_offset));
        }
        for (const value of archive.objects.learned_rules ?? []) {
          const row = value as Record<string, unknown>,
            id = idMap.get(String(row.id))!,
            suggestionId = idMap.get(String(row.suggestion_id));
          if (suggestionId) this.db.prepare('INSERT INTO learned_rules VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, workspace.id, suggestionId, String(row.statement), String(row.scope), Number(row.version), Number(row.enabled), row.prior_enabled == null ? null : Number(row.prior_enabled), String(row.created_at), String(row.updated_at));
        }
        for (const value of archive.objects.rule_outcomes ?? []) {
          const row = value as Record<string, unknown>,
            ruleId = row.rule_id ? (idMap.get(String(row.rule_id)) ?? null) : null,
            suggestionId = row.suggestion_id ? (idMap.get(String(row.suggestion_id)) ?? null) : null;
          if (ruleId || suggestionId) this.db.prepare('INSERT INTO rule_outcomes VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), workspace.id, ruleId, suggestionId, String(row.action), Number(row.match_count), Number(row.version), String(row.created_at));
        }
        for (const edgeValue of archive.objects.relationships ?? []) {
          const edge = edgeValue as Record<string, unknown>,
            from = idMap.get(String(edge.from_id)),
            to = idMap.get(String(edge.to_id));
          if (from && to) {
            const relationshipId = randomUUID();
            idMap.set(String(edge.id), relationshipId);
            this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(relationshipId, workspace.id, from, to, String(edge.type), String(edge.created_at));
          }
        }
        for(const value of archive.objects.reflection_runs??[]){const row=value as Record<string,unknown>,id=idMap.get(String(row.id))!,archivedStatus=String(row.status),status=['queued','reviewing'].includes(archivedStatus)?'failed':archivedStatus;if(!['proposed','stale','accepted','rejected','cancelled','failed','killed'].includes(status))throw new Error('Reflection run archive status is invalid');this.db.prepare('INSERT INTO reflection_runs VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,workspace.id,status,String(row.provider),String(row.provider_version),String(row.policy_version),String(row.budget_json),String(row.omissions_json),String(row.created_at),String(row.updated_at))}
        for(const value of archive.objects.reflection_sources??[]){const row=value as Record<string,unknown>,id=idMap.get(String(row.id))!,runId=idMap.get(String(row.run_id)),sourceId=idMap.get(String(row.source_id));if(!runId||!sourceId||!['memory','document'].includes(String(row.source_kind))||!/^[a-f0-9]{64}$/.test(String(row.source_digest)))throw new Error('Reflection source archive provenance is invalid');this.db.prepare('INSERT INTO reflection_sources VALUES (?,?,?,?,?,?,?)').run(id,runId,workspace.id,sourceId,String(row.source_kind),String(row.source_digest),String(row.source_updated_at))}
        for(const value of archive.objects.reflection_proposals??[]){const row=value as Record<string,unknown>,id=idMap.get(String(row.id))!,runId=idMap.get(String(row.run_id)),acceptedId=row.accepted_object_id?idMap.get(String(row.accepted_object_id))??null:null;if(!runId||!['duplicate','stale','contradiction','relationship','rule'].includes(String(row.kind))||!['proposed','accepted','edited','rejected','stale','rolled_back'].includes(String(row.status)))throw new Error('Reflection proposal archive is invalid');this.db.prepare('INSERT INTO reflection_proposals VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,runId,workspace.id,String(row.kind),String(row.title),String(row.before_body),String(row.proposed_body),String(row.rationale),String(row.status),acceptedId,String(row.created_at),row.resolved_at==null?null:String(row.resolved_at))}
        for(const value of archive.objects.reflection_proposal_sources??[]){const row=value as Record<string,unknown>,proposalId=idMap.get(String(row.proposal_id)),sourceId=idMap.get(String(row.source_row_id));if(!proposalId||!sourceId)throw new Error('Reflection proposal source archive is invalid');this.db.prepare('INSERT INTO reflection_proposal_sources VALUES (?,?)').run(proposalId,sourceId)}
        for(const value of archive.objects.reflection_runs??[]){const row=value as Record<string,unknown>,id=idMap.get(String(row.id))!,archived=String(row.status),status=['queued','reviewing'].includes(archived)?'failed':archived;this.db.prepare('UPDATE reflection_runs SET status=? WHERE id=? AND workspace_id=?').run(status,id,workspace.id)}
        if ((archive.objects.attachments ?? []).length > MAX_ATTACHMENTS_PER_WORKSPACE) throw new Error(`Workspace attachment limit of ${MAX_ATTACHMENTS_PER_WORKSPACE} exceeded`);
        const restoredOwnerCounts = new Map<string, number>();
        for (const attachmentValue of archive.objects.attachments ?? []) {
          const attachment = attachmentValue as Record<string, unknown>;
          const owner = idMap.get(String(attachment.owner_id));
          if (!owner) throw new Error('Attachment archive owner is missing');
          const ownerCount = (restoredOwnerCounts.get(owner) ?? 0) + 1;
          if (ownerCount > MAX_ATTACHMENTS_PER_OWNER) throw new Error(`Attachment owner limit of ${MAX_ATTACHMENTS_PER_OWNER} exceeded`);
          restoredOwnerCounts.set(owner, ownerCount);
          const bytes = Buffer.from(String(attachment.data_base64 ?? ''), 'base64');
          const validated = validateAttachment(String(attachment.name), String(attachment.media_type), bytes),
            sha256 = validated.sha256;
          if (sha256 !== String(attachment.sha256)) throw new Error('Attachment archive integrity check failed');
          const id = randomUUID(),
            relativePath = `${id}-${validated.safeName}`;
          idMap.set(String(attachment.id), id);
          const targetPath = path.join(this.attachmentRoot, relativePath);
          writeFileSync(targetPath, bytes, { flag: 'wx', mode: 0o600 });
          writtenFiles.push(targetPath);
          this.db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?)').run(id, workspace.id, owner, validated.safeName, String(attachment.media_type), sha256, relativePath, String(attachment.created_at));
        }
        const captureSettings=archive.objects.activity_capture_settings??[];if(captureSettings.length>1)throw new Error('Activity capture settings archive is invalid');if(captureSettings.length){const row=captureSettings[0] as Record<string,unknown>,policy=validateActivityCapturePolicy({version:1,enabled:Boolean(row.enabled),paused:Boolean(row.paused),retentionDays:Number(row.retention_days),syncRaw:Boolean(row.sync_raw),exclusions:JSON.parse(String(row.exclusions_json))});this.db.prepare('INSERT INTO activity_capture_settings VALUES (?,?,?,?,?,?,?)').run(workspace.id,policy.enabled?1:0,1,policy.retentionDays,policy.syncRaw?1:0,JSON.stringify(policy.exclusions),String(row.updated_at))}
        for(const value of archive.objects.activity_snapshots??[]){const row=value as Record<string,unknown>,id=idMap.get(String(row.id)),attachmentId=idMap.get(String(row.attachment_id)),capturedAt=String(row.captured_at),expiresAt=String(row.expires_at),digest=String(row.source_sha256),attachment=attachmentId?this.db.prepare('SELECT sha256 FROM attachments WHERE id=? AND workspace_id=?').get(attachmentId,workspace.id) as {sha256:string}|undefined:undefined;if(!id||!attachmentId||!attachment||attachment.sha256!==digest||Number(row.policy_version)!==1||!canonicalIso(capturedAt)||!canonicalIso(expiresAt)||Date.parse(expiresAt)<=Date.parse(capturedAt)||!/^[a-f0-9]{64}$/.test(digest)||![row.device_id,row.display_id,row.app_bundle_id,row.app_process].every((item)=>/^[A-Za-z0-9._-]{1,200}$/.test(String(item)))||String(row.app_title??'').length>300)throw new Error('Activity snapshot archive provenance is invalid');this.db.prepare('INSERT INTO activity_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,workspace.id,attachmentId,capturedAt,String(row.device_id),String(row.display_id),String(row.app_bundle_id),String(row.app_process),row.app_title==null?null:String(row.app_title),1,digest,expiresAt,String(row.created_at))}
        for(const sourceValue of archive.objects.document_import_sources??[]){const source=sourceValue as Record<string,unknown>,documentId=idMap.get(String(source.document_id)),revisionId=idMap.get(String(source.revision_id)),attachmentId=idMap.get(String(source.attachment_id));if(!documentId||!revisionId||!attachmentId)throw new Error('Imported document source archive references are invalid');this.registerDocumentImportSource(workspace.id,{documentId,revisionId,attachmentId,sourceDigest:String(source.source_digest),textDigest:String(source.text_digest),extractor:String(source.extractor),extractorVersion:String(source.extractor_version)});this.db.prepare('UPDATE document_import_sources SET created_at=? WHERE document_id=?').run(String(source.created_at),documentId)}
        if((archive.objects.local_events??[]).length>LOCAL_TRIGGER_LIMITS.maxEvents||(archive.objects.local_trigger_rules??[]).length>LOCAL_TRIGGER_LIMITS.maxRules||(archive.objects.local_trigger_runs??[]).length>LOCAL_TRIGGER_LIMITS.maxRules*LOCAL_TRIGGER_LIMITS.maxRunsPerRule)throw new Error('Local trigger archive exceeds workspace limits');const restoredEvents=new Map<string,{id:string;eventType:string;digest:string}>();for(const value of archive.objects.local_events??[]){const row=value as Record<string,unknown>,payload=JSON.parse(String(row.payload_json)) as LocalTriggerPayload,envelope=createLocalEventEnvelope({workspaceId:workspace.id,eventType:String(row.event_type),idempotencyKey:String(row.idempotency_key),payload,occurredAt:String(row.occurred_at),receivedAt:String(row.received_at)});if(Number(row.schema_version)!==1||String(row.source)!==LOCAL_TRIGGER_AUTHORITY.source||String(row.status)!=='quarantined'||String(row.payload_digest)!==envelope.payloadDigest||String(row.authority_json)!==JSON.stringify(LOCAL_TRIGGER_AUTHORITY))throw new Error('Local event archive authority is invalid');const id=randomUUID();idMap.set(String(row.id),id);restoredEvents.set(String(row.id),{id,eventType:envelope.eventType,digest:envelope.payloadDigest});this.db.prepare("INSERT INTO local_events VALUES (?,?,?,?,?,?,?,?,?,?,?,'quarantined')").run(id,workspace.id,1,envelope.source,envelope.eventType,envelope.occurredAt,envelope.receivedAt,envelope.idempotencyKey,JSON.stringify(envelope.payload),envelope.payloadDigest,JSON.stringify(LOCAL_TRIGGER_AUTHORITY))}
        const archivedWorkspaceId=String((archive.workspace as Record<string,unknown>).id),restoredRules=new Map<string,{id:string;eventId:string;oldEventId:string;version:number;digest:string;oldDigest:string;definitionJson:string;oldDefinitionJson:string;eventType:string;eventDigest:string}>();for(const value of archive.objects.local_trigger_rules??[]){const row=value as Record<string,unknown>,oldEventId=String(row.source_event_id),event=restoredEvents.get(oldEventId);if(!event)throw new Error('Local trigger rule archive source is invalid');const oldExpected=suggestedTriggerRule(archivedWorkspaceId,event.eventType),expected=suggestedTriggerRule(workspace.id,event.eventType),status=String(row.status);if(Number(row.version)!==1||String(row.statement)!==oldExpected.statement||String(row.definition_json)!==JSON.stringify(oldExpected.definition)||String(row.definition_digest)!==oldExpected.digest||!['suggested','paused','killed'].includes(status))throw new Error('Local trigger rule archive authority is invalid');const id=randomUUID();idMap.set(String(row.id),id);restoredRules.set(String(row.id),{id,eventId:event.id,oldEventId,version:1,digest:expected.digest,oldDigest:oldExpected.digest,definitionJson:JSON.stringify(expected.definition),oldDefinitionJson:JSON.stringify(oldExpected.definition),eventType:event.eventType,eventDigest:event.digest});this.db.prepare('INSERT INTO local_trigger_rules VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,workspace.id,event.id,expected.statement,1,JSON.stringify(expected.definition),expected.digest,status,String(row.created_at),String(row.updated_at))}
        for(const value of archive.objects.local_trigger_runs??[]){const row=value as Record<string,unknown>,oldRuleId=String(row.rule_id),oldEventId=String(row.event_id),rule=restoredRules.get(oldRuleId),event=restoredEvents.get(oldEventId),status=String(row.status),attempt=Number(row.attempt),validStatus=status==='dry_run'&&attempt===1||status==='retrying'&&(attempt===1||attempt===2)||status==='dead_letter'&&attempt===3;if(!rule||!event||oldEventId!==rule.oldEventId||event.id!==rule.eventId||!validStatus||Number(row.proposed_effects)!==0)throw new Error('Local trigger run archive is invalid');const oldExpected=localTriggerDryRun({workspaceId:archivedWorkspaceId,ruleId:oldRuleId,ruleVersion:rule.version,ruleDigest:rule.oldDigest,eventId:oldEventId,eventDigest:event.digest,eventType:event.eventType,definitionJson:rule.oldDefinitionJson,killSwitch:false}),expected=localTriggerDryRun({workspaceId:workspace.id,ruleId:rule.id,ruleVersion:rule.version,ruleDigest:rule.digest,eventId:event.id,eventDigest:event.digest,eventType:event.eventType,definitionJson:rule.definitionJson,killSwitch:false});if(String(row.run_digest)!==oldExpected.digest)throw new Error('Local trigger run archive provenance is invalid');this.db.prepare('INSERT INTO local_trigger_runs VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),workspace.id,rule.id,event.id,status,attempt,0,expected.digest,String(row.created_at))}
        for(const value of archive.objects.external_inbound_events??[]){const row=value as Record<string,unknown>,payload=JSON.parse(String(row.payload_json)) as LocalTriggerPayload,sourceEventId=String(row.source_event_id),eventId=randomUUID(),channelId=String(row.channel_id),occurredAt=String(row.occurred_at),receivedAt=String(row.received_at),occurred=Date.parse(occurredAt),received=Date.parse(receivedAt),validated=createLocalEventEnvelope({workspaceId:archivedWorkspaceId,eventType:String(row.event_type),idempotencyKey:sourceEventId,payload,occurredAt,receivedAt:occurredAt});if(!/^[A-Za-z0-9_-]{16,128}$/.test(sourceEventId)||!/^[A-Za-z0-9_-]{16,128}$/.test(channelId)||!Number.isFinite(received)||new Date(received).toISOString()!==receivedAt||occurred>received+LOCAL_TRIGGER_LIMITS.maxClockSkewMs||String(row.status)!=='quarantined'||String(row.payload_digest)!==validated.payloadDigest)throw new Error('Inbound webhook archive provenance is invalid');this.db.prepare("INSERT INTO external_inbound_events VALUES (?,?,?,?,?,?,?,?,?,'quarantined',?)").run(eventId,sourceEventId,workspace.id,channelId,validated.eventType,occurredAt,receivedAt,JSON.stringify(validated.payload),validated.payloadDigest,String(row.created_at))}
        const triggerSettings=archive.objects.local_trigger_settings??[];if(triggerSettings.length>1)throw new Error('Local trigger settings archive is invalid');if(triggerSettings.length){const row=triggerSettings[0] as Record<string,unknown>,kill=Number(row.kill_switch);if(![0,1].includes(kill))throw new Error('Local trigger settings archive is invalid');this.db.prepare('INSERT INTO local_trigger_settings VALUES (?,?,?)').run(workspace.id,kill,String(row.updated_at))}
        for (const tombstoneValue of archive.objects.tombstones ?? []) {
          const tombstone = tombstoneValue as Record<string, unknown>,
            mapped = idMap.get(String(tombstone.object_id))!;
          this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(mapped, workspace.id, String(tombstone.object_kind), String(tombstone.deleted_at));
        }
        for (const activityValue of archive.objects.activities ?? []) {
          const archived = activityValue as Record<string, unknown>,
            oldObjectId = archived.object_id ? String(archived.object_id) : undefined;
          const mappedObjectId = oldObjectId === String((archive.workspace as Record<string, unknown>).id) ? workspace.id : oldObjectId ? (idMap.get(oldObjectId) ?? null) : null;
          const metadata = remapArchiveValue(JSON.parse(String(archived.metadata_json ?? '{}')) as unknown, idMap, String((archive.workspace as Record<string, unknown>).id), workspace.id);
          this.db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), workspace.id, String(archived.category), String(archived.action), mappedObjectId, archived.object_kind ? String(archived.object_kind) : null, JSON.stringify(metadata), String(archived.created_at));
        }
        this.activity(workspace.id, 'lifecycle', 'workspace.restored', workspace.id, 'workspace', { archiveVersion: archive.version });
      });
    } catch (error) {
      for (const file of writtenFiles) rmSync(file, { force: true });
      throw error;
    }
    return workspace;
  }

  counts(): Record<string, number> {
    const tables = ['workspaces', 'documents', 'revisions', 'chats', 'messages', 'memories', 'memory_suggestions', 'commitments', 'rule_suggestions', 'rule_suggestion_sources', 'learned_rules', 'rule_outcomes', 'relationships', 'attachments', 'document_import_sources', 'document_chunks', 'embeddings','tool_gateway_settings','tool_gateway_receipts','tool_failure_knowledge', 'activities', 'tombstones', 'queued_work', 'security_profiles', 'executions', 'execution_events', 'search_fts'];
    return Object.fromEntries(
      tables.map((table) => [
        table,
        Number(
          (
            this.db.prepare(`SELECT count(*) count FROM ${table}`).get() as {
              count: number;
            }
          ).count,
        ),
      ]),
    );
  }

  localDiagnostics(workspaceId: string): {
    schemaVersion: number;
    expectedSchemaVersion: number;
    integrity: 'ok' | 'corrupt';
    foreignKeyViolations: number;
    missingFiles: number;
    orphanFiles: number;
    digestMismatches: number;
    indexedObjects: number;
    expectedObjects: number;
  } {
    if (!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) throw new Error('Workspace not found');
    const integrityRows = this.db.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>;
    const integrity = integrityRows.length === 1 && Object.values(integrityRows[0])[0] === 'ok' ? 'ok' : 'corrupt';
    const foreignKeyViolations = (this.db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length;
    const attachments = this.db.prepare('SELECT relative_path,sha256 FROM attachments WHERE workspace_id=?').all(workspaceId) as Array<{ relative_path: string; sha256: string }>;
    const referenced = new Set((this.db.prepare('SELECT relative_path FROM attachments').all() as Array<{ relative_path: string }>).map((row) => row.relative_path));
    let missingFiles = 0,
      digestMismatches = 0;
    for (const attachment of attachments) {
      const file = path.join(this.attachmentRoot, attachment.relative_path);
      if (!existsSync(file)) {
        missingFiles += 1;
        continue;
      }
      if (createHash('sha256').update(readFileSync(file)).digest('hex') !== attachment.sha256) digestMismatches += 1;
    }
    const invalidSources=Number((this.db.prepare("SELECT count(*) count FROM document_import_sources s LEFT JOIN documents d ON d.id=s.document_id AND d.workspace_id=s.workspace_id LEFT JOIN revisions r ON r.id=s.revision_id AND r.document_id=s.document_id LEFT JOIN attachments a ON a.id=s.attachment_id AND a.workspace_id=s.workspace_id AND a.owner_id=s.document_id WHERE s.workspace_id=? AND (d.id IS NULL OR d.current_revision_id<>s.revision_id OR r.id IS NULL OR a.id IS NULL OR a.sha256<>s.source_digest)").get(workspaceId) as {count:number}).count),sourceTexts=this.db.prepare('SELECT s.text_digest textDigest,r.body FROM document_import_sources s JOIN revisions r ON r.id=s.revision_id AND r.document_id=s.document_id WHERE s.workspace_id=?').all(workspaceId) as Array<{textDigest:string;body:string}>;digestMismatches+=invalidSources+sourceTexts.filter((item)=>contentDigest(item.body)!==item.textDigest).length;
    let orphanFiles = readdirSync(this.attachmentRoot).filter((entry) => !entry.includes('.deleting-') && !referenced.has(entry)).length;
    const meetingFiles = this.db.prepare('SELECT audio_relative_path relativePath,sha256 FROM meetings WHERE workspace_id=? AND audio_relative_path IS NOT NULL').all(workspaceId) as Array<{ relativePath: string; sha256: string }>;
    const allMeetingReferences = new Set((this.db.prepare('SELECT audio_relative_path relativePath FROM meetings WHERE audio_relative_path IS NOT NULL').all() as Array<{ relativePath: string }>).map((row) => row.relativePath));
    for (const meeting of meetingFiles) {
      const file = this.meetingAudioPath(meeting.relativePath);
      if (!existsSync(file)) {
        missingFiles++;
        continue;
      }
      if (createHash('sha256').update(readFileSync(file)).digest('hex') !== meeting.sha256) digestMismatches++;
    }
    orphanFiles += readdirSync(this.meetingRoot).filter((entry) => !entry.includes('.deleting-') && !allMeetingReferences.has(entry)).length;
    const indexedObjects = Number((this.db.prepare('SELECT count(*) count FROM search_fts WHERE workspace_id=?').get(workspaceId) as { count: number }).count);
    const expectedObjects = Number(
      (
        this.db
          .prepare(
            `SELECT
      (SELECT count(*) FROM documents WHERE workspace_id=?) +
      (SELECT count(*) FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=?) +
      (SELECT count(*) FROM memories WHERE workspace_id=?) count`,
          )
          .get(workspaceId, workspaceId, workspaceId) as { count: number }
      ).count,
    );
    return {
      schemaVersion: schemaVersion(this.db),
      expectedSchemaVersion: CURRENT_SCHEMA_VERSION,
      integrity,
      foreignKeyViolations,
      missingFiles,
      orphanFiles,
      digestMismatches,
      indexedObjects,
      expectedObjects,
    };
  }

  rebuildTextIndex(workspaceId: string): void {
    if (!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) throw new Error('Workspace not found');
    this.transaction(() => {
      this.db.prepare('DELETE FROM search_fts WHERE workspace_id=?').run(workspaceId);
      this.db.prepare("INSERT INTO search_fts SELECT d.workspace_id,d.id,'document',r.id,d.title,r.body FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=?").run(workspaceId);
      this.db.prepare("INSERT INTO search_fts SELECT c.workspace_id,m.id,'message',NULL,c.title,m.body FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=?").run(workspaceId);
      this.db.prepare("INSERT INTO search_fts SELECT workspace_id,id,'memory',NULL,title,body FROM memories WHERE workspace_id=?").run(workspaceId);
      this.activity(workspaceId, 'maintenance', 'search.rebuilt', workspaceId, 'workspace', {});
    });
  }

  toolGatewaySettings(workspaceId:string):{stopped:boolean;denyPatterns:string[];suppressCommit:boolean;suppressPush:boolean;updatedAt:string}{
    if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found')
    const row=this.db.prepare('SELECT stopped,deny_patterns_json denyPatterns,suppress_commit suppressCommit,suppress_push suppressPush,updated_at updatedAt FROM tool_gateway_settings WHERE workspace_id=?').get(workspaceId) as Record<string,unknown>|undefined
    return row?{stopped:Boolean(row.stopped),denyPatterns:JSON.parse(String(row.denyPatterns)) as string[],suppressCommit:Boolean(row.suppressCommit),suppressPush:Boolean(row.suppressPush),updatedAt:String(row.updatedAt)}:{stopped:false,denyPatterns:[],suppressCommit:false,suppressPush:false,updatedAt:now()}
  }
  setToolGatewaySettings(workspaceId:string,input:{stopped:boolean;denyPatterns:string[];suppressCommit:boolean;suppressPush:boolean}){
    if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');const timestamp=now();this.db.prepare('INSERT INTO tool_gateway_settings VALUES (?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET stopped=excluded.stopped,deny_patterns_json=excluded.deny_patterns_json,suppress_commit=excluded.suppress_commit,suppress_push=excluded.suppress_push,updated_at=excluded.updated_at').run(workspaceId,input.stopped?1:0,JSON.stringify(input.denyPatterns),input.suppressCommit?1:0,input.suppressPush?1:0,timestamp);this.activity(workspaceId,'ai','tool.policy.updated',workspaceId,'workspace',{stopped:input.stopped,denyCount:input.denyPatterns.length,suppressCommit:input.suppressCommit,suppressPush:input.suppressPush});return{...input,updatedAt:timestamp}
  }
  saveToolReceipt(receipt:ToolReceipt){
    if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(receipt.workspaceId))return false
    this.db.prepare('INSERT OR REPLACE INTO tool_gateway_receipts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(receipt.id,receipt.workspaceId,receipt.origin,receipt.tool,receipt.status,receipt.capabilityVersion,'local',receipt.profileName,receipt.policyDigest,receipt.summary.slice(0,500),receipt.code??null,receipt.notification?.slice(0,300)??null,receipt.rollbackRef?.slice(0,200)??null,receipt.outputBytes,receipt.truncated?1:0,receipt.startedAt,receipt.finishedAt??receipt.startedAt,receipt.durationMs??0)
    this.activity(receipt.workspaceId,'ai',`tool.${receipt.status}`,receipt.id,'tool_receipt',{tool:receipt.tool,origin:receipt.origin,status:receipt.status,code:receipt.code??null,outputBytes:receipt.outputBytes,truncated:receipt.truncated});return true
  }
  listToolReceipts(workspaceId:string,limit=100):ToolReceipt[]{if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');return(this.db.prepare('SELECT id,workspace_id workspaceId,origin,tool,status,capability_version capabilityVersion,device,profile_name profileName,policy_digest policyDigest,summary,code,notification,rollback_ref rollbackRef,output_bytes outputBytes,truncated,started_at startedAt,finished_at finishedAt,duration_ms durationMs FROM tool_gateway_receipts WHERE workspace_id=? ORDER BY started_at DESC,id DESC LIMIT ?').all(workspaceId,Math.max(1,Math.min(500,limit))) as Array<Record<string,unknown>>).map((row)=>({...row,version:1,device:'local',truncated:Boolean(row.truncated),outputBytes:Number(row.outputBytes),durationMs:Number(row.durationMs)}) as unknown as ToolReceipt)}
  findToolFailure(workspaceId:string,identity:ToolFailureIdentity,at=now()):ToolFailureMatch|undefined{
    if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found')
    this.purgeToolFailures(workspaceId,at,identity.tool)
    const row=this.db.prepare("SELECT id,error_class errorClass,remediation,expires_at expiresAt,updated_at updatedAt FROM tool_failure_knowledge WHERE workspace_id=? AND client_scope='local-personal' AND tool=? AND capability_version=? AND parameter_fingerprint=? AND context_digest=? AND outcome='active' AND expires_at>? ORDER BY updated_at DESC LIMIT 1").get(workspaceId,identity.tool,identity.capabilityVersion,identity.parameterFingerprint,identity.contextDigest,at) as Record<string,unknown>|undefined
    return row?{id:String(row.id),errorClass:String(row.errorClass),remediation:row.remediation==null?undefined:String(row.remediation),expiresAt:String(row.expiresAt),updatedAt:String(row.updatedAt)}:undefined
  }
  recordToolOutcome(request:ToolRequest,identity:ToolFailureIdentity,result:ToolResult,overrideReason?:string,remediation?:string):void{
    if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(request.workspaceId))return
    if(!['failed','timed_out','completed'].includes(result.receipt.status))return
    const timestamp=result.receipt.finishedAt??now(),existing=this.db.prepare("SELECT id,created_at createdAt FROM tool_failure_knowledge WHERE workspace_id=? AND client_scope='local-personal' AND tool=? AND capability_version=? AND parameter_fingerprint=? AND context_digest=?").get(request.workspaceId,identity.tool,identity.capabilityVersion,identity.parameterFingerprint,identity.contextDigest) as {id:string;createdAt:string}|undefined
    if(result.receipt.status==='completed'){
      if(existing){this.db.prepare("UPDATE tool_failure_knowledge SET outcome='superseded',override_reason=?,updated_at=?,superseded_by_receipt_id=? WHERE id=?").run(overrideReason??null,timestamp,result.receipt.id,existing.id);this.activity(request.workspaceId,'ai','tool.failure.superseded',existing.id,'tool_failure',{tool:identity.tool,receiptId:result.receipt.id,override:Boolean(overrideReason)});this.enqueueToolFailure(request.workspaceId,existing.id)}
      return
    }
    const id=existing?.id??randomUUID(),expiresAt=new Date(Date.parse(timestamp)+FAILURE_TTL_MS).toISOString(),errorClass=(result.receipt.code??result.receipt.status).slice(0,80)
    this.db.prepare("INSERT INTO tool_failure_knowledge VALUES (?,?, 'local-personal',?,?,?,?,?,?,?,?, 'active',?,?,?,NULL) ON CONFLICT(workspace_id,client_scope,tool,capability_version,parameter_fingerprint,context_digest) DO UPDATE SET source_receipt_id=excluded.source_receipt_id,error_class=excluded.error_class,remediation=COALESCE(excluded.remediation,tool_failure_knowledge.remediation),override_reason=excluded.override_reason,outcome='active',expires_at=excluded.expires_at,updated_at=excluded.updated_at,superseded_by_receipt_id=NULL").run(id,request.workspaceId,result.receipt.id,identity.tool,identity.capabilityVersion,identity.parameterFingerprint,identity.contextDigest,errorClass,remediation??null,overrideReason??null,expiresAt,existing?.createdAt??timestamp,timestamp)
    this.purgeToolFailures(request.workspaceId,timestamp,identity.tool)
    this.activity(request.workspaceId,'ai','tool.failure.learned',id,'tool_failure',{tool:identity.tool,errorClass,expiresAt,override:Boolean(overrideReason),hasRemediation:Boolean(remediation)})
    this.enqueueToolFailure(request.workspaceId,id)
  }
  listToolFailures(workspaceId:string,limit=100):Array<Record<string,unknown>>{
    if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found')
    this.purgeToolFailures(workspaceId,now())
    return this.db.prepare('SELECT id,tool,capability_version capabilityVersion,error_class errorClass,remediation,outcome,expires_at expiresAt,created_at createdAt,updated_at updatedAt,CASE WHEN override_reason IS NULL THEN 0 ELSE 1 END hadOverride FROM tool_failure_knowledge WHERE workspace_id=? ORDER BY updated_at DESC,id DESC LIMIT ?').all(workspaceId,Math.max(1,Math.min(500,limit))) as Array<Record<string,unknown>>
  }
  deleteToolFailure(workspaceId:string,id:string):boolean{const changed=this.db.prepare('DELETE FROM tool_failure_knowledge WHERE id=? AND workspace_id=?').run(id,workspaceId).changes>0;if(changed){this.activity(workspaceId,'ai','tool.failure.deleted',id,'tool_failure',{});this.syncJournal.enqueue(workspaceId,id,'tool_failure','delete',{id},[id])}return changed}
  deleteToolReceipt(workspaceId:string,id:string):boolean{const failures=this.db.prepare('SELECT id FROM tool_failure_knowledge WHERE workspace_id=? AND source_receipt_id=?').all(workspaceId,id) as Array<{id:string}>,changed=this.db.prepare('DELETE FROM tool_gateway_receipts WHERE id=? AND workspace_id=?').run(id,workspaceId).changes>0;for(const failure of failures)this.syncJournal.enqueue(workspaceId,failure.id,'tool_failure','delete',{id:failure.id},[failure.id]);return changed}
  recordVoiceActivity(workspaceId:string,chatId:string,action:'started'|'transcribed'|'stopped'|'failed',metadata:Record<string,unknown>={}):void{this.assertObjectInWorkspace(workspaceId,chatId,'chat');const safe=Object.fromEntries(Object.entries(metadata).filter(([key,value])=>['mode','provider','reason','durationMs'].includes(key)&&(typeof value==='string'||typeof value==='number'||typeof value==='boolean')));this.activity(workspaceId,'ai',`voice.${action}`,chatId,'chat',safe)}
  private purgeToolFailures(workspaceId:string,at:string,tool?:string){const expired=this.db.prepare(`SELECT id FROM tool_failure_knowledge WHERE workspace_id=? AND expires_at<=?${tool?' AND tool=?':''}`).all(...(tool?[workspaceId,at,tool]:[workspaceId,at])) as Array<{id:string}>,overflow=tool?this.db.prepare('SELECT id FROM tool_failure_knowledge WHERE workspace_id=? AND tool=? ORDER BY updated_at DESC,created_at DESC,parameter_fingerprint DESC,id DESC LIMIT -1 OFFSET ?').all(workspaceId,tool,MAX_FAILURES_PER_TOOL) as Array<{id:string}>:[];for(const id of new Set([...expired,...overflow].map((row)=>row.id))){this.db.prepare('DELETE FROM tool_failure_knowledge WHERE id=? AND workspace_id=?').run(id,workspaceId);this.syncJournal.enqueue(workspaceId,id,'tool_failure','delete',{id},[id]);this.activity(workspaceId,'ai','tool.failure.expired',id,'tool_failure',{reason:expired.some((row)=>row.id===id)?'expired':'retention'})}}
  private toolFailureSyncPayload(workspaceId:string,id:string){const row=this.db.prepare('SELECT id,source_receipt_id sourceReceiptId,tool,capability_version capabilityVersion,parameter_fingerprint parameterFingerprint,context_digest contextDigest,error_class errorClass,remediation,override_reason overrideReason,outcome,expires_at expiresAt,created_at createdAt,updated_at updatedAt,superseded_by_receipt_id supersededByReceiptId FROM tool_failure_knowledge WHERE id=? AND workspace_id=?').get(id,workspaceId) as Record<string,unknown>|undefined;if(!row)return undefined;const superseded=row.supersededByReceiptId?this.db.prepare('SELECT tool,status,capability_version capabilityVersion FROM tool_gateway_receipts WHERE id=? AND workspace_id=?').get(String(row.supersededByReceiptId),workspaceId) as Record<string,unknown>|undefined:undefined;return{...row,supersededReceiptTool:superseded?.tool,supersededReceiptStatus:superseded?.status,supersededReceiptCapabilityVersion:superseded?.capabilityVersion}}
  private enqueueToolFailure(workspaceId:string,id:string){const payload=this.toolFailureSyncPayload(workspaceId,id);if(payload)this.syncJournal.enqueue(workspaceId,id,'tool_failure','upsert',payload)}

  private activity(workspaceId: string, category: string, action: string, objectId: string, objectKind: string, metadata: Record<string, unknown>): void {
    this.db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), workspaceId, category, action, objectId, objectKind, JSON.stringify(metadata), now());
  }
  private activityObject(
    workspaceId: string,
    objectId: string | undefined,
    kind: string,
  ): {
    title?: string;
    targetId?: string;
    targetKind?: 'chat' | 'document' | 'memory' | 'commitment' | 'rule';
  } {
    if (!objectId) return {};
    if (kind === 'message') {
      const row = this.db.prepare('SELECT c.id chatId,c.title FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=? AND c.workspace_id=?').get(objectId, workspaceId) as { chatId: string; title: string } | undefined;
      return row
        ? {
            title: `Message in ${row.title}`,
            targetId: row.chatId,
            targetKind: 'chat',
          }
        : {};
    }
    if (kind === 'execution') {
      const row = this.db.prepare("SELECT cli||' · '||status title,chat_id chatId FROM executions WHERE id=? AND workspace_id=?").get(objectId, workspaceId) as { title: string; chatId: string } | undefined;
      return row ? { title: row.title, targetId: row.chatId, targetKind: 'chat' } : {};
    }
    if(kind==='tool_receipt'){const row=this.db.prepare("SELECT tool||' · '||status title FROM tool_gateway_receipts WHERE id=? AND workspace_id=?").get(objectId,workspaceId) as {title:string}|undefined;return row??{}}
    const lookups: Record<string, [string, 'chat' | 'document' | 'memory' | 'commitment' | 'rule']> = {
      document: ['SELECT title FROM documents WHERE id=? AND workspace_id=?', 'document'],
      chat: ['SELECT title FROM chats WHERE id=? AND workspace_id=?', 'chat'],
      memory: ['SELECT title FROM memories WHERE id=? AND workspace_id=?', 'memory'],
      commitment: ['SELECT title FROM commitments WHERE id=? AND workspace_id=?', 'commitment'],
      rule: ['SELECT statement title FROM learned_rules WHERE id=? AND workspace_id=?', 'rule'],
    };
    const lookup = lookups[kind];
    if (!lookup) {
      if (kind === 'workspace') {
        const row = this.db.prepare('SELECT name title FROM workspaces WHERE id=? AND id=?').get(objectId, workspaceId) as { title: string } | undefined;
        return row ?? {};
      }
      return {};
    }
    const row = this.db.prepare(lookup[0]).get(objectId, workspaceId) as { title: string } | undefined;
    return row ? { title: row.title, targetId: objectId, targetKind: lookup[1] } : {};
  }
  private indexText(workspaceId: string, objectId: string, kind: ObjectKind, revisionId: string | undefined, title: string, body: string): void {
    this.db.prepare('INSERT INTO search_fts VALUES (?,?,?,?,?,?)').run(workspaceId, objectId, kind, revisionId ?? null, title, body);
  }
  private attachmentPath(relativePath: string): string {
    if (relativePath !== path.basename(relativePath) || relativePath.includes('\0')) throw new Error('Stored attachment path is invalid');
    return path.join(this.attachmentRoot, relativePath);
  }
  private meetingAudioPath(relativePath: string): string {
    if (relativePath !== path.basename(relativePath) || relativePath.includes('\0')) throw new Error('Stored meeting audio path is invalid');
    return path.join(this.meetingRoot, relativePath);
  }
  private objectKindInWorkspace(workspaceId: string, id: string): 'document' | 'chat' | 'message' | 'memory' | 'activity_snapshot' | undefined {
    for (const [table, kind] of [
      ['documents', 'document'],
      ['chats', 'chat'],
      ['memories', 'memory'],
    ] as const)
      if (this.db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND workspace_id=?`).get(id, workspaceId)) return kind;
    if (this.db.prepare('SELECT 1 FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=? AND c.workspace_id=?').get(id, workspaceId)) return 'message';
    if(this.db.prepare('SELECT 1 FROM activity_snapshots WHERE id=? AND workspace_id=?').get(id,workspaceId))return'activity_snapshot';
    return undefined;
  }
  private objectWorkspace(id: string, expectedKind?: string): string | undefined {
    const sources =
      expectedKind === 'document'
        ? [['documents', 'workspace_id']]
        : expectedKind === 'chat'
          ? [['chats', 'workspace_id']]
          : expectedKind === 'memory'
            ? [['memories', 'workspace_id']]
            : expectedKind==='activity_snapshot'?[['activity_snapshots','workspace_id']]:[
                ['documents', 'workspace_id'],
                ['chats', 'workspace_id'],
                ['memories', 'workspace_id'],
                ['activity_snapshots','workspace_id'],
              ];
    for (const [table, column] of sources) {
      const row = this.db.prepare(`SELECT ${column} workspace_id FROM ${table} WHERE id=?`).get(id) as { workspace_id: string } | undefined;
      if (row) return row.workspace_id;
    }
    if (!expectedKind || expectedKind === 'message') {
      const row = this.db.prepare('SELECT c.workspace_id FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=?').get(id) as { workspace_id: string } | undefined;
      if (row) return row.workspace_id;
    }
    return undefined;
  }
  private assertObjectInWorkspace(workspaceId: string, id: string, expectedKind?: string): void {
    if (this.objectWorkspace(id, expectedKind) !== workspaceId) throw new Error('Object not found in workspace');
  }
  private sourceTitle(id: string, kind: ObjectKind): { title: string; excerpt: string } {
    if (kind === 'document') {
      const row = this.db.prepare('SELECT d.title,r.body FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.id=?').get(id) as { title: string; body: string };
      return { title: row.title, excerpt: row.body.slice(0, 180) };
    }
    if (kind === 'memory') {
      const row = this.db.prepare('SELECT title,body FROM memories WHERE id=?').get(id) as { title: string; body: string };
      return { title: row.title, excerpt: row.body.slice(0, 180) };
    }
    if (kind === 'message') {
      const row = this.db.prepare('SELECT c.title,m.body FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=?').get(id) as { title: string; body: string };
      return { title: row.title, excerpt: row.body.slice(0, 180) };
    }
    const row = this.db.prepare('SELECT title FROM chats WHERE id=?').get(id) as { title: string };
    return { title: row.title, excerpt: '' };
  }
  private graphNode(id: string): GraphNode | undefined {
    for (const [table, kind] of [
      ['documents', 'document'],
      ['chats', 'chat'],
      ['memories', 'memory'],
    ] as const) {
      const row = this.db.prepare(`SELECT title FROM ${table} WHERE id=?`).get(id) as { title: string } | undefined;
      if (row) return { id, kind, title: row.title };
    }
    const message = this.db.prepare('SELECT c.title FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=?').get(id) as { title: string } | undefined;
    if (message) return { id, kind: 'message', title: `Message in ${message.title}` };
    return undefined;
  }
  private rowsForWorkspace(table: string, workspaceId: string): unknown[] {
    if (table === 'revisions') return this.db.prepare('SELECT r.* FROM revisions r JOIN documents d ON d.id=r.document_id WHERE d.workspace_id=?').all(workspaceId);
    if (table === 'messages') return this.db.prepare('SELECT m.* FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=?').all(workspaceId);
    if (table === 'rule_suggestion_sources') return this.db.prepare('SELECT rs.* FROM rule_suggestion_sources rs JOIN rule_suggestions s ON s.id=rs.suggestion_id WHERE s.workspace_id=?').all(workspaceId);
    if (table === 'execution_events') return this.db.prepare('SELECT ee.* FROM execution_events ee JOIN executions e ON e.id=ee.execution_id WHERE e.workspace_id=?').all(workspaceId);
    if (table === 'hosted_run_events') return this.db.prepare('SELECT he.* FROM hosted_run_events he JOIN hosted_runs h ON h.id=he.run_id WHERE h.workspace_id=?').all(workspaceId);
    if (table === 'remote_job_events') return this.db.prepare('SELECT re.* FROM remote_job_events re JOIN remote_jobs r ON r.id=re.job_id WHERE r.workspace_id=?').all(workspaceId);
    if (table === 'reflection_proposal_sources') return this.db.prepare('SELECT ps.* FROM reflection_proposal_sources ps JOIN reflection_proposals p ON p.id=ps.proposal_id WHERE p.workspace_id=?').all(workspaceId);
    return this.db.prepare(`SELECT * FROM ${table} WHERE workspace_id=?`).all(workspaceId);
  }

  createReflectionRun(workspaceId:string,sourceIds:string[],provider:'codex'|'claude'|'deterministic'='deterministic'):{runId:string;proposalCount:number}{
    if(!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId))throw new Error('Workspace not found');
    const ids=[...new Set(sourceIds)];if(!ids.length||ids.length>50)throw new Error('Reflection requires 1 to 50 visible sources');
    type ReflectionSource={id:string;title:string;body:string;updatedAt:string;kind:'memory'|'document'};
    const sources=ids.map((id):ReflectionSource=>{const memory=this.db.prepare('SELECT id,title,body,updated_at updatedAt FROM memories WHERE id=? AND workspace_id=?').get(id,workspaceId)as Record<string,unknown>|undefined;if(memory)return{id:String(memory.id),title:String(memory.title),body:String(memory.body),updatedAt:String(memory.updatedAt),kind:'memory'};const document=this.db.prepare('SELECT d.id,d.title,r.body,r.created_at updatedAt FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.id=? AND d.workspace_id=?').get(id,workspaceId)as Record<string,unknown>|undefined;if(document)return{id:String(document.id),title:String(document.title),body:String(document.body),updatedAt:String(document.updatedAt),kind:'document'};throw new Error('Reflection source is outside this workspace or unavailable')});
    const runId=randomUUID(),timestamp=now(),sourceRows=sources.map((source)=>({...source,rowId:randomUUID(),digest:contentDigest(JSON.stringify([source.title,source.body,source.updatedAt]))}));
    const proposals:Array<{kind:'duplicate'|'stale'|'contradiction';title:string;before:string;after:string;rationale:string;sources:typeof sourceRows}>=[];
    const normalized=(value:unknown)=>String(value).trim().toLowerCase().replace(/\s+/g,' '),byBody=new Map<string,typeof sourceRows>(),byTitle=new Map<string,typeof sourceRows>();
    for(const source of sourceRows){const body=normalized(source.body),title=normalized(source.title);byBody.set(body,[...(byBody.get(body)??[]),source]);byTitle.set(title,[...(byTitle.get(title)??[]),source]);if(Date.now()-Date.parse(String(source.updatedAt))>180*86_400_000)proposals.push({kind:'stale',title:`Review stale claim · ${String(source.title)}`,before:String(source.body),after:String(source.body),rationale:'This source has not changed in more than 180 days. Confirm, edit, or reject without overwriting it.',sources:[source]})}
    for(const group of byBody.values())if(group.length>1)proposals.push({kind:'duplicate',title:`Consolidate duplicate · ${String(group[0].title)}`,before:group.map((item)=>String(item.body)).join('\n\n---\n\n'),after:String(group[0].body),rationale:'Normalized source bodies match. The proposed revision preserves one reviewable statement and leaves every source unchanged.',sources:group});
    for(const group of byTitle.values())if(group.length>1&&new Set(group.map((item)=>normalized(item.body))).size>1)proposals.push({kind:'contradiction',title:`Resolve conflicting claims · ${String(group[0].title)}`,before:group.map((item)=>String(item.body)).join('\n\n---\n\n'),after:'',rationale:'Sources with the same normalized title disagree. Waypoint does not choose a winner; edit a proposed revision only after review.',sources:group});
    this.transaction(()=>{this.db.prepare('INSERT INTO reflection_runs VALUES (?,?,?,?,?,?,?,?,?,?)').run(runId,workspaceId,proposals.length?'proposed':'accepted',provider,'local-cli-or-deterministic','reflection-v1',JSON.stringify({maxSources:50,maxRuntimeMs:120000,maxOutputBytes:262144}),JSON.stringify(proposals.length?[]:['No stale, duplicate, or contradictory candidates were found.']),timestamp,timestamp);for(const source of sourceRows)this.db.prepare('INSERT INTO reflection_sources VALUES (?,?,?,?,?,?,?)').run(source.rowId,runId,workspaceId,source.id,source.kind,source.digest,source.updatedAt);for(const proposal of proposals){const id=randomUUID();this.db.prepare("INSERT INTO reflection_proposals(id,run_id,workspace_id,kind,title,before_body,proposed_body,rationale,status,accepted_object_id,created_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,'proposed',NULL,?,NULL)").run(id,runId,workspaceId,proposal.kind,proposal.title,proposal.before,proposal.after,proposal.rationale,timestamp);for(const source of proposal.sources)this.db.prepare('INSERT INTO reflection_proposal_sources VALUES (?,?)').run(id,source.rowId)}this.activity(workspaceId,'knowledge','reflection.proposed',runId,'reflection_run',{provider,policyVersion:'reflection-v1',sourceCount:sources.length,proposalCount:proposals.length})});return{runId,proposalCount:proposals.length}
  }
  reflectionSourceEnvelope(workspaceId:string,sourceIds:string[]){const ids=[...new Set(sourceIds)];if(!ids.length||ids.length>50)throw new Error('Reflection requires 1 to 50 visible sources');return ids.map((id)=>{const memory=this.db.prepare('SELECT id,title,body,updated_at updatedAt FROM memories WHERE id=? AND workspace_id=?').get(id,workspaceId)as Record<string,unknown>|undefined,document=memory?undefined:this.db.prepare('SELECT d.id,d.title,r.body,r.created_at updatedAt FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.id=? AND d.workspace_id=?').get(id,workspaceId)as Record<string,unknown>|undefined,row=memory??document;if(!row)throw new Error('Reflection source is outside this workspace or unavailable');return{id:String(row.id),kind:memory?'memory':'document',title:String(row.title),body:String(row.body),updatedAt:String(row.updatedAt),digest:contentDigest(JSON.stringify([row.title,row.body,row.updatedAt]))}})}
  markReflectionRunReviewing(workspaceId:string,runId:string){const changed=this.db.prepare("UPDATE reflection_runs SET status='reviewing',updated_at=? WHERE id=? AND workspace_id=?").run(now(),runId,workspaceId);if(!changed.changes)throw new Error('Reflection run not found')}
  applyReflectionCliAnalysis(workspaceId:string,runId:string,provider:'codex'|'claude',providerVersion:string,analysis:unknown){const run=this.db.prepare('SELECT 1 FROM reflection_runs WHERE id=? AND workspace_id=?').get(runId,workspaceId);if(!run)throw new Error('Reflection run not found');if(!Array.isArray(analysis)||analysis.length>100)throw new Error('CLI reflection output is invalid');const sources=this.db.prepare('SELECT id,source_id sourceId FROM reflection_sources WHERE run_id=? AND workspace_id=?').all(runId,workspaceId)as Array<{id:string;sourceId:string}>,bySource=new Map(sources.map((item)=>[item.sourceId,item.id])),validated=analysis.map((value)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('CLI reflection proposal is invalid');const item=value as Record<string,unknown>,keys=Object.keys(item).sort(),expected=['beforeBody','kind','proposedBody','rationale','sourceIds','title'];if(JSON.stringify(keys)!==JSON.stringify(expected))throw new Error('CLI reflection proposal schema is invalid');const kind=String(item.kind),sourceIds=Array.isArray(item.sourceIds)?[...new Set(item.sourceIds.map(String))]:[];if(!['duplicate','stale','contradiction'].includes(kind)||!sourceIds.length||sourceIds.some((id)=>!bySource.has(id)))throw new Error('CLI reflection proposal authority is invalid');const bounded=(field:string,max:number,allowEmpty=false)=>{if(typeof item[field]!=='string')throw new Error(`CLI reflection ${field} is invalid`);const value=(item[field] as string).trim();if((!allowEmpty&&!value)||value.length>max)throw new Error(`CLI reflection ${field} is invalid`);return value};return{kind,title:bounded('title',300),before:bounded('beforeBody',200000),after:bounded('proposedBody',200000,true),rationale:bounded('rationale',4000),sourceIds}});const timestamp=now();this.transaction(()=>{this.db.prepare('DELETE FROM reflection_proposals WHERE run_id=? AND workspace_id=?').run(runId,workspaceId);for(const item of validated){const proposalId=randomUUID();this.db.prepare("INSERT INTO reflection_proposals VALUES (?,?,?,?,?,?,?,?, 'proposed',NULL,?,NULL)").run(proposalId,runId,workspaceId,item.kind,item.title,item.before,item.after,item.rationale,timestamp);for(const sourceId of item.sourceIds)this.db.prepare('INSERT INTO reflection_proposal_sources VALUES (?,?)').run(proposalId,bySource.get(sourceId)!)}this.db.prepare("UPDATE reflection_runs SET status=?,provider=?,provider_version=?,omissions_json='[]',updated_at=? WHERE id=? AND workspace_id=?").run(validated.length?'proposed':'accepted',provider,providerVersion.slice(0,200),timestamp,runId,workspaceId);this.activity(workspaceId,'knowledge','reflection.cli_completed',runId,'reflection_run',{provider,policyVersion:'reflection-v1',proposalCount:validated.length})});return{runId,proposalCount:validated.length}}
  failReflectionRun(workspaceId:string,runId:string,status:'cancelled'|'failed'|'killed',reason:string){this.transaction(()=>{const changed=this.db.prepare('UPDATE reflection_runs SET status=?,omissions_json=?,updated_at=? WHERE id=? AND workspace_id=?').run(status,JSON.stringify([reason.replace(/[\r\n]+/g,' ').slice(0,300)]),now(),runId,workspaceId);if(!changed.changes)throw new Error('Reflection run not found');this.db.prepare('DELETE FROM reflection_proposals WHERE run_id=? AND workspace_id=?').run(runId,workspaceId);this.activity(workspaceId,'knowledge',`reflection.${status}`,runId,'reflection_run',{provider:'local-cli',policyVersion:'reflection-v1'})})}
  listReflectionRuns(workspaceId:string){return this.db.prepare('SELECT id,status,provider,provider_version providerVersion,policy_version policyVersion,budget_json budgetJson,omissions_json omissionsJson,created_at createdAt,updated_at updatedAt FROM reflection_runs WHERE workspace_id=? ORDER BY created_at DESC').all(workspaceId)as Array<Record<string,unknown>>}
  listReflectionProposals(workspaceId:string,runId:string){const run=this.db.prepare('SELECT 1 FROM reflection_runs WHERE id=? AND workspace_id=?').get(runId,workspaceId);if(!run)throw new Error('Reflection run not found');return this.db.prepare("SELECT p.id,p.kind,p.title,p.before_body beforeBody,p.proposed_body proposedBody,p.rationale,p.status,p.accepted_object_id acceptedObjectId,p.created_at createdAt,p.resolved_at resolvedAt,group_concat(s.source_id) sourceIds,group_concat(s.source_digest) sourceDigests FROM reflection_proposals p JOIN reflection_proposal_sources ps ON ps.proposal_id=p.id JOIN reflection_sources s ON s.id=ps.source_row_id WHERE p.run_id=? AND p.workspace_id=? GROUP BY p.id ORDER BY p.created_at,p.id").all(runId,workspaceId)as Array<Record<string,unknown>>}
  resolveReflectionProposal(workspaceId:string,proposalId:string,action:'accept'|'edit'|'reject'|'rollback',editedBody?:string){const proposal=this.db.prepare('SELECT * FROM reflection_proposals WHERE id=? AND workspace_id=?').get(proposalId,workspaceId)as Record<string,unknown>|undefined;if(!proposal)throw new Error('Reflection proposal not found');const refreshRun=()=>{const counts=this.db.prepare("SELECT count(*) total,sum(CASE WHEN status='proposed' THEN 1 ELSE 0 END) pending,sum(CASE WHEN status='stale' THEN 1 ELSE 0 END) stale,sum(CASE WHEN status IN ('accepted','edited') THEN 1 ELSE 0 END) accepted FROM reflection_proposals WHERE run_id=?").get(String(proposal.run_id))as{total:number;pending:number;stale:number;accepted:number},status=counts.stale?'stale':counts.pending?'proposed':counts.accepted?'accepted':'rejected';this.db.prepare('UPDATE reflection_runs SET status=?,updated_at=? WHERE id=? AND workspace_id=?').run(status,now(),String(proposal.run_id),workspaceId)};if(action==='rollback'){if(!['accepted','edited'].includes(String(proposal.status))||!proposal.accepted_object_id)throw new Error('Reflection proposal cannot be rolled back');this.transaction(()=>{this.db.prepare('DELETE FROM memories WHERE id=? AND workspace_id=?').run(String(proposal.accepted_object_id),workspaceId);this.db.prepare("UPDATE reflection_proposals SET status='rolled_back',resolved_at=? WHERE id=?").run(now(),proposalId);refreshRun();this.activity(workspaceId,'knowledge','reflection.rolled_back',proposalId,'reflection_proposal',{runId:String(proposal.run_id)})});return}
    if(proposal.status!=='proposed')throw new Error('Reflection proposal is no longer pending');if(action==='reject'){this.transaction(()=>{this.db.prepare("UPDATE reflection_proposals SET status='rejected',resolved_at=? WHERE id=?").run(now(),proposalId);refreshRun();this.activity(workspaceId,'knowledge','reflection.rejected',proposalId,'reflection_proposal',{runId:proposal.run_id})});return}
    const sources=this.db.prepare('SELECT s.* FROM reflection_sources s JOIN reflection_proposal_sources ps ON ps.source_row_id=s.id WHERE ps.proposal_id=?').all(proposalId)as Array<Record<string,unknown>>,body=action==='edit'?String(editedBody??'').trim():String(proposal.proposed_body).trim();if(!body||body.length>200000)throw new Error('Reflection revision body is invalid');
    for(const source of sources){const sourceId=String(source.source_id),current=source.source_kind==='memory'?this.db.prepare('SELECT title,body,updated_at updatedAt FROM memories WHERE id=? AND workspace_id=?').get(sourceId,workspaceId):this.db.prepare('SELECT d.title,r.body,r.created_at updatedAt FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.id=? AND d.workspace_id=?').get(sourceId,workspaceId);if(!current||contentDigest(JSON.stringify([(current as Record<string,unknown>).title,(current as Record<string,unknown>).body,(current as Record<string,unknown>).updatedAt]))!==String(source.source_digest)){this.db.prepare("UPDATE reflection_proposals SET status='stale',resolved_at=? WHERE id=?").run(now(),proposalId);throw new Error('Reflection sources changed; rerun reflection before accepting')}}
    const memoryId=randomUUID(),timestamp=now(),primary=sources[0],title=String(proposal.title).replace(/^.+ · /,''),sourceObjectId=String(primary.source_id);this.transaction(()=>{this.db.prepare('INSERT INTO memories(id,workspace_id,title,body,source_object_id,ownership,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(memoryId,workspaceId,title,body,sourceObjectId,'source-owned',timestamp,timestamp);this.db.prepare("UPDATE reflection_proposals SET status=?,proposed_body=?,accepted_object_id=?,resolved_at=? WHERE id=? AND status='proposed'").run(action==='edit'?'edited':'accepted',body,memoryId,timestamp,proposalId);this.indexText(workspaceId,memoryId,'memory',undefined,title,body);this.syncJournal.enqueue(workspaceId,memoryId,'memory','upsert',{id:memoryId,title,body,sourceObjectId,ownership:'source-owned',createdAt:timestamp,updatedAt:timestamp});refreshRun();this.activity(workspaceId,'knowledge','reflection.accepted',proposalId,'reflection_proposal',{runId:String(proposal.run_id),edited:action==='edit'})});return{memoryId}
  }

  private reconcileAttachmentFiles(): void {
    const referenced = new Set((this.db.prepare('SELECT relative_path FROM attachments').all() as Array<{ relative_path: string }>).map((row) => row.relative_path));
    const suffix = /\.deleting-[0-9a-f-]{36}$/;
    for (const entry of readdirSync(this.attachmentRoot)) {
      const fullPath = path.join(this.attachmentRoot, entry),
        original = entry.replace(suffix, '');
      if (suffix.test(entry)) {
        if (referenced.has(original) && !existsSync(path.join(this.attachmentRoot, original))) renameSync(fullPath, path.join(this.attachmentRoot, original));
        else rmSync(fullPath, { force: true });
      } else if (!referenced.has(entry)) rmSync(fullPath, { force: true });
    }
  }
  private reconcileMeetingFiles(): void {
    const referenced = new Set((this.db.prepare('SELECT audio_relative_path relativePath FROM meetings WHERE audio_relative_path IS NOT NULL').all() as Array<{ relativePath: string }>).map((row) => row.relativePath)),
      suffix = /\.deleting-[0-9a-f-]{36}$/;
    for (const entry of readdirSync(this.meetingRoot)) {
      const full = this.meetingAudioPath(entry),
        original = entry.replace(suffix, '');
      if (suffix.test(entry)) {
        if (referenced.has(original) && !existsSync(this.meetingAudioPath(original))) renameSync(full, this.meetingAudioPath(original));
        else rmSync(full, { force: true });
      } else if (!referenced.has(entry)) rmSync(full, { force: true });
    }
  }
}

function cosine(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return Number.NaN;
  let dot = 0,
    leftMagnitude = 0,
    rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : Number.NaN;
}

function remapArchiveValue(value: unknown, idMap: Map<string, string>, oldWorkspaceId: string, newWorkspaceId: string): unknown {
  if (typeof value === 'string') return value === oldWorkspaceId ? newWorkspaceId : (idMap.get(value) ?? value);
  if (Array.isArray(value)) return value.map((item) => remapArchiveValue(item, idMap, oldWorkspaceId, newWorkspaceId));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapArchiveValue(item, idMap, oldWorkspaceId, newWorkspaceId)]));
  return value;
}
