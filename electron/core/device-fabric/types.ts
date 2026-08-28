import type { DeviceIdentity, DeviceKeyPair } from "../sync/types.js";

export type DevicePlatform = "darwin" | "win32" | "linux" | "unknown";
export type DeviceOperatingMode = "supervised" | "autonomous";

export interface DeviceMetadata {
  displayName: string;
  platform: DevicePlatform;
  architecture: string;
  appVersion: string;
}

export interface DeviceHostIdentity {
  certificatePem: string;
  privateKeyPem: string;
  fingerprintSha256: string;
  createdAt: string;
}

export interface TrustedDeviceRecord {
  device: DeviceIdentity;
  fingerprintSha256: string;
  metadata: DeviceMetadata;
  pairedAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
  defaultMode: DeviceOperatingMode;
  workspaceGrantPolicy: "all_current_and_future";
  reciprocalState: "pending" | "active";
  certificateFingerprintSha256?: string;
}

export interface DevicePairingPeerRecord {
  deviceId: string;
  signingPublicKey?: string;
  device?: DeviceIdentity;
  fingerprintSha256: string;
  metadata: DeviceMetadata;
  endpoint: string;
  certificateFingerprintSha256: string;
  capabilities: string[];
}

export interface DevicePairingSessionRecord {
  sessionId: string;
  direction: "incoming" | "outgoing";
  peer: DevicePairingPeerRecord;
  requesterNonce: string;
  responderNonce?: string;
  code?: string;
  expiresAt: string;
  recoveryUntil?: string;
  localConfirmed: boolean;
  remoteConfirmed: boolean;
  completed: boolean;
}

export interface ProtectedDeviceFabricState {
  version: 1;
  local: {
    device: DeviceKeyPair;
    fingerprintSha256: string;
    metadata: DeviceMetadata;
    createdAt: string;
    hostIdentity?: DeviceHostIdentity;
  };
  trustedDevices: TrustedDeviceRecord[];
  pairingSessions?: DevicePairingSessionRecord[];
  consumedAuthorizations?: DeviceConsumedAuthorization[];
  legacyWorkspaceDeviceIds: string[];
  updatedAt: string;
}

export interface DeviceFabricStatus {
  version: 1;
  localDeviceId: string;
  fingerprintSha256: string;
  metadata: DeviceMetadata;
  trustedDeviceCount: number;
  activeTrustedDeviceCount: number;
  legacyWorkspaceIdentityCount: number;
}

export interface DeviceOperationAuthorizationProposal {
  version: 1;
  initiatorDeviceId: string;
  responderDeviceId: string;
  scope: string;
  requestDigestSha256: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  initiatorSignature: string;
}

export interface DeviceOperationAuthorization
  extends DeviceOperationAuthorizationProposal {
  responderSignature: string;
}

export interface DeviceConsumedAuthorization {
  authorizationIdSha256: string;
  expiresAt: string;
  consumedAt: string;
}

export interface FleetWorkspaceCatalogEntry {
  workspaceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  authoritativeDeviceId: string;
  keyEpoch: number;
  counts: {
    chats: number;
    documents: number;
    memories: number;
    attachments: number;
  };
}

export interface FleetWorkspaceCatalog {
  version: 1;
  deviceId: string;
  generatedAt: string;
  workspaces: FleetWorkspaceCatalogEntry[];
}

export interface FleetSearchResult {
  sourceDeviceId: string;
  workspaceId: string;
  workspaceName: string;
  objectId: string;
  objectKind: string;
  revisionId?: string;
  title: string;
  excerpt: string;
  score: number;
  method: "text";
}

export interface FleetSearchResponse {
  version: 1;
  deviceId: string;
  query: string;
  generatedAt: string;
  partial: boolean;
  results: FleetSearchResult[];
}
