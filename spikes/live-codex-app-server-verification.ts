import path from 'node:path'
import { CodexAppServerWorkbench, type CodexRunRequest } from '../electron/core/codex-app-server.js'
import type { ExecutionEvent } from '../electron/core/ai-workbench.js'

const root=path.resolve(process.cwd()),events:ExecutionEvent[]=[],sessions:string[]=[]
const workbench=new CodexAppServerWorkbench()
const base:Omit<CodexRunRequest,'prompt'|'providerSessionId'>={
  cli:'codex',
  workspaceRoot:root,
  profile:{id:'live-read-only',name:'Chat · read only',roots:[root],filesystem:'read-only',network:'provider-only',tools:['provider-native'],maxDurationMs:120_000,maxConcurrency:1,approval:'always',peerEligible:false,secretNames:[]},
  onSession:(id)=>sessions.push(id),
  onApproval:async()=>({status:'declined' as const,decision:{reason:'live_read_only_probe'}}),
}
const first=await workbench.start(`live-first-${Date.now()}`,{...base,prompt:'Remember the token WAYPOINT_CODEX_APP_SERVER_OK. Reply with exactly STORED and do not call tools.'},(event)=>events.push(event)),firstTerminal=await first.completion
const secondEvents:ExecutionEvent[]=[],second=await workbench.start(`live-resume-${Date.now()}`,{...base,prompt:'Reply with exactly the token I asked you to remember in the previous turn. Do not call tools.',providerSessionId:sessions[0]},(event)=>secondEvents.push(event)),terminal=await second.completion,text=secondEvents.filter((event)=>event.type==='text').map((event)=>event.text??'').join('')
const result={firstTerminal,terminal,sessionId:sessions[0],resumedSessionId:sessions[1],text,eventTypes:secondEvents.map((event)=>event.rawType??event.type)}
console.log(JSON.stringify(result,null,2))
if(firstTerminal.status!=='completed'||terminal.status!=='completed'||!sessions[0]||sessions[1]!==sessions[0]||!text.includes('WAYPOINT_CODEX_APP_SERVER_OK'))process.exitCode=1
