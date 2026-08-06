import { closeSync, fsyncSync, openSync } from 'node:fs'

const WINDOWS_DIRECTORY_SYNC_ERRORS = new Set(['EACCES', 'EINVAL', 'ENOTSUP', 'EPERM'])

export function syncFileDurably(filePath: string, platform = process.platform): void {
  const descriptor = openSync(filePath, platform === 'win32' ? 'r+' : 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

export function syncDirectoryDurably(directory: string, platform = process.platform): void {
  let descriptor: number
  try { descriptor = openSync(directory, 'r') }
  catch (error) {
    if (platform === 'win32' && WINDOWS_DIRECTORY_SYNC_ERRORS.has((error as NodeJS.ErrnoException).code ?? '')) return
    throw error
  }
  try {
    try { fsyncSync(descriptor) }
    catch (error) {
      if (platform !== 'win32' || !WINDOWS_DIRECTORY_SYNC_ERRORS.has((error as NodeJS.ErrnoException).code ?? '')) throw error
    }
  } finally { closeSync(descriptor) }
}
