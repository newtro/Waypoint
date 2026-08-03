import { describe, expect, it, vi } from 'vitest'
import { cliCompatibility, cliExecutionPath, cliSearchDirectories, detectCli, parseCliVersion, resolveExecutable } from './cli-capabilities.js'

describe('cross-platform CLI capability detection', () => {
  it('uses PATHEXT for native Windows resolution', async () => {
    const found = await resolveExecutable('codex', {
      platform: 'win32', env: { PATH: 'C:\\Tools', PATHEXT: '.EXE;.CMD' },
      canAccess: async (candidate) => { if (!candidate.endsWith('codex.EXE')) throw new Error('missing') },
    })
    expect(found).toBe('C:\\Tools\\codex.EXE')
  })

  it('finds user-local Claude and the ChatGPT-bundled Codex with a Finder-style PATH', async () => {
    const accessible = new Set([
      '/Users/test/.local/bin/claude',
      '/Applications/ChatGPT.app/Contents/Resources/codex',
    ])
    const canAccess = async (candidate: string) => { if (!accessible.has(candidate)) throw new Error('missing') }
    const env = { PATH: '/usr/bin:/bin', HOME: '/Users/test' }
    await expect(resolveExecutable('claude', { platform: 'darwin', env, canAccess })).resolves.toBe('/Users/test/.local/bin/claude')
    await expect(resolveExecutable('codex', { platform: 'darwin', env, canAccess })).resolves.toBe('/Applications/ChatGPT.app/Contents/Resources/codex')
    expect(cliSearchDirectories(env, 'darwin')).toContain('/opt/homebrew/bin')
  })

  it('builds a child PATH that keeps the resolved executable and its runtime dependencies reachable', () => {
    expect(cliExecutionPath('/Users/test/.local/bin/claude', { PATH: '/usr/bin', HOME: '/Users/test' }, 'darwin').split(':'))
      .toEqual(expect.arrayContaining(['/Users/test/.local/bin', '/usr/bin', '/opt/homebrew/bin']))
  })

  it('executes the exact resolved path without re-resolving the name', async () => {
    const run = vi.fn(async () => ({ stdout: 'codex-cli 1.2.3', stderr: '' }))
    const result = await detectCli('codex', {
      env: { PATH: '/trusted/bin' }, platform: 'darwin', canAccess: async () => undefined, run,
    })
    expect(run).toHaveBeenCalledWith('/trusted/bin/codex', ['--version'])
    expect(result.available).toBe(true)
  })

  it('returns structured missing and malformed states', async () => {
    const missing = await detectCli('claude', { env: { PATH: '/none' }, canAccess: async () => { throw new Error('missing') } })
    expect(missing).toMatchObject({ available: false, error: expect.stringContaining('supported local install location') })
    const malformed = await detectCli('claude', {
      env: { PATH: '/trusted' }, canAccess: async () => undefined,
      run: async () => ({ stdout: '', stderr: '' }),
    })
    expect(malformed).toMatchObject({ available: false, error: 'CLI returned an empty version' })
  })

  it('surfaces timeout and execution failures without throwing', async () => {
    const result = await detectCli('codex', {
      env: { PATH: '/trusted' }, canAccess: async () => undefined,
      run: async () => { throw new Error('timed out') },
    })
    expect(result).toMatchObject({ available: false, error: 'timed out' })
  })
  it('parses decorated versions and returns actionable compatibility policy',()=>{
    expect(parseCliVersion('codex-cli 0.146.0-alpha.9.2')).toEqual([0,146,0])
    expect(cliCompatibility('codex','codex-cli 0.146.0-alpha.9.2')).toEqual({compatible:true})
    expect(cliCompatibility('claude','2.1.220 (Claude Code)')).toEqual({compatible:true})
    expect(cliCompatibility('claude','2.1.219')).toMatchObject({compatible:false,error:expect.stringContaining('2.1.220 or newer')})
    expect(cliCompatibility('codex','1.0.0')).toMatchObject({compatible:false,error:expect.stringContaining("newer than Waypoint's validated range")})
    expect(cliCompatibility('codex','development build')).toMatchObject({compatible:false,error:expect.stringContaining('Could not parse')})
  })
})
