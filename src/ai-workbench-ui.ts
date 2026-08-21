import { providerExecutionText } from './execution-text.js'

export type ExecutionRunView = Record<string, unknown> & {
  events?: Array<Record<string, unknown>>
}

export function executionAnswerText(run: ExecutionRunView): string {
  const events = Array.isArray(run.events) ? run.events : []
  const provider = ['codex', 'claude', 'grok'].includes(String(run.cli))
    ? String(run.cli) as 'codex' | 'claude' | 'grok'
    : 'codex'
  return providerExecutionText(provider, events)
}

export function failureAdvice(run: ExecutionRunView): string | undefined {
  if (!['failed', 'timed_out', 'canceled'].includes(String(run.status))) return
  const detail = String(run.errorMessage ?? '')
  if (/auth|login|sign.?in/i.test(detail)) return `${detail} Open ${String(run.cli)} in Terminal, sign in, then retry.`
  if (run.status === 'timed_out') return detail || 'This older run reached a legacy Waypoint deadline. Retry it; new AI runs have no Waypoint time limit.'
  if (run.status === 'canceled') return 'Canceled safely; the durable chat and run history were preserved.'
  return detail || `The ${String(run.cli)} process failed. Check Health for CLI compatibility and sign-in guidance.`
}
