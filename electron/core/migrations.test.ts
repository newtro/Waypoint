import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { assertSupportedSchema, createMigrationSnapshot, CURRENT_SCHEMA_VERSION, runMigrations, schemaVersion } from './migrations.js'

function legacy() {
  const root = mkdtempSync(path.join(tmpdir(), 'waypoint-migrate-')), file = path.join(root, 'waypoint.sqlite'), db = new DatabaseSync(file)
  db.exec('CREATE TABLE schema_versions(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_versions VALUES (4,\'old\'); CREATE TABLE content(value TEXT); INSERT INTO content VALUES (\'preserved\')')
  return { root, file, db }
}

describe('ordered schema migration', () => {
  it('snapshots known old data and applies each migration once', () => {
    const {root,file,db}=legacy(), before=assertSupportedSchema(db)
    expect(createMigrationSnapshot(db,file,before)).toBeTruthy()
    runMigrations(db,before,[{version:5,apply:(database)=>database.exec('CREATE TABLE settings(key TEXT PRIMARY KEY)')},{version:6,apply:(database)=>database.exec('CREATE TABLE execution_sources(id TEXT PRIMARY KEY)')},{version:7,apply:(database)=>database.exec('CREATE TABLE sync_state(id TEXT PRIMARY KEY)')},{version:8,apply:(database)=>database.exec('CREATE TABLE suggestions(id TEXT PRIMARY KEY)')},{version:9,apply:(database)=>database.exec('ALTER TABLE suggestions ADD COLUMN source_digest TEXT')},{version:10,apply:(database)=>database.exec('CREATE TABLE briefing(id TEXT PRIMARY KEY)')},{version:11,apply:(database)=>database.exec('CREATE TABLE rules(id TEXT PRIMARY KEY)')},{version:12,apply:(database)=>database.exec('CREATE INDEX content_value ON content(value)')},{version:13,apply:(database)=>database.exec('CREATE TABLE meetings(id TEXT PRIMARY KEY)')},{version:14,apply:(database)=>database.exec('CREATE TABLE playbooks(id TEXT PRIMARY KEY)')},{version:15,apply:(database)=>database.exec('CREATE TABLE document_chunks(id TEXT PRIMARY KEY)')},{version:16,apply:(database)=>database.exec('CREATE TABLE local_events(id TEXT PRIMARY KEY)')},{version:17,apply:(database)=>database.exec('CREATE TABLE external_inbound_events(id TEXT PRIMARY KEY)')},{version:18,apply:(database)=>database.exec('CREATE TABLE tool_gateway_receipts(id TEXT PRIMARY KEY)')},{version:19,apply:(database)=>database.exec('CREATE TABLE tool_failure_knowledge(id TEXT PRIMARY KEY)')},{version:20,apply:(database)=>database.exec('CREATE TABLE provider_usage_receipts(id TEXT PRIMARY KEY)')}])
    runMigrations(db,schemaVersion(db),[{version:21,apply:(database)=>database.exec('CREATE TABLE hosted_runs(id TEXT PRIMARY KEY)')}])
    runMigrations(db,schemaVersion(db),[{version:22,apply:(database)=>database.exec('CREATE TABLE activity_snapshots(id TEXT PRIMARY KEY)')}])
    runMigrations(db,schemaVersion(db),[{version:23,apply:(database)=>database.exec('CREATE TABLE remote_jobs(id TEXT PRIMARY KEY)')}])
    runMigrations(db,schemaVersion(db),[{version:24,apply:(database)=>database.exec('CREATE TABLE chat_model_preferences(id TEXT PRIMARY KEY)')}])
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION)
    expect((db.prepare('SELECT value FROM content').get() as {value:string}).value).toBe('preserved')
    expect(readdirSync(path.join(root,'migration-snapshots')).filter((name)=>name.endsWith('.sqlite'))).toHaveLength(1)
    runMigrations(db,schemaVersion(db),[{version:5,apply:()=>{throw new Error('must not rerun')}},{version:6,apply:()=>{throw new Error('must not rerun')}},{version:7,apply:()=>{throw new Error('must not rerun')}},{version:8,apply:()=>{throw new Error('must not rerun')}},{version:9,apply:()=>{throw new Error('must not rerun')}},{version:10,apply:()=>{throw new Error('must not rerun')}},{version:11,apply:()=>{throw new Error('must not rerun')}},{version:12,apply:()=>{throw new Error('must not rerun')}},{version:13,apply:()=>{throw new Error('must not rerun')}},{version:14,apply:()=>{throw new Error('must not rerun')}},{version:15,apply:()=>{throw new Error('must not rerun')}},{version:16,apply:()=>{throw new Error('must not rerun')}},{version:17,apply:()=>{throw new Error('must not rerun')}},{version:18,apply:()=>{throw new Error('must not rerun')}},{version:19,apply:()=>{throw new Error('must not rerun')}},{version:20,apply:()=>{throw new Error('must not rerun')}}])
    db.close()
  })

  it('rolls back a failed migration without stamping or partial schema', () => {
    const {db}=legacy()
    expect(()=>runMigrations(db,4,[{version:5,apply:(database)=>{database.exec('CREATE TABLE partial(value TEXT)');throw new Error('injected failure')}}])).toThrow(/injected/)
    expect(schemaVersion(db)).toBe(4)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get()).toBeUndefined()
    db.close()
  })

  it('fails closed on a newer schema without downgrading', () => {
    const {db}=legacy(); db.prepare('INSERT INTO schema_versions VALUES (?,?)').run(CURRENT_SCHEMA_VERSION+1,'future')
    expect(()=>assertSupportedSchema(db)).toThrow(/newer schema/)
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION+1)
    db.close()
  })
})
