import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { X509Certificate } from "node:crypto";
import path from "node:path";
import { syncDirectoryDurably, syncFileDurably } from "../durable-fs.js";
import type { SecretProtector } from "../sync/protected-sync-vault.js";
import type {
  DeviceConsumedAuthorization,
  DeviceMetadata,
  DeviceHostIdentity,
  DevicePairingSessionRecord,
  ProtectedDeviceFabricState,
  TrustedDeviceRecord,
} from "./types.js";

const DEVICE_ID = /^[A-Za-z0-9_-]{16,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9.+_-]{1,64}$/;

export interface DeviceVaultFileSystem {
  exists(file: string): boolean;
  read(file: string): Buffer;
  write(file: string, bytes: Buffer): void;
  rename(source: string, target: string): void;
  remove(file: string): void;
  syncFile(file: string): void;
  syncDirectory(directory: string): void;
}

const nativeFileSystem: DeviceVaultFileSystem = {
  exists: existsSync,
  read: readFileSync,
  write: (file, bytes) =>
    writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }),
  rename: renameSync,
  remove: (file) => rmSync(file, { force: true }),
  syncFile: syncFileDurably,
  syncDirectory: syncDirectoryDurably,
};

function validBase64(value: unknown, length: number): boolean {
  if (typeof value !== "string") return false;
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length === length && bytes.toString("base64") === value;
  } catch {
    return false;
  }
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}

function validMetadata(value: unknown): value is DeviceMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<DeviceMetadata>;
  return (
    typeof item.displayName === "string" &&
    item.displayName.trim().length >= 1 &&
    item.displayName.length <= 120 &&
    ["darwin", "win32", "linux", "unknown"].includes(String(item.platform)) &&
    typeof item.architecture === "string" &&
    VERSION.test(item.architecture) &&
    typeof item.appVersion === "string" &&
    VERSION.test(item.appVersion)
  );
}

function validIdentity(value: unknown, includePrivate: boolean): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    DEVICE_ID.test(String(item.deviceId)) &&
    validBase64(item.signingPublicKey, 32) &&
    validBase64(item.encryptionPublicKey, 32) &&
    (!includePrivate ||
      (validBase64(item.signingPrivateKey, 64) &&
        validBase64(item.encryptionPrivateKey, 32)))
  );
}

function validatePeer(value: unknown): value is TrustedDeviceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<TrustedDeviceRecord>;
  return (
    validIdentity(item.device, false) &&
    SHA256.test(String(item.fingerprintSha256)) &&
    validMetadata(item.metadata) &&
    validTimestamp(item.pairedAt) &&
    (item.revokedAt === undefined || validTimestamp(item.revokedAt)) &&
    (item.lastSeenAt === undefined || validTimestamp(item.lastSeenAt)) &&
    ["supervised", "autonomous"].includes(String(item.defaultMode)) &&
    item.workspaceGrantPolicy === "all_current_and_future" &&
    (item.reciprocalState === undefined ||
      ["pending", "active"].includes(item.reciprocalState)) &&
    (item.certificateFingerprintSha256 === undefined ||
      SHA256.test(item.certificateFingerprintSha256))
  );
}

function validHostIdentity(value: unknown): value is DeviceHostIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<DeviceHostIdentity>;
  if (
    typeof item.certificatePem !== "string" ||
    item.certificatePem.length > 32_768 ||
    typeof item.privateKeyPem !== "string" ||
    item.privateKeyPem.length > 32_768 ||
    !SHA256.test(String(item.fingerprintSha256)) ||
    !validTimestamp(item.createdAt)
  )
    return false;
  try {
    const certificate = new X509Certificate(item.certificatePem);
    return (
      createHash("sha256").update(certificate.raw).digest("hex") ===
        item.fingerprintSha256 &&
      /BEGIN (?:RSA )?PRIVATE KEY/.test(item.privateKeyPem)
    );
  } catch {
    return false;
  }
}

function validPrivateEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 256) return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !url.port
    )
      return false;
    const parts = url.hostname.split(".").map(Number);
    return (
      parts.length === 4 &&
      parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
      (parts[0] === 10 ||
        parts[0] === 127 ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31))
    );
  } catch {
    return false;
  }
}

function validPairingSession(
  value: unknown,
): value is DevicePairingSessionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<DevicePairingSessionRecord>,
    peer = item.peer;
  return (
    DEVICE_ID.test(String(item.sessionId)) &&
    ["incoming", "outgoing"].includes(String(item.direction)) &&
    Boolean(peer) &&
    DEVICE_ID.test(String(peer?.deviceId)) &&
    (peer?.signingPublicKey === undefined ||
      validBase64(peer.signingPublicKey, 32)) &&
    (peer?.device === undefined ||
      (validIdentity(peer.device, false) &&
        peer.device.deviceId === peer.deviceId &&
        peer.device.signingPublicKey === peer.signingPublicKey)) &&
    SHA256.test(String(peer?.fingerprintSha256)) &&
    validMetadata(peer?.metadata) &&
    validPrivateEndpoint(peer?.endpoint) &&
    SHA256.test(String(peer?.certificateFingerprintSha256)) &&
    Array.isArray(peer?.capabilities) &&
    peer.capabilities.length <= 16 &&
    new Set(peer.capabilities).size === peer.capabilities.length &&
    peer.capabilities.every(
      (capability) =>
        typeof capability === "string" && /^[a-z][a-z-]{0,63}$/.test(capability),
    ) &&
    DEVICE_ID.test(String(item.requesterNonce)) &&
    (item.responderNonce === undefined ||
      DEVICE_ID.test(String(item.responderNonce))) &&
    (item.code === undefined || /^\d{6}$/.test(item.code)) &&
    validTimestamp(item.expiresAt) &&
    (item.recoveryUntil === undefined ||
      (validTimestamp(item.recoveryUntil) &&
        Date.parse(item.recoveryUntil) >= Date.parse(item.expiresAt))) &&
    typeof item.localConfirmed === "boolean" &&
    typeof item.remoteConfirmed === "boolean" &&
    typeof item.completed === "boolean" &&
    (item.responderNonce === undefined) === (item.code === undefined)
  );
}

function validConsumedAuthorization(
  value: unknown,
): value is DeviceConsumedAuthorization {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<DeviceConsumedAuthorization>;
  return (
    SHA256.test(String(item.authorizationIdSha256)) &&
    validTimestamp(item.expiresAt) &&
    validTimestamp(item.consumedAt) &&
    Date.parse(item.consumedAt) <= Date.parse(item.expiresAt)
  );
}

function validate(value: unknown): asserts value is ProtectedDeviceFabricState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid protected device fabric state");
  const item = value as Partial<ProtectedDeviceFabricState>;
  if (
    item.version !== 1 ||
    !item.local ||
    !validIdentity(item.local.device, true) ||
    !SHA256.test(String(item.local.fingerprintSha256)) ||
    !validMetadata(item.local.metadata) ||
    !validTimestamp(item.local.createdAt) ||
    (item.local.hostIdentity !== undefined &&
      !validHostIdentity(item.local.hostIdentity)) ||
    !Array.isArray(item.trustedDevices) ||
    item.trustedDevices.length > 256 ||
    item.trustedDevices.some((peer) => !validatePeer(peer)) ||
    new Set(item.trustedDevices.map((peer) => peer.device.deviceId)).size !==
      item.trustedDevices.length ||
    item.trustedDevices.some(
      (peer) => peer.device.deviceId === item.local?.device.deviceId,
    ) ||
    (item.pairingSessions !== undefined &&
      (!Array.isArray(item.pairingSessions) ||
        item.pairingSessions.length > 64 ||
        item.pairingSessions.some((session) => !validPairingSession(session)) ||
        new Set(item.pairingSessions.map((session) => session.sessionId)).size !==
          item.pairingSessions.length)) ||
    (item.consumedAuthorizations !== undefined &&
      (!Array.isArray(item.consumedAuthorizations) ||
        item.consumedAuthorizations.length > 8_192 ||
        item.consumedAuthorizations.some(
          (authorization) => !validConsumedAuthorization(authorization),
        ) ||
        new Set(
          item.consumedAuthorizations.map(
            (authorization) => authorization.authorizationIdSha256,
          ),
        ).size !== item.consumedAuthorizations.length)) ||
    !Array.isArray(item.legacyWorkspaceDeviceIds) ||
    item.legacyWorkspaceDeviceIds.length > 512 ||
    item.legacyWorkspaceDeviceIds.some((id) => !DEVICE_ID.test(id)) ||
    new Set(item.legacyWorkspaceDeviceIds).size !==
      item.legacyWorkspaceDeviceIds.length ||
    !validTimestamp(item.updatedAt)
  )
    throw new Error("Invalid protected device fabric state");
}

interface StorageEnvelope {
  storageVersion: 1;
  generation: number;
  state: ProtectedDeviceFabricState;
}

interface SlotValue extends StorageEnvelope {
  file: string;
}

interface RevocationTombstone {
  version: 1;
  deviceId: string;
  revokedAt: string;
}

export class ProtectedDeviceVault {
  private readonly root: string;
  private readonly legacyTarget: string;
  private readonly slots: readonly [string, string];

  constructor(
    root: string,
    private readonly protector: SecretProtector,
    private readonly fileSystem: DeviceVaultFileSystem = nativeFileSystem,
  ) {
    if (!protector.available())
      throw new Error("OS-protected device fabric storage is unavailable");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = root;
    this.legacyTarget = path.join(root, "device-fabric.protected");
    this.slots = [
      path.join(root, "device-fabric.a.protected"),
      path.join(root, "device-fabric.b.protected"),
    ];
  }

  load(
    semanticValidator?: (state: ProtectedDeviceFabricState) => void,
  ): ProtectedDeviceFabricState | undefined {
    const { valid, invalid } = this.readSlots();
    const semanticInvalid: SlotValue[] = [],
      usable = semanticValidator
        ? valid.filter((candidate) => {
            try {
              semanticValidator(candidate.state);
              return true;
            } catch {
              semanticInvalid.push(candidate);
              return false;
            }
          })
        : valid;
    if (usable.length) {
      const latest = usable.sort(
          (left, right) => right.generation - left.generation,
        )[0],
        degradedAuthorizationState =
          usable.length < 2 || invalid.length > 0 || semanticInvalid.length > 0;
      if (degradedAuthorizationState)
        for (const peer of latest.state.trustedDevices)
          if (!peer.revokedAt)
            this.recordRevocation(peer.device.deviceId, latest.state.updatedAt);
      const effective = this.applyRevocations(latest.state),
        revocationApplied =
          JSON.stringify(effective) !== JSON.stringify(latest.state);
      if (
        usable.length === 1 ||
        invalid.length ||
        semanticInvalid.length ||
        revocationApplied
      ) {
        try {
          this.save(effective, latest.file);
        } catch {
          // The remaining valid immutable generation is still authoritative.
        }
      }
      this.ensureInitializedMarker();
      this.removeLegacySources();
      return effective;
    }
    if (invalid.length || semanticInvalid.length)
      throw new Error("Protected device fabric state cannot be opened");
    const legacy = this.readLegacy();
    if (!legacy) return undefined;
    const effective = this.applyRevocations(legacy);
    semanticValidator?.(effective);
    this.save(effective);
    this.save(effective);
    this.removeLegacySources();
    return effective;
  }

  save(value: ProtectedDeviceFabricState, preserveFile?: string): void {
    validate(value);
    const { valid, invalid } = this.readSlots();
    if (!valid.length && invalid.length)
      throw new Error("Protected device fabric state cannot be opened");
    const latest = valid.sort(
      (left, right) => right.generation - left.generation,
    )[0];
    const generation = (latest?.generation ?? 0) + 1;
    const target = preserveFile
      ? preserveFile === this.slots[0]
        ? this.slots[1]
        : this.slots[0]
      : latest?.file === this.slots[0]
        ? this.slots[1]
        : this.slots[0];
    const temporary = `${target}.${process.pid}.${Date.now()}.partial`;
    const envelope: StorageEnvelope = {
      storageVersion: 1,
      generation,
      state: value,
    };
    let installed = false;
    try {
      this.fileSystem.write(
        temporary,
        Buffer.from(this.protector.encrypt(JSON.stringify(envelope))),
      );
      this.fileSystem.syncFile(temporary);
      this.fileSystem.remove(target);
      this.fileSystem.rename(temporary, target);
      installed = true;
      try {
        this.fileSystem.syncDirectory(this.root);
      } catch (commitError) {
        try {
          this.fileSystem.remove(target);
          installed = false;
          this.fileSystem.syncDirectory(this.root);
          throw commitError;
        } catch (rollbackError) {
          if (!installed) throw commitError;
          if (rollbackError === commitError) throw commitError;
          // Rollback could not be proven. The readable new generation is the
          // commit boundary, so callers must advance in-memory state with it.
        }
      }
    } catch (error) {
      if (!installed) {
        try {
          this.fileSystem.remove(temporary);
        } catch {
          // A uniquely named partial file is never considered during load.
        }
        throw error;
      }
    }
    this.ensureInitializedMarker();
  }

  recordRevocation(deviceId: string, revokedAt: string): void {
    if (!DEVICE_ID.test(deviceId) || !validTimestamp(revokedAt))
      throw new Error("Invalid device revocation tombstone");
    const target = this.revocationPath(deviceId);
    if (this.fileSystem.exists(target)) {
      this.readRevocation(target);
      return;
    }
    const temporary = `${target}.${process.pid}.${Date.now()}.partial`,
      value: RevocationTombstone = { version: 1, deviceId, revokedAt };
    let installed = false;
    try {
      this.fileSystem.write(
        temporary,
        Buffer.from(this.protector.encrypt(JSON.stringify(value))),
      );
      this.fileSystem.syncFile(temporary);
      this.fileSystem.rename(temporary, target);
      installed = true;
      try {
        this.fileSystem.syncDirectory(this.root);
      } catch {
        // A readable revocation is the fail-closed commit boundary.
      }
    } catch (error) {
      if (!installed)
        try {
          this.fileSystem.remove(temporary);
        } catch {
          // Partial files are ignored.
        }
      throw error;
    }
  }

  clearRevocation(deviceId: string): void {
    if (!DEVICE_ID.test(deviceId)) throw new Error("Invalid device identity");
    this.fileSystem.remove(this.revocationPath(deviceId));
    this.fileSystem.syncDirectory(this.root);
  }

  isRevoked(deviceId: string): boolean {
    if (!DEVICE_ID.test(deviceId)) return true;
    const target = this.revocationPath(deviceId);
    return (
      this.fileSystem.exists(target) &&
      this.readRevocation(target).deviceId === deviceId
    );
  }

  private readSlots(): { valid: SlotValue[]; invalid: string[] } {
    const valid: SlotValue[] = [];
    const invalid: string[] = [];
    for (const file of this.slots) {
      if (!this.fileSystem.exists(file)) continue;
      try {
        const decoded = JSON.parse(
          this.protector.decrypt(this.fileSystem.read(file)),
        ) as Partial<StorageEnvelope>;
        if (
          decoded.storageVersion !== 1 ||
          !Number.isSafeInteger(decoded.generation) ||
          Number(decoded.generation) < 1
        )
          throw new Error("Invalid protected device fabric generation");
        validate(decoded.state);
        valid.push({
          storageVersion: 1,
          generation: Number(decoded.generation),
          state: decoded.state,
          file,
        });
      } catch {
        invalid.push(file);
      }
    }
    return { valid, invalid };
  }

  private readLegacy(): ProtectedDeviceFabricState | undefined {
    if (this.fileSystem.exists(this.initializedMarker())) {
      this.readInitializedMarker();
      throw new Error("Protected device fabric generations are missing");
    }
    const backup = `${this.legacyTarget}.backup`;
    const source = this.fileSystem.exists(this.legacyTarget)
      ? this.legacyTarget
      : this.fileSystem.exists(backup)
        ? backup
        : undefined;
    if (!source) return undefined;
    try {
      const value = JSON.parse(
        this.protector.decrypt(this.fileSystem.read(source)),
      );
      validate(value);
      return value;
    } catch {
      throw new Error("Protected device fabric state cannot be opened");
    }
  }

  private ensureInitializedMarker(): void {
    const target = this.initializedMarker();
    if (this.fileSystem.exists(target)) {
      this.readInitializedMarker();
      return;
    }
    const temporary = `${target}.${process.pid}.${Date.now()}.partial`;
    try {
      this.fileSystem.write(
        temporary,
        Buffer.from(
          this.protector.encrypt(
            JSON.stringify({
              version: 1,
              purpose: "device-fabric-initialized",
            }),
          ),
        ),
      );
      this.fileSystem.syncFile(temporary);
      this.fileSystem.rename(temporary, target);
      this.fileSystem.syncDirectory(this.root);
    } catch (error) {
      try {
        this.fileSystem.remove(temporary);
      } catch {
        // Partial marker files are ignored.
      }
      throw error;
    }
  }

  private readInitializedMarker(): void {
    try {
      const value = JSON.parse(
        this.protector.decrypt(this.fileSystem.read(this.initializedMarker())),
      ) as { version?: unknown; purpose?: unknown };
      if (value.version !== 1 || value.purpose !== "device-fabric-initialized")
        throw new Error("invalid");
    } catch {
      throw new Error(
        "Protected device fabric initialization marker is invalid",
      );
    }
  }

  private removeLegacySources(): void {
    if (
      !this.fileSystem.exists(this.legacyTarget) &&
      !this.fileSystem.exists(`${this.legacyTarget}.backup`)
    )
      return;
    this.fileSystem.remove(this.legacyTarget);
    this.fileSystem.remove(`${this.legacyTarget}.backup`);
    this.fileSystem.syncDirectory(this.root);
  }

  private initializedMarker(): string {
    return path.join(this.root, "device-fabric.initialized.protected");
  }

  private applyRevocations(
    state: ProtectedDeviceFabricState,
  ): ProtectedDeviceFabricState {
    const tombstones = new Map(
      readdirSync(this.root)
        .filter((name) => /^revocation-[a-f0-9]{64}\.protected$/.test(name))
        .map((name) => this.readRevocation(path.join(this.root, name)))
        .map((item) => [item.deviceId, item.revokedAt]),
    );
    if (!tombstones.size) return state;
    return {
      ...state,
      trustedDevices: state.trustedDevices.map((peer) => {
        const revokedAt = tombstones.get(peer.device.deviceId);
        return revokedAt ? { ...peer, revokedAt } : peer;
      }),
    };
  }

  private readRevocation(file: string): RevocationTombstone {
    try {
      const value = JSON.parse(
          this.protector.decrypt(this.fileSystem.read(file)),
        ) as Partial<RevocationTombstone>,
        expected = path
          .basename(file)
          .slice("revocation-".length, -".protected".length);
      if (
        value.version !== 1 ||
        !DEVICE_ID.test(String(value.deviceId)) ||
        !validTimestamp(value.revokedAt) ||
        createHash("sha256").update(String(value.deviceId)).digest("hex") !==
          expected
      )
        throw new Error("invalid");
      return value as RevocationTombstone;
    } catch {
      throw new Error("Protected device revocation cannot be opened");
    }
  }

  private revocationPath(deviceId: string): string {
    return path.join(
      this.root,
      `revocation-${createHash("sha256").update(deviceId).digest("hex")}.protected`,
    );
  }
}
