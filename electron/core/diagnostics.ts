export type DiagnosticStatus = 'pass' | 'warning' | 'blocked' | 'not_configured'

export type DiagnosticCode =
  | 'database.schema'
  | 'database.integrity'
  | 'storage.capacity'
  | 'storage.permissions'
  | 'attachments.consistency'
  | 'search.consistency'
  | 'embeddings.local_runtime'
  | 'cli.codex'
  | 'cli.claude'
  | 'sync.local_state'

export interface DiagnosticResult {
  code: DiagnosticCode
  status: DiagnosticStatus
  summary: string
  remediation?: string
  details?: Record<string, boolean | number | string | null>
}

export interface DiagnosticsReport {
  formatVersion: 1
  generatedAt: string
  results: DiagnosticResult[]
}

export interface DiagnosticsProbes {
  database(): Promise<{ schemaVersion: number; expectedSchemaVersion: number; integrity: 'ok' | 'corrupt'; foreignKeyViolations:number }>
  storage(): Promise<{ freeBytes: number; minimumFreeBytes: number; writable: boolean }>
  attachments(): Promise<{ missingFiles: number; orphanFiles: number; digestMismatches: number }>
  search(): Promise<{ indexedObjects: number; expectedObjects: number }>
  embeddings?: () => Promise<{ configured: boolean; reachable?: boolean; model?: string; modelInstalled?: boolean }>
  cli?: (provider: 'codex' | 'claude') => Promise<{ configured: boolean; available?: boolean; version?: string }>
  sync?: () => Promise<{ configured: boolean; pending: number; conflicts: number; activePeers: number }>
}

const remedies: Record<DiagnosticCode, string> = {
  'database.schema': 'Restart Waypoint to retry local database migrations; restore a backup if migration still fails.',
  'database.integrity': 'Stop editing and restore the most recent verified local backup.',
  'storage.capacity': 'Free local disk space before importing, indexing, or recording more content.',
  'storage.permissions': 'Restore write access to the Waypoint data directory in system privacy and file permissions.',
  'attachments.consistency': 'Restore missing attachment files from a verified backup or remove the affected attachment records.',
  'search.consistency': 'Rebuild the local text index from canonical workspace content.',
  'embeddings.local_runtime': 'Start the configured local Ollama runtime and install the selected embedding model.',
  'cli.codex': 'Install or sign in to the Codex CLI, then run diagnostics again.',
  'cli.claude': 'Install or sign in to the Claude Code CLI, then run diagnostics again.',
  'sync.local_state': 'Resolve local conflicts and review pending encrypted changes before relying on peer sync.',
}

const result = (code: DiagnosticCode, status: DiagnosticStatus, summary: string, details?: DiagnosticResult['details']): DiagnosticResult => ({
  code, status, summary, ...(status === 'pass' || status === 'not_configured' ? {} : { remediation: remedies[code] }), ...(details ? { details } : {}),
})

export async function runDiagnostics(probes: DiagnosticsProbes, generatedAt = new Date().toISOString()): Promise<DiagnosticsReport> {
  const results: DiagnosticResult[] = []
  try {
    const database = await probes.database()
    results.push(database.schemaVersion === database.expectedSchemaVersion
      ? result('database.schema', 'pass', 'Local database schema is current.', { schemaVersion: database.schemaVersion })
      : result('database.schema', 'blocked', 'Local database schema does not match this Waypoint version.', { schemaVersion: database.schemaVersion, expectedSchemaVersion: database.expectedSchemaVersion }))
    results.push(database.integrity === 'ok' && database.foreignKeyViolations === 0
      ? result('database.integrity', 'pass', 'SQLite integrity check passed.')
      : result('database.integrity', 'blocked', 'SQLite integrity or foreign-key checks failed.', {foreignKeyViolations:database.foreignKeyViolations}))
  } catch (error) { results.push(probeFailure('database.schema', error), probeFailure('database.integrity', error)) }

  try {
    const storage = await probes.storage()
    results.push(storage.freeBytes >= storage.minimumFreeBytes
      ? result('storage.capacity', 'pass', 'Local storage has sufficient free space.', { freeBytes: storage.freeBytes, minimumFreeBytes: storage.minimumFreeBytes })
      : result('storage.capacity', 'warning', 'Local storage is below the recommended free-space threshold.', { freeBytes: storage.freeBytes, minimumFreeBytes: storage.minimumFreeBytes }))
    results.push(storage.writable
      ? result('storage.permissions', 'pass', 'Waypoint local storage is writable.')
      : result('storage.permissions', 'blocked', 'Waypoint local storage is not writable.'))
  } catch (error) { results.push(probeFailure('storage.capacity', error), probeFailure('storage.permissions', error)) }

  try {
    const state = await probes.attachments(), inconsistent = state.missingFiles + state.orphanFiles + state.digestMismatches
    results.push(inconsistent === 0
      ? result('attachments.consistency', 'pass', 'Attachment records and local files are consistent.', state)
      : result('attachments.consistency', 'warning', 'Attachment consistency problems were found.', state))
  } catch (error) { results.push(probeFailure('attachments.consistency', error)) }

  try {
    const state = await probes.search(), delta = Math.abs(state.expectedObjects - state.indexedObjects)
    results.push(delta === 0
      ? result('search.consistency', 'pass', 'Text index matches canonical workspace content.', state)
      : result('search.consistency', 'warning', 'Text index does not match canonical workspace content.', { ...state, difference: delta }))
  } catch (error) { results.push(probeFailure('search.consistency', error)) }

  await optionalCheck(results, 'embeddings.local_runtime', probes.embeddings, (state) => {
    if (!state.configured) return result('embeddings.local_runtime', 'not_configured', 'Local embeddings are not configured.')
    if (!state.reachable || !state.modelInstalled) return result('embeddings.local_runtime', 'warning', 'The configured local embedding runtime is not ready.', { reachable: Boolean(state.reachable), model: state.model ?? 'unknown', modelInstalled: Boolean(state.modelInstalled) })
    return result('embeddings.local_runtime', 'pass', 'The configured local embedding runtime is ready.', { model: state.model ?? 'unknown' })
  })
  for (const provider of ['codex', 'claude'] as const) {
    const code = `cli.${provider}` as DiagnosticCode
    await optionalCheck(results, code, probes.cli ? () => probes.cli!(provider) : undefined, (state) => {
      if (!state.configured) return result(code, 'not_configured', `${provider === 'codex' ? 'Codex' : 'Claude Code'} CLI is not configured.`)
      return state.available
        ? result(code, 'pass', `${provider === 'codex' ? 'Codex' : 'Claude Code'} CLI is available.`, { version: state.version ?? 'unknown' })
        : result(code, 'warning', `${provider === 'codex' ? 'Codex' : 'Claude Code'} CLI is configured but unavailable.`)
    })
  }
  await optionalCheck(results, 'sync.local_state', probes.sync, (state) => {
    if (!state.configured) return result('sync.local_state', 'not_configured', 'Peer sync is not configured.')
    const details = { pending: state.pending, conflicts: state.conflicts, activePeers: state.activePeers }
    return state.conflicts > 0
      ? result('sync.local_state', 'warning', 'Local sync state has unresolved conflicts.', details)
      : result('sync.local_state', 'pass', state.pending > 0 ? 'Local sync changes are safely queued.' : 'Local sync state is clear.', details)
  })
  return { formatVersion: 1, generatedAt, results }
}

async function optionalCheck<T>(results: DiagnosticResult[], code: DiagnosticCode, probe: (() => Promise<T>) | undefined, map: (value: T) => DiagnosticResult): Promise<void> {
  if (!probe) { results.push(result(code, 'not_configured', 'This optional capability is not configured.')); return }
  try { results.push(map(await probe())) } catch (error) { results.push(probeFailure(code, error)) }
}

function probeFailure(code: DiagnosticCode, error: unknown): DiagnosticResult {
  return result(code, 'blocked', 'The local diagnostic check could not complete.', { errorType: error instanceof Error ? error.name : 'UnknownError' })
}

/** Produces a support-safe report: no content, absolute paths, credentials, or raw error messages. */
export function exportDiagnosticsReport(report: DiagnosticsReport): string {
  const safe = {
    formatVersion: report.formatVersion,
    generatedAt: report.generatedAt,
    results: report.results.map(({ code, status, summary, remediation, details }) => ({
      code, status, summary, ...(remediation ? { remediation } : {}), ...(details ? { details: sanitizeDetails(details) } : {}),
    })),
  }
  return `${JSON.stringify(safe, null, 2)}\n`
}

function sanitizeDetails(details: DiagnosticResult['details']): DiagnosticResult['details'] {
  const safe: NonNullable<DiagnosticResult['details']> = {}
  for (const [key, value] of Object.entries(details ?? {})) {
    if (/path|root|directory|content|prompt|message|token|secret|key|credential/i.test(key)) continue
    if (typeof value === 'string' && (value.includes('/') || value.includes('\\') || /(?:bearer|token|key)=/i.test(value))) safe[key] = '[redacted]'
    else safe[key] = value
  }
  return safe
}
