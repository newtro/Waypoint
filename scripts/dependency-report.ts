import { readFileSync } from 'node:fs'

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) as { packages: Record<string, { version?: string; license?: string; resolved?: string }> }
const packages = Object.entries(lock.packages).filter(([name]) => name.startsWith('node_modules/')).map(([name, value]) => ({
  name: name.slice('node_modules/'.length), version: value.version ?? 'unknown', license: value.license ?? 'not-declared', source: value.resolved?.startsWith('https://registry.npmjs.org/') ? 'npm-registry' : 'other',
})).sort((left, right) => left.name.localeCompare(right.name))
const undeclared = packages.filter((item) => item.license === 'not-declared').map((item) => item.name)
process.stdout.write(`${JSON.stringify({ formatVersion: 1, generatedAt: new Date().toISOString(), packageCount: packages.length, undeclaredLicenseCount: undeclared.length, undeclared, packages }, null, 2)}\n`)

