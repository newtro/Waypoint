import { describe, expect, it } from 'vitest'
import { converge, type Change } from './sync-model.js'

const upsertA: Change = { objectId: 'doc-1', changeId: 'a2', kind: 'upsert', content: 'A', clock: { mac: 2 } }
const upsertB: Change = { objectId: 'doc-1', changeId: 'b2', kind: 'upsert', content: 'B', clock: { windows: 2 } }
const deletion: Change = { objectId: 'doc-1', changeId: 'delete-3', kind: 'delete', clock: { mac: 3, windows: 2 } }

describe('sync convergence spike', () => {
  it('preserves concurrent authored variants regardless of arrival order', () => {
    const first = converge(upsertA, upsertB)
    const second = converge(upsertB, upsertA)
    expect(first).toEqual(second)
    expect(first.kind).toBe('conflict')
    if (first.kind === 'conflict') expect(first.variants.map((variant) => variant.content)).toEqual(['A', 'B'])
  })

  it('accepts a causally newer authored update without a conflict', () => {
    const newer: Change = { objectId: 'doc-1', changeId: 'a3', kind: 'upsert', content: 'resolved', clock: { mac: 3, windows: 2 } }
    expect(converge(upsertB, newer)).toEqual(newer)
  })

  it('prevents stale peers from resurrecting a deleted object', () => {
    expect(converge(deletion, upsertB)).toEqual(deletion)
    expect(converge(upsertB, deletion)).toEqual(deletion)
  })

  it('is idempotent for replayed changes', () => {
    expect(converge(deletion, deletion)).toEqual(deletion)
  })

  it('rejects convergence across different object identities', () => {
    const other = { ...upsertB, objectId: 'doc-2' }
    expect(() => converge(upsertA, other)).toThrow(/different objects/)
  })
})
