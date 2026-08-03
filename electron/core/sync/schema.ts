export interface SchemaRange { minimum: number; maximum: number }
export interface SchemaOffer { deviceId: string; schemas: Readonly<Record<string, SchemaRange>> }
export interface NegotiatedSchema { collection: string; version: number }

export function negotiateSchemas(local: SchemaOffer, remote: SchemaOffer, requiredCollections: readonly string[]): NegotiatedSchema[] {
  return [...new Set(requiredCollections)].sort().map((collection) => {
    const left = local.schemas[collection], right = remote.schemas[collection]
    if (!left || !right) throw new Error(`Peer does not support required schema: ${collection}`)
    if (!Number.isSafeInteger(left.minimum) || !Number.isSafeInteger(left.maximum) || left.minimum < 1 || left.minimum > left.maximum ||
        !Number.isSafeInteger(right.minimum) || !Number.isSafeInteger(right.maximum) || right.minimum < 1 || right.minimum > right.maximum) {
      throw new Error(`Invalid schema range: ${collection}`)
    }
    const minimum = Math.max(left.minimum, right.minimum), maximum = Math.min(left.maximum, right.maximum)
    if (minimum > maximum) throw new Error(`No compatible schema version: ${collection}`)
    return { collection, version: maximum }
  })
}
