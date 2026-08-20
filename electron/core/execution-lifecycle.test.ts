import {describe,expect,it,vi} from 'vitest'
import {cancelExecutionsBeforeShutdown,deleteWithExecutionCancellation,startDurableChild,validateOneChildDelegation} from './execution-lifecycle.js'

describe('execution owner lifecycle',()=>{
  it('waits for every active child before deleting its owning chat',async()=>{
    let ids=['r1','r2'];const order:string[]=[],store={activeExecutionIds:vi.fn(()=>ids),deleteObject:vi.fn(()=>order.push('delete'))},registry={cancel:vi.fn(()=>true),cancelAndWait:vi.fn(async(id:string)=>{order.push(`cancel:${id}`);await Promise.resolve();ids=ids.filter((candidate)=>candidate!==id);order.push(`stopped:${id}`);return true}),cancelAll:vi.fn()}
    await deleteWithExecutionCancellation(store,registry,'workspace','chat','chat')
    expect(order).toEqual(['cancel:r1','stopped:r1','cancel:r2','stopped:r2','delete']);expect(store.activeExecutionIds).toHaveBeenCalledWith('workspace','chat')
  })
  it('refuses deletion when an active child is not owned by a live registry',async()=>{const store={activeExecutionIds:vi.fn(()=>['orphan']),deleteObject:vi.fn()},registry={cancel:vi.fn(()=>false),cancelAndWait:vi.fn(async()=>false),cancelAll:vi.fn()};await expect(deleteWithExecutionCancellation(store,registry,'workspace','chat','chat')).rejects.toThrow(/not deleted/);expect(store.deleteObject).not.toHaveBeenCalled()})
  it('refuses deletion if new AI work appears while cancellation is being awaited',async()=>{let ids=['old'];const store={activeExecutionIds:vi.fn(()=>ids),deleteObject:vi.fn()},registry={cancel:vi.fn(()=>true),cancelAndWait:vi.fn(async()=>{ids=['new'];return true}),cancelAll:vi.fn()};await expect(deleteWithExecutionCancellation(store,registry,'workspace','chat','chat')).rejects.toThrow(/New AI work/);expect(store.deleteObject).not.toHaveBeenCalled()})
  it('cancels all children before shutdown',()=>{const registry={cancel:vi.fn(()=>true),cancelAndWait:vi.fn(async()=>true),cancelAll:vi.fn()};cancelExecutionsBeforeShutdown(registry);expect(registry.cancelAll).toHaveBeenCalledOnce()})
  it('does not spawn when chat deletion removes the queued owner during detection',async()=>{
    let resolveDetection!:(value:{available:boolean;executable:string})=>void
    const detection=new Promise<{available:boolean;executable:string}>((resolve)=>{resolveDetection=resolve}),spawn=vi.fn(),exists=vi.fn(()=>false)
    const starting=startDurableChild({workspaceId:'w',runId:'r',detect:()=>detection,executionExists:exists,spawn,markRunning:vi.fn()})
    resolveDetection({available:true,executable:'/trusted/codex'})
    await expect(starting).rejects.toThrow(/deleted during CLI detection/);expect(spawn).not.toHaveBeenCalled()
  })
  it('cancels a spawned child when its durable running transition loses the owner race',async()=>{
    const running={executable:'/trusted/codex',cancel:vi.fn()}
    await expect(startDurableChild({workspaceId:'w',runId:'r',detect:async()=>({available:true,executable:'/trusted/codex'}),executionExists:()=>true,spawn:async()=>running,markRunning:()=>{throw new Error('row deleted')}})).rejects.toThrow('row deleted')
    expect(running.cancel).toHaveBeenCalledOnce()
  })
  it('allows one child without changing permissions and rejects recursion or a second child',()=>{
    const root={id:'root',depth:0,securityProfileId:'safe'}
    expect(()=>validateOneChildDelegation([root],'root','safe')).not.toThrow()
    expect(()=>validateOneChildDelegation([root],'root','broader')).toThrow(/cannot expand/)
    expect(()=>validateOneChildDelegation([root,{id:'child',depth:1,parentExecutionId:'root'}],'root','safe')).toThrow(/already used/)
    expect(()=>validateOneChildDelegation([{id:'child',depth:1,securityProfileId:'safe'}],'child','safe')).toThrow(/root run/)
  })
})
