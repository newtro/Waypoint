import {existsSync,mkdtempSync,renameSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe,expect,it} from 'vitest'
import {WorkspaceStore} from './store.js'

const webm=Buffer.from([0x1a,0x45,0xdf,0xa3,1,2,3])
function setup(){const root=mkdtempSync(path.join(tmpdir(),'waypoint-meeting-')),store=new WorkspaceStore(path.join(root,'waypoint.sqlite')),workspace=store.createWorkspace('Personal',root);return{root,store,workspace}}

describe('local meeting lifecycle',()=>{
  it('persists local audio, requires transcript review, exports source-owned knowledge, and hard deletes the cascade',()=>{
    const{store,workspace}=setup(),meeting=store.createMeeting(workspace.id,'Private planning')
    store.finalizeMeetingAudio(workspace.id,meeting,'audio/webm',webm)
    expect(store.listMeetings(workspace.id)[0]).toMatchObject({id:meeting,status:'ready',bytes:webm.length,transcriptStatus:'none',speakerHandling:'uncertain'})
    expect(store.meetingAudio(workspace.id,meeting).mediaType).toBe('audio/webm')
    store.updateMeetingTranscript(workspace.id,meeting,'Speaker 1?: private transcript',false)
    expect(()=>store.saveMeetingTranscriptToMemory(workspace.id,meeting)).toThrow(/Review/)
    store.updateMeetingTranscript(workspace.id,meeting,'Speaker 1?: private transcript',true)
    const memory=store.saveMeetingTranscriptToMemory(workspace.id,meeting)
    expect(store.listMemories(workspace.id)).toEqual([expect.objectContaining({id:memory,sourceObjectId:meeting,ownership:'source-owned'})])
    store.updateMeetingTranscript(workspace.id,meeting,'Speaker 1?: corrected transcript',true);expect(store.saveMeetingTranscriptToMemory(workspace.id,meeting)).toBe(memory);expect(store.listMemories(workspace.id)[0]).toMatchObject({id:memory,body:'Speaker 1?: corrected transcript'})
    store.queueFullSyncSnapshot(workspace.id);expect(store.pendingSyncChanges(workspace.id).some((change)=>change.objectId===memory||JSON.stringify(change).includes('corrected transcript'))).toBe(false)
    store.deleteMeeting(workspace.id,meeting)
    expect(store.listMeetings(workspace.id)).toEqual([])
    expect(store.listMemories(workspace.id)).toEqual([])
    expect(()=>store.meetingAudio(workspace.id,meeting)).toThrow()
    expect(JSON.stringify(store.listActivity(workspace.id))).not.toContain('private transcript')
    store.close()
  })

  it('isolates workspaces, rejects malformed audio, and reconciles interrupted capture without media',()=>{
    const{root,store,workspace}=setup(),other=store.createWorkspace('Other',path.join(root,'other')),meeting=store.createMeeting(workspace.id,'Interrupted')
    expect(()=>store.finalizeMeetingAudio(other.id,meeting,'audio/webm',webm)).toThrow(/not found/)
    expect(()=>store.finalizeMeetingAudio(workspace.id,meeting,'audio/webm',Buffer.from('not audio'))).toThrow(/signature/)
    store.close();const reopened=new WorkspaceStore(path.join(root,'waypoint.sqlite'))
    expect(reopened.listMeetings(workspace.id)[0]).toMatchObject({status:'failed',failureCode:'interrupted',bytes:0})
    reopened.close()
  })

  it('exports and restores audio, transcript provenance, and local-only meeting state',()=>{
    const{root,store,workspace}=setup(),meeting=store.createMeeting(workspace.id,'Portable');store.finalizeMeetingAudio(workspace.id,meeting,'audio/webm',webm);store.updateMeetingTranscript(workspace.id,meeting,'Speaker 1?: reviewed',true);store.saveMeetingTranscriptToMemory(workspace.id,meeting)
    const archive=store.exportWorkspace(workspace.id),restored=store.restoreWorkspace(archive,'Restored',path.join(root,'restored')),restoredMeeting=store.listMeetings(restored.id)[0]
    expect(restoredMeeting).toMatchObject({title:'Portable',status:'ready',transcript:'Speaker 1?: reviewed',transcriptStatus:'reviewed',bytes:webm.length})
    expect(store.meetingAudio(restored.id,restoredMeeting.id).mediaType).toBe('audio/webm')
    expect(store.listMemories(restored.id)[0]).toMatchObject({sourceObjectId:restoredMeeting.id,ownership:'source-owned'})
    store.close()
  })

  it('reconciles staged and orphan meeting files and detects retained-media tampering',()=>{
    const{root,store,workspace}=setup(),meeting=store.createMeeting(workspace.id,'Crash recovery');store.finalizeMeetingAudio(workspace.id,meeting,'audio/webm',webm);const audio=store.meetingAudio(workspace.id,meeting),staged=`${audio.path}.deleting-12345678-1234-4123-8123-123456789abc`;renameSync(audio.path,staged);writeFileSync(path.join(root,'meeting-audio','orphan.webm'),webm);store.close();const reopened=new WorkspaceStore(path.join(root,'waypoint.sqlite'));expect(existsSync(audio.path)).toBe(true);expect(existsSync(staged)).toBe(false);expect(existsSync(path.join(root,'meeting-audio','orphan.webm'))).toBe(false);writeFileSync(audio.path,Buffer.from([0x1a,0x45,0xdf,0xa3,9]));expect(()=>reopened.meetingAudio(workspace.id,meeting)).toThrow(/integrity/);expect(reopened.localDiagnostics(workspace.id).digestMismatches).toBe(1);reopened.close()
  })
})
