import {describe,expect,it,vi} from 'vitest'
import {cancelExecutionsBeforeShutdown,deleteWithExecutionCancellation,startDurableChild} from './execution-lifecycle.js'

describe('execution owner lifecycle',()=>{
  it('cancels every active child before deleting its owning chat',()=>{
    const order:string[]=[],store={activeExecutionIds:vi.fn(()=>['r1','r2']),deleteObject:vi.fn(()=>order.push('delete'))},registry={cancel:vi.fn((id:string)=>{order.push(`cancel:${id}`);return true}),cancelAll:vi.fn()}
    deleteWithExecutionCancellation(store,registry,'workspace','chat','chat')
    expect(order).toEqual(['cancel:r1','cancel:r2','delete']);expect(store.activeExecutionIds).toHaveBeenCalledWith('workspace','chat')
  })
  it('cancels all children before shutdown',()=>{const registry={cancel:vi.fn(()=>true),cancelAll:vi.fn()};cancelExecutionsBeforeShutdown(registry);expect(registry.cancelAll).toHaveBeenCalledOnce()})
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
})
