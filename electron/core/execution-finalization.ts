import type { ExecutionEvent, RunStatus } from './ai-workbench.js'
import { canonicalExecutionText } from './execution-output.js'

type TerminalResult = { status: Exclude<RunStatus, 'queued' | 'running'>; exitCode: number | null; error?: string }

export interface ExecutionFinalizationStore {
  executionExists(workspaceId: string, runId: string): boolean
  listExecutions(workspaceId: string, chatId?: string): Array<Record<string, unknown>>
  finishExecution(runId: string, workspaceId: string, result: TerminalResult, answer: string): void
}

export async function finalizeExecution(
  store: ExecutionFinalizationStore,
  input: { runId: string; workspaceId: string; chatId: string; cli: 'codex' | 'claude'; result: TerminalResult; fallbackEvents?: ExecutionEvent[]; answerOverride?: string },
  options: { attempts?: number; retryDelay?: (attempt: number) => Promise<void> } = {},
): Promise<'persisted' | 'owner-deleted'> {
  const attempts = Math.max(1, options.attempts ?? 3)
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!store.executionExists(input.workspaceId, input.runId)) return 'owner-deleted'
    try {
      const storedEvents = store.listExecutions(input.workspaceId, input.chatId).find((run) => run.id === input.runId)?.events
      const durableEvents = Array.isArray(storedEvents) ? storedEvents.filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === 'object') : []
      const events: Array<Record<string, unknown>> = input.fallbackEvents?.length ? input.fallbackEvents : durableEvents
      const answer = input.answerOverride ?? canonicalExecutionText(input.cli, events)
      store.finishExecution(input.runId, input.workspaceId, input.result, answer)
      return 'persisted'
    } catch (error) {
      lastError = error
      if (attempt < attempts) await (options.retryDelay?.(attempt) ?? new Promise((resolve) => setTimeout(resolve, attempt * 50)))
    }
  }
  throw lastError
}
