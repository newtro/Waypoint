import type { SanitizedSyncStatus } from '../types.js'

const count=(value:unknown):number=>Number.isSafeInteger(value)&&Number(value)>=0?Number(value):0

/** Renderer-safe status: deliberately excludes IDs, clocks, payloads, keys, paths and envelope bytes. */
export function sanitizeSyncStatus(raw:Record<string,unknown>):SanitizedSyncStatus {
  const conflicts=count(raw.conflicts),pending=count(raw.pendingMutations)+count(raw.pendingEnvelopes)
  const setup=raw.setupStatus==='device_pending_keys'?'device_pending_keys':'local_only'
  const state=conflicts>0?'conflicts':setup==='device_pending_keys'?'device_pending_keys':pending>0?'pending':'local_only'
  return {state,pending,conflicts,conflictVariants:count(raw.conflictVariants),tombstones:count(raw.tombstones),enrollmentAvailable:false,connectionConfigured:false}
}
