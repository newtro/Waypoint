import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DeviceFabricService } from "./device-fabric-service.js";
import {
  advertisementPayload,
  createSignedAdvertisement,
} from "./device-network-protocol.js";
import {
  deviceEndpoint,
  isAllowedDiscoverySource,
  LanDiscoveryService,
} from "./lan-discovery.js";
import { ProtectedDeviceVault } from "./protected-device-vault.js";

const protector = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value),
  decrypt: (value: Uint8Array) => Buffer.from(value).toString(),
};
async function fabric(name: string) {
  return DeviceFabricService.create(
    new ProtectedDeviceVault(
      mkdtempSync(path.join(tmpdir(), "waypoint-discovery-")),
      protector,
    ),
    {
      displayName: name,
      platform: "win32",
      architecture: "x64",
      appVersion: "1.0.0",
    },
  );
}

describe("LAN discovery state", () => {
  it("builds a distinct reachable endpoint for each active interface", () => {
    expect(deviceEndpoint("192.168.1.20", 45832)).toBe(
      "https://192.168.1.20:45832/",
    );
    expect(deviceEndpoint("10.0.0.20", 45832)).toBe(
      "https://10.0.0.20:45832/",
    );
  });

  it("deduplicates presence, expires it, and never grants trust", async () => {
    const local = await fabric("Local"),
      peer = await fabric("Peer"),
      changed = vi.fn(),
      discovery = new LanDiscoveryService(local, changed),
      now = new Date("2026-08-21T12:00:00.000Z"),
      advert = createSignedAdvertisement(peer, {
        endpoint: "https://127.0.0.1:45000/",
        fingerprintSha256: "b".repeat(64),
        now,
      });
    discovery.observe(advert, now);
    discovery.observe(advert, new Date(now.getTime() + 1_000));
    expect(discovery.snapshot(new Date(now.getTime() + 1_000))).toHaveLength(1);
    expect(local.trustedDevices()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(discovery.snapshot(new Date(now.getTime() + 9_000))).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("bounds retained unknown identities across many multicast sources", async () => {
    const local = await fabric("Bounded Local"),
      peer = await fabric("Unknown Peer"),
      discovery = new LanDiscoveryService(local),
      now = new Date("2026-08-21T12:00:00.000Z");
    for (let index = 0; index < 2_000; index += 1) {
      const fingerprint = index.toString(16).padStart(64, "0"),
        advert = createSignedAdvertisement(peer, {
          endpoint: `https://192.168.${Math.floor(index / 250)}.${(index % 250) + 1}:45000/`,
          fingerprintSha256: fingerprint,
          now,
        });
      discovery.observe(advert, now);
    }
    expect(discovery.snapshot(now)).toHaveLength(90);
  });

  it("rejects public and unrelated multicast sources", () => {
    const interfaces = {
      Ethernet: [
        {
          address: "192.168.10.20",
          netmask: "255.255.255.0",
          family: "IPv4" as const,
          mac: "00:11:22:33:44:55",
          internal: false,
          cidr: "192.168.10.20/24",
        },
      ],
    };
    expect(isAllowedDiscoverySource("192.168.10.44", interfaces)).toBe(true);
    expect(isAllowedDiscoverySource("192.168.11.44", interfaces)).toBe(false);
    expect(isAllowedDiscoverySource("8.8.8.8", interfaces)).toBe(false);
  });

  it("flags a trusted fingerprint signature collision without replacing metadata", async () => {
    const local = await fabric("Local"),
      first = await fabric("First"),
      attackerRoot = mkdtempSync(path.join(tmpdir(), "waypoint-collision-")),
      attackerVault = new ProtectedDeviceVault(attackerRoot, protector),
      attacker = await DeviceFabricService.create(attackerVault, {
        displayName: "Attacker",
        platform: "linux",
        architecture: "x64",
        appVersion: "1.0.0",
      }),
      discovery = new LanDiscoveryService(local),
      now = new Date("2026-08-21T12:00:00.000Z"),
      firstAdvert = createSignedAdvertisement(first, {
        endpoint: "https://127.0.0.1:45001/",
        fingerprintSha256: "c".repeat(64),
        now,
      });
    local.trustDevice({
      device: first.localIdentity(),
      metadata: first.status().metadata,
      certificateFingerprintSha256: "c".repeat(64),
    });
    discovery.observe(firstAdvert, now);
    const forged = { ...firstAdvert, metadata: { ...firstAdvert.metadata } };
    forged.metadata.displayName = "Attacker";
    forged.signature = attacker.sign(advertisementPayload(forged));
    expect(
      discovery.observe(forged, new Date(now.getTime() + 1_000))
        ?.identityConflict,
    ).toBe(true);
    expect(discovery.snapshot(now)[0].advertisement.metadata.displayName).toBe(
      "First",
    );
  });
});
