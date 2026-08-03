import { describe, expect, it } from 'vitest'
import { WaypointCrypto } from './crypto.js'

describe('WaypointCrypto', () => {
  it('round-trips signed encrypted envelopes and rejects tampering or a wrong key', async () => {
    const crypto = await WaypointCrypto.create()
    const sender = crypto.generateDevice('mac')
    const recipient = crypto.generateDevice('pc')
    const key = crypto.generateWorkspaceKey()
    const envelope = crypto.encryptEnvelope({ workspaceId: 'w1', sender, recipient, workspaceKey: key, keyEpoch:1, sequence:1, payload: { op: 'upsert', text: 'private' } })
    expect(JSON.stringify(envelope)).not.toContain('private')
    expect(crypto.decryptEnvelope({ envelope, sender, recipient, workspaceKey: key })).toEqual({ op: 'upsert', text: 'private' })

    expect(() => crypto.decryptEnvelope({ envelope: { ...envelope, workspaceId: 'w2' }, sender, recipient, workspaceKey: key })).toThrow()
    expect(() => crypto.decryptEnvelope({ envelope: { ...envelope, keyEpoch: 2 }, sender, recipient, workspaceKey: key })).toThrow()
    expect(() => crypto.decryptEnvelope({ envelope, sender, recipient, workspaceKey: crypto.generateWorkspaceKey() })).toThrow()
  })

  it('authenticates attachment chunk metadata with the same local workspace key', async()=>{
    const crypto=await WaypointCrypto.create(), key=crypto.generateWorkspaceKey(), chunks=crypto.chunkCrypto(key)
    const body=new Uint8Array([1,2,3]), aad=new TextEncoder().encode('transfer:file:0')
    const sealed=await chunks.seal(body,aad)
    expect(await chunks.open(sealed,aad)).toEqual(body)
    await expect(chunks.open(sealed,new TextEncoder().encode('transfer:file:1'))).rejects.toThrow()
    const changed=sealed.slice();changed[changed.length-1]^=1
    await expect(chunks.open(changed,aad)).rejects.toThrow()
  })

  it('creates self-signed, expiring enrollment requests', async () => {
    const crypto = await WaypointCrypto.create()
    const device = crypto.generateDevice('mac')
    const now = new Date('2026-08-02T10:00:00Z')
    const request = crypto.createEnrollmentRequest({ workspaceId: 'w1', device, now, ttlMs: 1_000 })
    expect(crypto.verifyEnrollmentRequest(request, new Date(now.getTime() + 999))).toBe(true)
    expect(crypto.verifyEnrollmentRequest(request, new Date(now.getTime() + 1_000))).toBe(false)
    expect(crypto.verifyEnrollmentRequest({ ...request, workspaceId: 'w2' }, now)).toBe(false)
  })

  it('wraps workspace keys to one device encryption identity', async () => {
    const crypto = await WaypointCrypto.create()
    const intended = crypto.generateDevice('intended')
    const other = crypto.generateDevice('other')
    const key = crypto.generateWorkspaceKey()
    const wrapped = crypto.wrapWorkspaceKey(key, intended)
    expect(wrapped).not.toContain(key)
    expect(crypto.unwrapWorkspaceKey(wrapped, intended)).toBe(key)
    expect(() => crypto.unwrapWorkspaceKey(wrapped, other)).toThrow('cannot be opened')
  })
})
