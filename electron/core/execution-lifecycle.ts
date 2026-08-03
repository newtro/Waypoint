export interface ExecutionRegistry { cancel(runId:string):boolean; cancelAll():void }
export interface ExecutionOwnerStore { activeExecutionIds(workspaceId?:string,chatId?:string):string[]; deleteObject(workspaceId:string,kind:'document'|'chat'|'memory',objectId:string):void }

export function deleteWithExecutionCancellation(store:ExecutionOwnerStore,registry:ExecutionRegistry,workspaceId:string,kind:'document'|'chat'|'memory',objectId:string):void{
  if(kind==='chat')for(const runId of store.activeExecutionIds(workspaceId,objectId))registry.cancel(runId)
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
