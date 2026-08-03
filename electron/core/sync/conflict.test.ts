import { describe, expect, it } from 'vitest'
import { converge, type SyncChange } from './conflict.js'
import { DeterministicSyncEngine } from './sync-engine.js'

const upsert = (changeId: string, authorDeviceId: string, clock: Record<string, number>, value = changeId): SyncChange<string> =>
  ({ changeId, objectId: 'object', authorDeviceId, clock, kind: 'upsert', value })

describe('deterministic convergence', () => {
  it('preserves concurrent authored variants in canonical order', () => {
    const a = upsert('a', 'mac', { mac: 1 }), b = upsert('b', 'pc', { pc: 1 })
    const forward = converge(converge(undefined, b), a)
    const reverse = converge(converge(undefined, a), b)
    expect(forward).toEqual(reverse)
    expect(forward.kind === 'live' && forward.variants.map((v) => v.changeId)).toEqual(['a', 'b'])
  })

  it('replaces causally older writes but never resurrects a deleted identity', () => {
    const old = upsert('old', 'mac', { mac: 1 }), next = upsert('next', 'mac', { mac: 2 })
    const live = converge(converge(undefined, old), next)
    expect(live.kind === 'live' && live.variants.map((v) => v.changeId)).toEqual(['next'])
    const tombstone: SyncChange<string> = { changeId: 'delete', objectId: 'object', authorDeviceId: 'pc', clock: { pc: 1 }, kind: 'delete', deletedAt: '2026-01-01T00:00:00Z' }
    const deleted = converge(live, tombstone)
    expect(converge(deleted, upsert('stale', 'lost', { lost: 99 })).kind).toBe('deleted')
  })

  it('is replay-safe and order-independent at the engine boundary', () => {
    const changes = [upsert('b', 'pc', { pc: 1 }), upsert('a', 'mac', { mac: 1 })]
    const left = new DeterministicSyncEngine<string>(), right = new DeterministicSyncEngine<string>()
    expect(left.applyBatch(changes).every((result) => result.applied)).toBe(true)
    right.applyBatch([...changes].reverse())
    expect(left.state('object')).toEqual(right.state('object'))
    expect(left.apply(changes[0])).toMatchObject({ applied: false, reason: 'replay' })
    expect(() => left.apply(upsert('b', 'pc', { pc: 1 }, 'mutated replay'))).toThrow('collision')
  })
})
