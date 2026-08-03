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
  expiresAt: string
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
  deviceKeyDigest?: string
  wrappedWorkspaceKeyDigest?: string
  signature: string
}

export interface EnrollmentInvitation {
  version: 1
  invitationId: string
  workspaceId: string
  ownerDeviceId: string
  membershipEpoch: number
  secretHash: string
  expiresAt: string
  signature: string
}

export interface EnrollmentConsumeProof {
  version: 1
  requestId: string
  workspaceId: string
  deviceId: string
  approvalSignatureDigest: string
  nonce: string
  createdAt: string
  signature: string
}
export interface RotationClaimProof{version:1;workspaceId:string;deviceId:string;targetEpoch:number;nonce:string;createdAt:string;signature:string}

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
