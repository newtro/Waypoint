import { describe, expect, it } from 'vitest'
import { OpaqueRelayService } from '../../../node/relay/service.js'
import type { OpaqueRelayMessage } from '../../../node/relay/types.js'

const now = new Date('2026-08-02T10:00:00Z')
const message = (overrides: Partial<OpaqueRelayMessage> = {}): OpaqueRelayMessage => ({
  protocolVersion:1,messageId:'message_opaque_01',workspaceId:'workspace_opaque_01',recipientDeviceId:'recipient_peer_01',senderDeviceId:'sender_device_001',
  keyEpoch:1,sequence:1,
  createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  envelope: new Uint8Array([1, 2, 3]), ...overrides,
})

describe('OpaqueRelayService', () => {
  it('queues opaque bytes, scopes pulls and acknowledgements, and returns defensive copies', () => {
    const relay = new OpaqueRelayService({isActive:()=>true,verifySignature:()=>true})
    relay.enqueue(message(), now)
    expect(relay.pull('workspace_other_01','recipient_peer_01',now)).toEqual([])
    const pulled=relay.pull('workspace_opaque_01','recipient_peer_01',now)
    expect(pulled).toHaveLength(1)
    pulled[0].envelope[0] = 9
    expect(relay.pull('workspace_opaque_01','recipient_peer_01',now)[0].envelope[0]).toBe(1)
    expect(relay.acknowledge('workspace_opaque_01','other_device_001','message_opaque_01')).toBe(false)
    expect(relay.acknowledge('workspace_opaque_01','recipient_peer_01','message_opaque_01')).toBe(true)
  })

  it('is idempotent for exact retries and rejects collisions, expiry, and oversize data', () => {
    const relay = new OpaqueRelayService({isActive:()=>true,verifySignature:()=>true},{maxEnvelopeBytes:3,maxMessages:10,maxWorkspaceBytes:10})
    const firstReceipt = relay.enqueue(message(), now)
    expect(()=>relay.enqueue(message({envelope:new Uint8Array([9])}),now)).toThrow('collision')
    expect(relay.enqueue(message(), new Date(now.getTime() + 500))).toEqual(firstReceipt)
    expect(()=>relay.enqueue(message({messageId:'expired_message_1',expiresAt:now.toISOString()}),now)).toThrow('Expired')
    expect(()=>relay.enqueue(message({messageId:'large_message_001',envelope:new Uint8Array(4)}),now)).toThrow('exceeds')
    expect(()=>relay.enqueue(message({messageId:'rollback_message',sequence:1}),now)).toThrow('replay')
    expect(relay.purgeExpired(new Date(now.getTime() + 60_000))).toBe(1)
  })

  it('refuses delivery authority to a revoked or wrong-epoch sender',()=>{
    const relay=new OpaqueRelayService({isActive:(_workspace,device,epoch)=>device==='sender_device_001'&&epoch===2,verifySignature:()=>true})
    expect(()=>relay.enqueue(message(),now)).toThrow('active')
    expect(relay.enqueue(message({messageId:'authorized_msg_01',keyEpoch:2}),now)).toMatchObject({messageId:'authorized_msg_01'})
    expect(relay.pull('workspace_opaque_01','recipient_peer_01',now)).toEqual([])
  })
  it('rejects malformed dates, invalid signatures, and storage quota overflow',()=>{
    expect(()=>new OpaqueRelayService({isActive:()=>true,verifySignature:()=>true}).enqueue(message({protocolVersion:2}),now)).toThrow('protocol')
    expect(()=>new OpaqueRelayService({isActive:()=>true,verifySignature:()=>true}).enqueue(message({expiresAt:'not-a-date'}),now)).toThrow('invalid')
    expect(()=>new OpaqueRelayService({isActive:()=>true,verifySignature:()=>false}).enqueue(message(),now)).toThrow('signature')
    expect(()=>new OpaqueRelayService({isActive:()=>true,verifySignature:()=>true}).enqueue(message({workspaceId:'named workspace'}),now)).toThrow('opaque')
    const relay=new OpaqueRelayService({isActive:()=>true,verifySignature:()=>true},{maxEnvelopeBytes:3,maxMessages:1,maxWorkspaceBytes:3});relay.enqueue(message(),now)
    expect(()=>relay.enqueue(message({messageId:'second_message_01',sequence:2}),now)).toThrow('quota')
  })
})
