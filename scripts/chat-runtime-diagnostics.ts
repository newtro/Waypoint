import { detectCli } from '../spikes/cli-capabilities.js'
import { adapterArgs } from '../electron/core/ai-workbench.js'

const guiEnvironment: NodeJS.ProcessEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  APPDATA: process.env.APPDATA,
  ProgramFiles: process.env.ProgramFiles,
  PATH: process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin:/bin',
}

const capabilities = await Promise.all([
  detectCli('codex', { env: guiEnvironment }),
  detectCli('claude', { env: guiEnvironment }),
])

console.log(JSON.stringify({
  environment: 'simulated-packaged-gui',
  platform: process.platform,
  capabilities,
  adapters: { codex: adapterArgs('codex', '[stdin]'), claude: adapterArgs('claude', '[stdin]') },
}, null, 2))
