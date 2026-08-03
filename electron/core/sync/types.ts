export interface DeviceIdentity {
  deviceId: string
  signingPublicKey: string
  encryptionPublicKey: string
}

export interface DeviceKeyPair extends DeviceIdentity {
  signingPrivateKey: string
  encryptionPrivateKey: string
}

export interface SignedEncryptedEnvelope {
  version: 1
  envelopeId: string
  workspaceId: string
  senderDeviceId: string
  recipientDeviceId: string
  keyEpoch: number
  sequence: number
  createdAt: string
  nonce: string
  ciphertext: string
  signature: string
}

export interface EnrollmentRequest {
  version: 1
  requestId: string
  workspaceId: string
  device: DeviceIdentity
  createdAt: string
  expiresAt: string
  signature: string
}

export interface EnrollmentApproval {
  version: 1
  requestId: string
  workspaceId: string
  ownerDeviceId: string
  membershipEpoch: number
  approvedAt: string
  signature: string
}

export interface DeviceRecord extends DeviceIdentity {
  workspaceId: string
  enrolledAt: string
  revokedAt?: string
  lastSeenAt?: string
  membershipEpoch: number
}

export interface PresenceRecord {
  deviceId: string
  observedAt: string
  expiresAt: string
}
