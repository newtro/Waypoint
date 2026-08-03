import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import type { ExportArchive } from './types.js'
import { ARCHIVE_LIMITS } from './limits.js'

const allowedTables = new Set(['documents','revisions','chats','messages','memories','memory_suggestions','commitments','rule_suggestions','rule_suggestion_sources','learned_rules','rule_outcomes','relationships','attachments','document_import_sources','meetings','fixture_playbooks','fixture_playbook_runs','local_trigger_settings','local_events','local_trigger_rules','local_trigger_runs','activities','tombstones','security_profiles','executions','execution_events'])

export function archiveIntegrity(archive: Omit<ExportArchive, 'integrity'>): string {
  return createHash('sha256').update(JSON.stringify(archive)).digest('hex')
}

function boundedStrings(value: unknown): void {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > ARCHIVE_LIMITS.maxStringBytes) throw new Error('Archive contains an oversized string')
    return
  }
  if (Array.isArray(value)) { for (const item of value) boundedStrings(item); return }
  if (value && typeof value === 'object') for (const item of Object.values(value)) boundedStrings(item)
}

export function validateArchive(value: unknown): ExportArchive {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Archive must be an object')
  const archive = value as Record<string, unknown>
  if (archive.version !== 2 && archive.version !== 3) throw new Error('Unsupported archive version')
  if (typeof archive.exportedAt !== 'string' || !Number.isFinite(Date.parse(archive.exportedAt))) throw new Error('Archive timestamp is invalid')
  if (!archive.workspace || typeof archive.workspace !== 'object' || Array.isArray(archive.workspace)) throw new Error('Archive workspace is invalid')
  if (!archive.objects || typeof archive.objects !== 'object' || Array.isArray(archive.objects)) throw new Error('Archive objects are invalid')
  if (typeof archive.integrity !== 'string' || !/^[0-9a-f]{64}$/.test(archive.integrity)) throw new Error('Archive integrity value is invalid')
  const objects = archive.objects as Record<string, unknown>
  for (const [table, rows] of Object.entries(objects)) {
    if (!allowedTables.has(table)) throw new Error(`Archive table is unsupported: ${table}`)
    if (!Array.isArray(rows) || rows.length > ARCHIVE_LIMITS.maxRowsPerTable || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error(`Archive table is invalid: ${table}`)
  }
  const attachments = (objects.attachments ?? []) as Array<Record<string, unknown>>
  if (attachments.length > ARCHIVE_LIMITS.maxAttachments) throw new Error('Archive contains too many attachments')
  let totalAttachmentBytes = 0
  for (const attachment of attachments) {
    if (typeof attachment.data_base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.data_base64)) throw new Error('Attachment encoding is invalid')
    const bytes = Buffer.from(attachment.data_base64, 'base64')
    if (bytes.length > ARCHIVE_LIMITS.maxAttachmentBytes) throw new Error('Archive attachment exceeds the size limit')
    totalAttachmentBytes += bytes.length
  }
  if (totalAttachmentBytes > ARCHIVE_LIMITS.maxTotalAttachmentBytes) throw new Error('Archive attachments exceed the total size limit')
  const meetings=(objects.meetings??[]) as Array<Record<string,unknown>>;if(meetings.length>ARCHIVE_LIMITS.maxMeetings)throw new Error('Archive contains too many meetings');let totalMeetingBytes=0;for(const meeting of meetings){if(meeting.audio_data_base64==null)continue;if(typeof meeting.audio_data_base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(meeting.audio_data_base64))throw new Error('Meeting audio encoding is invalid');const bytes=Buffer.from(meeting.audio_data_base64,'base64');if(bytes.length>ARCHIVE_LIMITS.maxMeetingAudioBytes)throw new Error('Archive meeting audio exceeds the size limit');totalMeetingBytes+=bytes.length}if(totalMeetingBytes>ARCHIVE_LIMITS.maxTotalMeetingAudioBytes)throw new Error('Archive meeting audio exceeds the total size limit')
  boundedStrings({ workspace: archive.workspace, objects: Object.fromEntries(Object.entries(objects).map(([key, rows]) => [key, key === 'attachments' ? (rows as Array<Record<string, unknown>>).map((row) => Object.fromEntries(Object.entries(row).filter(([field]) => field !== 'data_base64'))) : key==='meetings'?(rows as Array<Record<string,unknown>>).map((row)=>Object.fromEntries(Object.entries(row).filter(([field])=>field!=='audio_data_base64'))):rows])) })
  const typed = archive as unknown as ExportArchive
  if (typed.integrity !== archiveIntegrity({ version: typed.version, exportedAt: typed.exportedAt, workspace: typed.workspace, objects: typed.objects })) throw new Error('Archive integrity check failed')
  return typed
}

function readBackupFile(filePath: string): ExportArchive {
  const size = statSync(filePath).size
  if (size > ARCHIVE_LIMITS.maxFileBytes) throw new Error('Backup exceeds the file size limit')
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(filePath, 'utf8')) }
  catch { throw new Error('Backup is not valid JSON') }
  return validateArchive(parsed)
}

export function readBackup(filePath:string):ExportArchive {
  recoverInterruptedBackup(filePath)
  return readBackupFile(filePath)
}
export function readBackupReadonly(filePath:string):ExportArchive{return readBackupFile(filePath)}

export type BackupFaultBoundary = 'temporary-durable'|'previous-durable'|'destination-replaced'

function syncFile(filePath:string):void { const descriptor=openSync(filePath,'r');try{fsyncSync(descriptor)}finally{closeSync(descriptor)} }
function syncDirectory(filePath:string):void { const descriptor=openSync(pathDirectory(filePath),'r');try{fsyncSync(descriptor)}finally{closeSync(descriptor)} }
function pathDirectory(filePath:string):string { const index=Math.max(filePath.lastIndexOf('/'),filePath.lastIndexOf('\\'));return index<0?'.':filePath.slice(0,index)||'/' }

export function recoverInterruptedBackup(filePath:string): 'current'|'previous'|'none' {
  const previousPath=`${filePath}.previous`,directory=pathDirectory(filePath),base=filePath.slice(directory==='/'?1:directory.length+1)
  const escapedBase=base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  const partialPattern=new RegExp(`^${escapedBase}\\.partial-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,'i')
  const candidates=readdirSync(directory).filter((entry)=>partialPattern.test(entry))
  let currentValid=false,previousValid=false
  if(existsSync(filePath)){try{readBackupFile(filePath);currentValid=true}catch{/* A prior crash may have exposed a damaged destination. */}}
  if(existsSync(previousPath)){try{readBackupFile(previousPath);previousValid=true}catch{/* Never restore an invalid prior copy. */}}
  const validCandidates=candidates.filter((candidate)=>{try{readBackupFile(`${directory}/${candidate}`);return true}catch{return false}})
  if(!currentValid&&previousValid){
    const recovery=`${filePath}.partial-recovery`;copyFileSync(previousPath,recovery);syncFile(recovery);renameSync(recovery,filePath);syncDirectory(filePath);currentValid=true
  } else if(!currentValid&&!previousValid&&validCandidates.length===1) {
    renameSync(`${directory}/${validCandidates[0]}`,filePath);syncDirectory(filePath);currentValid=true
  }
  if(currentValid)for(const candidate of validCandidates)if(existsSync(`${directory}/${candidate}`))rmSync(`${directory}/${candidate}`,{force:true})
  return currentValid?(previousValid?'previous':'current'):'none'
}

export function writeAtomicBackup(filePath: string, archive: ExportArchive, fault?: (boundary:BackupFaultBoundary)=>void): { bytes: number; integrity: string } {
  validateArchive(archive)
  const contents = `${JSON.stringify(archive, null, 2)}\n`
  if (Buffer.byteLength(contents) > ARCHIVE_LIMITS.maxFileBytes) throw new Error('Backup exceeds the file size limit')
  const temporaryPath = `${filePath}.partial-${randomUUID()}`
  const previousPath = `${filePath}.previous`, previousTemporaryPath=`${previousPath}.partial`
  let descriptor: number | undefined
  try {
    recoverInterruptedBackup(filePath)
    descriptor = openSync(temporaryPath, 'wx', 0o600)
    writeFileSync(descriptor, contents, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor); descriptor = undefined
    readBackupFile(temporaryPath)
    fault?.('temporary-durable')
    if (existsSync(filePath)) {
      copyFileSync(filePath,previousTemporaryPath);syncFile(previousTemporaryPath);renameSync(previousTemporaryPath,previousPath);syncDirectory(filePath);fault?.('previous-durable')
    }
    renameSync(temporaryPath, filePath)
    fault?.('destination-replaced')
    syncDirectory(filePath)
    return { bytes: Buffer.byteLength(contents), integrity: archive.integrity }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporaryPath, { force: true })
    rmSync(previousTemporaryPath,{force:true})
    throw error
  }
}
