import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CliWorkbench, CONSERVATIVE_PROFILE } from '../electron/core/ai-workbench.js'

const root = mkdtempSync(path.join(tmpdir(), 'waypoint-live-cli-'))
const profile = { ...CONSERVATIVE_PROFILE, roots: [root], maxDurationMs: 45_000 }

try {
  for (const cli of ['codex', 'claude'] as const) {
    const events: Array<{ type: string; text?: string }> = []
    const run = await new CliWorkbench().start(cli, {
      cli, prompt: 'Reply with exactly WAYPOINT_LIVE_OK. Do not use tools or modify files.',
      workspaceRoot: root, profile, timeoutMs: 45_000,
    }, (event) => events.push(event))
    const result = await run.completion
    console.log(JSON.stringify({ cli, result, text: events.filter((event) => event.type === 'text').at(-1)?.text, workspaceFiles: readdirSync(root) }))
  }

  const failed = await new CliWorkbench().start('failure', {
    cli: 'codex', prompt: 'Reply briefly.', workspaceRoot: root, profile,
    model: 'waypoint-invalid-model-for-failure', timeoutMs: 30_000,
  }, () => {})
  console.log(JSON.stringify({ failure: await failed.completion }))

  const canceled = await new CliWorkbench().start('cancel', {
    cli: 'claude', prompt: 'Think silently for a long time, do not use tools, then reply.',
    workspaceRoot: root, profile, timeoutMs: 45_000,
  }, () => {})
  setTimeout(() => canceled.cancel(), 250)
  console.log(JSON.stringify({ cancellation: await canceled.completion, workspaceFiles: readdirSync(root) }))
} finally {
  rmSync(root, { recursive: true, force: true })
}
