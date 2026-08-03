import { describe, expect, it, vi } from 'vitest'
import { PeerExecutionAuthorizer, type LocalExecutionProfile, type PeerExecutionRequest } from './peer-execution.js'

const profile: LocalExecutionProfile = { id: 'safe', enabled: true, allowedSourceDeviceIds: ['mac'], allowedTools: ['codex'], allowedWorkspaceRoots: ['/workspace'], requiresApproval: true }
const request = (overrides: Partial<PeerExecutionRequest> = {}): PeerExecutionRequest => ({
  requestId: 'request-1', sourceDeviceId: 'mac', targetDeviceId: 'pc', profileId: 'safe', tool: 'codex', workspaceRoot: '/workspace/project',
  issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:05:00.000Z', payload: {}, ...overrides,
})
const authorizer = (overrides: Record<string, unknown> = {}) => {const consumed=new Set<string>();return new PeerExecutionAuthorizer({
  localDeviceId: 'pc', now: () => new Date('2026-01-01T00:01:00.000Z'), isActiveSource: () => true,
  verify: async () => true, approve: async () => true,replayStore:{hasPeerRequest:(id:string)=>consumed.has(id),consumePeerRequest:(id:string)=>{consumed.add(id)}}, ...overrides,
} as never)}

describe('target-enforced peer execution', () => {
  it('requires target-local profile bounds and explicit local approval', async () => {
    const approve = vi.fn(async () => true), guard = authorizer({ approve })
    expect(await guard.authorize(request(), profile)).toMatchObject({ allowed: true })
    expect(approve).toHaveBeenCalledOnce()
  })
  it('requires approval even when a profile incorrectly marks it optional',async()=>{const approve=vi.fn(async()=>false);expect(await authorizer({approve}).authorize(request(),{...profile,requiresApproval:false})).toMatchObject({allowed:false});expect(approve).toHaveBeenCalledOnce()})

  it('fails closed for revocation, expiry, wrong target, roots, tools, and denial', async () => {
    expect(await authorizer({ isActiveSource: () => false }).authorize(request(), profile)).toMatchObject({ allowed: false, reason: expect.stringContaining('enrolled') })
    expect(await authorizer().authorize(request({ expiresAt: '2026-01-01T00:00:30Z' }), profile)).toMatchObject({ allowed: false, reason: expect.stringContaining('expired') })
    expect(await authorizer().authorize(request({ targetDeviceId: 'other' }), profile)).toMatchObject({ allowed: false, reason: expect.stringContaining('target') })
    expect(await authorizer().authorize(request({ workspaceRoot: '/workspace-escape' }), profile)).toMatchObject({ allowed: false, reason: expect.stringContaining('root') })
    expect(await authorizer().authorize(request({ workspaceRoot: '/workspace/../escape' }), profile)).toMatchObject({ allowed: false, reason: expect.stringContaining('root') })
    expect(await authorizer().authorize(request({ tool: 'shell' }), profile)).toMatchObject({ allowed: false, reason: expect.stringContaining('Tool') })
    expect(await authorizer({ approve: async () => false }).authorize(request(), profile)).toMatchObject({ allowed: false, reason: expect.stringContaining('denied') })
  })

  it('rejects replay even after an authenticated policy denial', async () => {
    const guard = authorizer()
    expect(await guard.authorize(request(), { ...profile, allowedTools: [] })).toMatchObject({ allowed: false })
    expect(await guard.authorize(request(), profile)).toMatchObject({ allowed: false, reason: expect.stringContaining('consumed') })
  })
})
