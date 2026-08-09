import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import {createHash} from 'node:crypto'
import {existsSync,mkdtempSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { adapterArgs, CliWorkbench, CONSERVATIVE_PROFILE, parseEvent, validateRequest } from './ai-workbench.js'

class FakeChild extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough(); killed = false
  kill() { this.killed = true; queueMicrotask(() => this.emit('close', null)); return true }
}
const workspaceRoot = path.resolve('/safe/workspace'), workspaceImage = path.resolve('build/icons/waypoint.png'), imageBytes=readFileSync(workspaceImage), image={path:workspaceImage,name:'waypoint.png',mediaType:'image/png' as const,sha256:createHash('sha256').update(imageBytes).digest('hex')}
const profile = { ...CONSERVATIVE_PROFILE, roots: [workspaceRoot] }

describe('AI workbench privilege boundary', () => {
  it('constructs conservative non-persistent CLI requests', () => {
    expect(adapterArgs('codex', 'hello')).toEqual(expect.arrayContaining(['--json','--ephemeral','--sandbox','read-only','--skip-git-repo-check']))
    expect(adapterArgs('claude', 'hello')).toEqual(expect.arrayContaining(['--verbose','--no-session-persistence','--safe-mode','--tools','','--permission-mode','dontAsk']))
    expect(adapterArgs('claude', 'hello')).not.toContain('--dangerously-skip-permissions')
    expect(adapterArgs('codex', 'private prompt')).not.toContain('private prompt')
    expect(adapterArgs('claude', 'private prompt')).not.toContain('private prompt')
    expect(adapterArgs('codex', 'image', undefined, [image])).toEqual(expect.arrayContaining(['--image',workspaceImage]))
  })

  it('delivers Claude images as structured stdin without enabling a filesystem tool or exposing a path', async () => {
    const child=new FakeChild(),spawn=vi.fn(()=>child),workbench = new CliWorkbench(spawn as never, async()=>'/bin/claude'),running=await workbench.start('claude-image',{cli:'claude',prompt:'inspect',workspaceRoot,profile,images:[image]},()=>{})
    const args=(spawn.mock.calls[0] as unknown as [string,string[]])[1],input=child.stdin.read()?.toString()??''
    expect(args).toEqual(expect.arrayContaining(['--input-format','stream-json','--tools','']))
    expect(args).not.toContain(workspaceImage)
    expect(input).not.toContain(workspaceImage)
    expect(JSON.parse(input)).toMatchObject({type:'user',message:{role:'user',content:[{type:'text',text:'inspect'},{type:'image',source:{type:'base64',media_type:'image/png'}}]}})
    child.emit('close',0);await expect(running.completion).resolves.toMatchObject({status:'completed'})
  })

  it('gives Codex an immutable run-scoped image snapshot and removes it at terminal state',async()=>{
    const root=mkdtempSync(path.join(tmpdir(),'waypoint-codex-image-')),child=new FakeChild(),workbench=new CliWorkbench((()=>child)as never,async()=>'/bin/codex'),running=await workbench.start('codex-image',{cli:'codex',prompt:'inspect',workspaceRoot:root,profile:{...profile,roots:[root]},images:[image]},()=>{}),imageArg=running.args[running.args.indexOf('--image')+1]
    expect(imageArg).not.toBe(workspaceImage);expect(imageArg).toContain('.waypoint-cli-images-');expect(readFileSync(imageArg)).toEqual(imageBytes)
    child.emit('close',0);await expect(running.completion).resolves.toMatchObject({status:'completed'});expect(existsSync(imageArg)).toBe(false)
  })

  it('revalidates caller-owned delivery authority after async invocation resolution and immediately before spawn',async()=>{
    const order:string[]=[],child=new FakeChild(),workbench=new CliWorkbench((()=>{order.push('spawn');return child})as never,async()=>'/bin/codex',process.platform,(async(_name:string,_executable:string,args:string[])=>{order.push('resolve');await Promise.resolve();return{executable:'/bin/codex',args}})as never),running=await workbench.start('revalidate',{cli:'codex',prompt:'inspect',workspaceRoot,profile,beforeSpawn:()=>order.push('revalidate')},()=>{})
    expect(order).toEqual(['resolve','revalidate','spawn']);child.emit('close',0);await running.completion
  })

  it('rejects forged image metadata before process launch', async () => {
    const spawn=vi.fn(),workbench = new CliWorkbench(spawn as never, async()=>'/bin/claude')
    await expect(workbench.start('bad-image',{cli:'claude',prompt:'x',workspaceRoot,profile,images:[{...image,sha256:'0'.repeat(64)}]},()=>{})).rejects.toThrow(/integrity/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rejects roots, secrets, and recursive lineage outside the profile', () => {
    expect(() => validateRequest({ cli:'codex', prompt:'x', workspaceRoot:path.resolve('/outside'), profile })).toThrow(/outside/)
    expect(() => validateRequest({ cli:'codex', prompt:'x', workspaceRoot, profile:{...profile,secretNames:['TOKEN']} })).toThrow(/secrets/)
    expect(() => validateRequest({ cli:'codex', prompt:'x', workspaceRoot, profile, depth:2 })).toThrow(/depth/)
    expect(() => validateRequest({ cli:'codex', prompt:'x', workspaceRoot, profile,maxOutputBytes:8_388_609 })).toThrow(/output budget/)
  })

  it('normalizes text, tool, and malformed output without treating output as authority', () => {
    expect(parseEvent('codex', JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'answer'}}))).toMatchObject({type:'text',text:'answer'})
    expect(parseEvent('claude', JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',name:'Read'}]}}))).toMatchObject({type:'tool',name:'Read started'})
    expect(parseEvent('claude',JSON.stringify({type:'user',message:{content:[{type:'tool_result',content:'ok'}]}}))).toMatchObject({type:'tool',name:'Tool completed',text:'ok'})
    expect(parseEvent('claude',JSON.stringify({type:'user',message:{content:[{type:'text',text:'ignored'},{type:'tool_result',is_error:true,content:'token=hidden'}]}}))).toMatchObject({type:'tool',name:'Tool failed',text:'token=[REDACTED]'})
    expect(parseEvent('claude',JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'live'}}}))).toMatchObject({type:'text',text:'live'})
    expect(parseEvent('claude',JSON.stringify({type:'system',subtype:'init',model:'claude-sonnet'}))).toMatchObject({type:'diagnostic',name:'model: claude-sonnet'})
    expect(parseEvent('codex', 'not json')).toEqual({type:'diagnostic',text:'CLI emitted an unparseable event'})
  })

  it('uses exact resolved binary, minimized environment, streams, and completes', async () => {
    const child = new FakeChild(), events: unknown[] = []
    let capturedOptions: {env:NodeJS.ProcessEnv}|undefined
    const spawn = vi.fn((_file:string,_args:string[],options:{env:NodeJS.ProcessEnv}) => {capturedOptions=options;return child})
    const workbench = new CliWorkbench(spawn as never, async () => '/trusted/bin/codex')
    const running = await workbench.start('r1', {cli:'codex',prompt:'hello',workspaceRoot,profile}, (event)=>events.push(event))
    child.stdout.write(`${JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}})}\n`); child.emit('close', 0)
    await expect(running.completion).resolves.toMatchObject({status:'completed',exitCode:0})
    expect(spawn).toHaveBeenCalledWith('/trusted/bin/codex', expect.any(Array), expect.objectContaining({cwd:workspaceRoot,shell:false}))
    const environment = capturedOptions!.env
    expect(environment).toMatchObject({HOME:expect.any(String),LANG:expect.any(String),NO_COLOR:'1',PATH:expect.any(String),USER:expect.any(String)})
    expect(environment).not.toHaveProperty('OPENAI_API_KEY')
    expect(environment.PATH?.split(path.delimiter)[0]).toBe(path.dirname('/trusted/bin/codex'))
    expect(child.stdin.read()?.toString()).toBe('hello')
    expect(events).toContainEqual(expect.objectContaining({type:'text',text:'done'}))
  })

  it('executes a resolved Windows npm shim through its package entrypoint while retaining the exact CLI path as provenance', async () => {
    const child = new FakeChild(), spawn = vi.fn(() => child)
    const invocation = vi.fn(async (_name, _executable, args) => ({
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js', ...args],
    }))
    const workbench = new CliWorkbench(spawn as never, async () => 'C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd', 'win32', invocation as never)
    const running = await workbench.start('windows-cmd', {cli:'codex',prompt:'hello',workspaceRoot,profile}, ()=>{})
    expect(spawn).toHaveBeenCalledWith(expect.stringMatching(/node\.exe$/i), expect.arrayContaining([
      'C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js', 'exec',
    ]), expect.objectContaining({cwd:workspaceRoot,shell:false}))
    expect(running.executable).toBe('C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd')
    expect(invocation).toHaveBeenCalledWith('codex', 'C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd', expect.arrayContaining(['exec']), { platform: 'win32' })
    child.emit('close', 0)
    await expect(running.completion).resolves.toMatchObject({status:'completed'})
  })

  it('records failure, cancellation, and timeout as terminal outcomes', async () => {
    const failure = new FakeChild(); const failed = new CliWorkbench((() => failure) as never, async()=>'/bin/claude')
    const run = await failed.start('f', {cli:'claude',prompt:'x',workspaceRoot,profile}, ()=>{})
    failure.stderr.write('authentication required'); failure.emit('close', 1)
    await expect(run.completion).resolves.toMatchObject({status:'failed',error:'authentication required'})

    const canceledChild = new FakeChild(); const canceled = new CliWorkbench((() => canceledChild) as never, async()=>'/bin/codex')
    const cancelRun = await canceled.start('c', {cli:'codex',prompt:'x',workspaceRoot,profile}, ()=>{}); cancelRun.cancel()
    await expect(cancelRun.completion).resolves.toMatchObject({status:'canceled'})

    vi.useFakeTimers(); const timeoutChild = new FakeChild(); const timed = new CliWorkbench((() => timeoutChild) as never, async()=>'/bin/codex')
    const timeoutRun = await timed.start('t', {cli:'codex',prompt:'x',workspaceRoot,profile,timeoutMs:10}, ()=>{}); await vi.advanceTimersByTimeAsync(11)
    await expect(timeoutRun.completion).resolves.toMatchObject({status:'timed_out'}); vi.useRealTimers()
  })
  it('terminates output at the receipt-specific byte budget',async()=>{const child=new FakeChild(),workbench=new CliWorkbench((()=>child) as never,async()=>'/bin/codex'),run=await workbench.start('limited',{cli:'codex',prompt:'x',workspaceRoot,profile,maxOutputBytes:10},()=>{});child.stdout.write('12345678901');await expect(run.completion).resolves.toMatchObject({status:'failed',error:expect.stringContaining('10-byte')})})
  it('cancels and boundedly drains active children during shutdown',async()=>{
    const child=new FakeChild(),workbench=new CliWorkbench((()=>child) as never,async()=>'/bin/codex')
    await workbench.start('shutdown',{cli:'codex',prompt:'x',workspaceRoot,profile},()=>{})
    await workbench.shutdown(50);expect(child.killed).toBe(true)
  })
})
