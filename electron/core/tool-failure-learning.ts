import {createHash,createHmac} from 'node:crypto'
import os from 'node:os'
import type {ToolRequest,ToolResult} from './tool-gateway.js'

export const FAILURE_TTL_MS=7*24*60*60*1000,MAX_FAILURES_PER_TOOL=50
export interface ToolFailureIdentity{tool:ToolRequest['tool'];capabilityVersion:string;parameterFingerprint:string;contextDigest:string}
export interface ToolFailureMatch{id:string;errorClass:string;remediation?:string;expiresAt:string;updatedAt:string}
export interface ToolFailureLearningHooks{
  find(workspaceId:string,identity:ToolFailureIdentity,at:string):ToolFailureMatch|undefined
  record(request:ToolRequest,identity:ToolFailureIdentity,result:ToolResult,overrideReason?:string,remediation?:string):void
}

function stable(value:unknown):unknown{
  if(Array.isArray(value))return value.map(stable)
  if(value&&typeof value==='object'){const output:Record<string,unknown>={};for(const key of Object.keys(value as Record<string,unknown>).sort())if(!['failureOverrideReason','failureRemediation'].includes(key))output[key]=stable((value as Record<string,unknown>)[key]);return output}
  if(['string','number','boolean'].includes(typeof value)||value===null)return value
  return String(value)
}

export function failureIdentity(key:Buffer,request:ToolRequest,capabilityVersion='1.0.0',context={platform:process.platform,arch:process.arch}):ToolFailureIdentity{
  if(key.length<32)throw new Error('failure_fingerprint_key_unavailable')
  const envelope=JSON.stringify(stable({tool:request.tool,arguments:request.arguments})),parameterFingerprint=createHmac('sha256',key).update(envelope).digest('hex'),contextDigest=createHash('sha256').update(JSON.stringify(stable(context))).digest('hex')
  return{tool:request.tool,capabilityVersion,parameterFingerprint,contextDigest}
}

export function safeFailureNote(value:unknown,max=300):string|undefined{
  if(value===undefined||value===null)return undefined
  const text=[...String(value)].map((character)=>{const code=character.charCodeAt(0);return code<32||code===127?' ':character}).join('').replace(/\s+/g,' ').trim()
  if(!text||text.length>max)throw new Error('invalid_failure_note')
  return text
}

export function localFailureContext(){return{platform:os.platform(),arch:os.arch(),release:os.release().split('.').slice(0,2).join('.')}}
export function workspaceFailureKey(workspaceKey:string,keyEpoch:number){const decoded=Buffer.from(workspaceKey,'base64');if(decoded.length!==32||!Number.isSafeInteger(keyEpoch)||keyEpoch<1)throw new Error('invalid_workspace_failure_key');return{key:createHmac('sha256',decoded).update('Waypoint tool failure fingerprint v1').digest(),capabilityVersion:`1.0.0/fingerprint:workspace-epoch-${keyEpoch}`}}
