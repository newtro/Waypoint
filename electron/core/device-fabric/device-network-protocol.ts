import type { DeviceFabricService } from "./device-fabric-service.js";

const SHA256 = /^[a-f0-9]{64}$/;

export interface DiscoveryDeviceIdentity {
  /** SHA-256 fingerprint of the HTTPS identity serving the advertised endpoint. */
  fingerprintSha256: string;
}

export interface DiscoveryDeviceMetadata {
  displayName: string;
  platform: "darwin" | "win32" | "linux" | "unknown";
  appVersion: string;
}

/**
 * The multicast envelope is deliberately minimal. Operational state and the
 * device public keys are returned only after an authenticated HTTPS request.
 */
export interface DeviceAdvertisementPayload {
  version: 1;
  type: "waypoint-device";
  device: DiscoveryDeviceIdentity;
  metadata: DiscoveryDeviceMetadata;
  endpoint: string;
  sentAt: string;
  expiresAt: string;
}

export interface SignedDeviceAdvertisement extends DeviceAdvertisementPayload {
  signature: string;
}

export function advertisementPayload(
  value: DeviceAdvertisementPayload,
): string {
  return JSON.stringify({
    version: value.version,
    type: value.type,
    device: {
      fingerprintSha256: value.device.fingerprintSha256,
    },
    metadata: {
      displayName: value.metadata.displayName,
      platform: value.metadata.platform,
      appVersion: value.metadata.appVersion,
    },
    endpoint: value.endpoint,
    sentAt: value.sentAt,
    expiresAt: value.expiresAt,
  });
}

export function createSignedAdvertisement(
  service: DeviceFabricService,
  input: {
    endpoint: string;
    fingerprintSha256: string;
    now?: Date;
    ttlMs?: number;
  },
): SignedDeviceAdvertisement {
  const now = input.now ?? new Date(),
    ttlMs = input.ttlMs ?? 8_000,
    status = service.status(),
    value: DeviceAdvertisementPayload = {
      version: 1,
      type: "waypoint-device",
      device: {
        fingerprintSha256: input.fingerprintSha256,
      },
      metadata: {
        displayName: status.metadata.displayName,
        platform: status.metadata.platform,
        appVersion: status.metadata.appVersion,
      },
      endpoint: input.endpoint,
      sentAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
  validateStructure(value, now, false);
  return { ...value, signature: service.sign(advertisementPayload(value)) };
}

export function parseSignedAdvertisement(
  input: unknown,
  now = new Date(),
): SignedDeviceAdvertisement {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid device advertisement");
  const item = input as SignedDeviceAdvertisement;
  validateStructure(item, now, true);
  return {
    ...item,
    device: { ...item.device },
    metadata: { ...item.metadata },
  };
}

export function verifySignedAdvertisement(
  item: SignedDeviceAdvertisement,
  service: Pick<DeviceFabricService, "verifySigningKey">,
  signingPublicKey: string,
): boolean {
  return service.verifySigningKey(
    advertisementPayload(item),
    item.signature,
    signingPublicKey,
  );
}

function validateStructure(
  item: DeviceAdvertisementPayload & { signature?: unknown },
  now: Date,
  requireSignature: boolean,
): void {
  const sentAt = Date.parse(String(item.sentAt)),
    expiresAt = Date.parse(String(item.expiresAt));
  if (
    item.version !== 1 ||
    item.type !== "waypoint-device" ||
    !validIdentity(item.device) ||
    !validMetadata(item.metadata) ||
    !validLanEndpoint(item.endpoint) ||
    !Number.isFinite(sentAt) ||
    !Number.isFinite(expiresAt) ||
    sentAt > now.getTime() + 5_000 ||
    sentAt < now.getTime() - 15_000 ||
    expiresAt <= now.getTime() ||
    expiresAt - sentAt > 15_000 ||
    (requireSignature && !validBase64(item.signature, 64))
  )
    throw new Error("Invalid device advertisement");
}

function validIdentity(value: unknown): value is DiscoveryDeviceIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<DiscoveryDeviceIdentity>;
  return (
    SHA256.test(String(item.fingerprintSha256)) &&
    Object.keys(item).every((key) => key === "fingerprintSha256")
  );
}

function validMetadata(value: unknown): value is DiscoveryDeviceMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<DiscoveryDeviceMetadata>;
  return (
    typeof item.displayName === "string" &&
    item.displayName.trim().length > 0 &&
    item.displayName.length <= 120 &&
    ["darwin", "win32", "linux", "unknown"].includes(String(item.platform)) &&
    /^[A-Za-z0-9.+_-]{1,64}$/.test(String(item.appVersion)) &&
    Object.keys(item).every((key) =>
      ["displayName", "platform", "appVersion"].includes(key),
    )
  );
}

function validBase64(value: unknown, length: number): boolean {
  if (typeof value !== "string") return false;
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length === length && bytes.toString("base64") === value;
  } catch {
    return false;
  }
}

export function validLanEndpoint(value: unknown): value is string {
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
    const octets = url.hostname.split(".").map(Number);
    if (
      octets.length !== 4 ||
      octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    )
      return false;
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    );
  } catch {
    return false;
  }
}
