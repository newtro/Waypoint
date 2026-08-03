export type VectorClock = Record<string, number>

export interface Change {
  objectId: string
  changeId: string
  clock: VectorClock
  kind: 'upsert' | 'delete'
  content?: string
}

export interface Conflict {
  objectId: string
  kind: 'conflict'
  variants: Change[]
}

export type ObjectState = Change | Conflict

function dominates(left: VectorClock, right: VectorClock): boolean {
  const devices = new Set([...Object.keys(left), ...Object.keys(right)])
  let strictlyGreater = false
  for (const device of devices) {
    const leftCounter = left[device] ?? 0
    const rightCounter = right[device] ?? 0
    if (leftCounter < rightCounter) return false
    if (leftCounter > rightCounter) strictlyGreater = true
  }
  return strictlyGreater
}

function variantsOf(state: ObjectState): Change[] {
  return state.kind === 'conflict' ? state.variants : [state]
}

export function converge(current: ObjectState | undefined, incoming: Change): ObjectState {
  if (!current) return incoming
  if (current.objectId !== incoming.objectId) {
    throw new Error(`Cannot converge different objects: ${current.objectId} and ${incoming.objectId}`)
  }

  const variants = variantsOf(current)
  if (variants.some((variant) => variant.changeId === incoming.changeId)) return current
  const deletion = [...variants, incoming].find((variant) => variant.kind === 'delete')
  if (deletion) return deletion

  const surviving = variants.filter((variant) => !dominates(incoming.clock, variant.clock))
  if (surviving.some((variant) => dominates(variant.clock, incoming.clock))) return current
  const merged = [...surviving, incoming].sort((left, right) => left.changeId.localeCompare(right.changeId))
  return merged.length === 1 ? merged[0] : { objectId: incoming.objectId, kind: 'conflict', variants: merged }
}
