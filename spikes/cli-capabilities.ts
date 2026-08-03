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

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

/**
 * Finder/Explorer launched applications receive a deliberately sparse PATH.
 * Search only explicit PATH entries and well-known, user-controlled install
 * locations; never invoke a login shell or execute shell profile files.
 */
export function cliSearchDirectories(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const configured = (env.PATH ?? '').split(pathApi.delimiter).filter(Boolean)
  if (platform === 'win32') {
    const home = env.USERPROFILE
    const local = env.LOCALAPPDATA
    const roaming = env.APPDATA
    return unique([
      ...configured,
      local && pathApi.join(local, 'Programs', 'Claude'),
      local && pathApi.join(local, 'Programs', 'OpenAI'),
      roaming && pathApi.join(roaming, 'npm'),
      home && pathApi.join(home, '.local', 'bin'),
      home && pathApi.join(home, '.volta', 'bin'),
      env.ProgramFiles && pathApi.join(env.ProgramFiles, 'nodejs'),
      'C:\\Program Files\\nodejs',
      'C:\\Windows\\System32',
    ])
  }
  const home = env.HOME
  return unique([
    ...configured,
    home && pathApi.join(home, '.local', 'bin'),
    home && pathApi.join(home, '.npm-global', 'bin'),
    home && pathApi.join(home, '.volta', 'bin'),
    ...(platform === 'darwin' ? [
      '/Applications/ChatGPT.app/Contents/Resources',
      '/opt/homebrew/bin',
    ] : []),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ])
}

export function cliExecutionPath(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  return unique([pathApi.dirname(executable), ...cliSearchDirectories(env, platform)]).join(pathApi.delimiter)
}

export async function resolveExecutable(
  name: string,
  options: Pick<DetectionOptions, 'env' | 'platform' | 'canAccess'> = {},
): Promise<string | undefined> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const canAccess = options.canAccess ?? ((candidate) => access(candidate))
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const pathEntries = cliSearchDirectories(env, platform)
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
  if (!executable) return { name, available: false, error: `${name} was not found in PATH or a supported local install location` }
  const run = options.run ?? ((resolved, args) => execFileAsync(resolved, args, {
    timeout: 5_000,
    shell: false,
    windowsHide: true,
    env: { PATH: cliExecutionPath(resolved, options.env ?? process.env, options.platform ?? process.platform) },
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
