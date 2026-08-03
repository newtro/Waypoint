import { readFileSync } from 'node:fs'
import { writeAtomicBackup, type BackupFaultBoundary } from './backup.js'
import type { ExportArchive } from './types.js'

const destination=process.argv[2],archivePath=process.argv[3],boundary=process.argv[4] as BackupFaultBoundary
if(!destination||!archivePath||!boundary)throw new Error('destination, archive, and boundary are required')
const archive=JSON.parse(readFileSync(archivePath,'utf8')) as ExportArchive
writeAtomicBackup(destination,archive,(reached)=>{if(reached===boundary)process.exit(86)})
