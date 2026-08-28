import { createSocket, type Socket } from "node:dgram";
import { networkInterfaces } from "node:os";
import type { DeviceFabricService } from "./device-fabric-service.js";
import {
  createSignedAdvertisement,
  parseSignedAdvertisement,
  verifySignedAdvertisement,
  type SignedDeviceAdvertisement,
} from "./device-network-protocol.js";

export const DEVICE_DISCOVERY_PORT = 45831;
export const DEVICE_DISCOVERY_GROUP = "239.255.87.80";
const ANNOUNCE_MS = 2_000;
const MAX_DISCOVERED_DEVICES = 128;
const DISCOVERY_ADMISSION_WINDOW_MS = 60_000;
const MAX_DATAGRAMS_PER_SOURCE = 90;
const MAX_DISCOVERY_ADMISSION_SOURCES = 256;

export interface DiscoveredDevice {
  advertisement: SignedDeviceAdvertisement;
  firstSeenAt: string;
  lastSeenAt: string;
  identityConflict: boolean;
}

export class LanDiscoveryService {
  private readonly discovered = new Map<string, DiscoveredDevice>();
  private readonly memberships = new Set<string>();
  private socket?: Socket;
  private port?: number;
  private fixedAddress?: string;
  private listenAddresses?: string[];
  private certificateFingerprintSha256?: string;
  private announceTimer?: NodeJS.Timeout;
  private interfaceTimer?: NodeJS.Timeout;
  private readonly sourceAdmissions = new Map<
    string,
    { windowStartedAt: number; count: number }
  >();

  constructor(
    private readonly fabric: DeviceFabricService,
    private readonly changed: () => void = () => undefined,
  ) {}

  async start(
    endpoint: string | number,
    certificateFingerprintSha256: string,
    listenAddresses?: string[],
  ): Promise<void> {
    if (this.socket) throw new Error("LAN discovery is already running");
    if (typeof endpoint === "number") {
      this.port = endpoint;
      this.fixedAddress = undefined;
      this.listenAddresses = listenAddresses
        ? [...new Set(listenAddresses)].sort()
        : undefined;
    } else {
      const parsed = new URL(endpoint);
      this.port = Number(parsed.port);
      this.fixedAddress = parsed.hostname;
      this.listenAddresses = [parsed.hostname];
    }
    this.certificateFingerprintSha256 = certificateFingerprintSha256;
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;
    socket.on("message", (bytes, remote) => {
      try {
        if (bytes.byteLength > 8_192) return;
        this.observe(
          JSON.parse(bytes.toString("utf8")),
          new Date(),
          remote.address,
        );
      } catch {
        // Untrusted multicast input is ignored without affecting the host.
      }
    });
    socket.on("error", () => {
      // Presence is best effort; the authenticated HTTPS host stays available.
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        socket.once("error", onError);
        socket.bind(DEVICE_DISCOVERY_PORT, "0.0.0.0", () => {
          socket.off("error", onError);
          resolve();
        });
      });
    } catch (error) {
      this.socket = undefined;
      try {
        socket.close();
      } catch {
        // A failed bind may already have closed the socket.
      }
      throw error;
    }
    socket.setMulticastTTL(1);
    socket.setMulticastLoopback(true);
    this.refreshMemberships();
    this.announce();
    this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_MS);
    this.interfaceTimer = setInterval(() => {
      this.refreshMemberships();
      this.snapshot(new Date());
    }, 10_000);
    this.announceTimer.unref();
    this.interfaceTimer.unref();
  }

  observe(
    input: unknown,
    now = new Date(),
    source = "manual",
  ): DiscoveredDevice | undefined {
    if (source !== "manual" && !isAllowedDiscoverySource(source))
      return undefined;
    if (!this.admitSource(source, now)) return undefined;
    const advertisement = parseSignedAdvertisement(input, now);
    for (const [fingerprint, item] of this.discovered)
      if (Date.parse(item.advertisement.expiresAt) <= now.getTime())
        this.discovered.delete(fingerprint);
    const local = this.fabric.localIdentity(),
      discoveryId = advertisement.device.fingerprintSha256,
      sameLocalId = discoveryId === this.certificateFingerprintSha256,
      localConflict =
        sameLocalId &&
        (!verifySignedAdvertisement(
          advertisement,
          this.fabric,
          local.signingPublicKey,
        ) ||
          advertisement.device.fingerprintSha256 !==
            this.certificateFingerprintSha256);
    if (sameLocalId && !localConflict) return undefined;
    const trusted = this.fabric
        .trustedDevices(true, true)
        .find(
          (peer) => peer.certificateFingerprintSha256 === discoveryId,
        ),
      trustedConflict = Boolean(
        trusted &&
          (!verifySignedAdvertisement(
            advertisement,
            this.fabric,
            trusted.device.signingPublicKey,
          ) ||
            (!trusted.revokedAt &&
              trusted.certificateFingerprintSha256 &&
              trusted.certificateFingerprintSha256 !==
                advertisement.device.fingerprintSha256)),
      ),
      prior = this.discovered.get(discoveryId),
      conflict = Boolean(localConflict || trustedConflict),
      next: DiscoveredDevice = {
        advertisement: conflict
          ? (prior?.advertisement ?? advertisement)
          : advertisement,
        firstSeenAt: prior?.firstSeenAt ?? now.toISOString(),
        lastSeenAt: now.toISOString(),
        identityConflict: prior?.identityConflict === true || conflict,
      };
    if (
      !prior &&
      !trusted &&
      this.discovered.size >= MAX_DISCOVERED_DEVICES
    )
      return undefined;
    this.discovered.set(discoveryId, next);
    if (!next.identityConflict && trusted)
      this.fabric.markSeen(trusted.device.deviceId, now);
    this.changed();
    return this.clone(next);
  }

  snapshot(now = new Date()): DiscoveredDevice[] {
    let expired = false;
    for (const [deviceId, item] of this.discovered)
      if (Date.parse(item.advertisement.expiresAt) <= now.getTime()) {
        this.discovered.delete(deviceId);
        expired = true;
      }
    if (expired) this.changed();
    return [...this.discovered.values()]
      .map((item) => this.clone(item))
      .sort((left, right) =>
        left.advertisement.metadata.displayName.localeCompare(
          right.advertisement.metadata.displayName,
        ),
      );
  }

  currentAdvertisement(
    now = new Date(),
    address = this.fixedAddress ?? preferredDeviceAddress(),
  ): SignedDeviceAdvertisement {
    if (!this.port || !this.certificateFingerprintSha256)
      throw new Error("LAN discovery is not started");
    return createSignedAdvertisement(this.fabric, {
      endpoint: deviceEndpoint(address, this.port),
      fingerprintSha256: this.certificateFingerprintSha256,
      now,
    });
  }

  updateListenAddresses(addresses: string[]): void {
    if (this.fixedAddress) return;
    this.listenAddresses = [...new Set(addresses)].sort();
    this.refreshMemberships();
    this.announce();
  }

  announce(): void {
    if (!this.socket) return;
    const addresses = this.fixedAddress
      ? [this.fixedAddress]
      : (this.listenAddresses ?? privateInterfaceAddresses());
    for (const address of addresses.length ? addresses : ["127.0.0.1"]) {
      try {
        if (address !== "127.0.0.1")
          this.socket.setMulticastInterface(address);
        const bytes = Buffer.from(
          JSON.stringify(this.currentAdvertisement(new Date(), address)),
        );
        this.socket.send(
          bytes,
          DEVICE_DISCOVERY_PORT,
          DEVICE_DISCOVERY_GROUP,
          () => undefined,
        );
      } catch {
        // An interface can disappear while its advert is being prepared.
      }
    }
  }

  async stop(): Promise<void> {
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.interfaceTimer) clearInterval(this.interfaceTimer);
    this.announceTimer = undefined;
    this.interfaceTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    await new Promise<void>((resolve) => {
      try {
        socket.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  private refreshMemberships(): void {
    const socket = this.socket;
    if (!socket) return;
    const current = new Set(
      this.listenAddresses ?? privateInterfaceAddresses(),
    );
    for (const address of current)
      if (!this.memberships.has(address))
        try {
          socket.addMembership(DEVICE_DISCOVERY_GROUP, address);
          this.memberships.add(address);
        } catch {
          // An interface can disappear between enumeration and membership.
        }
    for (const address of [...this.memberships])
      if (!current.has(address)) {
        try {
          socket.dropMembership(DEVICE_DISCOVERY_GROUP, address);
        } catch {
          // Already removed by the operating system.
        }
        this.memberships.delete(address);
      }
  }

  private admitSource(source: string, now: Date): boolean {
    const timestamp = now.getTime(),
      prior = this.sourceAdmissions.get(source);
    if (
      !prior ||
      timestamp - prior.windowStartedAt >= DISCOVERY_ADMISSION_WINDOW_MS
    ) {
      if (
        !prior &&
        this.sourceAdmissions.size >= MAX_DISCOVERY_ADMISSION_SOURCES
      ) {
        const oldest = [...this.sourceAdmissions.entries()].sort(
          (left, right) =>
            left[1].windowStartedAt - right[1].windowStartedAt,
        )[0]?.[0];
        if (oldest) this.sourceAdmissions.delete(oldest);
      }
      this.sourceAdmissions.set(source, {
        windowStartedAt: timestamp,
        count: 1,
      });
      return true;
    }
    if (prior.count >= MAX_DATAGRAMS_PER_SOURCE) return false;
    prior.count += 1;
    return true;
  }

  private clone(value: DiscoveredDevice): DiscoveredDevice {
    return {
      ...value,
      advertisement: {
        ...value.advertisement,
        device: { ...value.advertisement.device },
        metadata: { ...value.advertisement.metadata },
      },
    };
  }
}

export function privateInterfaceAddresses(): string[] {
  return [
    ...new Set(
      Object.values(networkInterfaces())
        .flatMap((items) => items ?? [])
        .filter(
          (item) =>
            item.family === "IPv4" &&
            !item.internal &&
            (/^10\./.test(item.address) ||
              /^192\.168\./.test(item.address) ||
              /^172\.(?:1[6-9]|2\d|3[01])\./.test(item.address)),
        )
        .map((item) => item.address),
    ),
  ].sort();
}

export function preferredDeviceAddress(): string {
  return privateInterfaceAddresses()[0] ?? "127.0.0.1";
}

export function preferredDeviceAddressForPeer(endpoint: string): string {
  let remote: number;
  try {
    remote = ipv4Number(new URL(endpoint).hostname);
  } catch {
    return preferredDeviceAddress();
  }
  for (const item of Object.values(networkInterfaces()).flatMap(
    (items) => items ?? [],
  )) {
    if (item.family !== "IPv4" || item.internal) continue;
    try {
      const address = ipv4Number(item.address),
        mask = ipv4Number(item.netmask);
      if ((address & mask) === (remote & mask)) return item.address;
    } catch {
      // Ignore incomplete interface records.
    }
  }
  return preferredDeviceAddress();
}

export function deviceEndpoint(address: string, port: number): string {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address))
    throw new Error("Invalid device interface address");
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("Invalid device host port");
  return `https://${address}:${port}/`;
}

function ipv4Number(value: string): number {
  const parts = value.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some(
      (part) => !Number.isInteger(part) || part < 0 || part > 255,
    )
  )
    throw new Error("Invalid IPv4 address");
  return (
    ((parts[0] << 24) >>> 0) +
    (parts[1] << 16) +
    (parts[2] << 8) +
    parts[3]
  );
}

export function isAllowedDiscoverySource(
  source: string,
  interfaces = networkInterfaces(),
): boolean {
  const normalized = source.startsWith("::ffff:")
    ? source.slice(7)
    : source;
  if (/^127\./.test(normalized)) return true;
  if (!isPrivateAddress(normalized)) return false;
  let remote: number;
  try {
    remote = ipv4Number(normalized);
  } catch {
    return false;
  }
  for (const item of Object.values(interfaces).flatMap(
    (entries) => entries ?? [],
  )) {
    if (
      item.family !== "IPv4" ||
      item.internal ||
      !isPrivateAddress(item.address)
    )
      continue;
    try {
      const local = ipv4Number(item.address),
        mask = ipv4Number(item.netmask);
      if ((local & mask) === (remote & mask)) return true;
    } catch {
      // Ignore malformed operating-system interface records.
    }
  }
  return false;
}

function isPrivateAddress(value: string): boolean {
  const parts = value.split(".").map(Number);
  return (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31))
  );
}
