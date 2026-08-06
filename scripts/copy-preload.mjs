import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'dist-preload', 'preload.js')
const destination = path.join(root, 'dist-electron', 'electron', 'preload.cjs')

mkdirSync(path.dirname(destination), { recursive: true })
copyFileSync(source, destination)
