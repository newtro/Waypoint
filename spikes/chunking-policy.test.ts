import { describe, expect, it } from 'vitest'
import { chunkingRequiresReindex, type ChunkingProvenance } from './chunking-policy.js'

const baseline: ChunkingProvenance = { provider: 'native', providerVersion: '1', policy: 'recursive', policyConfigDigest: 'abc', suiteVersion: 'v1' }

describe('chunking provenance', () => {
  it('keeps an identical index generation', () => expect(chunkingRequiresReindex(baseline, { ...baseline })).toBe(false))
  it.each(['provider', 'providerVersion', 'policy', 'policyConfigDigest', 'suiteVersion'] as const)('requires reindex when %s changes', (field) => {
    expect(chunkingRequiresReindex(baseline, { ...baseline, [field]: 'changed' })).toBe(true)
  })
})
