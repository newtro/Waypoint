export type ExecutionRunView = Record<string, unknown> & {
  events?: Array<Record<string, unknown>>
}

export function failureAdvice(run: ExecutionRunView): string | undefined {
  if (!['failed', 'timed_out', 'canceled'].includes(String(run.status))) return
  const detail = String(run.errorMessage ?? '')
  if (/auth|login|sign.?in/i.test(detail)) return `${detail} Open ${String(run.cli)} in Terminal, sign in, then retry.`
  if (run.status === 'timed_out') return 'The bounded run timed out. Narrow the task or choose a longer approved profile.'
  if (run.status === 'canceled') return 'Canceled safely; the durable chat and run history were preserved.'
  return detail || `The ${String(run.cli)} process failed. Check Health for CLI compatibility and sign-in guidance.`
}
