import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { adapterArgs, CliWorkbench, CONSERVATIVE_PROFILE, parseEvent, validateRequest } from './ai-workbench.js'

class FakeChild extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough(); killed = false
  kill() { this.killed = true; queueMicrotask(() => this.emit('close', null)); return true }
}
const profile = { ...CONSERVATIVE_PROFILE, roots: ['/safe/workspace'] }

describe('AI workbench privilege boundary', () => {
  it('constructs conservative non-persistent CLI requests', () => {
    expect(adapterArgs('codex', 'hello')).toEqual(expect.arrayContaining(['--json','--ephemeral','--sandbox','read-only','--skip-git-repo-check']))
    expect(adapterArgs('claude', 'hello')).toEqual(expect.arrayContaining(['--verbose','--no-session-persistence','--safe-mode','--tools','','--permission-mode','dontAsk']))
    expect(adapterArgs('claude', 'hello')).not.toContain('--dangerously-skip-permissions')
    expect(adapterArgs('codex', 'private prompt')).not.toContain('private prompt')
    expect(adapterArgs('claude', 'private prompt')).not.toContain('private prompt')
    expect(adapterArgs('codex', 'image', undefined, ['/safe/workspace/map.png'])).toEqual(expect.arrayContaining(['--image','/safe/workspace/map.png']))
  })

  it('rejects image delivery to adapters without a real image path', async () => {
    const workbench = new CliWorkbench(vi.fn() as never, async()=>'/bin/claude')
    await expect(workbench.start('no-image',{cli:'claude',prompt:'x',workspaceRoot:'/safe/workspace',profile,imagePaths:['/safe/workspace/map.png']},()=>{})).rejects.toThrow(/does not support image/)
  })

  it('rejects roots, secrets, and recursive lineage outside the profile', () => {
    expect(() => validateRequest({ cli:'codex', prompt:'x', workspaceRoot:'/outside', profile })).toThrow(/outside/)
    expect(() => validateRequest({ cli:'codex', prompt:'x', workspaceRoot:'/safe/workspace', profile:{...profile,secretNames:['TOKEN']} })).toThrow(/secrets/)
    expect(() => validateRequest({ cli:'codex', prompt:'x', workspaceRoot:'/safe/workspace', profile, depth:2 })).toThrow(/depth/)
    expect(() => validateRequest({ cli:'codex', prompt:'x', workspaceRoot:'/safe/workspace', profile,maxOutputBytes:8_388_609 })).toThrow(/output budget/)
  })

  it('normalizes text, tool, and malformed output without treating output as authority', () => {
    expect(parseEvent('codex', JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'answer'}}))).toMatchObject({type:'text',text:'answer'})
    expect(parseEvent('claude', JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',name:'Read'}]}}))).toMatchObject({type:'tool',name:'Read'})
    expect(parseEvent('claude',JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'live'}}}))).toMatchObject({type:'text',text:'live'})
    expect(parseEvent('claude',JSON.stringify({type:'system',subtype:'init',model:'claude-sonnet'}))).toMatchObject({type:'diagnostic',name:'model: claude-sonnet'})
    expect(parseEvent('codex', 'not json')).toEqual({type:'diagnostic',text:'CLI emitted an unparseable event'})
  })

  it('uses exact resolved binary, minimized environment, streams, and completes', async () => {
    const child = new FakeChild(), events: unknown[] = []
    let capturedOptions: {env:NodeJS.ProcessEnv}|undefined
    const spawn = vi.fn((_file:string,_args:string[],options:{env:NodeJS.ProcessEnv}) => {capturedOptions=options;return child})
    const workbench = new CliWorkbench(spawn as never, async () => '/trusted/bin/codex')
    const running = await workbench.start('r1', {cli:'codex',prompt:'hello',workspaceRoot:'/safe/workspace',profile}, (event)=>events.push(event))
    child.stdout.write(`${JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}})}\n`); child.emit('close', 0)
    await expect(running.completion).resolves.toMatchObject({status:'completed',exitCode:0})
    expect(spawn).toHaveBeenCalledWith('/trusted/bin/codex', expect.any(Array), expect.objectContaining({cwd:'/safe/workspace',shell:false}))
    const environment = capturedOptions!.env
    expect(Object.keys(environment).sort()).toEqual(['HOME','LANG','NO_COLOR','PATH','USER'])
    expect(environment.PATH?.split(':')[0]).toBe('/trusted/bin')
    expect(child.stdin.read()?.toString()).toBe('hello')
    expect(events).toContainEqual(expect.objectContaining({type:'text',text:'done'}))
  })

  it('records failure, cancellation, and timeout as terminal outcomes', async () => {
    const failure = new FakeChild(); const failed = new CliWorkbench((() => failure) as never, async()=>'/bin/claude')
    const run = await failed.start('f', {cli:'claude',prompt:'x',workspaceRoot:'/safe/workspace',profile}, ()=>{})
    failure.stderr.write('authentication required'); failure.emit('close', 1)
    await expect(run.completion).resolves.toMatchObject({status:'failed',error:'authentication required'})

    const canceledChild = new FakeChild(); const canceled = new CliWorkbench((() => canceledChild) as never, async()=>'/bin/codex')
    const cancelRun = await canceled.start('c', {cli:'codex',prompt:'x',workspaceRoot:'/safe/workspace',profile}, ()=>{}); cancelRun.cancel()
    await expect(cancelRun.completion).resolves.toMatchObject({status:'canceled'})

    vi.useFakeTimers(); const timeoutChild = new FakeChild(); const timed = new CliWorkbench((() => timeoutChild) as never, async()=>'/bin/codex')
    const timeoutRun = await timed.start('t', {cli:'codex',prompt:'x',workspaceRoot:'/safe/workspace',profile,timeoutMs:10}, ()=>{}); await vi.advanceTimersByTimeAsync(11)
    await expect(timeoutRun.completion).resolves.toMatchObject({status:'timed_out'}); vi.useRealTimers()
  })
  it('terminates output at the receipt-specific byte budget',async()=>{const child=new FakeChild(),workbench=new CliWorkbench((()=>child) as never,async()=>'/bin/codex'),run=await workbench.start('limited',{cli:'codex',prompt:'x',workspaceRoot:'/safe/workspace',profile,maxOutputBytes:10},()=>{});child.stdout.write('12345678901');await expect(run.completion).resolves.toMatchObject({status:'failed',error:expect.stringContaining('10-byte')})})
  it('cancels and boundedly drains active children during shutdown',async()=>{
    const child=new FakeChild(),workbench=new CliWorkbench((()=>child) as never,async()=>'/bin/codex')
    await workbench.start('shutdown',{cli:'codex',prompt:'x',workspaceRoot:'/safe/workspace',profile},()=>{})
    await workbench.shutdown(50);expect(child.killed).toBe(true)
  })
})
