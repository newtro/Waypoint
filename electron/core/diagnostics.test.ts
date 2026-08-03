import { describe, expect, it, vi } from 'vitest'
import { exportDiagnosticsReport, runDiagnostics, type DiagnosticsProbes } from './diagnostics.js'

const healthy = (): DiagnosticsProbes => ({
  database: async () => ({ schemaVersion: 5, expectedSchemaVersion: 5, integrity: 'ok', foreignKeyViolations:0 }),
  storage: async () => ({ freeBytes: 2_000, minimumFreeBytes: 1_000, writable: true }),
  attachments: async () => ({ missingFiles: 0, orphanFiles: 0, digestMismatches: 0 }),
  search: async () => ({ indexedObjects: 12, expectedObjects: 12 }),
  embeddings: async () => ({ configured: true, reachable: true, model: 'qwen3-embedding:4b', modelInstalled: true }),
  cli: async (provider) => ({ configured: true, available: true, version: `${provider}-1` }),
  sync: async () => ({ configured: true, pending: 0, conflicts: 0, activePeers: 1 }),
})

describe('bounded local diagnostics', () => {
  it('returns stable, ordered pass results without external work', async () => {
    const probes = healthy(), report = await runDiagnostics(probes, '2026-08-02T00:00:00.000Z')
    expect(report.results.map(({ code }) => code)).toEqual([
      'database.schema', 'database.integrity', 'storage.capacity', 'storage.permissions', 'attachments.consistency',
      'search.consistency', 'embeddings.local_runtime', 'cli.codex', 'cli.claude', 'sync.local_state',
    ])
    expect(report.results.every(({ status }) => status === 'pass')).toBe(true)
  })

  it('classifies degraded, unavailable, and optional states with remediation', async () => {
    const probes = healthy()
    probes.database = async () => ({ schemaVersion: 4, expectedSchemaVersion: 5, integrity: 'corrupt', foreignKeyViolations:2 })
    probes.storage = async () => ({ freeBytes: 20, minimumFreeBytes: 1_000, writable: false })
    probes.attachments = async () => ({ missingFiles: 1, orphanFiles: 2, digestMismatches: 1 })
    probes.search = async () => ({ indexedObjects: 2, expectedObjects: 5 })
    probes.embeddings = async () => ({ configured: true, reachable: false, model: 'qwen', modelInstalled: false })
    probes.cli = async (provider) => provider === 'codex' ? { configured: false } : { configured: true, available: false }
    probes.sync = async () => ({ configured: true, pending: 3, conflicts: 1, activePeers: 0 })
    const results = (await runDiagnostics(probes)).results
    expect(results.map(({ status }) => status)).toEqual(['blocked', 'blocked', 'warning', 'blocked', 'warning', 'warning', 'warning', 'not_configured', 'warning', 'warning'])
    expect(results.filter(({ status }) => status === 'blocked' || status === 'warning').every(({ remediation }) => Boolean(remediation))).toBe(true)
  })

  it('fails closed per probe and continues the remaining bounded checks', async () => {
    const probes = healthy(), cli = vi.fn(probes.cli!)
    probes.database = async () => { throw new TypeError('private /Users/person/workspace.sqlite') }
    probes.cli = cli
    const results = (await runDiagnostics(probes)).results
    expect(results.slice(0, 2)).toEqual([
      expect.objectContaining({ code: 'database.schema', status: 'blocked', details: { errorType: 'TypeError' } }),
      expect.objectContaining({ code: 'database.integrity', status: 'blocked', details: { errorType: 'TypeError' } }),
    ])
    expect(cli).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(10)
  })

  it('marks omitted optional probes not configured', async () => {
    const complete = healthy()
    const required: DiagnosticsProbes = {
      database: complete.database,
      storage: complete.storage,
      attachments: complete.attachments,
      search: complete.search,
    }
    const results = (await runDiagnostics(required)).results.slice(6)
    expect(results).toHaveLength(4)
    expect(results.every(({ status }) => status === 'not_configured')).toBe(true)
  })

  it('exports only minimized structured data and redacts path-like or sensitive detail fields', () => {
    const exported = exportDiagnosticsReport({ formatVersion: 1, generatedAt: 'fixed', results: [{
      code: 'storage.permissions', status: 'blocked', summary: 'Cannot write locally.', remediation: 'Fix permissions.',
      details: { freeBytes: 3, databasePath: '/Users/alice/private.sqlite', model: '/private/model', secretToken: 'abc' },
    }] })
    expect(JSON.parse(exported)).toEqual({ formatVersion: 1, generatedAt: 'fixed', results: [{
      code: 'storage.permissions', status: 'blocked', summary: 'Cannot write locally.', remediation: 'Fix permissions.', details: { freeBytes: 3, model: '[redacted]' },
    }] })
    expect(exported).not.toContain('/Users/alice')
    expect(exported).not.toContain('abc')
  })
})
