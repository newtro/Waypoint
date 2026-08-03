import { describe, expect, it } from 'vitest'
import { reconcileSelectedChatId, RefreshGate } from '../../src/chat-selection.js'

describe('chat selection reconciliation', () => {
  const chats = [{ id: 'recent' }, { id: 'older' }]

  it('preserves an active durable chat after refresh', () => {
    expect(reconcileSelectedChatId(chats, 'older')).toBe('older')
  })

  it('selects the newest remaining chat after deletion or initial load', () => {
    expect(reconcileSelectedChatId(chats, 'deleted')).toBe('recent')
    expect(reconcileSelectedChatId(chats)).toBe('recent')
    expect(reconcileSelectedChatId([])).toBeUndefined()
  })

  it('rejects an older workspace refresh that completes after a newer selection', () => {
    const gate = new RefreshGate(), older = gate.begin(), newer = gate.begin()
    expect(gate.isCurrent(older)).toBe(false)
    expect(gate.isCurrent(newer)).toBe(true)
  })
})
