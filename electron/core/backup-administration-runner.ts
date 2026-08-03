import path from 'node:path'
import {mkdtempSync} from 'node:fs'
import {rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {Worker} from 'node:worker_threads'
import type {BackupCheckResult,RestoreDrillResult} from './backup-administration.js'

type Operation='verify'|'drill'
type Result=BackupCheckResult|RestoreDrillResult
type WorkerLike={once(event:'message',listener:(value:unknown)=>void):WorkerLike;once(event:'error',listener:()=>void):WorkerLike;once(event:'exit',listener:(code:number)=>void):WorkerLike;terminate():Promise<number>}
type WorkerRequest={operation:Operation;filePath:string;drillParent?:string}
type WorkerFactory=(request:WorkerRequest)=>WorkerLike
type RunnerOptions={deadlineMs?:number;temporaryParent?:string;remove?:(target:string)=>Promise<void>}
let active=false
const TABLES=['documents','revisions','chats','messages','memories','memory_suggestions','commitments','rule_suggestions','rule_suggestion_sources','learned_rules','rule_outcomes','relationships','attachments','document_import_sources','meetings','fixture_playbooks','fixture_playbook_runs','local_trigger_settings','local_events','local_trigger_rules','local_trigger_runs','external_inbound_events','tool_gateway_settings','tool_gateway_receipts','activities','tombstones','security_profiles','executions','execution_events'] as const
const CODES=['invalid','unsupported','too_large','io','restore_failed','cleanup_failed','busy','worker_failed'] as const

function safeName(filePath:string):string{return path.basename(filePath).slice(0,255)||'selected backup'}
function remediation(code:(typeof CODES)[number]):string{return code==='busy'?'Wait for the current local backup check to finish, then try again.':code==='too_large'?'Choose a backup within Waypoint’s documented local limits.':code==='unsupported'?'Use a backup version supported by this Waypoint build.':code==='io'?'Check that the selected file is readable and try again.':code==='restore_failed'?'Keep the original backup unchanged and use a different verified backup.':code==='cleanup_failed'?'Remove the temporary Waypoint restore-drill folder from the system temporary directory, then retry.':code==='invalid'?'Choose an unmodified Waypoint backup and verify it again.':'Waypoint could not complete the local backup check. Keep the original backup unchanged and try again.'}
function failed(filePath:string,code:'busy'|'worker_failed'):BackupCheckResult{return{status:'failed',fileName:safeName(filePath),code,remediation:remediation(code)}}
function sanitize(value:unknown,filePath:string,operation:Operation):Result|undefined{
  if(!value||typeof value!=='object')return undefined
  const item=value as Record<string,unknown>
  if(item.status==='failed'&&CODES.includes(item.code as (typeof CODES)[number])){const code=item.code as (typeof CODES)[number];return{status:'failed',fileName:safeName(filePath),code,remediation:remediation(code)}}
  if(item.status!=='passed'||(item.version!==2&&item.version!==3)||typeof item.exportedAt!=='string'||!Number.isFinite(Date.parse(item.exportedAt))||!item.counts||typeof item.counts!=='object')return undefined
  const source=item.counts as Record<string,unknown>,keys=Object.keys(source)
  if(keys.length!==TABLES.length||!TABLES.every((table)=>keys.includes(table)&&Number.isInteger(source[table])&&Number(source[table])>=0&&Number(source[table])<=100_000))return undefined
  const counts=Object.fromEntries(TABLES.map((table)=>[table,Number(source[table])])),totalObjects=Object.values(counts).reduce((sum,count)=>sum+count,0)
  if(item.totalObjects!==totalObjects)return undefined
  const result:Result={status:'passed',fileName:safeName(filePath),version:item.version,exportedAt:item.exportedAt,counts,totalObjects}
  if(operation==='drill'){
    const drill=item.drill as Record<string,unknown>|undefined
    if(!drill||drill.databaseIntegrity!=='ok'||drill.foreignKeyViolations!==0||drill.missingFiles!==0||drill.digestMismatches!==0||drill.searchDifference!==0||drill.countsMatch!==true||drill.temporaryDataRemoved!==true)return undefined
    return{...result,drill:{databaseIntegrity:'ok',foreignKeyViolations:0,missingFiles:0,digestMismatches:0,searchDifference:0,countsMatch:true,temporaryDataRemoved:true}}
  }
  return result
}
function defaultFactory(request:WorkerRequest):WorkerLike{return new Worker(new URL('./backup-administration-worker.js',import.meta.url),{workerData:request,resourceLimits:{maxOldGenerationSizeMb:768,stackSizeMb:8}})}

export function runBackupAdministration(operation:Operation,filePath:string,workerFactory:WorkerFactory=defaultFactory,options:RunnerOptions={}):Promise<Result>{
  if(active)return Promise.resolve(failed(filePath,'busy'))
  active=true
  return new Promise((resolve)=>{
    let settling=false,message:Result|undefined,worker:WorkerLike|undefined,drillParent:string|undefined
    const cleanup=async():Promise<boolean>=>{if(!drillParent)return true;try{if(options.remove)await options.remove(drillParent);else await rm(drillParent,{recursive:true,force:true,maxRetries:2,retryDelay:50});return true}catch{return false}}
    const finish=async(result:Result,terminate=false)=>{if(settling)return;settling=true;clearTimeout(timer);if(terminate&&worker)try{await worker.terminate()}catch{/* Cleanup still runs after failed termination. */}const removed=await cleanup();active=false;resolve(removed?result:{status:'failed',fileName:safeName(filePath),code:'cleanup_failed',remediation:remediation('cleanup_failed')})}
    const timer=setTimeout(()=>void finish(failed(filePath,'worker_failed'),true),options.deadlineMs??5*60_000)
    try{if(operation==='drill')drillParent=mkdtempSync(path.join(options.temporaryParent??tmpdir(),'waypoint-restore-worker-'));worker=workerFactory({operation,filePath,...(drillParent?{drillParent}:{})})}catch{return void finish(failed(filePath,'worker_failed'),true)}
    worker.once('message',(value)=>{message=sanitize(value,filePath,operation)})
    worker.once('error',()=>void finish(failed(filePath,'worker_failed'),true))
    worker.once('exit',(code)=>void finish(code===0&&message?message:failed(filePath,'worker_failed')))
  })
}
