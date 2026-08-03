import { access } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
export type CliName = 'codex' | 'claude'

export interface CliCapability {
  name: CliName
  available: boolean
  executable?: string
  version?: string
  error?: string
  compatible?: boolean
  compatibilityError?: string
}

const minimumVersions:Record<CliName,readonly [number,number,number]>={codex:[0,146,0],claude:[2,1,220]}
const maximumMajorExclusive:Record<CliName,number>={codex:1,claude:3}

export function parseCliVersion(value:string):[number,number,number]|undefined{
  const match=value.match(/(?:^|\D)(\d+)\.(\d+)\.(\d+)(?:\D|$)/)
  return match?[Number(match[1]),Number(match[2]),Number(match[3])]:undefined
}

export function cliCompatibility(name:CliName,version:string):{compatible:boolean;error?:string}{
  const parsed=parseCliVersion(version),minimum=minimumVersions[name],minimumLabel=minimum.join('.')
  if(!parsed)return{compatible:false,error:`Could not parse ${name} version “${version}”. Update the CLI and run the local health check.`}
  if(parsed[0]>=maximumMajorExclusive[name])return{compatible:false,error:`${name} ${parsed.join('.')} is newer than Waypoint's validated range. Update Waypoint before running this CLI.`}
  const comparison=parsed[0]-minimum[0]||parsed[1]-minimum[1]||parsed[2]-minimum[2]
  return comparison>=0?{compatible:true}:{compatible:false,error:`${name} ${parsed.join('.')} is unsupported. Update to ${minimumLabel} or newer, then retry.`}
}

export interface DetectionOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  canAccess?: (candidate: string) => Promise<void>
  run?: (executable: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
}

export async function resolveExecutable(
  name: string,
  options: Pick<DetectionOptions, 'env' | 'platform' | 'canAccess'> = {},
): Promise<string | undefined> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const canAccess = options.canAccess ?? ((candidate) => access(candidate))
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const pathEntries = (env.PATH ?? '').split(pathApi.delimiter).filter(Boolean)
  const extensions = platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : ['']
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = pathApi.resolve(directory, `${name}${extension}`)
      try {
        await canAccess(candidate)
        return candidate
      } catch {
        // Continue searching the explicit PATH entries.
      }
    }
  }
  return undefined
}

export async function detectCli(name: CliName, options: DetectionOptions = {}): Promise<CliCapability> {
  const executable = await resolveExecutable(name, options)
  if (!executable) return { name, available: false, error: `${name} was not found on PATH` }
  const run = options.run ?? ((resolved, args) => execFileAsync(resolved, args, {
    timeout: 5_000,
    shell: false,
    windowsHide: true,
    env: { PATH: options.env?.PATH ?? process.env.PATH ?? '' },
  }))
  try {
    const { stdout, stderr } = await run(executable, ['--version'])
    const version = `${stdout}${stderr}`.trim()
    if (!version) return { name, available: false, executable, error: 'CLI returned an empty version' }
    const compatibility=cliCompatibility(name,version)
    return { name, available: true, executable, version, compatible:compatibility.compatible,compatibilityError:compatibility.error }
  } catch (error) {
    return { name, available: false, executable, error: error instanceof Error ? error.message : 'Unknown detection error' }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await Promise.all([detectCli('codex'), detectCli('claude')]), null, 2))
}
