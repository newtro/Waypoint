import { describe, expect, it, vi } from 'vitest'
import { cliCompatibility, detectCli, parseCliVersion, resolveExecutable } from './cli-capabilities.js'

describe('cross-platform CLI capability detection', () => {
  it('uses PATHEXT for native Windows resolution', async () => {
    const found = await resolveExecutable('codex', {
      platform: 'win32', env: { PATH: 'C:\\Tools', PATHEXT: '.EXE;.CMD' },
      canAccess: async (candidate) => { if (!candidate.endsWith('codex.EXE')) throw new Error('missing') },
    })
    expect(found).toBe('C:\\Tools\\codex.EXE')
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
    expect(missing).toMatchObject({ available: false, error: 'claude was not found on PATH' })
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
