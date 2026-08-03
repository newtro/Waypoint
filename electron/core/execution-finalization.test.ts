import { describe, expect, it, vi } from 'vitest'
import { finalizeExecution, type ExecutionFinalizationStore } from './execution-finalization.js'

function fixture(overrides: Partial<ExecutionFinalizationStore> = {}): ExecutionFinalizationStore {
  return {
    executionExists: () => true,
    listExecutions: () => [{ id: 'run', events: [{ type: 'text', text: 'first' }, { type: 'text', text: 'final' }] }],
    finishExecution: vi.fn(),
    ...overrides,
  }
}

describe('durable execution finalization', () => {
  it('persists completed output and uses the non-duplicated final Claude message', async () => {
    const store = fixture()
    await expect(finalizeExecution(store, { runId: 'run', workspaceId: 'workspace', chatId: 'chat', cli: 'claude', result: { status: 'completed', exitCode: 0 } })).resolves.toBe('persisted')
    expect(store.finishExecution).toHaveBeenCalledWith('run', 'workspace', { status: 'completed', exitCode: 0 }, 'final')
  })

  it('retries transient persistence failures before completing the durable gate', async () => {
    const finishExecution = vi.fn().mockImplementationOnce(() => { throw new Error('database busy') })
    await expect(finalizeExecution(fixture({ finishExecution }), { runId: 'run', workspaceId: 'workspace', chatId: 'chat', cli: 'codex', result: { status: 'failed', exitCode: 1, error: 'bad model' } }, { retryDelay: async () => undefined })).resolves.toBe('persisted')
    expect(finishExecution).toHaveBeenCalledTimes(2)
  })

  it('uses the in-memory stream if an event append was transiently unavailable', async () => {
    const finishExecution = vi.fn()
    const store = fixture({ listExecutions: () => [{ id: 'run', events: [] }], finishExecution })
    await finalizeExecution(store, { runId: 'run', workspaceId: 'workspace', chatId: 'chat', cli: 'codex', result: { status: 'completed', exitCode: 0 }, fallbackEvents: [{ type: 'text', text: 'recovered answer' }] })
    expect(finishExecution).toHaveBeenCalledWith('run', 'workspace', expect.any(Object), 'recovered answer')
  })

  it('stops retrying when cascade deletion removes persistence authority', async () => {
    const executionExists = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
    const store = fixture({ executionExists, finishExecution: () => { throw new Error('deleted') } })
    await expect(finalizeExecution(store, { runId: 'run', workspaceId: 'workspace', chatId: 'chat', cli: 'codex', result: { status: 'canceled', exitCode: null } }, { retryDelay: async () => undefined })).resolves.toBe('owner-deleted')
  })

  it('surfaces repeated persistence failure instead of silently leaving a live-looking run', async () => {
    const store = fixture({ finishExecution: () => { throw new Error('disk unavailable') } })
    await expect(finalizeExecution(store, { runId: 'run', workspaceId: 'workspace', chatId: 'chat', cli: 'codex', result: { status: 'completed', exitCode: 0 } }, { attempts: 2, retryDelay: async () => undefined })).rejects.toThrow('disk unavailable')
  })
})
