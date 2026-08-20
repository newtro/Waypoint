import {describe,expect,it} from 'vitest'
import {sanitizeSyncStatus} from './sync-status.js'

describe('renderer-safe sync status',()=>{
  it.each([
    [{setupStatus:'local_only'},'local_only'],
    [{setupStatus:'local_only',pendingMutations:2,pendingEnvelopes:1},'pending'],
    [{setupStatus:'device_pending_keys',pendingMutations:4},'device_pending_keys'],
    [{setupStatus:'device_pending_keys',conflicts:1,conflictVariants:2},'conflicts'],
  ] as const)('derives %s without exposing raw state',(raw,state)=>expect(sanitizeSyncStatus(raw as Record<string,unknown>)).toMatchObject({state,enrollmentAvailable:false,connectionConfigured:false}))
  it('emits only bounded aggregate fields',()=>{
    const result=sanitizeSyncStatus({setupStatus:'local_only',pendingMutations:1,payload:{body:'secret'},localDeviceId:'secret-device',clock:{peer:2},conflicts:-1})
    expect(result).toEqual({state:'pending',pending:1,conflicts:0,conflictVariants:0,tombstones:0,localOnlyAttachments:0,enrollmentAvailable:false,connectionConfigured:false})
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
