import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe,expect,it } from 'vitest'
import { archiveIntegrity,readBackup,writeAtomicBackup,type BackupFaultBoundary } from './backup.js'
import type { ExportArchive } from './types.js'

function archive(stamp:string):ExportArchive{const value={version:3 as const,exportedAt:stamp,workspace:{id:'w'},objects:{documents:[],attachments:[]}};return{...value,integrity:archiveIntegrity(value)}}
describe('backup process-death boundaries',()=>{
  for(const boundary of ['temporary-durable','previous-durable','destination-replaced'] as BackupFaultBoundary[])it(`recovers after ${boundary}`,()=>{
    const root=mkdtempSync(path.join(tmpdir(),'waypoint-backup-crash-')),destination=path.join(root,'backup.json'),input=path.join(root,'next.json')
    writeAtomicBackup(destination,archive('2026-08-01T00:00:00.000Z'));writeFileSync(input,JSON.stringify(archive('2026-08-02T00:00:00.000Z')))
    const child=spawnSync(process.execPath,['--import','tsx',new URL('./backup-fault-child.ts',import.meta.url).pathname,destination,input,boundary])
    expect(child.status).toBe(86)
    expect(['2026-08-01T00:00:00.000Z','2026-08-02T00:00:00.000Z']).toContain(readBackup(destination).exportedAt)
  })
  it('promotes the uniquely valid durable partial after a first-ever backup crash',()=>{
    const root=mkdtempSync(path.join(tmpdir(),'waypoint-backup-first-crash-')),destination=path.join(root,'backup.json'),input=path.join(root,'next.json')
    writeFileSync(input,JSON.stringify(archive('2026-08-02T00:00:00.000Z')))
    const child=spawnSync(process.execPath,['--import','tsx',new URL('./backup-fault-child.ts',import.meta.url).pathname,destination,input,'temporary-durable'])
    expect(child.status).toBe(86)
    expect(readBackup(destination).exportedAt).toBe('2026-08-02T00:00:00.000Z')
  })
})
