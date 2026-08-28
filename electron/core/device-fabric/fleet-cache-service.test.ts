import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FleetCacheService,
  fleetFetchFailureAction,
  type FleetWorkspaceGrant,
} from "./fleet-cache-service.js";

const protector = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).map((byte) => byte ^ 0x4f),
  decrypt: (value: Uint8Array) =>
    Buffer.from(Buffer.from(value).map((byte) => byte ^ 0x4f)).toString(),
};

describe("fleet encrypted cache", () => {
  it("retains a valid cache on transport loss but discards authoritative deletion", () => {
    expect(fleetFetchFailureAction(new Error("connection refused"), true)).toBe(
      "fallback",
    );
    expect(
      fleetFetchFailureAction(
        Object.assign(new Error("Fleet object was not found"), {
          statusCode: 404,
          deviceCode: "fleet_object_not_found",
        }),
        true,
      ),
    ).toBe("discard");
    expect(
      fleetFetchFailureAction(
        Object.assign(new Error("not_found"), { statusCode: 404 }),
        true,
      ),
    ).toBe("fallback");
    expect(fleetFetchFailureAction(new Error("connection refused"), false)).toBe(
      "fail",
    );
  });
  it("persists protected grants and authenticated encrypted objects across restart", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-cache-")),
      sourceDeviceId = "source_device_0001",
      workspaceId = "fleet_workspace_0001",
      service = new FleetCacheService(root, protector),
      grant = service.ensureAuthoritativeGrant(workspaceId, sourceDeviceId),
      encrypted = service.encryptAuthoritativeObject({
        sourceDeviceId,
        workspaceId,
        objectId: "fleet_document_0001",
        objectKind: "document",
        revisionId: "fleet_revision_0001",
        updatedAt: "2026-08-21T12:00:00.000Z",
        plaintext: JSON.stringify({
          version: 1,
          sourceDeviceId,
          workspace: { id: workspaceId, name: "Fleet" },
          objectKind: "document",
          object: {
            id: "fleet_document_0001",
            revisionId: "fleet_revision_0001",
            title: "Secret",
            body: "fleet needle",
          },
        }),
      });
    expect(JSON.stringify(encrypted)).not.toContain("fleet needle");
    expect(service.cacheEncryptedObject(encrypted)).toContain("fleet needle");
    service.setPinned(sourceDeviceId, workspaceId, true, {
      completeWithinBounds: true,
      attachmentLimitBytes: 6 * 1024 * 1024,
    });
    service.saveCatalog({
      version: 1,
      deviceId: sourceDeviceId,
      generatedAt: "2026-08-21T12:00:00.000Z",
      workspaces: [
        {
          workspaceId,
          name: "Fleet",
          createdAt: "2026-08-21T11:00:00.000Z",
          updatedAt: "2026-08-21T12:00:00.000Z",
          authoritativeDeviceId: sourceDeviceId,
          keyEpoch: 1,
          counts: { chats: 0, documents: 1, memories: 0, attachments: 0 },
        },
      ],
    });
    const protectedBytes = readFileSync(
      path.join(root, "fleet-cache.protected"),
    );
    expect(protectedBytes.includes(Buffer.from(grant.workspaceKey))).toBe(false);
    expect(protectedBytes.includes(Buffer.from("fleet needle"))).toBe(false);

    const reopened = new FleetCacheService(root, protector);
    expect(
      reopened.openCachedObject(
        sourceDeviceId,
        workspaceId,
        "fleet_document_0001",
      ),
    ).toContain("fleet needle");
    expect(
      reopened.searchCached(
        "fleet needle",
        new Set([sourceDeviceId]),
        10,
      ),
    ).toEqual([
      expect.objectContaining({
        sourceDeviceId,
        workspaceId,
        objectId: "fleet_document_0001",
        method: "cached_text",
      }),
    ]);
    expect(reopened.status()).toMatchObject({
      grants: 1,
      objects: 1,
      pinnedWorkspaceIds: [workspaceId],
    });
    expect(reopened.catalogs(new Set([sourceDeviceId]))).toEqual([
      expect.objectContaining({
        deviceId: sourceDeviceId,
        workspaces: [expect.objectContaining({ workspaceId, name: "Fleet" })],
      }),
    ]);
    expect(
      reopened.rotateAuthoritativeGrant(workspaceId, sourceDeviceId).keyEpoch,
    ).toBe(2);
    expect(
      reopened.openCachedObject(
        sourceDeviceId,
        workspaceId,
        "fleet_document_0001",
      ),
    ).toContain("fleet needle");
    reopened.reconcileInventory(sourceDeviceId, workspaceId, []);
    expect(
      reopened.openCachedObject(
        sourceDeviceId,
        workspaceId,
        "fleet_document_0001",
      ),
    ).toBeUndefined();
  });

  it("rejects tamper, stale/colliding keys, missing grants, and revocation", () => {
    const source = new FleetCacheService(
        mkdtempSync(path.join(tmpdir(), "waypoint-fleet-source-")),
        protector,
      ),
      target = new FleetCacheService(
        mkdtempSync(path.join(tmpdir(), "waypoint-fleet-target-")),
        protector,
      ),
      sourceDeviceId = "source_device_0002",
      workspaceId = "fleet_workspace_0002",
      grant = source.ensureAuthoritativeGrant(workspaceId, sourceDeviceId),
      encrypted = source.encryptAuthoritativeObject({
        sourceDeviceId,
        workspaceId,
        objectId: "fleet_memory_000001",
        objectKind: "memory",
        updatedAt: "2026-08-21T12:00:00.000Z",
        plaintext: JSON.stringify({
          version: 1,
          sourceDeviceId,
          workspace: { id: workspaceId, name: "Fleet" },
          objectKind: "memory",
          object: { id: "fleet_memory_000001", body: "private memory" },
        }),
      });
    expect(() => target.cacheEncryptedObject(encrypted)).toThrow(/key/);
    target.acceptGrant(grant);
    expect(() =>
      target.cacheEncryptedObject({
        ...encrypted,
        authTag: Buffer.alloc(16).toString("base64"),
      }),
    ).toThrow(/authentication/);
    expect(target.cacheEncryptedObject(encrypted)).toContain("private memory");
    expect(() =>
      target.acceptGrant({
        ...grant,
        workspaceKey: Buffer.alloc(32, 7).toString("base64"),
      }),
    ).toThrow(/collision/);
    expect(() =>
      target.acceptGrant({
        ...grant,
        keyEpoch: 0,
      } as FleetWorkspaceGrant),
    ).toThrow(/Invalid/);
    target.revokeSource(sourceDeviceId);
    expect(target.status()).toMatchObject({ grants: 0, objects: 0 });
  });

  it("qualifies durable pins by source device and reconciles one source only", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-pins-")),
      service = new FleetCacheService(root, protector),
      workspaceId = "shared_workspace_0001",
      firstSource = "source_device_alpha",
      secondSource = "source_device_bravo";
    service.setPinned(firstSource, workspaceId, true, {
      completeWithinBounds: true,
      omittedAttachments: 2,
    });
    service.setPinned(secondSource, workspaceId, true, {
      completeWithinBounds: false,
    });
    expect(new FleetCacheService(root, protector).status().pins).toEqual([
      expect.objectContaining({
        sourceDeviceId: firstSource,
        workspaceId,
        completeWithinBounds: true,
        omittedAttachments: 2,
      }),
      expect.objectContaining({
        sourceDeviceId: secondSource,
        workspaceId,
        completeWithinBounds: false,
      }),
    ]);

    service.reconcileCatalog(firstSource, []);
    expect(service.status().pins).toEqual([
      expect.objectContaining({
        sourceDeviceId: secondSource,
        workspaceId,
      }),
    ]);
  });

  it("atomically persists a catalog replacement with deleted-workspace cache purge", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-catalog-atomic-")),
      service = new FleetCacheService(root, protector),
      sourceDeviceId = "source_device_catalog",
      workspaceId = "workspace_catalog_old",
      objectId = "document_catalog_old";
    service.ensureAuthoritativeGrant(workspaceId, sourceDeviceId);
    service.cacheEncryptedObject(
      service.encryptAuthoritativeObject({
        sourceDeviceId,
        workspaceId,
        objectId,
        objectKind: "document",
        updatedAt: "2026-08-21T12:00:00.000Z",
        plaintext: JSON.stringify({
          version: 1,
          sourceDeviceId,
          workspace: { id: workspaceId, name: "Deleted workspace" },
          objectKind: "document",
          object: { id: objectId, title: "Deleted needle" },
        }),
      }),
    );
    service.setPinned(sourceDeviceId, workspaceId, true, {
      completeWithinBounds: true,
    });
    service.applyCatalog({
      version: 1,
      deviceId: sourceDeviceId,
      generatedAt: "2026-08-21T13:00:00.000Z",
      workspaces: [],
    });

    const reopened = new FleetCacheService(root, protector);
    expect(reopened.catalogs(new Set([sourceDeviceId]))[0].workspaces).toEqual(
      [],
    );
    expect(reopened.status()).toMatchObject({ grants: 0, objects: 0, pins: [] });
    expect(
      reopened.searchCached("Deleted needle", new Set([sourceDeviceId]), 10),
    ).toEqual([]);
  });

  it("rejects authenticated ciphertext whose plaintext provenance disagrees", () => {
    const source = new FleetCacheService(
        mkdtempSync(path.join(tmpdir(), "waypoint-fleet-provenance-source-")),
        protector,
      ),
      target = new FleetCacheService(
        mkdtempSync(path.join(tmpdir(), "waypoint-fleet-provenance-target-")),
        protector,
      ),
      sourceDeviceId = "source_device_provenance",
      workspaceId = "fleet_workspace_provenance",
      grant = source.ensureAuthoritativeGrant(workspaceId, sourceDeviceId),
      encrypted = source.encryptAuthoritativeObject({
        sourceDeviceId,
        workspaceId,
        objectId: "fleet_document_provenance",
        objectKind: "document",
        updatedAt: "2026-08-21T12:00:00.000Z",
        plaintext: JSON.stringify({
          version: 1,
          sourceDeviceId,
          workspace: { id: "different_workspace_0001", name: "Spoofed" },
          objectKind: "document",
          object: { id: "fleet_document_provenance", body: "private" },
        }),
      });
    target.acceptGrant(grant);
    expect(() => target.cacheEncryptedObject(encrypted)).toThrow(/provenance/);
    expect(target.status().objects).toBe(0);
  });
});
