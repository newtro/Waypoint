export interface OpaqueRelayMessage {
  messageId: string
  workspaceId: string
  recipientDeviceId: string
  senderDeviceId: string
  keyEpoch: number
  sequence: number
  createdAt: string
  expiresAt: string
  envelope: Uint8Array
}

export interface RelayAuthority {
  isActive(workspaceId:string, deviceId:string, keyEpoch:number): boolean
  verifySignature(message:OpaqueRelayMessage): boolean
}

export interface RelayReceipt {
  messageId: string
  acceptedAt: string
}
