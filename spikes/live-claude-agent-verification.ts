import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {resolveExecutable} from './cli-capabilities.js'
import {ClaudeAgentWorkbench} from '../electron/core/claude-agent-sdk.js'
import type {SecurityProfile} from '../electron/core/ai-workbench.js'

const root=mkdtempSync(path.join(tmpdir(),'waypoint-claude-agent-')),repo=path.join(root,'repo');mkdirSync(repo)
const executable=await resolveExecutable('claude');if(!executable)throw new Error('Claude CLI unavailable')
const profile:SecurityProfile={id:'developer',name:'Developer · approve changes',roots:[repo],filesystem:'workspace-write',network:'disabled',tools:['shell','files','skills','mcp'],maxDurationMs:120_000,maxConcurrency:1,approval:'on-write',peerEligible:false,secretNames:[]}
const workbench=new ClaudeAgentWorkbench();let session:string|undefined
try{
  const first=await workbench.start('first',{cli:'claude',prompt:'Create WAYPOINT_CLAUDE_LIVE.txt containing exactly CLAUDE_LIVE_OK. Do not change anything else.',workspaceRoot:repo,profile,executable,version:'2.1.221',onSession:(value)=>{session=value},onApproval:async(request)=>{if(request.kind!=='file_change')return{status:'declined',decision:{}};return{status:'accepted',decision:{scope:'once'}}}},event=>{if(event.type==='text')process.stdout.write(event.text??'')})
  const firstResult=await first.completion;if(firstResult.status!=='completed')throw new Error(`First run ${firstResult.status}: ${firstResult.error??'unknown'}`)
  const file=path.join(repo,'WAYPOINT_CLAUDE_LIVE.txt');if(readFileSync(file,'utf8').trim()!=='CLAUDE_LIVE_OK')throw new Error('Claude write proof mismatch')
  if(!session)throw new Error('Claude session ID missing')
  let answer='';const second=await workbench.start('second',{cli:'claude',prompt:'Read WAYPOINT_CLAUDE_LIVE.txt and reply with only its exact contents.',workspaceRoot:repo,profile,executable,version:'2.1.221',providerSessionId:session,onSession:(value)=>{if(value!==session)throw new Error('Claude session did not resume exact ID')},onApproval:async()=>({status:'declined',decision:{}})},event=>{if(event.type==='text'&&event.rawType==='claude.result')answer=event.text??''})
  const secondResult=await second.completion;if(secondResult.status!=='completed'||answer.trim()!=='CLAUDE_LIVE_OK')throw new Error(secondResult.error??`Resume proof mismatch: ${answer}`)
  console.log(JSON.stringify({ok:true,session,write:'CLAUDE_LIVE_OK',resume:answer.trim()}))
}finally{await workbench.shutdown();try{rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200})}catch(error){console.error('Disposable cleanup failed',error)}}
