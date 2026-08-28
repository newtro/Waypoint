import { createHash, randomBytes, X509Certificate } from "node:crypto";
import selfsigned from "selfsigned";
import { WaypointCrypto } from "../sync/crypto.js";
import type { DeviceIdentity } from "../sync/types.js";
import { ProtectedDeviceVault } from "./protected-device-vault.js";
import type {
  DeviceFabricStatus,
  DeviceHostIdentity,
  DeviceOperationAuthorization,
  DeviceOperationAuthorizationProposal,
  DevicePairingSessionRecord,
  DeviceMetadata,
  DeviceOperatingMode,
  ProtectedDeviceFabricState,
  TrustedDeviceRecord,
} from "./types.js";

const DEVICE_ID = /^[A-Za-z0-9_-]{16,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const AUTHORIZATION_SCOPE = /^[A-Za-z0-9:._/-]{1,256}$/;
const AUTHORIZATION_TTL_MS = 30_000;
const MAX_CONSUMED_AUTHORIZATIONS = 8_192;

export function deviceOperationRequestDigest(
  requestBytes: string | Uint8Array,
): string {
  return createHash("sha256").update(requestBytes).digest("hex");
}

function authorizationPayload(
  value: Omit<
    DeviceOperationAuthorizationProposal,
    "initiatorSignature"
  >,
): string {
  return JSON.stringify({
    version: value.version,
    initiatorDeviceId: value.initiatorDeviceId,
    responderDeviceId: value.responderDeviceId,
    scope: value.scope,
    requestDigestSha256: value.requestDigestSha256,
    nonce: value.nonce,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  });
}

function fingerprint(device: DeviceIdentity): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        device.deviceId,
        device.signingPublicKey,
        device.encryptionPublicKey,
      ]),
    )
    .digest("hex");
}

function canonicalMetadata(value: DeviceMetadata): DeviceMetadata {
  return {
    displayName: value.displayName.trim().slice(0, 120),
    platform: ["darwin", "win32", "linux"].includes(value.platform)
      ? value.platform
      : "unknown",
    architecture: value.architecture,
    appVersion: value.appVersion,
  };
}

function clonePairingSession(
  value: DevicePairingSessionRecord,
): DevicePairingSessionRecord {
  return {
    ...value,
    peer: {
      ...value.peer,
      ...(value.peer.device ? { device: { ...value.peer.device } } : {}),
      metadata: { ...value.peer.metadata },
      capabilities: [...value.peer.capabilities],
    },
  };
}

function assertSemanticIntegrity(
  state: ProtectedDeviceFabricState,
  crypto: WaypointCrypto,
): void {
  if (!crypto.validateDeviceKeyPair(state.local.device))
    throw new Error("Protected local device keypair integrity mismatch");
  if (state.local.fingerprintSha256 !== fingerprint(state.local.device))
    throw new Error("Protected local device fingerprint mismatch");
  for (const peer of state.trustedDevices)
    if (peer.fingerprintSha256 !== fingerprint(peer.device))
      throw new Error("Protected trusted device fingerprint mismatch");
  for (const session of state.pairingSessions ?? [])
    if (
      session.peer.device &&
      session.peer.fingerprintSha256 !== fingerprint(session.peer.device)
    )
      throw new Error("Protected pairing device fingerprint mismatch");
}

export class DeviceFabricService {
  private constructor(
    private readonly vault: ProtectedDeviceVault,
    private readonly crypto: WaypointCrypto,
    private state: ProtectedDeviceFabricState,
  ) {}

  static async create(
    vault: ProtectedDeviceVault,
    metadata: DeviceMetadata,
    legacyWorkspaceDeviceIds: string[] = [],
    now = new Date(),
  ): Promise<DeviceFabricService> {
    const crypto = await WaypointCrypto.create();
    let state = vault.load((candidate) =>
      assertSemanticIntegrity(candidate, crypto),
    );
    const legacy = [...new Set(legacyWorkspaceDeviceIds)].sort();
    if (!state) {
      const device = crypto.generateDevice();
      state = {
        version: 1,
        local: {
          device,
          fingerprintSha256: fingerprint(device),
          metadata: canonicalMetadata(metadata),
          createdAt: now.toISOString(),
        },
        trustedDevices: [],
        pairingSessions: [],
        consumedAuthorizations: [],
        legacyWorkspaceDeviceIds: legacy,
        updatedAt: now.toISOString(),
      };
      vault.save(state);
    } else {
      const nextMetadata = canonicalMetadata(metadata);
      const nextLegacy = [
        ...new Set([...state.legacyWorkspaceDeviceIds, ...legacy]),
      ].sort();
      const requiresAuthorizationMigration =
        state.consumedAuthorizations === undefined ||
        state.trustedDevices.some((peer) => peer.reciprocalState === undefined);
      if (
        JSON.stringify(state.local.metadata) !== JSON.stringify(nextMetadata) ||
        JSON.stringify(state.legacyWorkspaceDeviceIds) !==
          JSON.stringify(nextLegacy) ||
        requiresAuthorizationMigration
      ) {
        state = {
          ...state,
          local: { ...state.local, metadata: nextMetadata },
          trustedDevices: state.trustedDevices.map((peer) => ({
            ...peer,
            reciprocalState: peer.reciprocalState ?? "active",
          })),
          consumedAuthorizations: state.consumedAuthorizations ?? [],
          legacyWorkspaceDeviceIds: nextLegacy,
          updatedAt: now.toISOString(),
        };
        vault.save(state);
      }
    }
    return new DeviceFabricService(vault, crypto, state);
  }

  status(): DeviceFabricStatus {
    return {
      version: 1,
      localDeviceId: this.state.local.device.deviceId,
      fingerprintSha256: this.state.local.fingerprintSha256,
      metadata: { ...this.state.local.metadata },
      trustedDeviceCount: this.state.trustedDevices.length,
      activeTrustedDeviceCount: this.state.trustedDevices.filter(
        (peer) => !peer.revokedAt && peer.reciprocalState === "active",
      ).length,
      legacyWorkspaceIdentityCount: this.state.legacyWorkspaceDeviceIds.length,
    };
  }

  localIdentity(): DeviceIdentity {
    const device = this.state.local.device;
    return {
      deviceId: device.deviceId,
      signingPublicKey: device.signingPublicKey,
      encryptionPublicKey: device.encryptionPublicKey,
    };
  }

  sign(payload: string): string {
    return this.crypto.signDevicePayload(payload, this.state.local.device);
  }

  verify(payload: string, signature: string, device: DeviceIdentity): boolean {
    return this.crypto.verifyDevicePayload(payload, signature, device);
  }

  verifySigningKey(
    payload: string,
    signature: string,
    signingPublicKey: string,
  ): boolean {
    return this.crypto.verifySigningPayload(
      payload,
      signature,
      signingPublicKey,
    );
  }

  wrapWorkspaceKeyForDevice(
    workspaceKey: string,
    recipientDeviceId: string,
  ): string {
    const recipient = this.state.trustedDevices.find(
      (peer) =>
        peer.device.deviceId === recipientDeviceId && !peer.revokedAt,
    );
    if (!recipient) throw new Error("Trusted workspace-key recipient not found");
    return this.crypto.wrapWorkspaceKey(workspaceKey, recipient.device);
  }

  unwrapWorkspaceKeyFromDevice(wrappedWorkspaceKey: string): string {
    return this.crypto.unwrapWorkspaceKey(
      wrappedWorkspaceKey,
      this.state.local.device,
    );
  }

  trustedDevices(
    includeRevoked = false,
    includePending = false,
  ): TrustedDeviceRecord[] {
    return this.state.trustedDevices
      .filter(
        (peer) =>
          (includeRevoked || !peer.revokedAt) &&
          (includePending || peer.reciprocalState === "active"),
      )
      .map((peer) => ({
        ...peer,
        device: { ...peer.device },
        metadata: { ...peer.metadata },
      }));
  }

  pairingSessions(now = new Date()): DevicePairingSessionRecord[] {
    return (this.state.pairingSessions ?? [])
      .filter(
        (session) =>
          Date.parse(session.recoveryUntil ?? session.expiresAt) >
          now.getTime(),
      )
      .map(clonePairingSession);
  }

  savePairingSessions(
    sessions: DevicePairingSessionRecord[],
    at = new Date(),
  ): void {
    const nextState: ProtectedDeviceFabricState = {
      ...this.state,
      pairingSessions: sessions.map(clonePairingSession),
      updatedAt: at.toISOString(),
    };
    this.vault.save(nextState);
    this.state = nextState;
  }

  trustDevice(input: {
    device: DeviceIdentity;
    metadata: DeviceMetadata;
    certificateFingerprintSha256?: string;
    defaultMode?: DeviceOperatingMode;
    pairedAt?: Date;
    allowRevoked?: boolean;
    reciprocalState?: "pending" | "active";
  }, pairingSessions?: DevicePairingSessionRecord[]): TrustedDeviceRecord {
    if (input.device.deviceId === this.state.local.device.deviceId)
      throw new Error("A device cannot trust itself as a peer");
    const digest = fingerprint(input.device);
    const existing = this.state.trustedDevices.find(
      (peer) => peer.device.deviceId === input.device.deviceId,
    );
    if (existing && existing.fingerprintSha256 !== digest)
      throw new Error("Trusted device identity collision");
    const wasRevoked = Boolean(
      existing?.revokedAt || this.vault.isRevoked(input.device.deviceId),
    );
    if (wasRevoked && !input.allowRevoked)
      throw new Error(
        "Revoked device requires a new explicit pairing ceremony",
      );
    const pairedAt = (input.pairedAt ?? new Date()).toISOString();
    const record: TrustedDeviceRecord = {
      device: { ...input.device },
      fingerprintSha256: digest,
      metadata: canonicalMetadata(input.metadata),
      pairedAt: existing?.revokedAt
        ? pairedAt
        : (existing?.pairedAt ?? pairedAt),
      defaultMode: input.defaultMode ?? existing?.defaultMode ?? "supervised",
      workspaceGrantPolicy: "all_current_and_future",
      reciprocalState:
        input.reciprocalState ?? existing?.reciprocalState ?? "active",
      ...(input.certificateFingerprintSha256
        ? {
            certificateFingerprintSha256: input.certificateFingerprintSha256,
          }
        : existing?.certificateFingerprintSha256
          ? {
              certificateFingerprintSha256:
                existing.certificateFingerprintSha256,
            }
          : {}),
    };
    const nextState: ProtectedDeviceFabricState = {
      ...this.state,
      trustedDevices: [
        ...this.state.trustedDevices.filter(
          (peer) => peer.device.deviceId !== input.device.deviceId,
        ),
        record,
      ].sort((left, right) =>
        left.device.deviceId.localeCompare(right.device.deviceId),
      ),
      ...(pairingSessions
        ? { pairingSessions: pairingSessions.map(clonePairingSession) }
        : {}),
      updatedAt: pairedAt,
    };
    this.vault.save(nextState);
    if (wasRevoked) this.vault.clearRevocation(input.device.deviceId);
    this.state = nextState;
    return {
      ...record,
      device: { ...record.device },
      metadata: { ...record.metadata },
    };
  }

  activateReciprocalTrust(
    deviceId: string,
    at = new Date(),
  ): TrustedDeviceRecord {
    const existing = this.state.trustedDevices.find(
      (peer) => peer.device.deviceId === deviceId && !peer.revokedAt,
    );
    if (!existing) throw new Error("Pending trusted device not found");
    if (existing.reciprocalState !== "pending")
      return {
        ...existing,
        device: { ...existing.device },
        metadata: { ...existing.metadata },
      };
    const next = { ...existing, reciprocalState: "active" as const },
      nextState: ProtectedDeviceFabricState = {
        ...this.state,
        trustedDevices: this.state.trustedDevices.map((peer) =>
          peer.device.deviceId === deviceId ? next : peer,
        ),
        updatedAt: at.toISOString(),
      };
    this.vault.save(nextState);
    this.state = nextState;
    return {
      ...next,
      device: { ...next.device },
      metadata: { ...next.metadata },
    };
  }

  revokeDevice(deviceId: string, at = new Date()): TrustedDeviceRecord {
    const existing = this.state.trustedDevices.find(
      (peer) => peer.device.deviceId === deviceId && !peer.revokedAt,
    );
    if (!existing) throw new Error("Active trusted device not found");
    const revokedAt = at.toISOString();
    const next = { ...existing, revokedAt };
    const nextState: ProtectedDeviceFabricState = {
      ...this.state,
      trustedDevices: this.state.trustedDevices.map((peer) =>
        peer.device.deviceId === deviceId ? next : peer,
      ),
      updatedAt: revokedAt,
    };
    this.vault.recordRevocation(deviceId, revokedAt);
    try {
      this.vault.save(nextState);
    } catch {
      // The independent durable tombstone is the revocation commit boundary.
    }
    this.state = nextState;
    return {
      ...next,
      device: { ...next.device },
      metadata: { ...next.metadata },
    };
  }

  setDefaultMode(
    deviceId: string,
    mode: DeviceOperatingMode,
    at = new Date(),
  ): TrustedDeviceRecord {
    if (!(["supervised", "autonomous"] as string[]).includes(mode))
      throw new Error("Invalid device operating mode");
    const existing = this.state.trustedDevices.find(
      (peer) => peer.device.deviceId === deviceId && !peer.revokedAt,
    );
    if (!existing) throw new Error("Active trusted device not found");
    const next = { ...existing, defaultMode: mode };
    const nextState: ProtectedDeviceFabricState = {
      ...this.state,
      trustedDevices: this.state.trustedDevices.map((peer) =>
        peer.device.deviceId === deviceId ? next : peer,
      ),
      updatedAt: at.toISOString(),
    };
    this.vault.save(nextState);
    this.state = nextState;
    return {
      ...next,
      device: { ...next.device },
      metadata: { ...next.metadata },
    };
  }

  createOperationAuthorization(
    responderDeviceId: string,
    scope: string,
    requestBytes: string | Uint8Array,
    now = new Date(),
  ): DeviceOperationAuthorizationProposal {
    const responder = this.state.trustedDevices.find(
      (peer) =>
        peer.device.deviceId === responderDeviceId && !peer.revokedAt,
    );
    if (!responder) throw new Error("Trusted responder not found");
    if (!AUTHORIZATION_SCOPE.test(scope))
      throw new Error("Invalid operation authorization scope");
    if (!requestBytes.length)
      throw new Error("Invalid operation authorization request bytes");
    const requestDigestSha256 = deviceOperationRequestDigest(requestBytes);
    const unsigned = {
      version: 1 as const,
      initiatorDeviceId: this.state.local.device.deviceId,
      responderDeviceId,
      scope,
      requestDigestSha256,
      nonce: randomBytes(24).toString("base64url"),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + AUTHORIZATION_TTL_MS).toISOString(),
    };
    return {
      ...unsigned,
      initiatorSignature: this.sign(authorizationPayload(unsigned)),
    };
  }

  countersignOperationAuthorization(
    proposal: DeviceOperationAuthorizationProposal,
    now = new Date(),
  ): DeviceOperationAuthorization {
    if (
      proposal.responderDeviceId !== this.state.local.device.deviceId ||
      !this.validAuthorizationWindow(proposal, now)
    )
      throw new Error("Invalid operation authorization proposal");
    const initiator = this.state.trustedDevices.find(
      (peer) =>
        peer.device.deviceId === proposal.initiatorDeviceId &&
        !peer.revokedAt,
    );
    const unsigned = this.authorizationUnsigned(proposal);
    if (
      !initiator ||
      !this.verify(
        authorizationPayload(unsigned),
        proposal.initiatorSignature,
        initiator.device,
      )
    )
      throw new Error("Operation authorization initiator is invalid");
    return {
      ...proposal,
      responderSignature: this.sign(authorizationPayload(unsigned)),
    };
  }

  verifyOperationAuthorization(
    authorization: DeviceOperationAuthorization | undefined,
    peerDeviceId: string,
    scope: string,
    requestBytes: string | Uint8Array,
    now = new Date(),
  ): boolean {
    const requestDigestSha256 = requestBytes.length
      ? deviceOperationRequestDigest(requestBytes)
      : "";
    if (
      !authorization ||
      authorization.scope !== scope ||
      authorization.requestDigestSha256 !== requestDigestSha256 ||
      !this.validAuthorizationWindow(authorization, now)
    )
      return false;
    const localDeviceId = this.state.local.device.deviceId,
      localIsInitiator = authorization.initiatorDeviceId === localDeviceId,
      localIsResponder = authorization.responderDeviceId === localDeviceId;
    if (
      localIsInitiator === localIsResponder ||
      (localIsInitiator
        ? authorization.responderDeviceId
        : authorization.initiatorDeviceId) !== peerDeviceId
    )
      return false;
    const peer = this.state.trustedDevices.find(
      (record) =>
        record.device.deviceId === peerDeviceId && !record.revokedAt,
    );
    if (!peer) return false;
    const unsigned = this.authorizationUnsigned(authorization),
      payload = authorizationPayload(unsigned),
      initiator = localIsInitiator ? this.localIdentity() : peer.device,
      responder = localIsResponder ? this.localIdentity() : peer.device;
    return (
      this.verify(payload, authorization.initiatorSignature, initiator) &&
      this.verify(payload, authorization.responderSignature, responder)
    );
  }

  grantsWorkspace(
    deviceId: string,
    workspaceId: string,
    authorization?: DeviceOperationAuthorization,
    requestBytes: string | Uint8Array = "",
    now = new Date(),
  ): boolean {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(workspaceId)) return false;
    const permitted = this.state.trustedDevices.some(
      (peer) =>
        peer.device.deviceId === deviceId &&
        !peer.revokedAt &&
        peer.workspaceGrantPolicy === "all_current_and_future",
    );
    return (
      permitted &&
      this.consumeOperationAuthorization(
        authorization,
        deviceId,
        `workspace:${workspaceId}:grant`,
        requestBytes,
        now,
      )
    );
  }

  consumeOperationAuthorization(
    authorization: DeviceOperationAuthorization | undefined,
    peerDeviceId: string,
    scope: string,
    requestBytes: string | Uint8Array,
    now = new Date(),
  ): boolean {
    if (
      !this.verifyOperationAuthorization(
        authorization,
        peerDeviceId,
        scope,
        requestBytes,
        now,
      ) ||
      !authorization ||
      authorization.responderDeviceId !== this.state.local.device.deviceId
    )
      return false;
    const authorizationIdSha256 = createHash("sha256")
        .update(
          JSON.stringify([
            authorization.initiatorDeviceId,
            authorization.responderDeviceId,
            authorization.nonce,
          ]),
        )
        .digest("hex"),
      unexpired = (this.state.consumedAuthorizations ?? []).filter(
        (item) => Date.parse(item.expiresAt) > now.getTime(),
      );
    if (
      unexpired.some(
        (item) => item.authorizationIdSha256 === authorizationIdSha256,
      ) ||
      unexpired.length >= MAX_CONSUMED_AUTHORIZATIONS
    )
      return false;
    const nextState: ProtectedDeviceFabricState = {
      ...this.state,
      consumedAuthorizations: [
        ...unexpired,
        {
          authorizationIdSha256,
          expiresAt: authorization.expiresAt,
          consumedAt: now.toISOString(),
        },
      ],
      updatedAt: now.toISOString(),
    };
    this.vault.save(nextState);
    this.state = nextState;
    return true;
  }

  private authorizationUnsigned(
    value: DeviceOperationAuthorizationProposal,
  ): Omit<DeviceOperationAuthorizationProposal, "initiatorSignature"> {
    return {
      version: value.version,
      initiatorDeviceId: value.initiatorDeviceId,
      responderDeviceId: value.responderDeviceId,
      scope: value.scope,
      requestDigestSha256: value.requestDigestSha256,
      nonce: value.nonce,
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
    };
  }

  private validAuthorizationWindow(
    value: DeviceOperationAuthorizationProposal,
    now: Date,
  ): boolean {
    const issuedAt = Date.parse(String(value?.issuedAt)),
      expiresAt = Date.parse(String(value?.expiresAt));
    return (
      value?.version === 1 &&
      DEVICE_ID.test(String(value.initiatorDeviceId)) &&
      DEVICE_ID.test(String(value.responderDeviceId)) &&
      value.initiatorDeviceId !== value.responderDeviceId &&
      AUTHORIZATION_SCOPE.test(String(value.scope)) &&
      SHA256.test(String(value.requestDigestSha256)) &&
      /^[A-Za-z0-9_-]{16,128}$/.test(String(value.nonce)) &&
      Number.isFinite(issuedAt) &&
      Number.isFinite(expiresAt) &&
      issuedAt <= now.getTime() + 5_000 &&
      issuedAt >= now.getTime() - AUTHORIZATION_TTL_MS - 5_000 &&
      expiresAt > now.getTime() &&
      expiresAt - issuedAt <= AUTHORIZATION_TTL_MS
    );
  }

  async ensureHostIdentity(now = new Date()): Promise<DeviceHostIdentity> {
    const existing = this.state.local.hostIdentity;
    if (existing) {
      try {
        const certificate = new X509Certificate(existing.certificatePem);
        if (Date.parse(certificate.validTo) > now.getTime() + 30 * 86_400_000)
          return { ...existing };
      } catch {
        // Rotate an unusable protected host identity before listening.
      }
    }
    const generated = await selfsigned.generate(
        [{ name: "commonName", value: "Waypoint Device Host" }],
        { keySize: 2048, days: 730, algorithm: "sha256" },
      ),
      certificate = new X509Certificate(generated.cert),
      hostIdentity: DeviceHostIdentity = {
        certificatePem: generated.cert,
        privateKeyPem: generated.private,
        fingerprintSha256: createHash("sha256")
          .update(certificate.raw)
          .digest("hex"),
        createdAt: now.toISOString(),
      },
      nextState: ProtectedDeviceFabricState = {
        ...this.state,
        local: { ...this.state.local, hostIdentity },
        updatedAt: now.toISOString(),
      };
    this.vault.save(nextState);
    this.state = nextState;
    return { ...hostIdentity };
  }

  hostIdentity(): DeviceHostIdentity | undefined {
    const value = this.state.local.hostIdentity;
    return value ? { ...value } : undefined;
  }

  markSeen(deviceId: string, at = new Date()): void {
    const existing = this.state.trustedDevices.find(
      (peer) => peer.device.deviceId === deviceId && !peer.revokedAt,
    );
    if (!existing) return;
    const timestamp = at.toISOString();
    if (
      existing.lastSeenAt &&
      at.getTime() - Date.parse(existing.lastSeenAt) < 60_000
    )
      return;
    const nextState: ProtectedDeviceFabricState = {
      ...this.state,
      trustedDevices: this.state.trustedDevices.map((peer) =>
        peer.device.deviceId === deviceId
          ? { ...peer, lastSeenAt: timestamp }
          : peer,
      ),
      updatedAt: timestamp,
    };
    this.vault.save(nextState);
    this.state = nextState;
  }
}
