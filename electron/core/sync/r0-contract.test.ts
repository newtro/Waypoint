import {describe,expect,it} from 'vitest'
import {OpaqueRelayService} from '../../../node/relay/service.js'
import type {OpaqueRelayMessage} from '../../../node/relay/types.js'
import {DeterministicSyncEngine} from './sync-engine.js'
import {negotiateSchemas} from './schema.js'
import {NODE_METADATA_SURFACES,RELAY_VISIBLE_FIELDS,R0_PROTOCOL_CONTRACT,relayMetadataView,validateRecoveryManifest} from './protocol-contract.js'
import {WaypointCrypto} from './crypto.js'
import {toOpaqueRelayMessage,verifyOpaqueRelayMessage} from './relay-adapter.js'

const now=new Date('2026-08-03T12:00:00Z')
const message=(overrides:Partial<OpaqueRelayMessage>={}):OpaqueRelayMessage=>({protocolVersion:1,messageId:'opaque_message_001',workspaceId:'opaque_workspace_01',recipientDeviceId:'opaque_peer_b_001',senderDeviceId:'opaque_peer_a_001',keyEpoch:1,sequence:1,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+60_000).toISOString(),envelope:new Uint8Array([9,8,7]),...overrides})

describe('R0 frozen local contract',()=>{
  it('negotiates only mutually supported required schemas and fails closed',()=>{
    const local={deviceId:'mac',schemas:R0_PROTOCOL_CONTRACT.schemas},remote={deviceId:'peer',schemas:{objects:{minimum:1,maximum:2},attachments:{minimum:2,maximum:2}}}
    expect(negotiateSchemas(local,remote,['objects','attachments'])).toEqual([{collection:'attachments',version:2},{collection:'objects',version:1}])
    expect(()=>negotiateSchemas(local,{...remote,schemas:{...remote.schemas,objects:{minimum:2,maximum:2}}},['objects'])).toThrow('No compatible')
  })

  it('exposes only frozen opaque delivery metadata',()=>{
    const metadata=relayMetadataView(message())
    expect(Object.keys(metadata).sort()).toEqual([...RELAY_VISIBLE_FIELDS].sort())
    expect(JSON.stringify(metadata)).not.toMatch(/body|filename|prompt|workspaceKey|ciphertext/i)
    expect(NODE_METADATA_SURFACES.neverNodeVisible).toContain('recoveryPassphrase')
    expect(NODE_METADATA_SURFACES.enrollment).toContain('applicantSigningPublicKey')
  })

  it('enforces epoch authority, replay rejection, revocation, and maximum relay lifetime',()=>{
    const active=new Set(['opaque_peer_a_001','opaque_peer_b_001']),relay=new OpaqueRelayService({isActive:(_workspace,device,epoch)=>active.has(device)&&epoch===1,verifySignature:()=>true})
    relay.enqueue(message(),now)
    expect(()=>relay.enqueue(message({messageId:'replay_message_01',sequence:1}),now)).toThrow('replay')
    expect(()=>relay.enqueue(message({messageId:'future_message_01',sequence:2,expiresAt:new Date(now.getTime()+8*86_400_000).toISOString()}),now)).toThrow('lifetime')
    active.delete('opaque_peer_a_001')
    expect(relay.pull('opaque_workspace_01','opaque_peer_b_001',now)).toEqual([])
  })

  it('keeps deletion dominant after an offline stale update',()=>{
    const engine=new DeterministicSyncEngine<{body:string}>()
    engine.apply({changeId:'upsert',objectId:'document',authorDeviceId:'peer-a',clock:{'peer-a':1},kind:'upsert',value:{body:'original'}})
    engine.apply({changeId:'delete',objectId:'document',authorDeviceId:'peer-a',clock:{'peer-a':2},kind:'delete',deletedAt:now.toISOString()})
    engine.apply({changeId:'offline-stale',objectId:'document',authorDeviceId:'peer-b',clock:{'peer-b':1},kind:'upsert',value:{body:'resurrect'}})
    expect(engine.state('document')?.kind).toBe('deleted')
  })

  it('round-trips the frozen offline recovery artifact and rejects tampering or a wrong passphrase',async()=>{
    const crypto=await WaypointCrypto.create(),key=crypto.generateWorkspaceKey(),manifest=crypto.createRecoveryManifest('opaque_workspace_01',key,'a careful offline passphrase',now)
    expect(validateRecoveryManifest(manifest,now)).toEqual(manifest)
    expect(crypto.recoverWorkspaceKey(manifest,'a careful offline passphrase',now)).toBe(key)
    expect(()=>crypto.recoverWorkspaceKey(manifest,'the wrong passphrase!',now)).toThrow('cannot be opened')
    expect(()=>crypto.recoverWorkspaceKey({...manifest,body:'must not enter recovery'},'a careful offline passphrase',now)).toThrow('Unexpected')
    expect(()=>validateRecoveryManifest({...manifest,salt:Buffer.alloc(12).toString('base64')},now)).toThrow('salt')
    expect(()=>validateRecoveryManifest({...manifest,nonce:Buffer.alloc(16).toString('base64')},now)).toThrow('nonce')
    expect(R0_PROTOCOL_CONTRACT.recovery.serverEscrow).toBe(false)
  })

  it('cryptographically binds relay-visible routing, epoch, sequence, and lifetime metadata',async()=>{
    const crypto=await WaypointCrypto.create(),sender=crypto.generateDevice('opaque_sender_001'),recipient=crypto.generateDevice('opaque_recipient_1'),key=crypto.generateWorkspaceKey()
    const envelope=crypto.encryptEnvelope({workspaceId:'opaque_workspace_01',sender,recipient,workspaceKey:key,payload:{body:'private'},keyEpoch:3,sequence:7,now,ttlMs:60_000}),message=toOpaqueRelayMessage(envelope)
    const relay=new OpaqueRelayService({isActive:()=>true,verifySignature:(candidate)=>verifyOpaqueRelayMessage(candidate,sender,crypto)})
    expect(relay.enqueue(message,now).messageId).toBe(envelope.envelopeId)
    expect(()=>new OpaqueRelayService({isActive:()=>true,verifySignature:(candidate)=>verifyOpaqueRelayMessage(candidate,sender,crypto)}).enqueue({...message,keyEpoch:4},now)).toThrow('signature')
    expect(()=>new OpaqueRelayService({isActive:()=>true,verifySignature:(candidate)=>verifyOpaqueRelayMessage(candidate,sender,crypto)}).enqueue({...message,expiresAt:new Date(now.getTime()+120_000).toISOString()},now)).toThrow('signature')
  })
})
