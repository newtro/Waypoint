import {describe,expect,it,vi} from 'vitest'
import {recordSyncActivityBestEffort} from './activity-recording.js'

describe('non-interfering sync activity recording',()=>{
  it('does not propagate a local audit write failure into a completed security operation',()=>{
    const recorder={recordSyncActivity:vi.fn(()=>{throw new Error('database full')})}
    expect(recordSyncActivityBestEffort(recorder,'workspace','device.revoked')).toBe(false)
    expect(recorder.recordSyncActivity).toHaveBeenCalledOnce()
  })
})
