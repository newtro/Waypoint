import {describe,expect,it,vi} from 'vitest'
import {closesEditedDocumentAfterDelete,DebouncedAutosave} from './autosave.js'

type Draft={title:string;body:string}
const identity=(draft:Draft)=>JSON.stringify(draft)
describe('document autosave',()=>{
  it('keeps an unrelated edited note open when another object is deleted',()=>{
    expect(closesEditedDocumentAfterDelete('document','note-b','note-a')).toBe(false)
    expect(closesEditedDocumentAfterDelete('chat','chat-a','note-a')).toBe(false)
    expect(closesEditedDocumentAfterDelete('memory','memory-a','note-a')).toBe(false)
    expect(closesEditedDocumentAfterDelete('document','note-a','note-a')).toBe(true)
  })
  it('debounces rapid changes into one durable revision',async()=>{
    vi.useFakeTimers();const save=vi.fn(async()=>{}),states:string[]=[],autosave=new DebouncedAutosave(identity,500,(state)=>states.push(state))
    autosave.markPersisted({title:'A',body:'one'});autosave.schedule({title:'A',body:'two'},save);autosave.schedule({title:'A',body:'three'},save)
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1);expect(save).toHaveBeenCalledWith({title:'A',body:'three'});expect(states.at(-1)).toBe('saved');vi.useRealTimers()
  })
  it('flushes explicit save and does not duplicate an unchanged revision',async()=>{
    const save=vi.fn(async()=>{}),draft={title:'A',body:'changed'},autosave=new DebouncedAutosave(identity,500)
    autosave.schedule(draft,save);await autosave.flush(draft,save);await autosave.flush(draft,save)
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('reports a bounded error and permits retry',async()=>{
    const states:Array<[string,string|undefined]>=[],autosave=new DebouncedAutosave(identity,1,(state,error)=>states.push([state,error])),draft={title:'A',body:'changed'}
    await expect(autosave.flush(draft,async()=>{throw new Error('disk full')})).rejects.toThrow('disk full')
    expect(states.at(-1)).toEqual(['error','disk full']);await autosave.flush(draft,async()=>{});expect(states.at(-1)?.[0]).toBe('saved')
  })
  it('does not duplicate a revision when explicit save meets the same in-flight autosave',async()=>{
    vi.useFakeTimers();let release!:()=>void;const blocked=new Promise<void>((resolve)=>{release=resolve}),save=vi.fn(()=>blocked),draft={title:'A',body:'changed'},autosave=new DebouncedAutosave(identity,10)
    autosave.schedule(draft,save);await vi.advanceTimersByTimeAsync(10);const explicit=autosave.flush(draft,save);release();await explicit
    expect(save).toHaveBeenCalledTimes(1);vi.useRealTimers()
  })
  it('flushes a pending draft before navigation',async()=>{
    vi.useFakeTimers();const save=vi.fn(async()=>{}),draft={title:'A',body:'navigate safely'},autosave=new DebouncedAutosave(identity,900)
    autosave.schedule(draft,save);expect(autosave.hasPending()).toBe(true)
    await expect(autosave.flushPending(save)).resolves.toBe(true)
    expect(save).toHaveBeenCalledWith(draft);expect(autosave.hasPending()).toBe(false);await vi.runAllTimersAsync();expect(save).toHaveBeenCalledTimes(1);vi.useRealTimers()
  })
  it('keeps a failed navigation flush pending so navigation can be blocked and retried',async()=>{
    const draft={title:'A',body:'do not lose'},autosave=new DebouncedAutosave(identity,900);autosave.schedule(draft,async()=>{})
    await expect(autosave.flushPending(async()=>{throw new Error('disk full')})).rejects.toThrow('disk full')
    expect(autosave.hasPending()).toBe(true)
    const save=vi.fn(async()=>{});await autosave.flushPending(save);expect(save).toHaveBeenCalledWith(draft);expect(autosave.hasPending()).toBe(false)
  })
})
