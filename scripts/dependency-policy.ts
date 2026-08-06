import { readFileSync } from 'node:fs'
import path from 'node:path'

type Manifest = {
  allowScripts?: Record<string, boolean>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

type LockEntry = {
  version?: string
  resolved?: string
  integrity?: string
  hasInstallScript?: boolean
  link?: boolean
}

type Lockfile = { packages?: Record<string, LockEntry> }

const root = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as Manifest
const lockfile = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as Lockfile
const packages = lockfile.packages ?? {}
const scriptPolicy = manifest.allowScripts ?? {}
const failures: string[] = []
const registryOrigin = 'https://registry.npmjs.org'
const scriptPackages = new Set<string>()
let registryPackages = 0

function packageName(key: string): string | undefined {
  const marker = 'node_modules/'
  const index = key.lastIndexOf(marker)
  if (index < 0) return undefined
  const tail = key.slice(index + marker.length)
  const parts = tail.split('/')
  return tail.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

for (const [key, entry] of Object.entries(packages)) {
  const name = packageName(key)
  if (!name || !entry.version || entry.link) continue

  if (entry.resolved) {
    let resolved: URL
    try {
      resolved = new URL(entry.resolved)
    } catch {
      failures.push(`${name}@${entry.version} has an invalid resolved URL`)
      continue
    }
    if (resolved.origin !== registryOrigin) failures.push(`${name}@${entry.version} does not resolve from the npm registry`)
    else registryPackages++
    if (!entry.integrity?.startsWith('sha512-')) failures.push(`${name}@${entry.version} is not pinned with SHA-512 integrity`)
  }

  if (entry.hasInstallScript) {
    const identity = `${name}@${entry.version}`
    scriptPackages.add(identity)
    if (typeof scriptPolicy[identity] !== 'boolean') failures.push(`${identity} has an unreviewed install script`)
  }
}

for (const identity of Object.keys(scriptPolicy)) {
  if (!scriptPackages.has(identity)) failures.push(`${identity} is a stale install-script policy entry`)
}

for (const [name, specifier] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
  if (/^(?:git(?:\+|:)|github:|https?:|file:|link:)/i.test(specifier)) failures.push(`${name} uses a non-registry dependency specifier`)
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`Dependency policy passed: ${registryPackages} registry packages, ${scriptPackages.size} reviewed install-script packages, no Git or remote URL dependencies.`)
