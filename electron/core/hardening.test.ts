import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { readBackup, writeAtomicBackup } from './backup.js'
import { WorkspaceStore } from './store.js'

describe('destructive and recovery confidence', () => {
  it('keeps an explicit backup separate, purges live derived data, and restores into new identities', () => {
    const root=mkdtempSync(path.join(tmpdir(),'waypoint-hardening-')),database=path.join(root,'waypoint.sqlite'),backupPath=path.join(root,'external-backup.json')
    const store=new WorkspaceStore(database),workspace=store.createWorkspace('Original',root),document=store.createDocument(workspace.id,'Recoverable','backup-recovery-needle')
    store.indexEmbedding(workspace.id,{objectId:document.id,objectKind:'document',revisionId:document.revisionId},[1,0],{provider:'test',providerVersion:'1',model:'test',modelDigest:'digest',chunkingDigest:'whole'})
    const attachment=path.join(root,'owned.txt');writeFileSync(attachment,'owned bytes');store.addAttachment(workspace.id,document.id,'owned.txt','text/plain',attachment)
    writeAtomicBackup(backupPath,store.exportWorkspace(workspace.id))
    store.deleteObject(workspace.id,'document',document.id)
    expect(existsSync(backupPath)).toBe(true)
    expect(store.searchText(workspace.id,'backup-recovery')).toEqual([])
    expect(store.counts()).toMatchObject({documents:0,revisions:0,attachments:0,embeddings:0})
    const restored=store.restoreWorkspace(readBackup(backupPath),'Recovery drill',root)
    const result=store.searchText(restored.id,'backup-recovery')[0]
    expect(result.objectId).not.toBe(document.id)
    expect(store.counts().embeddings).toBe(0)
    expect(JSON.stringify(store.exportWorkspace(restored.id))).not.toContain('vector_json')
    store.close()
  })

  it('detects FTS drift and repairs it transactionally from canonical content', () => {
    const root=mkdtempSync(path.join(tmpdir(),'waypoint-hardening-')),database=path.join(root,'waypoint.sqlite')
    let store=new WorkspaceStore(database);const workspace=store.createWorkspace('Repair',root);store.createDocument(workspace.id,'Canonical','rebuild-search-needle');store.close()
    const raw=new DatabaseSync(database);raw.prepare('DELETE FROM search_fts WHERE workspace_id=?').run(workspace.id);raw.close()
    store=new WorkspaceStore(database)
    expect(store.localDiagnostics(workspace.id)).toMatchObject({indexedObjects:0,expectedObjects:1})
    store.rebuildTextIndex(workspace.id)
    expect(store.localDiagnostics(workspace.id)).toMatchObject({indexedObjects:1,expectedObjects:1})
    expect(store.searchText(workspace.id,'rebuild-search')).toHaveLength(1)
    store.close()
  })

  it('does not call another workspace attachment an orphan and reports actual schema and foreign-key damage',()=>{
    const root=mkdtempSync(path.join(tmpdir(),'waypoint-hardening-')),database=path.join(root,'waypoint.sqlite')
    let store=new WorkspaceStore(database);const first=store.createWorkspace('First',root),second=store.createWorkspace('Second',root)
    const firstDoc=store.createDocument(first.id,'First','Body'),secondDoc=store.createDocument(second.id,'Second','Body'),source=path.join(root,'shared.txt');writeFileSync(source,'bytes')
    store.addAttachment(first.id,firstDoc.id,'first.txt','text/plain',source);store.addAttachment(second.id,secondDoc.id,'second.txt','text/plain',source)
    expect(store.localDiagnostics(first.id)).toMatchObject({schemaVersion:10,expectedSchemaVersion:10,foreignKeyViolations:0,orphanFiles:0,missingFiles:0,digestMismatches:0})
    store.close()
    const raw=new DatabaseSync(database);raw.exec('PRAGMA foreign_keys=OFF');raw.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run('broken','missing-document','body',new Date().toISOString());raw.close()
    store=new WorkspaceStore(database)
    expect(store.localDiagnostics(first.id).foreignKeyViolations).toBe(1)
    store.close()
  })
})
