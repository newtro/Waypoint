import type {OpaqueRelayMessage} from '../../../node/relay/types.js'
import type {DeviceIdentity,SignedEncryptedEnvelope} from './types.js'
import {WaypointCrypto} from './crypto.js'

const encode=(value:SignedEncryptedEnvelope)=>new TextEncoder().encode(JSON.stringify(value))

export function toOpaqueRelayMessage(envelope:SignedEncryptedEnvelope):OpaqueRelayMessage{
  return{protocolVersion:envelope.version,messageId:envelope.envelopeId,workspaceId:envelope.workspaceId,recipientDeviceId:envelope.recipientDeviceId,senderDeviceId:envelope.senderDeviceId,keyEpoch:envelope.keyEpoch,sequence:envelope.sequence,createdAt:envelope.createdAt,expiresAt:envelope.expiresAt,envelope:encode(envelope)}
}

export function verifyOpaqueRelayMessage(message:OpaqueRelayMessage,sender:DeviceIdentity,crypto:WaypointCrypto):boolean{
  try{
    const envelope=JSON.parse(new TextDecoder().decode(message.envelope)) as SignedEncryptedEnvelope
    return message.protocolVersion===envelope.version&&message.messageId===envelope.envelopeId&&message.workspaceId===envelope.workspaceId&&message.recipientDeviceId===envelope.recipientDeviceId&&message.senderDeviceId===envelope.senderDeviceId&&message.keyEpoch===envelope.keyEpoch&&message.sequence===envelope.sequence&&message.createdAt===envelope.createdAt&&message.expiresAt===envelope.expiresAt&&crypto.verifyEnvelopeSignature(envelope,sender)
  }catch{return false}
}
