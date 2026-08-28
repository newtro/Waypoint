import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DeviceFabricService } from "./device-fabric-service.js";
import {
  createSignedAdvertisement,
  parseSignedAdvertisement,
  verifySignedAdvertisement,
} from "./device-network-protocol.js";
import { ProtectedDeviceVault } from "./protected-device-vault.js";

const protector = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value),
  decrypt: (value: Uint8Array) => Buffer.from(value).toString(),
};

describe("device network advertisement protocol", () => {
  it("accepts a bounded signed LAN presence and rejects tamper, expiry, and WAN endpoints", async () => {
    const service = await DeviceFabricService.create(
        new ProtectedDeviceVault(
          mkdtempSync(path.join(tmpdir(), "waypoint-advert-")),
          protector,
        ),
        {
          displayName: "Fixture PC",
          platform: "win32",
          architecture: "x64",
          appVersion: "1.0.0",
        },
      ),
      now = new Date("2026-08-21T12:00:00.000Z"),
      advert = createSignedAdvertisement(service, {
        endpoint: "https://192.168.1.20:45832/",
        fingerprintSha256: "a".repeat(64),
        now,
      });
    expect(parseSignedAdvertisement(advert, now)).toEqual(advert);
    expect(
      verifySignedAdvertisement(
        advert,
        service,
        service.localIdentity().signingPublicKey,
      ),
    ).toBe(true);
    expect(JSON.stringify(advert)).not.toContain(
      service.localIdentity().encryptionPublicKey,
    );
    expect(JSON.stringify(advert)).not.toContain(
      service.localIdentity().signingPublicKey,
    );
    expect(advert.device).toEqual({
      fingerprintSha256: "a".repeat(64),
    });
    expect(advert.metadata).toEqual({
      displayName: "Fixture PC",
      platform: "win32",
      appVersion: "1.0.0",
    });
    const tampered = {
      ...advert,
      metadata: { ...advert.metadata, displayName: "Other" },
    };
    expect(parseSignedAdvertisement(tampered, now)).toEqual(tampered);
    expect(
      verifySignedAdvertisement(
        tampered,
        service,
        service.localIdentity().signingPublicKey,
      ),
    ).toBe(false);
    expect(() =>
      parseSignedAdvertisement(advert, new Date(now.getTime() + 9_000)),
    ).toThrow(/Invalid/);
    expect(() =>
      createSignedAdvertisement(service, {
        endpoint: "https://8.8.8.8:443/",
        fingerprintSha256: "a".repeat(64),
        now,
      }),
    ).toThrow(/Invalid/);
  });
});
