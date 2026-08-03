import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { archiveIntegrity, readBackup, recoverInterruptedBackup, validateArchive, writeAtomicBackup } from './backup.js'
import type { ExportArchive } from './types.js'

function archive(exportedAt='2026-08-02T00:00:00.000Z'): ExportArchive {
  const base = { version: 3 as const, exportedAt, workspace: { id: 'old', name: 'Personal' }, objects: { documents: [], attachments: [] } }
  return { ...base, integrity: archiveIntegrity(base) }
}

describe('bounded atomic backups', () => {
  it('writes, reopens, verifies, and replaces atomically', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'waypoint-backup-')), destination = path.join(root, 'workspace.json')
    writeAtomicBackup(destination,archive('2026-08-01T00:00:00.000Z'))
    expect(writeAtomicBackup(destination, archive()).bytes).toBeGreaterThan(0)
    expect(readBackup(destination)).toEqual(archive())
    expect(readBackup(`${destination}.previous`).exportedAt).toBe('2026-08-01T00:00:00.000Z')
  })

  it('recovers a missing or damaged destination from the deterministic durable prior copy',()=>{
    const root=mkdtempSync(path.join(tmpdir(),'waypoint-backup-')),destination=path.join(root,'workspace.json')
    writeFileSync(`${destination}.previous`,`${JSON.stringify(archive())}\n`);writeFileSync(destination,'damaged');writeFileSync(`${destination}.partial-stale`,'partial')
    expect(recoverInterruptedBackup(destination)).toBe('previous')
    expect(readBackup(destination)).toEqual(archive())
  })

  it('does not delete arbitrary or invalid sibling files that resemble partial backups',()=>{
    const root=mkdtempSync(path.join(tmpdir(),'waypoint-backup-')),destination=path.join(root,'workspace.json')
    writeAtomicBackup(destination,archive())
    const arbitrary=`${destination}.partial-not-owned`,invalid=`${destination}.partial-00000000-0000-4000-8000-000000000000`
    writeFileSync(arbitrary,'personal sibling');writeFileSync(invalid,'not a Waypoint backup')
    expect(readBackup(destination)).toEqual(archive())
    expect(existsSync(arbitrary)).toBe(true);expect(existsSync(invalid)).toBe(true)
  })

  it('rejects corruption, unsupported fields, malformed JSON, and future versions before restore', () => {
    const valid = archive(), corrupt = structuredClone(valid); corrupt.workspace.name = 'tampered'
    expect(() => validateArchive(corrupt)).toThrow(/integrity/)
    const unknown = structuredClone(valid) as unknown as Record<string, unknown>; (unknown.objects as Record<string, unknown>).credentials = []
    expect(() => validateArchive(unknown)).toThrow(/unsupported/)
    const future = { ...valid, version: 99 }
    expect(() => validateArchive(future)).toThrow(/Unsupported/)
    const root = mkdtempSync(path.join(tmpdir(), 'waypoint-backup-')), file = path.join(root, 'bad.json'); writeFileSync(file, '{')
    expect(() => readBackup(file)).toThrow(/valid JSON/)
  })

  it('rejects invalid attachment encodings and per-item limits', () => {
    const valid = archive(), objects = { attachments: [{ data_base64: 'not base64!', sha256: 'x' }] }
    const base = { ...valid, objects }, candidate = { ...base, integrity: archiveIntegrity({ version: base.version, exportedAt: base.exportedAt, workspace: base.workspace, objects }) }
    expect(() => validateArchive(candidate)).toThrow(/encoding/)
  })
})
