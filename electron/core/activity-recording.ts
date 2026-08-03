type SyncAction='device.initialized'|'device.enrolled'|'device.approved'|'device.revoked'|'key.rotated'|'sync.completed'

export function recordSyncActivityBestEffort(recorder:{recordSyncActivity(workspaceId:string,action:SyncAction,details?:Record<string,unknown>):void},workspaceId:string,action:SyncAction,details:Record<string,unknown>={}):boolean{
  try{recorder.recordSyncActivity(workspaceId,action,details);return true}catch{return false}
}
