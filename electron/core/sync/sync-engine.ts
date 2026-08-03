import { converge, type ConvergedState, type SyncChange } from './conflict.js'

export interface ApplyResult { applied: boolean; reason?: 'replay'; changeId: string }

export class DeterministicSyncEngine<T> {
  private readonly objects = new Map<string, ConvergedState<T>>()
  private readonly applied = new Map<string, string>()

  private fingerprint(change: SyncChange<T>): string {
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value
    return JSON.stringify(canonical(change))
  }

  apply(change: SyncChange<T>): ApplyResult {
    if (!change.changeId || !change.objectId) throw new Error('Change identity is required')
    const fingerprint = this.fingerprint(change), prior = this.applied.get(change.changeId)
    if (prior !== undefined) {
      if (prior !== fingerprint) throw new Error('Change ID collision with different content')
      return { applied: false, reason: 'replay', changeId: change.changeId }
    }
    this.objects.set(change.objectId, converge(this.objects.get(change.objectId), change))
    this.applied.set(change.changeId, fingerprint)
    return { applied: true, changeId: change.changeId }
  }

  applyBatch(changes: readonly SyncChange<T>[]): ApplyResult[] {
    return [...changes].sort((a, b) => a.changeId.localeCompare(b.changeId)).map((change) => this.apply(change))
  }

  state(objectId: string): ConvergedState<T> | undefined { return this.objects.get(objectId) }
  hasApplied(changeId: string): boolean { return this.applied.has(changeId) }
}
