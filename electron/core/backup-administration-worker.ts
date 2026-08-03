import {parentPort,workerData} from 'node:worker_threads'
import path from 'node:path'
import {inspectBackupFile,runRestoreDrill,type BackupCheckResult,type RestoreDrillResult} from './backup-administration.js'

type WorkerRequest={operation:'verify'|'drill';filePath:string;drillParent?:string}
const request=workerData as WorkerRequest

function workerFailure():BackupCheckResult{return{status:'failed',fileName:typeof request?.filePath==='string'?(path.basename(request.filePath).slice(0,255)||'selected backup'):'selected backup',code:'worker_failed',remediation:'Waypoint could not complete the local backup check. Keep the original backup unchanged and try again.'}}

let result:BackupCheckResult|RestoreDrillResult
try{
  if(!parentPort||!request||!['verify','drill'].includes(request.operation)||typeof request.filePath!=='string'||!request.filePath||!path.isAbsolute(request.filePath)||request.operation==='drill'&&(typeof request.drillParent!=='string'||!path.isAbsolute(request.drillParent)))throw new Error('Invalid worker request')
  result=request.operation==='verify'?inspectBackupFile(request.filePath):runRestoreDrill(request.filePath,request.drillParent)
}catch{result=workerFailure()}
parentPort?.postMessage(result)
