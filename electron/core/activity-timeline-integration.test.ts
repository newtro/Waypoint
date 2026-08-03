import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe,expect,it} from 'vitest'
import {WorkspaceStore} from './store.js'

function setup(){const root=mkdtempSync(path.join(tmpdir(),'waypoint-activity-')),store=new WorkspaceStore(path.join(root,'waypoint.sqlite')),workspace=store.createWorkspace('Personal',root);return{store,workspace}}

describe('unified activity timeline',()=>{
  it('is workspace scoped, filterable, bounded, linked, and content minimized',()=>{
    const{store,workspace}=setup(),other=store.createWorkspace('Other',path.join(workspace.localPath,'other')),chat=store.createChat(workspace.id,'Planning'),message=store.addMessage(workspace.id,chat,'user','private prompt needle'),document=store.createDocument(workspace.id,'Public label','private body needle')
    store.createMemory(other.id,'Other secret','cross-workspace needle')
    const all=store.listActivity(workspace.id)
    expect(all.some((item)=>item.objectId===chat&&item.objectTitle==='Planning'&&item.objectState==='available')).toBe(true)
    expect(all.some((item)=>item.objectId===message&&item.objectTitle==='Message in Planning')).toBe(true)
    expect(JSON.stringify(all)).not.toMatch(/private prompt needle|private body needle|cross-workspace needle|localPath/)
    expect(store.listActivity(workspace.id,{families:['content'],query:'document',limit:1})).toEqual([expect.objectContaining({objectId:document.id,family:'content'})])
    expect(store.listActivity(workspace.id,{limit:2})).toHaveLength(2)
    store.recordSyncActivity(workspace.id,'sync.completed',{status:'completed',deviceId:'private-device-id'})
    expect(store.listActivity(workspace.id,{families:['sync']})).toEqual([expect.objectContaining({family:'sync',action:'sync.completed',details:{}})])
    expect(()=>store.listActivity(workspace.id,{families:['invalid' as 'content']})).toThrow(/family/)
    expect(()=>store.listActivity(workspace.id,{limit:Number.NaN})).toThrow(/limit/)
    store.close()
  })

  it('retains content-free deletion evidence while marking the target unavailable',()=>{
    const{store,workspace}=setup(),document=store.createDocument(workspace.id,'Delete me','sensitive deletion body')
    store.deleteObject(workspace.id,'document',document.id)
    const event=store.listActivity(workspace.id).find((item)=>item.objectId===document.id&&item.action==='deleted')
    expect(event).toMatchObject({family:'lifecycle',objectState:'deleted',objectKind:'document'})
    expect(event?.objectTitle).toBeUndefined()
    expect(JSON.stringify(event)).not.toContain('sensitive deletion body')
    store.close()
  })
})
