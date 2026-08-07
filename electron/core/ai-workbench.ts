import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { cliExecutionEnvironment, cliProcessInvocation, resolveExecutable, type CliName } from '../../spikes/cli-capabilities.js'
import {redactToolText} from './tool-gateway.js'

export type RunStatus = 'queued'|'running'|'completed'|'failed'|'canceled'|'timed_out'
export type ExecutionEvent = { type: 'text'|'tool'|'agent'|'diagnostic'; text?: string; name?: string; rawType?: string }

export interface SecurityProfile {
  id: string; name: string; roots: string[]; filesystem: 'read-only'|'workspace-write'
  network: 'provider-only'|'disabled'; tools: string[]; maxDurationMs: number; maxConcurrency: number
  approval: 'always'|'on-write'; peerEligible: boolean; secretNames: string[]
}

export const CONSERVATIVE_PROFILE: SecurityProfile = {
  id: 'workspace-conservative-v1', name: 'Workspace — conservative', roots: [], filesystem: 'read-only',
  network: 'provider-only', tools: [], maxDurationMs: 120_000, maxConcurrency: 1,
  approval: 'always', peerEligible: false, secretNames: [],
}

export interface RunRequest {
  cli: CliName; prompt: string; workspaceRoot: string; profile: SecurityProfile; model?: string
  parentRunId?: string; depth?: number; timeoutMs?: number; executable?: string; version?: string; imagePaths?: string[]
  maxOutputBytes?: number
}

export interface RunningExecution {
  executable: string; version?: string; args: string[]; cancel(): void; completion: Promise<{ status: Exclude<RunStatus,'queued'|'running'>; exitCode: number|null; error?: string }>
}

type SpawnProcess = (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; shell: false; windowsHide: true }) => ChildProcessWithoutNullStreams
type InvocationResolver = typeof cliProcessInvocation

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function validateRequest(request: RunRequest): void {
  if (!request.prompt.trim() || request.prompt.length > 2_000_000) throw new Error('A bounded prompt is required')
  if (!path.isAbsolute(request.workspaceRoot)) throw new Error('Workspace root must be absolute')
  if (!request.profile.roots.length || !request.profile.roots.some((root) => isWithin(request.workspaceRoot, root))) throw new Error('Workspace root is outside the security profile')
  if ((request.depth ?? 0) > 1) throw new Error('Agent lineage depth exceeds the Phase 2 limit')
  if (request.profile.maxConcurrency !== 1) throw new Error('Phase 2 profiles must limit concurrency to one')
  if (request.profile.secretNames.length) throw new Error('Phase 2 does not inject secrets')
  if(request.maxOutputBytes!==undefined&&(!Number.isSafeInteger(request.maxOutputBytes)||request.maxOutputBytes<1||request.maxOutputBytes>8_388_608))throw new Error('Execution output budget is invalid')
}

export function adapterArgs(cli: CliName, _prompt: string, model?: string, imagePaths: string[] = []): string[] {
  if (cli === 'codex') return ['exec', '--json', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', ...imagePaths.flatMap((imagePath)=>['--image',imagePath]), ...(model ? ['--model', model] : []), '-']
  return ['-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '--no-session-persistence', '--safe-mode', '--tools', '', '--permission-mode', 'dontAsk', ...(model ? ['--model', model] : [])]
}

export function parseEvent(cli: CliName, line: string): ExecutionEvent {
  let value: Record<string, unknown>
  try { value = JSON.parse(line) as Record<string, unknown> } catch { return { type: 'diagnostic', text: 'CLI emitted an unparseable event' } }
  if (cli === 'codex') {
    const item = value.item as Record<string, unknown>|undefined
    if (item?.type === 'agent_message' && typeof item.text === 'string') return { type: 'text', text: item.text, rawType: String(value.type ?? '') }
    if (item?.type === 'command_execution') {const phase=String(value.type??'').includes('started')?'started':String(value.type??'').includes('completed')?'completed':'progress',exit=typeof item.exit_code==='number'?` · exit ${item.exit_code}`:'',output=typeof item.aggregated_output==='string'?redactToolText(item.aggregated_output).trim().slice(0,1000):undefined;return{type:'tool',name:`Command ${phase}${exit}`,text:output,rawType:String(value.type??'')}}
  } else {
    const streamEvent=value.event as Record<string,unknown>|undefined,delta=streamEvent?.delta as Record<string,unknown>|undefined
    if(streamEvent?.type==='content_block_delta'&&delta?.type==='text_delta'&&typeof delta.text==='string')return{type:'text',text:delta.text,rawType:'stream_event.content_block_delta'}
    if(value.type==='system'&&value.subtype==='init'&&typeof value.model==='string')return{type:'diagnostic',name:`model: ${value.model}`,rawType:'system.init'}
    const message = value.message as Record<string, unknown>|undefined
    const content = message?.content
    if (Array.isArray(content)) {
      const result = content.find((part) => typeof part === 'object' && part && (part as Record<string,unknown>).type === 'tool_result') as Record<string,unknown>|undefined
      if (result) return { type: 'tool', name: `Tool ${result.is_error===true?'failed':'completed'}`, text:typeof result.content==='string'?redactToolText(result.content).slice(0,1000):undefined, rawType:String(value.type??'') }
      const tool = content.find((part) => typeof part === 'object' && part && (part as Record<string,unknown>).type === 'tool_use') as Record<string,unknown>|undefined
      if (tool) return { type: 'tool', name: `${String(tool.name ?? 'tool')} started`, rawType: String(value.type ?? '') }
      const text = content.filter((part) => typeof part === 'object' && part && (part as Record<string,unknown>).type === 'text').map((part) => String((part as Record<string,unknown>).text ?? '')).join('')
      if (text) return { type: 'text', text, rawType: String(value.type ?? '') }
    }
  }
  return { type: 'diagnostic', rawType: String(value.type ?? 'unknown') }
}

export class CliWorkbench {
  private readonly active = new Map<string, RunningExecution>()
  constructor(
    private readonly spawnProcess: SpawnProcess = spawn as SpawnProcess,
    private readonly resolver = resolveExecutable,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly invocationResolver: InvocationResolver = cliProcessInvocation,
  ) {}

  async start(runId: string, request: RunRequest, onEvent: (event: ExecutionEvent) => void): Promise<RunningExecution> {
    validateRequest(request)
    if (this.active.size >= request.profile.maxConcurrency) throw new Error('Execution concurrency limit reached')
    const executable = request.executable ?? await this.resolver(request.cli)
    if (!executable) throw new Error(`${request.cli} CLI was not found on PATH`)
    if (!path.isAbsolute(executable)) throw new Error('Resolved CLI path must be absolute')
    if(request.imagePaths?.some((imagePath)=>!path.isAbsolute(imagePath)))throw new Error('Attachment image paths must be absolute')
    if(request.cli!=='codex'&&request.imagePaths?.length)throw new Error(`${request.cli} adapter does not support image delivery`)
    const args = adapterArgs(request.cli, request.prompt, request.model, request.imagePaths)
    const environment = cliExecutionEnvironment(executable, process.env, this.platform),
      invocation = await this.invocationResolver(request.cli, executable, args, { platform: this.platform })
    const child = this.spawnProcess(invocation.executable, invocation.args, { cwd: path.resolve(request.workspaceRoot), env: environment, shell: false, windowsHide: true })
    let settled = false, canceled = false, timedOut = false, outputLimited = false, stderr = '', buffer = '', outputBytes = 0
    const timeoutMs = Math.min(request.timeoutMs ?? request.profile.maxDurationMs, request.profile.maxDurationMs)
    let forceTimer: NodeJS.Timeout|undefined
    const finishSignal = () => { if (!settled) { child.kill('SIGTERM'); forceTimer??=setTimeout(()=>{if(!settled)child.kill('SIGKILL')},2_000) } }
    const timer = setTimeout(() => { timedOut = true; finishSignal() }, timeoutMs)
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdin.end(request.prompt)
    const maxOutputBytes=request.maxOutputBytes??8_388_608
    child.stdout.on('data', (chunk: string) => { outputBytes += Buffer.byteLength(chunk); if (outputBytes > maxOutputBytes) { outputLimited = true; finishSignal(); return }; buffer += chunk; const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''; for (const line of lines) if (line.trim()) onEvent(parseEvent(request.cli, line)) })
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-8_192) })
    const completion = new Promise<{ status: Exclude<RunStatus,'queued'|'running'>; exitCode: number|null; error?: string }>((resolve) => {
      child.once('error', (error) => { if (settled) return; settled = true; clearTimeout(timer);if(forceTimer)clearTimeout(forceTimer); this.active.delete(runId); resolve({ status: 'failed', exitCode: null, error: error.message }) })
      child.once('close', (code) => { if (settled) return; settled = true; clearTimeout(timer);if(forceTimer)clearTimeout(forceTimer); this.active.delete(runId); if (buffer.trim() && !outputLimited) onEvent(parseEvent(request.cli, buffer)); const status = timedOut ? 'timed_out' : canceled ? 'canceled' : outputLimited ? 'failed' : code === 0 ? 'completed' : 'failed'; resolve({ status, exitCode: code, error: outputLimited ? `CLI output exceeded the ${maxOutputBytes}-byte execution budget` : status === 'failed' ? (stderr.trim() || `CLI exited with code ${code}`) : undefined }) })
    })
    const running: RunningExecution = { executable, version:request.version, args, cancel: () => { canceled = true; finishSignal() }, completion }
    this.active.set(runId, running)
    return running
  }

  cancel(runId: string): boolean { const run = this.active.get(runId); if (!run) return false; run.cancel(); return true }
  cancelAll():void{for(const run of this.active.values())run.cancel()}
  async shutdown(graceMs=2_500):Promise<void>{
    const completions=[...this.active.values()].map((run)=>run.completion)
    this.cancelAll()
    if(!completions.length)return
    await Promise.race([Promise.allSettled(completions),new Promise<void>((resolve)=>setTimeout(resolve,graceMs))])
  }
}
