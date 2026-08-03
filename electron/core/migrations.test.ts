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
    runMigrations(db,before,[{version:5,apply:(database)=>database.exec('CREATE TABLE settings(key TEXT PRIMARY KEY)')}])
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION)
    expect((db.prepare('SELECT value FROM content').get() as {value:string}).value).toBe('preserved')
    expect(readdirSync(path.join(root,'migration-snapshots')).filter((name)=>name.endsWith('.sqlite'))).toHaveLength(1)
    runMigrations(db,schemaVersion(db),[{version:5,apply:()=>{throw new Error('must not rerun')}}])
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
