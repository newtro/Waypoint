import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputs = [
  ['preload.js', 'preload.cjs'],
  ['quick-capture-preload.js', 'quick-capture-preload.cjs'],
]

for (const [sourceName, destinationName] of outputs) {
  const source = path.join(root, 'dist-preload', sourceName)
  const destination = path.join(root, 'dist-electron', 'electron', destinationName)
  mkdirSync(path.dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}
