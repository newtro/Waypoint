export interface ExecutionRegistry {
  cancel(runId:string):boolean
  cancelAndWait(runId:string):Promise<boolean>
  cancelAll():void
}
export interface ExecutionOwnerStore {
  activeExecutionIds(workspaceId?:string,chatId?:string):string[]
  cancelQueuedExecution?(workspaceId:string,runId:string):boolean
  deleteObject(workspaceId:string,kind:'document'|'chat'|'memory',objectId:string):void
}

export async function deleteWithExecutionCancellation(store:ExecutionOwnerStore,registries:ExecutionRegistry|readonly ExecutionRegistry[],workspaceId:string,kind:'document'|'chat'|'memory',objectId:string):Promise<void>{
  const available=Array.isArray(registries)?registries:[registries]
  if(kind==='chat')for(const runId of store.activeExecutionIds(workspaceId,objectId)){
    if(store.cancelQueuedExecution?.(workspaceId,runId))continue
    let canceled=false
    for(const registry of available){
      canceled=await registry.cancelAndWait(runId)
      if(canceled)break
    }
    if(!canceled)throw new Error('The active AI run could not be stopped, so the chat was not deleted')
  }
  if(kind==='chat'&&store.activeExecutionIds(workspaceId,objectId).length)throw new Error('New AI work reached the chat while deletion was waiting, so the chat was not deleted')
  store.deleteObject(workspaceId,kind,objectId)
}

export function cancelExecutionsBeforeShutdown(registry:ExecutionRegistry):void{registry.cancelAll()}

export function validateOneChildDelegation(runs:Array<Record<string,unknown>>,parentExecutionId:string,profileId:string):void{
  const parent=runs.find((run)=>run.id===parentExecutionId)
  if(!parent||Number(parent.depth)!==0)throw new Error('Child delegation requires a surviving root run')
  if(runs.some((run)=>run.parentExecutionId===parentExecutionId))throw new Error('This root run already used its one-child delegation budget')
  if(parent.securityProfileId!==profileId)throw new Error('Child delegation cannot expand or change the parent security profile')
}

export async function startDurableChild<TCapability extends {available:boolean;executable?:string;error?:string},TRunning extends {executable:string;version?:string;cancel():void}>(input:{
  workspaceId:string;runId:string;detect():Promise<TCapability>;executionExists(workspaceId:string,runId:string):boolean
  spawn(capability:TCapability):Promise<TRunning>;markRunning(running:TRunning):void
}):Promise<TRunning>{
  const capability=await input.detect()
  if(!capability.available||!capability.executable)throw new Error(capability.error??'CLI is unavailable')
  if(!input.executionExists(input.workspaceId,input.runId))throw new Error('Execution owner was deleted during CLI detection')
  const running=await input.spawn(capability)
  try{input.markRunning(running)}catch(error){running.cancel();throw error}
  return running
}
