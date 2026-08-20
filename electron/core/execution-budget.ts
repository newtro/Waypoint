import {createHash} from 'node:crypto'
import type {SecurityProfile} from './ai-workbench.js'

export const EXECUTION_BUDGET_VERSION=2 as const
export interface ExecutionBudgetReceipt{version:1|2;kind:'root'|'child';approvalOrigin:'explicit-chat-action'|'explicit-delegate-action';device:'local';maxPromptBytes:number;maxOutputBytes:number;maxDurationMs:number;providerNativeLimits?:true;maxConcurrency:1;maxDepth:1;maxChildren:number;maxAttempts:1;maxAttachments:number;fallbackAllowed:false;externalCostAllowed:false;peerAllowed:false;profileDigest:string}
export function securityProfileDigest(profile:SecurityProfile):string{return createHash('sha256').update(JSON.stringify({id:profile.id,roots:profile.roots,filesystem:profile.filesystem,network:profile.network,tools:profile.tools,approval:profile.approval,maxDurationMs:profile.maxDurationMs,maxConcurrency:profile.maxConcurrency,peerEligible:profile.peerEligible,secretNames:profile.secretNames})).digest('hex')}
function isBoundedLocalProfile(profile:SecurityProfile):boolean{
  if(profile.maxConcurrency!==1||!Number.isSafeInteger(profile.maxDurationMs)||profile.maxDurationMs<1||profile.maxDurationMs>120_000||profile.secretNames.length||profile.peerEligible)return false
  const exact=(expected:string[])=>profile.tools.length===expected.length&&[...profile.tools].sort().every((tool,index)=>tool===[...expected].sort()[index])
  const chat=profile.filesystem==='read-only'&&profile.network==='provider-only'&&profile.approval==='always'&&exact(['provider-native'])
  const developer=profile.filesystem==='workspace-write'&&profile.network==='provider-only'&&profile.approval==='on-write'&&exact(['provider-native','terminal','local-cli','mcp','skills','subagents'])
  const full=profile.filesystem==='workspace-write'&&profile.network==='enabled'&&profile.approval==='on-write'&&exact(['provider-native','terminal','local-cli','mcp','skills','subagents','web','browser','waypoint'])
  const bypass=profile.name==='Bypass permissions · no prompts'&&profile.filesystem==='workspace-write'&&profile.network==='enabled'&&profile.approval==='never'&&exact(['provider-native','terminal','local-cli','mcp','skills','subagents','web','browser','waypoint'])
  return chat||developer||full||bypass
}
export function createExecutionBudget(input:{kind:'root'|'child';profile:SecurityProfile;prompt:string;attachmentCount:number}):ExecutionBudgetReceipt{
  const child=input.kind==='child'
  if(!isBoundedLocalProfile(input.profile))throw new Error('Security profile exceeds the local execution budget boundary')
  if(!Number.isSafeInteger(input.attachmentCount)||input.attachmentCount<0)throw new Error('Attachment count is invalid')
  if(!input.prompt.trim())throw new Error('A prompt is required')
  const profileDigest=securityProfileDigest(input.profile)
  return{version:EXECUTION_BUDGET_VERSION,kind:input.kind,approvalOrigin:child?'explicit-delegate-action':'explicit-chat-action',device:'local',maxPromptBytes:0,maxOutputBytes:0,maxDurationMs:0,providerNativeLimits:true,maxConcurrency:1,maxDepth:1,maxChildren:child?0:1,maxAttempts:1,maxAttachments:0,fallbackAllowed:false,externalCostAllowed:false,peerAllowed:false,profileDigest}
}
export function serializeExecutionBudget(receipt:ExecutionBudgetReceipt):string{return JSON.stringify(receipt)}
export function parseExecutionBudget(value:unknown):ExecutionBudgetReceipt|undefined{if(typeof value!=='string'||value.length>2_000)return;try{const item=JSON.parse(value) as Partial<ExecutionBudgetReceipt>,child=item.kind==='child',native=item.providerNativeLimits===true,integers=[item.maxPromptBytes,item.maxOutputBytes,item.maxDurationMs,item.maxChildren,item.maxAttachments],common=(item.version===1||item.version===2)&&(child||item.kind==='root')&&item.approvalOrigin===(child?'explicit-delegate-action':'explicit-chat-action')&&item.device==='local'&&item.maxConcurrency===1&&item.maxDepth===1&&item.maxAttempts===1&&item.fallbackAllowed===false&&item.externalCostAllowed===false&&item.peerAllowed===false&&!integers.some((number)=>!Number.isSafeInteger(number)||Number(number)<0)&&item.maxChildren===(child?0:1)&&/^[a-f0-9]{64}$/.test(String(item.profileDigest));if(!common)return;if(item.version===2){if(!native||item.maxPromptBytes!==0||item.maxOutputBytes!==0||item.maxDurationMs!==0||item.maxAttachments!==0)return}else if(item.maxPromptBytes!==(child?512*1024:2_000_000)||item.maxOutputBytes!==(native?0:child?2*1024*1024:8*1024*1024)||(native?item.maxDurationMs!==0:item.maxDurationMs!<1||item.maxDurationMs!>(child?60_000:120_000))||item.maxAttachments!==(child?0:20))return;return item as ExecutionBudgetReceipt}catch{return}}
