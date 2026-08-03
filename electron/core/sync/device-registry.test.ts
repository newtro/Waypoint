import { describe, expect, it } from 'vitest'
import { WaypointCrypto } from './crypto.js'
import { DeviceRegistry } from './device-registry.js'

describe('DeviceRegistry', () => {
  it('enrolls, tracks expiring presence, and makes revocation terminal', async () => {
    const crypto = await WaypointCrypto.create()
    const consumed=new Set<string>(),registry = new DeviceRegistry(crypto,{hasEnrollment:(id)=>consumed.has(id),consumeEnrollment:(id)=>{consumed.add(id)}})
    const owner=crypto.generateDevice('owner')
    const device = crypto.generateDevice('mac')
    const now = new Date('2026-08-02T10:00:00Z')
    registry.bootstrapOwner('w1',owner,now)
    const enrollment=crypto.createEnrollmentRequest({ workspaceId: 'w1', device, now }),approval=crypto.approveEnrollment(enrollment,owner,1,now);registry.enroll(enrollment,approval, now)
    expect(()=>registry.enroll(enrollment,approval,now)).toThrow('consumed')
    registry.heartbeat('w1', 'mac', now, 1_000)
    expect(registry.activePresence('w1', new Date(now.getTime() + 999))).toHaveLength(1)
    expect(registry.activePresence('w1', new Date(now.getTime() + 1_000))).toHaveLength(0)
    expect(registry.revoke('w1', 'mac', now).revokedAt).toBe(now.toISOString())
    expect(() => registry.heartbeat('w1', 'mac', now)).toThrow('Revoked')
    const retry=crypto.createEnrollmentRequest({workspaceId:'w1',device,now}),retryApproval=crypto.approveEnrollment(retry,owner,1,now)
    expect(() => registry.enroll(retry,retryApproval,now)).toThrow('Revoked')
  })

  it('rejects enrollment tampering and device-id key substitution', async () => {
    const crypto = await WaypointCrypto.create()
    const consumed=new Set<string>(),registry = new DeviceRegistry(crypto,{hasEnrollment:(id)=>consumed.has(id),consumeEnrollment:(id)=>{consumed.add(id)}})
    const owner=crypto.generateDevice('owner')
    const first = crypto.generateDevice('shared-id')
    const replacement = crypto.generateDevice('shared-id')
    const now = new Date('2026-08-02T10:00:00Z')
    registry.bootstrapOwner('w1',owner,now)
    const firstRequest=crypto.createEnrollmentRequest({ workspaceId: 'w1', device: first, now });registry.enroll(firstRequest,crypto.approveEnrollment(firstRequest,owner,1,now),now)
    const replacementRequest=crypto.createEnrollmentRequest({ workspaceId: 'w1', device: replacement, now })
    expect(() => registry.enroll(replacementRequest,crypto.approveEnrollment(replacementRequest,owner,1,now),now)).toThrow('key mismatch')
    const request = crypto.createEnrollmentRequest({ workspaceId: 'w1', device: first, now })
    expect(() => registry.enroll({ ...request, workspaceId: 'w2' },crypto.approveEnrollment(request,owner,1,now),now)).toThrow('invalid')
    const outsider=crypto.generateDevice('outsider')
    expect(()=>registry.enroll(request,crypto.approveEnrollment(request,outsider,1,now),now)).toThrow('owner')
  })
})
