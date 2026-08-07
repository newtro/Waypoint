import {createHash} from 'node:crypto'
import type {SecurityProfile} from './ai-workbench.js'

export const EXECUTION_BUDGET_VERSION=1 as const
export interface ExecutionBudgetReceipt{version:1;kind:'root'|'child';approvalOrigin:'explicit-chat-action'|'explicit-delegate-action';device:'local';maxPromptBytes:number;maxOutputBytes:number;maxDurationMs:number;maxConcurrency:1;maxDepth:1;maxChildren:number;maxAttempts:1;maxAttachments:number;fallbackAllowed:false;externalCostAllowed:false;peerAllowed:false;profileDigest:string}
export function securityProfileDigest(profile:SecurityProfile):string{return createHash('sha256').update(JSON.stringify({id:profile.id,roots:profile.roots,filesystem:profile.filesystem,network:profile.network,tools:profile.tools,approval:profile.approval,maxDurationMs:profile.maxDurationMs,maxConcurrency:profile.maxConcurrency,peerEligible:profile.peerEligible,secretNames:profile.secretNames})).digest('hex')}
function isBoundedLocalProfile(profile:SecurityProfile):boolean{
  if(profile.maxConcurrency!==1||!Number.isSafeInteger(profile.maxDurationMs)||profile.maxDurationMs<1||profile.maxDurationMs>120_000||profile.secretNames.length||profile.peerEligible||profile.network!=='provider-only')return false
  const conservative=profile.filesystem==='read-only'&&profile.approval==='always'&&profile.tools.length===0
  const autonomousTools=['local-cli','terminal','tool-gateway']
  const autonomous=profile.filesystem==='workspace-write'&&profile.approval==='on-write'&&profile.tools.length===autonomousTools.length&&[...profile.tools].sort().every((tool,index)=>tool===autonomousTools[index])
  return conservative||autonomous
}
export function createExecutionBudget(input:{kind:'root'|'child';profile:SecurityProfile;prompt:string;attachmentCount:number}):ExecutionBudgetReceipt{
  const child=input.kind==='child',maxPromptBytes=child?512*1024:2_000_000,maxAttachments=child?0:20,maxOutputBytes=child?2*1024*1024:8*1024*1024
  if(!isBoundedLocalProfile(input.profile))throw new Error('Security profile exceeds the local execution budget boundary')
  if(input.attachmentCount<0||input.attachmentCount>maxAttachments)throw new Error('Attachment count exceeds the execution budget')
  if(Buffer.byteLength(input.prompt,'utf8')>maxPromptBytes)throw new Error('Prompt exceeds the execution byte budget')
  const profileDigest=securityProfileDigest(input.profile)
  return{version:EXECUTION_BUDGET_VERSION,kind:input.kind,approvalOrigin:child?'explicit-delegate-action':'explicit-chat-action',device:'local',maxPromptBytes,maxOutputBytes,maxDurationMs:Math.min(input.profile.maxDurationMs,child?60_000:120_000),maxConcurrency:1,maxDepth:1,maxChildren:child?0:1,maxAttempts:1,maxAttachments,fallbackAllowed:false,externalCostAllowed:false,peerAllowed:false,profileDigest}
}
export function serializeExecutionBudget(receipt:ExecutionBudgetReceipt):string{return JSON.stringify(receipt)}
export function parseExecutionBudget(value:unknown):ExecutionBudgetReceipt|undefined{if(typeof value!=='string'||value.length>2_000)return;try{const item=JSON.parse(value) as Partial<ExecutionBudgetReceipt>,child=item.kind==='child',integers=[item.maxPromptBytes,item.maxOutputBytes,item.maxDurationMs,item.maxChildren,item.maxAttachments];if(item.version!==1||(!child&&item.kind!=='root')||item.approvalOrigin!==(child?'explicit-delegate-action':'explicit-chat-action')||item.device!=='local'||item.maxConcurrency!==1||item.maxDepth!==1||item.maxAttempts!==1||item.fallbackAllowed!==false||item.externalCostAllowed!==false||item.peerAllowed!==false||integers.some((number)=>!Number.isSafeInteger(number)||Number(number)<0)||item.maxPromptBytes!==(child?512*1024:2_000_000)||item.maxOutputBytes!==(child?2*1024*1024:8*1024*1024)||item.maxDurationMs!<1||item.maxDurationMs!>(child?60_000:120_000)||item.maxChildren!==(child?0:1)||item.maxAttachments!==(child?0:20)||!/^[a-f0-9]{64}$/.test(String(item.profileDigest)))return;return item as ExecutionBudgetReceipt}catch{return}}
