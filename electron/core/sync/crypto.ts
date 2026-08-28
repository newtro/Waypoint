import sodium from "libsodium-wrappers-sumo";
import { createHash, randomUUID } from "node:crypto";
import type {
  DeviceIdentity,
  DeviceKeyPair,
  EnrollmentApproval,
  EnrollmentConsumeProof,
  EnrollmentInvitation,
  EnrollmentRequest,
  RotationClaimProof,
  SignedEncryptedEnvelope,
} from "./types.js";
import type { ChunkCrypto } from "./attachment-transfer.js";
import {
  R0_PROTOCOL_CONTRACT,
  validateRecoveryManifest,
  type RecoveryManifest,
} from "./protocol-contract.js";

const utf8 = (value: string) => sodium.from_string(value);
const b64 = (value: Uint8Array) =>
  sodium.to_base64(value, sodium.base64_variants.ORIGINAL);
const unb64 = (value: string) =>
  sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
const recoveryCore = (value: Omit<RecoveryManifest, "checksum">) =>
  JSON.stringify([
    value.format,
    value.version,
    value.workspaceId,
    value.createdAt,
    value.kdf,
    value.opslimit,
    value.memlimitBytes,
    value.cipher,
    value.salt,
    value.nonce,
    value.wrappedWorkspaceKey,
  ]);
const recoveryChecksum = (value: Omit<RecoveryManifest, "checksum">) =>
  `sha256-${createHash("sha256").update(recoveryCore(value)).digest("hex")}`;

function canonicalEnvelope(
  envelope: Omit<SignedEncryptedEnvelope, "signature">,
): string {
  return JSON.stringify([
    envelope.version,
    envelope.envelopeId,
    envelope.workspaceId,
    envelope.senderDeviceId,
    envelope.recipientDeviceId,
    envelope.keyEpoch,
    envelope.sequence,
    envelope.createdAt,
    envelope.expiresAt,
    envelope.nonce,
    envelope.ciphertext,
  ]);
}

function canonicalEnrollment(
  request: Omit<EnrollmentRequest, "signature">,
): string {
  return JSON.stringify([
    request.version,
    request.requestId,
    request.workspaceId,
    request.device.deviceId,
    request.device.signingPublicKey,
    request.device.encryptionPublicKey,
    request.createdAt,
    request.expiresAt,
  ]);
}
function canonicalApproval(
  approval: Omit<EnrollmentApproval, "signature">,
): string {
  return JSON.stringify([
    approval.version,
    approval.requestId,
    approval.workspaceId,
    approval.ownerDeviceId,
    approval.membershipEpoch,
    approval.approvedAt,
    approval.deviceKeyDigest ?? "",
    approval.wrappedWorkspaceKeyDigest ?? "",
  ]);
}
function canonicalInvitation(
  invitation: Omit<EnrollmentInvitation, "signature">,
): string {
  return JSON.stringify([
    invitation.version,
    invitation.invitationId,
    invitation.workspaceId,
    invitation.ownerDeviceId,
    invitation.membershipEpoch,
    invitation.secretHash,
    invitation.expiresAt,
  ]);
}
function canonicalConsume(
  proof: Omit<EnrollmentConsumeProof, "signature">,
): string {
  return JSON.stringify([
    proof.version,
    proof.requestId,
    proof.workspaceId,
    proof.deviceId,
    proof.approvalSignatureDigest,
    proof.nonce,
    proof.createdAt,
  ]);
}
function canonicalRotationClaim(
  proof: Omit<RotationClaimProof, "signature">,
): string {
  return JSON.stringify([
    proof.version,
    proof.workspaceId,
    proof.deviceId,
    proof.targetEpoch,
    proof.nonce,
    proof.createdAt,
  ]);
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class WaypointCrypto {
  static async create(): Promise<WaypointCrypto> {
    await sodium.ready;
    return new WaypointCrypto();
  }

  generateDevice(deviceId: string = randomUUID()): DeviceKeyPair {
    const signing = sodium.crypto_sign_keypair();
    const encryption = sodium.crypto_box_keypair();
    return {
      deviceId,
      signingPublicKey: b64(signing.publicKey),
      signingPrivateKey: b64(signing.privateKey),
      encryptionPublicKey: b64(encryption.publicKey),
      encryptionPrivateKey: b64(encryption.privateKey),
    };
  }

  generateWorkspaceKey(): string {
    return b64(
      sodium.randombytes_buf(
        sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
      ),
    );
  }

  validateDeviceKeyPair(device: DeviceKeyPair): boolean {
    try {
      const signingPrivate = unb64(device.signingPrivateKey),
        encryptionPrivate = unb64(device.encryptionPrivateKey),
        signingPublic = unb64(device.signingPublicKey),
        encryptionPublic = unb64(device.encryptionPublicKey);
      return (
        signingPrivate.length === 64 &&
        sodium.memcmp(signingPrivate.slice(32), signingPublic) &&
        sodium.memcmp(
          sodium.crypto_scalarmult_base(encryptionPrivate),
          encryptionPublic,
        )
      );
    } catch {
      return false;
    }
  }

  signDevicePayload(payload: string, device: DeviceKeyPair): string {
    if (!payload || payload.length > 1_000_000)
      throw new Error("Device payload is invalid");
    return b64(
      sodium.crypto_sign_detached(
        utf8(payload),
        unb64(device.signingPrivateKey),
      ),
    );
  }

  verifyDevicePayload(
    payload: string,
    signature: string,
    device: DeviceIdentity,
  ): boolean {
    return this.verifySigningPayload(
      payload,
      signature,
      device.signingPublicKey,
    );
  }

  verifySigningPayload(
    payload: string,
    signature: string,
    signingPublicKey: string,
  ): boolean {
    if (!payload || payload.length > 1_000_000) return false;
    try {
      return sodium.crypto_sign_verify_detached(
        unb64(signature),
        utf8(payload),
        unb64(signingPublicKey),
      );
    } catch {
      return false;
    }
  }

  createRecoveryManifest(
    workspaceId: string,
    workspaceKey: string,
    passphrase: string,
    now = new Date(),
  ): RecoveryManifest {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(workspaceId))
      throw new Error("Recovery requires an opaque workspace identifier");
    if (passphrase.length < 12 || passphrase.length > 1024)
      throw new Error("Recovery passphrase must contain 12 to 1024 characters");
    const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES),
      nonce = sodium.randombytes_buf(
        sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
      );
    const key = sodium.crypto_pwhash(
      sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
      passphrase,
      salt,
      R0_PROTOCOL_CONTRACT.recovery.opslimit,
      R0_PROTOCOL_CONTRACT.recovery.memlimitBytes,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
    const header = [
      R0_PROTOCOL_CONTRACT.recovery.format,
      R0_PROTOCOL_CONTRACT.recovery.version,
      workspaceId,
      now.toISOString(),
    ];
    const wrapped = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      unb64(workspaceKey),
      utf8(JSON.stringify(header)),
      null,
      nonce,
      key,
    );
    const core: Omit<RecoveryManifest, "checksum"> = {
      format: R0_PROTOCOL_CONTRACT.recovery.format,
      version: R0_PROTOCOL_CONTRACT.recovery.version,
      workspaceId,
      createdAt: now.toISOString(),
      kdf: R0_PROTOCOL_CONTRACT.recovery.kdf,
      opslimit: R0_PROTOCOL_CONTRACT.recovery.opslimit,
      memlimitBytes: R0_PROTOCOL_CONTRACT.recovery.memlimitBytes,
      cipher: R0_PROTOCOL_CONTRACT.recovery.cipher,
      salt: b64(salt),
      nonce: b64(nonce),
      wrappedWorkspaceKey: b64(wrapped),
    };
    return { ...core, checksum: recoveryChecksum(core) };
  }

  recoverWorkspaceKey(
    value: unknown,
    passphrase: string,
    now = new Date(),
  ): string {
    if (passphrase.length < 12 || passphrase.length > 1024)
      throw new Error("Recovery passphrase must contain 12 to 1024 characters");
    const manifest = validateRecoveryManifest(value, now),
      { checksum, ...core } = manifest;
    if (recoveryChecksum(core) !== checksum)
      throw new Error("Recovery manifest checksum mismatch");
    try {
      const key = sodium.crypto_pwhash(
        sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
        passphrase,
        unb64(manifest.salt),
        manifest.opslimit,
        manifest.memlimitBytes,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      );
      const header = [
        manifest.format,
        manifest.version,
        manifest.workspaceId,
        manifest.createdAt,
      ];
      return b64(
        sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null,
          unb64(manifest.wrappedWorkspaceKey),
          utf8(JSON.stringify(header)),
          unb64(manifest.nonce),
          key,
        ),
      );
    } catch {
      throw new Error("Recovery artifact cannot be opened");
    }
  }

  wrapWorkspaceKey(workspaceKey: string, recipient: DeviceIdentity): string {
    return b64(
      sodium.crypto_box_seal(
        unb64(workspaceKey),
        unb64(recipient.encryptionPublicKey),
      ),
    );
  }

  unwrapWorkspaceKey(wrappedKey: string, recipient: DeviceKeyPair): string {
    try {
      const key = sodium.crypto_box_seal_open(
        unb64(wrappedKey),
        unb64(recipient.encryptionPublicKey),
        unb64(recipient.encryptionPrivateKey),
      );
      if (!key) throw new Error();
      return b64(key);
    } catch {
      throw new Error("Wrapped workspace key cannot be opened by this device");
    }
  }

  encryptEnvelope(input: {
    workspaceId: string;
    sender: DeviceKeyPair;
    recipient: DeviceIdentity;
    workspaceKey: string;
    payload: unknown;
    keyEpoch: number;
    sequence: number;
    now?: Date;
    ttlMs?: number;
  }): SignedEncryptedEnvelope {
    const nonce = sodium.randombytes_buf(
      sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
    );
    if (
      !Number.isSafeInteger(input.keyEpoch) ||
      input.keyEpoch < 1 ||
      !Number.isSafeInteger(input.sequence) ||
      input.sequence < 1
    )
      throw new Error("Valid key epoch and sequence are required");
    const now = input.now ?? new Date(),
      ttlMs =
        input.ttlMs ??
        R0_PROTOCOL_CONTRACT.retention.relayEnvelopeMaximumDays * 86_400_000;
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 1 ||
      ttlMs >
        R0_PROTOCOL_CONTRACT.retention.relayEnvelopeMaximumDays * 86_400_000
    )
      throw new Error("Envelope lifetime exceeds protocol policy");
    const header = [
      1,
      input.workspaceId,
      input.sender.deviceId,
      input.recipient.deviceId,
      input.keyEpoch,
      input.sequence,
    ];
    const plaintext = utf8(JSON.stringify(input.payload));
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      utf8(JSON.stringify(header)),
      null,
      nonce,
      unb64(input.workspaceKey),
    );
    const unsigned: Omit<SignedEncryptedEnvelope, "signature"> = {
      version: 1,
      envelopeId: randomUUID(),
      workspaceId: input.workspaceId,
      senderDeviceId: input.sender.deviceId,
      recipientDeviceId: input.recipient.deviceId,
      keyEpoch: input.keyEpoch,
      sequence: input.sequence,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      nonce: b64(nonce),
      ciphertext: b64(ciphertext),
    };
    return {
      ...unsigned,
      signature: b64(
        sodium.crypto_sign_detached(
          utf8(canonicalEnvelope(unsigned)),
          unb64(input.sender.signingPrivateKey),
        ),
      ),
    };
  }

  decryptEnvelope<T>(input: {
    envelope: SignedEncryptedEnvelope;
    sender: DeviceIdentity;
    recipient: DeviceKeyPair;
    workspaceKey: string | string[];
  }): T {
    const { envelope } = input;
    if (
      envelope.version !== 1 ||
      envelope.senderDeviceId !== input.sender.deviceId ||
      envelope.recipientDeviceId !== input.recipient.deviceId
    ) {
      throw new Error("Envelope identity mismatch");
    }
    if (!this.verifyEnvelopeSignature(envelope, input.sender))
      throw new Error("Envelope signature is invalid");
    if (
      !Number.isSafeInteger(envelope.keyEpoch) ||
      envelope.keyEpoch < 1 ||
      !Number.isSafeInteger(envelope.sequence) ||
      envelope.sequence < 1
    )
      throw new Error("Envelope epoch or sequence is invalid");
    const created = Date.parse(envelope.createdAt),
      expires = Date.parse(envelope.expiresAt);
    if (
      !Number.isFinite(created) ||
      !Number.isFinite(expires) ||
      expires <= created ||
      expires - created >
        R0_PROTOCOL_CONTRACT.retention.relayEnvelopeMaximumDays * 86_400_000
    )
      throw new Error("Envelope lifetime is invalid");
    const header = [
      1,
      envelope.workspaceId,
      envelope.senderDeviceId,
      envelope.recipientDeviceId,
      envelope.keyEpoch,
      envelope.sequence,
    ];
    for (const candidate of Array.isArray(input.workspaceKey)
      ? input.workspaceKey
      : [input.workspaceKey])
      try {
        const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null,
          unb64(envelope.ciphertext),
          utf8(JSON.stringify(header)),
          unb64(envelope.nonce),
          unb64(candidate),
        );
        return JSON.parse(sodium.to_string(plaintext)) as T;
      } catch {
        /* Try the retained previous epoch key. */
      }
    throw new Error("Envelope cannot be opened by an active workspace key");
  }

  verifyEnvelopeSignature(
    envelope: SignedEncryptedEnvelope,
    sender: DeviceIdentity,
  ): boolean {
    try {
      return (
        envelope.version === R0_PROTOCOL_CONTRACT.protocolVersion &&
        envelope.senderDeviceId === sender.deviceId &&
        sodium.crypto_sign_verify_detached(
          unb64(envelope.signature),
          utf8(canonicalEnvelope(envelope)),
          unb64(sender.signingPublicKey),
        )
      );
    } catch {
      return false;
    }
  }

  chunkCrypto(workspaceKey: string): ChunkCrypto {
    const key = unb64(workspaceKey);
    return {
      seal: async (plaintext, associatedData) => {
        const nonce = sodium.randombytes_buf(
          sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
        );
        const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
          plaintext,
          associatedData,
          null,
          nonce,
          key,
        );
        const result = new Uint8Array(nonce.length + ciphertext.length);
        result.set(nonce);
        result.set(ciphertext, nonce.length);
        return result;
      },
      open: async (sealed, associatedData) => {
        const nonceBytes = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
        if (sealed.length <= nonceBytes)
          throw new Error("Encrypted chunk is truncated");
        return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null,
          sealed.slice(nonceBytes),
          associatedData,
          sealed.slice(0, nonceBytes),
          key,
        );
      },
    };
  }

  createEnrollmentRequest(input: {
    workspaceId: string;
    device: DeviceKeyPair;
    now?: Date;
    ttlMs?: number;
  }): EnrollmentRequest {
    const now = input.now ?? new Date();
    const ttlMs = input.ttlMs ?? 10 * 60_000;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 10 * 60_000)
      throw new Error("Enrollment lifetime exceeds the allowed bound");
    const unsigned: Omit<EnrollmentRequest, "signature"> = {
      version: 1,
      requestId: randomUUID(),
      workspaceId: input.workspaceId,
      device: {
        deviceId: input.device.deviceId,
        signingPublicKey: input.device.signingPublicKey,
        encryptionPublicKey: input.device.encryptionPublicKey,
      },
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    return {
      ...unsigned,
      signature: b64(
        sodium.crypto_sign_detached(
          utf8(canonicalEnrollment(unsigned)),
          unb64(input.device.signingPrivateKey),
        ),
      ),
    };
  }

  verifyEnrollmentRequest(
    request: EnrollmentRequest,
    now = new Date(),
  ): boolean {
    try {
      const expiresAt = Date.parse(request.expiresAt);
      const createdAt = Date.parse(request.createdAt);
      if (
        request.version !== 1 ||
        !Number.isFinite(expiresAt) ||
        !Number.isFinite(createdAt) ||
        expiresAt <= now.getTime() ||
        createdAt > now.getTime() + 30_000 ||
        expiresAt - createdAt > 10 * 60_000
      )
        return false;
      return sodium.crypto_sign_verify_detached(
        unb64(request.signature),
        utf8(canonicalEnrollment(request)),
        unb64(request.device.signingPublicKey),
      );
    } catch {
      return false;
    }
  }

  createEnrollmentInvitation(
    workspaceId: string,
    owner: DeviceKeyPair,
    membershipEpoch: number,
    expiresAt: Date,
  ) {
    if (
      !Number.isSafeInteger(membershipEpoch) ||
      membershipEpoch < 1 ||
      expiresAt.getTime() <= Date.now() ||
      expiresAt.getTime() > Date.now() + 24 * 60 * 60_000
    )
      throw new Error("Invitation authority or expiry is invalid");
    const secret = b64(sodium.randombytes_buf(32)),
      unsigned: Omit<EnrollmentInvitation, "signature"> = {
        version: 1,
        invitationId: randomUUID(),
        workspaceId,
        ownerDeviceId: owner.deviceId,
        membershipEpoch,
        secretHash: digest(secret),
        expiresAt: expiresAt.toISOString(),
      };
    return {
      secret,
      invitation: {
        ...unsigned,
        signature: b64(
          sodium.crypto_sign_detached(
            utf8(canonicalInvitation(unsigned)),
            unb64(owner.signingPrivateKey),
          ),
        ),
      },
    };
  }
  verifyEnrollmentInvitation(
    invitation: EnrollmentInvitation,
    owner: DeviceIdentity,
    now = new Date(),
  ): boolean {
    try {
      return (
        invitation.version === 1 &&
        invitation.ownerDeviceId === owner.deviceId &&
        Date.parse(invitation.expiresAt) > now.getTime() &&
        Date.parse(invitation.expiresAt) <= now.getTime() + 24 * 60 * 60_000 &&
        sodium.crypto_sign_verify_detached(
          unb64(invitation.signature),
          utf8(canonicalInvitation(invitation)),
          unb64(owner.signingPublicKey),
        )
      );
    } catch {
      return false;
    }
  }
  createEnrollmentConsumeProof(
    request: EnrollmentRequest,
    approval: EnrollmentApproval,
    device: DeviceKeyPair,
    now = new Date(),
  ): EnrollmentConsumeProof {
    if (
      request.device.deviceId !== device.deviceId ||
      approval.requestId !== request.requestId
    )
      throw new Error("Enrollment consumption authority mismatch");
    const unsigned: Omit<EnrollmentConsumeProof, "signature"> = {
      version: 1,
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      deviceId: device.deviceId,
      approvalSignatureDigest: digest(approval.signature),
      nonce: randomUUID(),
      createdAt: now.toISOString(),
    };
    return {
      ...unsigned,
      signature: b64(
        sodium.crypto_sign_detached(
          utf8(canonicalConsume(unsigned)),
          unb64(device.signingPrivateKey),
        ),
      ),
    };
  }
  verifyEnrollmentConsumeProof(
    proof: EnrollmentConsumeProof,
    device: DeviceIdentity,
    approval: EnrollmentApproval,
    now = new Date(),
  ): boolean {
    try {
      const created = Date.parse(proof.createdAt);
      return (
        proof.version === 1 &&
        proof.deviceId === device.deviceId &&
        proof.requestId === approval.requestId &&
        proof.workspaceId === approval.workspaceId &&
        proof.approvalSignatureDigest === digest(approval.signature) &&
        Number.isFinite(created) &&
        Math.abs(now.getTime() - created) <= 60_000 &&
        sodium.crypto_sign_verify_detached(
          unb64(proof.signature),
          utf8(canonicalConsume(proof)),
          unb64(device.signingPublicKey),
        )
      );
    } catch {
      return false;
    }
  }
  createRotationClaim(
    workspaceId: string,
    targetEpoch: number,
    device: DeviceKeyPair,
    at = new Date(),
  ): RotationClaimProof {
    const unsigned: Omit<RotationClaimProof, "signature"> = {
      version: 1,
      workspaceId,
      deviceId: device.deviceId,
      targetEpoch,
      nonce: randomUUID(),
      createdAt: at.toISOString(),
    };
    return {
      ...unsigned,
      signature: b64(
        sodium.crypto_sign_detached(
          utf8(canonicalRotationClaim(unsigned)),
          unb64(device.signingPrivateKey),
        ),
      ),
    };
  }
  verifyRotationClaim(
    proof: RotationClaimProof,
    device: DeviceIdentity,
    at = new Date(),
  ): boolean {
    try {
      const created = Date.parse(proof.createdAt);
      return (
        proof.version === 1 &&
        proof.deviceId === device.deviceId &&
        Number.isSafeInteger(proof.targetEpoch) &&
        proof.targetEpoch > 1 &&
        Math.abs(at.getTime() - created) <= 60_000 &&
        sodium.crypto_sign_verify_detached(
          unb64(proof.signature),
          utf8(canonicalRotationClaim(proof)),
          unb64(device.signingPublicKey),
        )
      );
    } catch {
      return false;
    }
  }

  approveEnrollment(
    request: EnrollmentRequest,
    owner: DeviceKeyPair,
    membershipEpoch: number,
    now = new Date(),
    wrappedWorkspaceKey?: string,
  ): EnrollmentApproval {
    if (!Number.isSafeInteger(membershipEpoch) || membershipEpoch < 1)
      throw new Error("Valid owner membership epoch required");
    const deviceKeyDigest = digest(
      JSON.stringify([
        request.device.deviceId,
        request.device.signingPublicKey,
        request.device.encryptionPublicKey,
      ]),
    );
    const unsigned: Omit<EnrollmentApproval, "signature"> = {
      version: 1,
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      ownerDeviceId: owner.deviceId,
      membershipEpoch,
      approvedAt: now.toISOString(),
      deviceKeyDigest,
      ...(wrappedWorkspaceKey
        ? { wrappedWorkspaceKeyDigest: digest(wrappedWorkspaceKey) }
        : {}),
    };
    return {
      ...unsigned,
      signature: b64(
        sodium.crypto_sign_detached(
          utf8(canonicalApproval(unsigned)),
          unb64(owner.signingPrivateKey),
        ),
      ),
    };
  }
  verifyEnrollmentApproval(
    approval: EnrollmentApproval,
    owner: DeviceIdentity,
  ): boolean {
    try {
      return (
        approval.version === 1 &&
        approval.ownerDeviceId === owner.deviceId &&
        sodium.crypto_sign_verify_detached(
          unb64(approval.signature),
          utf8(canonicalApproval(approval)),
          unb64(owner.signingPublicKey),
        )
      );
    } catch {
      return false;
    }
  }
}
