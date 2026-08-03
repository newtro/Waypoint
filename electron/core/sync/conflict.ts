export type VectorClock = Readonly<Record<string, number>>

export interface AuthoredChange<T> {
  changeId: string
  objectId: string
  authorDeviceId: string
  clock: VectorClock
  kind: 'upsert'
  value: T
}

export interface TombstoneChange {
  changeId: string
  objectId: string
  authorDeviceId: string
  clock: VectorClock
  kind: 'delete'
  deletedAt: string
}

export type SyncChange<T> = AuthoredChange<T> | TombstoneChange
export type ConvergedState<T> =
  | { kind: 'live'; objectId: string; variants: readonly AuthoredChange<T>[] }
  | { kind: 'deleted'; objectId: string; tombstone: TombstoneChange }

export function compareClocks(left: VectorClock, right: VectorClock): 'before' | 'after' | 'equal' | 'concurrent' {
  const devices = new Set([...Object.keys(left), ...Object.keys(right)])
  let lower = false, higher = false
  for (const device of devices) {
    const l = left[device] ?? 0, r = right[device] ?? 0
    lower ||= l < r
    higher ||= l > r
  }
  if (!lower && !higher) return 'equal'
  if (lower && higher) return 'concurrent'
  return lower ? 'before' : 'after'
}

function canonicalTombstone(left: TombstoneChange, right: TombstoneChange): TombstoneChange {
  const order = compareClocks(left.clock, right.clock)
  if (order === 'before') return right
  if (order === 'after') return left
  return left.changeId.localeCompare(right.changeId) <= 0 ? left : right
}

/** Deletion is intentionally irreversible for an object identity. Restore must mint a new identity. */
export function converge<T>(current: ConvergedState<T> | undefined, incoming: SyncChange<T>): ConvergedState<T> {
  if (current && current.objectId !== incoming.objectId) throw new Error('Cannot converge different object identities')
  if (current?.kind === 'deleted') {
    return incoming.kind === 'delete'
      ? { kind: 'deleted', objectId: incoming.objectId, tombstone: canonicalTombstone(current.tombstone, incoming) }
      : current
  }
  if (incoming.kind === 'delete') return { kind: 'deleted', objectId: incoming.objectId, tombstone: incoming }

  const existing = current?.variants ?? []
  if (existing.some(({ changeId }) => changeId === incoming.changeId)) return current!
  if (existing.some((variant) => compareClocks(variant.clock, incoming.clock) === 'after')) return current!
  const variants = existing
    .filter((variant) => compareClocks(variant.clock, incoming.clock) !== 'before')
    .concat(incoming)
    .sort((a, b) => a.changeId.localeCompare(b.changeId))
  return { kind: 'live', objectId: incoming.objectId, variants }
}
