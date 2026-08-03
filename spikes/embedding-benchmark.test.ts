import { describe, expect, it } from 'vitest'
import { DIMENSIONS, localFeatureVector } from './embedding-benchmark.js'

describe('local vector feasibility spike', () => {
  it('is deterministic and normalized', () => {
    const first = localFeatureVector('Durable personal memory')
    const second = localFeatureVector('Durable personal memory')
    expect(first).toEqual(second)
    expect(first).toHaveLength(DIMENSIONS)
    const magnitude = Math.sqrt(Array.from(first).reduce((sum, value) => sum + value * value, 0))
    expect(magnitude).toBeCloseTo(1, 5)
  })
})
