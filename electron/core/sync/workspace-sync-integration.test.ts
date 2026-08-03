import { mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { describe,expect,it } from 'vitest'
import { WorkspaceStore } from '../store.js'
import type { InboundChange } from './sync-store.js'

function setup(){const root=mkdtempSync(path.join(tmpdir(),'waypoint-integrated-sync-')),database=path.join(root,'waypoint.sqlite'),store=new WorkspaceStore(database),workspace=store.createWorkspace('Private',path.join(root,'workspace'));return{root,database,store,workspace}}
function inbound(input:Partial<InboundChange>&Pick<InboundChange,'id'|'deviceId'|'sequence'|'clock'|'payload'>):InboundChange{return{envelopeId:`envelope-${input.id}`,workspaceId:'workspace',objectId:'remote-doc',objectKind:'document',operation:'upsert',createdAt:new Date().toISOString(),...input}}

describe('WorkspaceStore Phase 3 journal integration',()=>{
  it('atomically journals create/update and deletion replaces owned pending content with a tombstone',()=>{
    const {database,store,workspace}=setup();const document=store.createDocument(workspace.id,'Route','first');store.updateDocument(workspace.id,document.id,'Route','second')
    expect(store.pendingSyncChanges(workspace.id).filter((change)=>change.objectId===document.id).map((change)=>change.operation)).toEqual(['upsert','upsert'])
    store.deleteObject(workspace.id,'document',document.id)
    const changes=store.pendingSyncChanges(workspace.id).filter((change)=>change.objectId===document.id)
    expect(changes).toHaveLength(1);expect(changes[0]).toMatchObject({operation:'delete',payload:{id:document.id,cascade:true}})
    expect(store.syncStatus(workspace.id)).toMatchObject({setupStatus:'local_only',pendingMutations:1,tombstones:1})
    const staleRemote=inbound({workspaceId:workspace.id,objectId:document.id,id:'stale-after-local-delete',deviceId:'offline-peer',sequence:9,clock:{'offline-peer':9},payload:{body:'resurrection'}});expect(store.recordInboundSyncChange(staleRemote)).toBe('ignored')
    store.close();const reopened=new WorkspaceStore(database);expect(reopened.pendingSyncChanges(workspace.id)).toHaveLength(1);expect(()=>reopened.updateDocument(workspace.id,document.id,'x','resurrection')).toThrow('not found');reopened.close()
  })

  it('rolls canonical creation back when same-transaction journal enqueue fails',()=>{
    const {database,store,workspace}=setup(),admin=new DatabaseSync(database)
    admin.exec("CREATE TRIGGER reject_document_sync BEFORE INSERT ON sync_mutations WHEN NEW.object_kind='document' BEGIN SELECT RAISE(ABORT,'journal unavailable'); END;");admin.close()
    expect(()=>store.createDocument(workspace.id,'Must be atomic','body')).toThrow('journal unavailable')
    expect(store.listDocuments(workspace.id)).toEqual([]);expect(store.pendingSyncChanges(workspace.id)).toEqual([]);store.close()
  })

  it('journals chats, messages, memories, graph edges, and supported attachment metadata',()=>{
    const {root,store,workspace}=setup(),chat=store.captureChat(workspace.id,'Sync','hello'),document=store.createDocument(workspace.id,'Source','body'),memory=store.captureMemory(workspace.id,'Remember','fact',document.id),attachment=path.join(root,'note.md');writeFileSync(attachment,'attachment')
    store.addMessage(workspace.id,chat,'user','continued');store.addAttachment(workspace.id,document.id,'note.md','text/markdown',attachment)
    const pending=store.pendingSyncChanges(workspace.id),kinds=new Set(pending.map((change)=>change.objectKind));expect(kinds).toEqual(new Set(['chat','message','document','memory','relationship','attachment']));expect(pending.some((change)=>change.objectId===memory)).toBe(true)
    const relationshipId=pending.find((change)=>change.objectKind==='relationship')!.objectId,attachmentId=pending.find((change)=>change.objectKind==='attachment')!.objectId;store.deleteObject(workspace.id,'document',document.id);expect(store.syncHead(workspace.id,relationshipId)).toBeUndefined();expect(store.syncHead(workspace.id,attachmentId)).toBeUndefined();expect(store.syncHead(workspace.id,memory)).toMatchObject({operation:'upsert',payload:{sourceObjectId:null}});store.close()
  })

  it('records durable remote conflicts and deletion permanently dominates stale inbound changes',()=>{
    const {store,workspace}=setup();store.configureSyncDevice(workspace.id,'local-device');expect(store.syncStatus(workspace.id)).toMatchObject({setupStatus:'device_pending_keys',localDeviceId:'local-device'})
    const first=inbound({workspaceId:workspace.id,id:'a',deviceId:'mac',sequence:1,clock:{mac:1},payload:{body:'A'}}),second=inbound({workspaceId:workspace.id,id:'b',deviceId:'pc',sequence:1,clock:{pc:1},payload:{body:'B'}})
    expect(store.recordInboundSyncChange(first)).toBe('applied');expect(store.recordInboundSyncChange(second)).toBe('conflict');expect(store.syncStatus(workspace.id)).toMatchObject({conflicts:1,conflictVariants:2})
    const deletion=inbound({workspaceId:workspace.id,id:'delete',deviceId:'mac',sequence:2,clock:{mac:2,pc:1},operation:'delete',payload:{}});expect(store.recordInboundSyncChange(deletion)).toBe('applied')
    const stale=inbound({workspaceId:workspace.id,id:'stale',deviceId:'pc',sequence:2,clock:{pc:2},payload:{body:'resurrection'}});expect(store.recordInboundSyncChange(stale)).toBe('ignored');expect(store.syncStatus(workspace.id)).toMatchObject({conflicts:0,tombstones:1});store.close()
  })

  it('canonicalizes authored conflicts independent of arrival and clears them only with a causal resolver',()=>{
    const left=setup(),right=setup(),a=inbound({workspaceId:left.workspace.id,id:'a',deviceId:'mac',sequence:1,clock:{mac:1},payload:{body:'A'}}),b=inbound({workspaceId:left.workspace.id,id:'b',deviceId:'pc',sequence:1,clock:{pc:1},payload:{body:'B'}})
    left.store.recordInboundSyncChange(a);left.store.recordInboundSyncChange(b)
    right.store.recordInboundSyncChange({...b,workspaceId:right.workspace.id,envelopeId:'right-b'});right.store.recordInboundSyncChange({...a,workspaceId:right.workspace.id,envelopeId:'right-a'})
    expect(left.store.syncHead(left.workspace.id,'remote-doc')?.changeId).toBe('a');expect(right.store.syncHead(right.workspace.id,'remote-doc')?.changeId).toBe('a')
    const resolver=inbound({workspaceId:left.workspace.id,id:'resolved',deviceId:'mac',sequence:2,clock:{mac:2,pc:1},payload:{body:'resolved'}});expect(left.store.recordInboundSyncChange(resolver)).toBe('applied');expect(left.store.syncStatus(left.workspace.id)).toMatchObject({conflicts:0,conflictVariants:0});expect(left.store.syncHead(left.workspace.id,'remote-doc')?.payload).toEqual({body:'resolved'});left.store.close();right.store.close()
  })
  it('treats exact change retries as idempotent and rejects envelope or change identifier collisions',()=>{const{store,workspace}=setup(),original=inbound({workspaceId:workspace.id,id:'immutable',deviceId:'mac',sequence:1,clock:{mac:1},payload:{body:'original'}});expect(store.recordInboundSyncChange(original)).toBe('applied');expect(store.recordInboundSyncChange({...original,envelopeId:'retry-envelope'})).toBe('replay');expect(()=>store.recordInboundSyncChange({...original,envelopeId:'mutated-envelope',payload:{body:'changed'}})).toThrow('Change ID collision');expect(()=>store.recordInboundSyncChange({...original,id:'another-change',payload:{body:'changed'}})).toThrow('Envelope ID collision');expect(store.syncHead(workspace.id,'remote-doc')?.payload).toEqual({body:'original'});store.close()})

  it('keeps sync queues and device state outside portable workspace exports',()=>{const{store,workspace}=setup();store.createDocument(workspace.id,'Private','body');store.configureSyncDevice(workspace.id,'device-secret-boundary');const archive=store.exportWorkspace(workspace.id);expect(Object.keys(archive.objects).some((key)=>key.startsWith('sync_'))).toBe(false);expect(JSON.stringify(archive)).not.toContain('device-secret-boundary');store.close()})
})
