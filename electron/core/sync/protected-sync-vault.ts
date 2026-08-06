import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { DeviceKeyPair, EnrollmentRequest } from "./types.js";
import { syncDirectoryDurably, syncFileDurably } from "../durable-fs.js";
import {
  validateDesktopHostDescriptor,
  type DesktopHostDescriptor,
} from "./peer-host-transport.js";

export interface SecretProtector {
  available(): boolean;
  encrypt(value: string): Uint8Array;
  decrypt(value: Uint8Array): string;
}
export interface ProtectedWorkspaceSecrets {
  version: 1;
  workspaceId: string;
  device: DeviceKeyPair;
  workspaceKey: string;
  keyEpoch: number;
  endpoint: string;
  transport?: { mode: "hosted-relay" } | DesktopHostDescriptor;
  rotation?: { targetEpoch: number; workspaceKey: string };
  previous?: { keyEpoch: number; workspaceKey: string };
  snapshotRequired?: boolean;
  webhookSecrets?: Array<{
    channelId: string;
    secretVersion: number;
    secret: string;
  }>;
}
export interface ProtectedPendingEnrollment {
  version: 1;
  workspaceId: string;
  device: DeviceKeyPair;
  request: EnrollmentRequest;
  endpoint: string;
  transport?: { mode: "hosted-relay" } | DesktopHostDescriptor;
}
export interface ProtectedPeerHostIdentity {
  version: 1;
  workspaceId: string;
  certificatePem: string;
  privateKeyPem: string;
}
const ID = /^[A-Za-z0-9_-]{16,128}$/;
export const PINNED_RELAY_ORIGIN = "https://waypoint-relay.johnnycode.ai";

export class ProtectedSyncVault {
  constructor(
    private readonly root: string,
    private readonly protector: SecretProtector,
  ) {
    if (!protector.available())
      throw new Error("OS-protected sync storage is unavailable");
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  save(value: ProtectedWorkspaceSecrets): void {
    validate(value);
    const target = this.path(value.workspaceId),
      temporary = `${target}.${process.pid}.${Date.now()}.partial`,
      backup = `${target}.backup`;
    try {
      writeFileSync(
        temporary,
        Buffer.from(this.protector.encrypt(JSON.stringify(value))),
        { flag: "wx", mode: 0o600 },
      );
      syncFile(temporary);
      rmSync(backup, { force: true });
      if (existsSync(target)) renameSync(target, backup);
      try {
        renameSync(temporary, target);
      } catch (error) {
        if (existsSync(backup)) renameSync(backup, target);
        throw error;
      }
      syncDirectory(this.root);
      rmSync(backup, { force: true });
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
  load(workspaceId: string): ProtectedWorkspaceSecrets | undefined {
    if (!ID.test(workspaceId)) throw new Error("Invalid workspace identity");
    const target = this.path(workspaceId),
      backup = `${target}.backup`;
    let bytes: Buffer;
    try {
      bytes = readFileSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!existsSync(backup)) return undefined;
      bytes = readFileSync(backup);
    }
    let value: unknown;
    try {
      value = JSON.parse(this.protector.decrypt(bytes));
    } catch {
      throw new Error("Protected sync identity cannot be opened");
    }
    validate(value);
    if (value.workspaceId !== workspaceId)
      throw new Error("Protected sync identity ownership mismatch");
    return value;
  }
  remove(workspaceId: string): void {
    if (!ID.test(workspaceId)) throw new Error("Invalid workspace identity");
    rmSync(this.path(workspaceId), { force: true });
    rmSync(this.pendingPath(workspaceId), { force: true });
    rmSync(this.hostPath(workspaceId), { force: true });
  }
  savePending(value: ProtectedPendingEnrollment): void {
    validatePending(value);
    this.write(this.pendingPath(value.workspaceId), value);
  }
  loadPending(workspaceId: string): ProtectedPendingEnrollment | undefined {
    const value = this.read(this.pendingPath(workspaceId));
    if (value === undefined) return undefined;
    validatePending(value);
    if (value.workspaceId !== workspaceId)
      throw new Error("Protected pending enrollment ownership mismatch");
    return value;
  }
  removePending(workspaceId: string): void {
    if (!ID.test(workspaceId)) throw new Error("Invalid workspace identity");
    rmSync(this.pendingPath(workspaceId), { force: true });
  }
  saveHostIdentity(value: ProtectedPeerHostIdentity): void {
    validateHostIdentity(value);
    this.write(this.hostPath(value.workspaceId), value);
  }
  loadHostIdentity(workspaceId: string): ProtectedPeerHostIdentity | undefined {
    const value = this.read(this.hostPath(workspaceId));
    if (value === undefined) return undefined;
    validateHostIdentity(value);
    if (value.workspaceId !== workspaceId)
      throw new Error("Protected peer-host identity ownership mismatch");
    return value;
  }
  removeHostIdentity(workspaceId: string): void {
    if (!ID.test(workspaceId)) throw new Error("Invalid workspace identity");
    rmSync(this.hostPath(workspaceId), { force: true });
  }
  private write(target: string, value: unknown): void {
    const temporary = `${target}.${process.pid}.${Date.now()}.partial`,
      backup = `${target}.backup`;
    try {
      writeFileSync(
        temporary,
        Buffer.from(this.protector.encrypt(JSON.stringify(value))),
        { flag: "wx", mode: 0o600 },
      );
      syncFile(temporary);
      rmSync(backup, { force: true });
      if (existsSync(target)) renameSync(target, backup);
      try {
        renameSync(temporary, target);
      } catch (error) {
        if (existsSync(backup)) renameSync(backup, target);
        throw error;
      }
      syncDirectory(this.root);
      rmSync(backup, { force: true });
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
  private read(target: string): unknown | undefined {
    const backup = `${target}.backup`;
    let bytes: Buffer;
    try {
      bytes = readFileSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!existsSync(backup)) return undefined;
      bytes = readFileSync(backup);
    }
    try {
      return JSON.parse(this.protector.decrypt(bytes));
    } catch {
      throw new Error("Protected sync identity cannot be opened");
    }
  }
  private path(workspaceId: string) {
    return path.join(this.root, `${workspaceId}.protected`);
  }
  private pendingPath(workspaceId: string) {
    return path.join(this.root, `${workspaceId}.pending.protected`);
  }
  private hostPath(workspaceId: string) {
    return path.join(this.root, `${workspaceId}.host.protected`);
  }
}
function validate(value: unknown): asserts value is ProtectedWorkspaceSecrets {
  if (!value || typeof value !== "object")
    throw new Error("Invalid protected sync identity");
  const item = value as Partial<ProtectedWorkspaceSecrets>,
    keys = Object.keys(item),
    webhooks = item.webhookSecrets;
  if (
    keys.some(
      (key) =>
        ![
          "version",
          "workspaceId",
          "device",
          "workspaceKey",
          "keyEpoch",
          "endpoint",
          "transport",
          "rotation",
          "previous",
          "snapshotRequired",
          "webhookSecrets",
        ].includes(key),
    ) ||
    item.version !== 1 ||
    !item.device ||
    !ID.test(String(item.workspaceId)) ||
    !ID.test(String(item.device.deviceId)) ||
    !validBase64(item.device.signingPublicKey, 32) ||
    !validBase64(item.device.signingPrivateKey, 64) ||
    !validBase64(item.device.encryptionPublicKey, 32) ||
    !validBase64(item.device.encryptionPrivateKey, 32) ||
    !validBase64(item.workspaceKey, 32) ||
    !Number.isSafeInteger(item.keyEpoch) ||
    Number(item.keyEpoch) < 1 ||
    !validEndpoint(item.endpoint, item.transport) ||
    (item.snapshotRequired !== undefined &&
      typeof item.snapshotRequired !== "boolean") ||
    (webhooks !== undefined &&
      (!Array.isArray(webhooks) ||
        webhooks.length > 100 ||
        webhooks.some(
          (entry) =>
            !ID.test(entry.channelId) ||
            !Number.isSafeInteger(entry.secretVersion) ||
            entry.secretVersion < 1 ||
            Buffer.from(entry.secret, "base64url").length !== 32,
        ))) ||
    (item.previous !== undefined &&
      (!Number.isSafeInteger(item.previous.keyEpoch) ||
        item.previous.keyEpoch !== Number(item.keyEpoch) - 1 ||
        !validBase64(item.previous.workspaceKey, 32))) ||
    (item.rotation !== undefined &&
      (!Number.isSafeInteger(item.rotation.targetEpoch) ||
        item.rotation.targetEpoch !== Number(item.keyEpoch) + 1 ||
        !validBase64(item.rotation.workspaceKey, 32)))
  )
    throw new Error("Invalid protected sync identity");
}
function validBase64(value: unknown, length: number) {
  if (typeof value !== "string") return false;
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length === length && bytes.toString("base64") === value;
  } catch {
    return false;
  }
}
function validatePending(
  value: unknown,
): asserts value is ProtectedPendingEnrollment {
  if (!value || typeof value !== "object")
    throw new Error("Invalid protected pending enrollment");
  const item = value as Partial<ProtectedPendingEnrollment>;
  if (
    item.version !== 1 ||
    !ID.test(String(item.workspaceId)) ||
    !validEndpoint(item.endpoint, item.transport) ||
    !item.device ||
    !item.request ||
    item.request.workspaceId !== item.workspaceId ||
    item.request.device.deviceId !== item.device.deviceId ||
    !validBase64(item.device.signingPrivateKey, 64) ||
    !validBase64(item.device.encryptionPrivateKey, 32)
  )
    throw new Error("Invalid protected pending enrollment");
}
function validEndpoint(endpoint: unknown, transport: unknown) {
  if (endpoint === PINNED_RELAY_ORIGIN)
    return (
      transport === undefined ||
      (transport as { mode?: unknown }).mode === "hosted-relay"
    );
  try {
    validateDesktopHostDescriptor(transport);
    return endpoint === transport.endpoint;
  } catch {
    return false;
  }
}
function validateHostIdentity(
  value: unknown,
): asserts value is ProtectedPeerHostIdentity {
  if (!value || typeof value !== "object")
    throw new Error("Invalid protected peer-host identity");
  const item = value as Partial<ProtectedPeerHostIdentity>;
  if (
    item.version !== 1 ||
    !ID.test(String(item.workspaceId)) ||
    typeof item.certificatePem !== "string" ||
    !item.certificatePem.includes("BEGIN CERTIFICATE") ||
    item.certificatePem.length > 32_768 ||
    typeof item.privateKeyPem !== "string" ||
    !/BEGIN (?:RSA )?PRIVATE KEY/.test(item.privateKeyPem) ||
    item.privateKeyPem.length > 32_768
  )
    throw new Error("Invalid protected peer-host identity");
}
function syncFile(file: string) {
  syncFileDurably(file);
}
function syncDirectory(directory: string) {
  syncDirectoryDurably(directory);
}
