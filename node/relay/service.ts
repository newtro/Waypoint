import type { OpaqueRelayMessage, RelayAuthority, RelayReceipt } from './types.js'

export class OpaqueRelayService {
  private readonly messages = new Map<string, OpaqueRelayMessage>()
  private readonly acceptedAt = new Map<string, string>()
  private readonly sequences = new Map<string, number>()
  constructor(private readonly authority: RelayAuthority, private readonly limits={maxEnvelopeBytes:8*1024*1024,maxMessages:10_000,maxWorkspaceBytes:512*1024*1024}) {}

  enqueue(message: OpaqueRelayMessage, now = new Date()): RelayReceipt {
    if (!(message.envelope instanceof Uint8Array) || message.envelope.byteLength === 0) throw new Error('Opaque envelope is required')
    if (message.envelope.byteLength > this.limits.maxEnvelopeBytes) throw new Error('Opaque envelope exceeds relay limit')
    const expires=Date.parse(message.expiresAt),created=Date.parse(message.createdAt)
    if(!Number.isFinite(expires)||!Number.isFinite(created)||expires<=now.getTime()||created>now.getTime()+30_000||expires<=created)throw new Error('Expired or invalid envelope is rejected')
    const existing = this.messages.get(message.messageId)
    if (existing) {
      if (!sameMessage(existing, message)) throw new Error('Message identifier collision')
      return { messageId: message.messageId, acceptedAt: this.acceptedAt.get(message.messageId)! }
    }
    if (!this.authority.isActive(message.workspaceId,message.senderDeviceId,message.keyEpoch)) throw new Error('Sender is not an active device at this key epoch')
    if(!this.authority.verifySignature(message))throw new Error('Envelope signature is invalid')
    if(!Number.isSafeInteger(message.sequence)||message.sequence<1)throw new Error('Valid sender sequence required')
    const sequenceKey=`${message.workspaceId}:${message.senderDeviceId}`, prior=this.sequences.get(sequenceKey)??0
    if(message.sequence<=prior)throw new Error('Sender sequence replay or rollback')
    if(this.messages.size>=this.limits.maxMessages)throw new Error('Relay message quota exceeded')
    const workspaceBytes=[...this.messages.values()].filter((item)=>item.workspaceId===message.workspaceId).reduce((sum,item)=>sum+item.envelope.byteLength,0)
    if(workspaceBytes+message.envelope.byteLength>this.limits.maxWorkspaceBytes)throw new Error('Relay workspace storage quota exceeded')
    this.messages.set(message.messageId, { ...message, envelope: message.envelope.slice() })
    this.acceptedAt.set(message.messageId, now.toISOString())
    this.sequences.set(sequenceKey,message.sequence)
    return { messageId: message.messageId, acceptedAt: now.toISOString() }
  }

  pull(workspaceId: string, recipientDeviceId: string, now = new Date(), limit = 100): OpaqueRelayMessage[] {
    this.purgeExpired(now)
    return [...this.messages.values()]
      .filter((item) => item.workspaceId === workspaceId && item.recipientDeviceId === recipientDeviceId && this.authority.isActive(workspaceId,recipientDeviceId,item.keyEpoch) && this.authority.isActive(workspaceId,item.senderDeviceId,item.keyEpoch))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.max(0, Math.min(limit, 1000)))
      .map((item) => ({ ...item, envelope: item.envelope.slice() }))
  }

  acknowledge(workspaceId: string, recipientDeviceId: string, messageId: string): boolean {
    const message = this.messages.get(messageId)
    if (!message || message.workspaceId !== workspaceId || message.recipientDeviceId !== recipientDeviceId || !this.authority.isActive(workspaceId,recipientDeviceId,message.keyEpoch)) return false
    this.acceptedAt.delete(messageId)
    return this.messages.delete(messageId)
  }

  purgeExpired(now = new Date()): number {
    let purged = 0
    for (const [id, message] of this.messages) {
      if (Date.parse(message.expiresAt) <= now.getTime()) {
        this.messages.delete(id)
        this.acceptedAt.delete(id)
        purged += 1
      }
    }
    return purged
  }

  size(): number { return this.messages.size }
}

function sameMessage(left: OpaqueRelayMessage, right: OpaqueRelayMessage): boolean {
  return left.workspaceId === right.workspaceId && left.recipientDeviceId === right.recipientDeviceId &&
    left.senderDeviceId === right.senderDeviceId && left.createdAt === right.createdAt &&
    left.keyEpoch === right.keyEpoch && left.sequence === right.sequence &&
    left.expiresAt === right.expiresAt && Buffer.from(left.envelope).equals(Buffer.from(right.envelope))
}
