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

export function cliExecutionEnvironment(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: cliExecutionPath(executable, env, platform),
    HOME: env.HOME ?? env.USERPROFILE ?? '',
    USER: env.USER ?? env.USERNAME ?? '',
    LANG: env.LANG ?? 'en_US.UTF-8',
    NO_COLOR: '1',
  }
  if (platform === 'win32') {
    const required: Record<string, string | undefined> = {
      SystemRoot: env.SystemRoot ?? env.SYSTEMROOT,
      USERPROFILE: env.USERPROFILE ?? env.HOME,
      APPDATA: env.APPDATA,
      LOCALAPPDATA: env.LOCALAPPDATA,
      TEMP: env.TEMP,
      TMP: env.TMP,
      COMSPEC: env.COMSPEC,
    }
    for (const [name, value] of Object.entries(required)) if (value) environment[name] = value
  }
  return environment
}

const npmShimEntrypoints: Record<CliName, string[]> = {
  codex: ['node_modules', '@openai', 'codex', 'bin', 'codex.js'],
  claude: ['node_modules', '@anthropic-ai', 'claude-code', 'cli.js'],
}

export async function cliProcessInvocation(
  name: CliName,
  executable: string,
  args: string[],
  options: Pick<DetectionOptions, 'env' | 'platform' | 'canAccess'> & { nodeExecutable?: string } = {},
): Promise<{ executable: string; args: string[] }> {
  const platform = options.platform ?? process.platform
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)) {
    const pathApi = path.win32,
      shimDirectory = pathApi.dirname(executable),
      entrypointCandidates = [
        pathApi.resolve(shimDirectory, ...npmShimEntrypoints[name]),
        pathApi.resolve(shimDirectory, '..', ...npmShimEntrypoints[name].slice(1)),
      ],
      canAccess = options.canAccess ?? ((candidate: string) => access(candidate))
    let entrypoint: string | undefined
    for (const candidate of entrypointCandidates) try { await canAccess(candidate); entrypoint = candidate; break } catch { /* Try the next bounded npm layout. */ }
    if (!entrypoint) throw new Error(`${name} Windows npm shim has an unsupported package layout`)
    const nodeExecutable = options.nodeExecutable ?? await resolveExecutable('node', options)
    if (!nodeExecutable || /\.(?:cmd|bat)$/i.test(nodeExecutable)) throw new Error('A native Node.js executable is required for the Windows npm CLI shim')
    return {
      executable: nodeExecutable,
      args: [entrypoint, ...args],
    }
  }
  return { executable, args }
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
  try {
    const env = options.env ?? process.env,
      platform = options.platform ?? process.platform,
      { stdout, stderr } = options.run
        ? await options.run(executable, ['--version'])
        : await cliProcessInvocation(name, executable, ['--version'], options).then((invocation) => execFileAsync(invocation.executable, invocation.args, {
            timeout: 5_000,
            shell: false,
            windowsHide: true,
            env: cliExecutionEnvironment(executable, env, platform),
          }))
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
