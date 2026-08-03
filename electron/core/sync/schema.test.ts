import { describe, expect, it } from 'vitest'
import { negotiateSchemas } from './schema.js'

describe('schema negotiation', () => {
  it('chooses the newest mutually supported version deterministically', () => {
    expect(negotiateSchemas(
      { deviceId: 'mac', schemas: { objects: { minimum: 1, maximum: 4 }, attachments: { minimum: 2, maximum: 3 } } },
      { deviceId: 'pc', schemas: { objects: { minimum: 2, maximum: 3 }, attachments: { minimum: 1, maximum: 2 } } },
      ['objects', 'attachments'],
    )).toEqual([{ collection: 'attachments', version: 2 }, { collection: 'objects', version: 3 }])
  })

  it('fails closed for missing, malformed, or incompatible required schemas', () => {
    const valid = { deviceId: 'a', schemas: { objects: { minimum: 2, maximum: 3 } } }
    expect(() => negotiateSchemas(valid, { deviceId: 'b', schemas: {} }, ['objects'])).toThrow('required schema')
    expect(() => negotiateSchemas(valid, { deviceId: 'b', schemas: { objects: { minimum: 4, maximum: 5 } } }, ['objects'])).toThrow('No compatible')
    expect(() => negotiateSchemas(valid, { deviceId: 'b', schemas: { objects: { minimum: 3, maximum: 2 } } }, ['objects'])).toThrow('Invalid')
  })
})
