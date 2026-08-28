import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DeviceFabricService,
  deviceOperationRequestDigest,
} from "./device-fabric-service.js";
import { FleetCacheService } from "./fleet-cache-service.js";
import {
  createFleetRemoteWorkOrder,
  FleetRemoteWorkService,
} from "./fleet-remote-work-service.js";
import { advertisementPayload } from "./device-network-protocol.js";
import {
  DeviceNetworkRuntime,
  type DeviceNetworkOperations,
} from "./device-network-runtime.js";
import { ProtectedDeviceVault } from "./protected-device-vault.js";

const protector = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value),
  decrypt: (value: Uint8Array) => Buffer.from(value).toString(),
};
async function runtime(
  name: string,
  operations?: (fabric: DeviceFabricService) => DeviceNetworkOperations,
  capabilities = ["presence", "pairing", "remote-work"],
) {
  const root = mkdtempSync(path.join(tmpdir(), "waypoint-network-runtime-")),
    vault = new ProtectedDeviceVault(root, protector),
    fabric = await DeviceFabricService.create(vault, {
      displayName: name,
      platform: name.includes("Mac") ? "darwin" : "win32",
      architecture: name.includes("Mac") ? "arm64" : "x64",
      appVersion: "1.0.0",
    }),
    network = new DeviceNetworkRuntime(
      fabric,
      () => ({
        capabilities,
        runningJobs: 0,
        attentionItems: 0,
      }),
      () => undefined,
      undefined,
      operations?.(fabric),
    );
  await network.start({ bindAddress: "127.0.0.1", discovery: false });
  return { root, vault, fabric, network };
}

describe("device network pairing", () => {
  it("rebinds HTTPS and advertisements when eligible interfaces change", async () => {
    let addresses = ["127.0.0.1"];
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-rebind-")),
      fabric = await DeviceFabricService.create(
        new ProtectedDeviceVault(root, protector),
        {
          displayName: "Rebinding PC",
          platform: "win32",
          architecture: "x64",
          appVersion: "1.0.0",
        },
      ),
      network = new DeviceNetworkRuntime(
        fabric,
        () => ({ capabilities: ["presence"], runningJobs: 0, attentionItems: 0 }),
        () => undefined,
        () => addresses,
      ),
      mutable = network as unknown as { reconcileListeners(): Promise<void> };
    try {
      await expect(
        network.start({ bindAddress: "0.0.0.0", discovery: false }),
      ).rejects.toThrow(/private or loopback/);
      await network.start({ discovery: false });
      expect(network.status().host.endpoint).toContain("127.0.0.1");
      addresses = ["127.0.0.2"];
      await mutable.reconcileListeners();
      expect(network.status().host.endpoint).toContain("127.0.0.2");
      expect(network.advertisement().endpoint).toContain("127.0.0.2");
      addresses = ["192.0.2.1"];
      await mutable.reconcileListeners();
      expect(network.status().host).toMatchObject({
        running: false,
        endpoint: undefined,
      });
    } finally {
      await network.stop();
    }
  });

  it("returns operational state only through reciprocal authenticated trust", async () => {
    const pc = await runtime("Presence PC"),
      mac = await runtime("Presence Mac");
    try {
      pc.fabric.trustDevice({
        device: mac.fabric.localIdentity(),
        metadata: mac.fabric.status().metadata,
        certificateFingerprintSha256:
          mac.fabric.hostIdentity()!.fingerprintSha256,
      });
      mac.fabric.trustDevice({
        device: pc.fabric.localIdentity(),
        metadata: pc.fabric.status().metadata,
        certificateFingerprintSha256:
          pc.fabric.hostIdentity()!.fingerprintSha256,
      });
      mac.network.setPauseState({ pauseWork: true, pauseSync: false });
      pc.network.observeAdvertisement(mac.network.advertisement());
      await vi.waitFor(() => {
        expect(pc.network.status().peers[0]).toMatchObject({
          status: "paused",
          pauseWork: true,
          pauseSync: false,
          capabilities: ["presence", "pairing", "remote-work"],
        });
      });
    } finally {
      await Promise.allSettled([pc.network.stop(), mac.network.stop()]);
    }
  });

  it("accepts every production fleet capability in authenticated presence", async () => {
    const capabilities = [
        "presence",
        "pairing",
        "workspace-catalog",
        "fleet-search",
        "workspace-grants",
        "encrypted-cache",
        "workspace-pin",
        "remote-work",
        "live-supervision",
        "desktop-view",
        "desktop-control",
      ],
      pc = await runtime("Capability PC", undefined, capabilities),
      mac = await runtime("Capability Mac", undefined, capabilities);
    try {
      pc.fabric.trustDevice({
        device: mac.fabric.localIdentity(),
        metadata: mac.fabric.status().metadata,
        certificateFingerprintSha256:
          mac.fabric.hostIdentity()!.fingerprintSha256,
      });
      mac.fabric.trustDevice({
        device: pc.fabric.localIdentity(),
        metadata: pc.fabric.status().metadata,
        certificateFingerprintSha256:
          pc.fabric.hostIdentity()!.fingerprintSha256,
      });
      pc.network.observeAdvertisement(mac.network.advertisement());
      await vi.waitFor(() =>
        expect(pc.network.status().peers[0]).toMatchObject({
          status: "trusted-online",
          capabilities,
        }),
      );
    } finally {
      await Promise.allSettled([pc.network.stop(), mac.network.stop()]);
    }
  });

  it("exchanges a pinned fresh mutual authorization before granting workspace scope", async () => {
    const pc = await runtime("Authorization PC"),
      mac = await runtime("Authorization Mac"),
      workspaceId = "workspace_authorization_01",
      scope = `workspace:${workspaceId}:grant`,
      requestBytes = JSON.stringify({
        version: 1,
        workspaceId,
        operation: "grant",
      });
    try {
      pc.fabric.trustDevice({
        device: mac.fabric.localIdentity(),
        metadata: mac.fabric.status().metadata,
        certificateFingerprintSha256:
          mac.fabric.hostIdentity()!.fingerprintSha256,
        reciprocalState: "active",
      });
      mac.fabric.trustDevice({
        device: pc.fabric.localIdentity(),
        metadata: pc.fabric.status().metadata,
        certificateFingerprintSha256:
          pc.fabric.hostIdentity()!.fingerprintSha256,
        reciprocalState: "pending",
      });
      pc.network.observeAdvertisement(mac.network.advertisement());
      mac.network.observeAdvertisement(pc.network.advertisement());

      expect(
        pc.fabric.grantsWorkspace(
          mac.fabric.status().localDeviceId,
          workspaceId,
        ),
      ).toBe(false);
      const authorization = await pc.network.authorizeOperation(
        mac.fabric.status().localDeviceId,
        scope,
        requestBytes,
      );
      expect(authorization.requestDigestSha256).toBe(
        deviceOperationRequestDigest(requestBytes),
      );
      expect(
        pc.fabric.grantsWorkspace(
          mac.fabric.status().localDeviceId,
          workspaceId,
          authorization,
          requestBytes,
        ),
      ).toBe(false);
      expect(
        mac.fabric.grantsWorkspace(
          pc.fabric.status().localDeviceId,
          workspaceId,
          authorization,
          requestBytes,
        ),
      ).toBe(true);
      expect(
        mac.fabric.grantsWorkspace(
          pc.fabric.status().localDeviceId,
          workspaceId,
          authorization,
          requestBytes,
        ),
      ).toBe(false);
      expect(
        pc.fabric.verifyOperationAuthorization(
          authorization,
          mac.fabric.status().localDeviceId,
          "workspace:wrong_authorization_01:grant",
          requestBytes,
        ),
      ).toBe(false);
    } finally {
      await Promise.allSettled([pc.network.stop(), mac.network.stop()]);
    }
  });

  it("returns bounded catalog and provenance-preserving search only after consume-once authorization", async () => {
    const workspaceId = "fleet_workspace_0001",
      mac = await runtime("Catalog Mac", (fabric) => ({
        catalog: () => ({
          version: 1,
          deviceId: fabric.status().localDeviceId,
          generatedAt: new Date().toISOString(),
          workspaces: [
            {
              workspaceId,
              name: "Mac Project",
              createdAt: "2026-08-21T12:00:00.000Z",
              updatedAt: "2026-08-21T12:01:00.000Z",
              authoritativeDeviceId: fabric.status().localDeviceId,
              keyEpoch: 1,
              counts: {
                chats: 2,
                documents: 3,
                memories: 1,
                attachments: 4,
              },
            },
          ],
        }),
        search: (query) => ({
          version: 1,
          deviceId: fabric.status().localDeviceId,
          query,
          generatedAt: new Date().toISOString(),
          partial: false,
          results: [
            {
              sourceDeviceId: fabric.status().localDeviceId,
              workspaceId,
              workspaceName: "Mac Project",
              objectId: "fleet_document_0001",
              objectKind: "document",
              revisionId: "fleet_revision_0001",
              title: "Remote design",
              excerpt: "Exact Mac provenance",
              score: 1.5,
              method: "text",
            },
          ],
        }),
      })),
      pc = await runtime("Catalog PC");
    try {
      pc.fabric.trustDevice({
        device: mac.fabric.localIdentity(),
        metadata: mac.fabric.status().metadata,
        certificateFingerprintSha256:
          mac.fabric.hostIdentity()!.fingerprintSha256,
        reciprocalState: "active",
      });
      mac.fabric.trustDevice({
        device: pc.fabric.localIdentity(),
        metadata: pc.fabric.status().metadata,
        certificateFingerprintSha256:
          pc.fabric.hostIdentity()!.fingerprintSha256,
        reciprocalState: "active",
      });
      pc.network.observeAdvertisement(mac.network.advertisement());
      mac.network.observeAdvertisement(pc.network.advertisement());

      await expect(
        pc.network.refreshCatalog(mac.fabric.status().localDeviceId),
      ).resolves.toMatchObject({
        workspaces: [
          {
            workspaceId,
            authoritativeDeviceId: mac.fabric.status().localDeviceId,
            counts: { documents: 3 },
          },
        ],
      });
      expect(pc.network.catalog()[0].workspaces[0].name).toBe("Mac Project");
      await expect(
        pc.network.searchDevice(mac.fabric.status().localDeviceId, "design"),
      ).resolves.toMatchObject({
        partial: false,
        results: [
          {
            sourceDeviceId: mac.fabric.status().localDeviceId,
            workspaceId,
            workspaceName: "Mac Project",
            title: "Remote design",
          },
        ],
      });
      pc.network.unlink(mac.fabric.status().localDeviceId);
      expect(pc.network.catalog()).toEqual([]);
      await expect(
        pc.network.searchDevice(mac.fabric.status().localDeviceId, "design"),
      ).rejects.toThrow(/Trusted device/);
    } finally {
      await Promise.allSettled([pc.network.stop(), mac.network.stop()]);
    }
  });

  it("auto-grants a wrapped workspace key and fetches only the requested encrypted object", async () => {
    const workspaceId = "fleet_workspace_0003",
      objectId = "fleet_document_0003",
      sourceCache = new FleetCacheService(
        mkdtempSync(path.join(tmpdir(), "waypoint-fleet-source-runtime-")),
        protector,
      ),
      mac = await runtime("Cache Mac", (fabric) => ({
        catalog: () => ({
          version: 1,
          deviceId: fabric.status().localDeviceId,
          generatedAt: new Date().toISOString(),
          workspaces: [],
        }),
        search: (query) => ({
          version: 1,
          deviceId: fabric.status().localDeviceId,
          query,
          generatedAt: new Date().toISOString(),
          partial: false,
          results: [],
        }),
        workspaceGrant: (requestedWorkspaceId, requesterDeviceId) => {
          const grant = sourceCache.ensureAuthoritativeGrant(
            requestedWorkspaceId,
            fabric.status().localDeviceId,
          );
          return {
            version: 1,
            sourceDeviceId: fabric.status().localDeviceId,
            recipientDeviceId: requesterDeviceId,
            workspaceId: requestedWorkspaceId,
            keyEpoch: grant.keyEpoch,
            wrappedWorkspaceKey: fabric.wrapWorkspaceKeyForDevice(
              grant.workspaceKey,
              requesterDeviceId,
            ),
            grantedAt: new Date().toISOString(),
          };
        },
        encryptedObject: (input) =>
          sourceCache.encryptAuthoritativeObject({
            sourceDeviceId: fabric.status().localDeviceId,
            workspaceId: input.workspaceId,
            objectId: input.objectId,
            objectKind: input.objectKind,
            revisionId: "fleet_revision_0003",
            updatedAt: "2026-08-21T12:00:00.000Z",
            plaintext: JSON.stringify({
              version: 1,
              sourceDeviceId: fabric.status().localDeviceId,
              workspace: { id: input.workspaceId, name: "Mac cache" },
              objectKind: input.objectKind,
              object: {
                id: input.objectId,
                revisionId: "fleet_revision_0003",
                title: "Mac only",
                body: "cache needle",
              },
            }),
          }),
        workspaceInventory: (requestedWorkspaceId) => ({
          version: 1,
          sourceDeviceId: fabric.status().localDeviceId,
          workspaceId: requestedWorkspaceId,
          generatedAt: new Date().toISOString(),
          attachmentLimitBytes: 6 * 1024 * 1024,
          omittedAttachments: 0,
          objects: [{ objectId, objectKind: "document" }],
        }),
      })),
      pc = await runtime("Cache PC"),
      targetCache = new FleetCacheService(
        mkdtempSync(path.join(tmpdir(), "waypoint-fleet-target-runtime-")),
        protector,
      );
    try {
      pc.fabric.trustDevice({
        device: mac.fabric.localIdentity(),
        metadata: mac.fabric.status().metadata,
        certificateFingerprintSha256:
          mac.fabric.hostIdentity()!.fingerprintSha256,
      });
      mac.fabric.trustDevice({
        device: pc.fabric.localIdentity(),
        metadata: pc.fabric.status().metadata,
        certificateFingerprintSha256:
          pc.fabric.hostIdentity()!.fingerprintSha256,
      });
      pc.network.observeAdvertisement(mac.network.advertisement());
      mac.network.observeAdvertisement(pc.network.advertisement());

      const envelope = await pc.network.requestWorkspaceGrant(
        mac.fabric.status().localDeviceId,
        workspaceId,
      );
      targetCache.acceptGrant({
        workspaceId,
        sourceDeviceId: mac.fabric.status().localDeviceId,
        keyEpoch: envelope.keyEpoch,
        workspaceKey: pc.fabric.unwrapWorkspaceKeyFromDevice(
          envelope.wrappedWorkspaceKey,
        ),
        grantedAt: envelope.grantedAt,
      });
      await expect(
        pc.network.fetchWorkspaceInventory(
          mac.fabric.status().localDeviceId,
          workspaceId,
        ),
      ).resolves.toMatchObject({
        omittedAttachments: 0,
        objects: [{ objectId, objectKind: "document" }],
      });
      const encrypted = await pc.network.fetchEncryptedObject(
        mac.fabric.status().localDeviceId,
        { workspaceId, objectId, objectKind: "document" },
      );
      expect(JSON.stringify(encrypted)).not.toContain("cache needle");
      expect(targetCache.cacheEncryptedObject(encrypted)).toContain(
        "cache needle",
      );
      pc.network.unlink(mac.fabric.status().localDeviceId);
      targetCache.revokeSource(mac.fabric.status().localDeviceId);
      expect(targetCache.status()).toMatchObject({ grants: 0, objects: 0 });
    } finally {
      await Promise.allSettled([pc.network.stop(), mac.network.stop()]);
    }
  });

  it("submits, reads, and cancels a mutually authorized target-local work order", async () => {
    const workerStore = new FleetRemoteWorkService(
        mkdtempSync(path.join(tmpdir(), "waypoint-fleet-worker-runtime-")),
        protector,
      ),
      mac = await runtime("Worker Mac", (fabric) => ({
        catalog: () => ({
          version: 1,
          deviceId: fabric.status().localDeviceId,
          generatedAt: new Date().toISOString(),
          workspaces: [],
        }),
        search: (query) => ({
          version: 1,
          deviceId: fabric.status().localDeviceId,
          query,
          generatedAt: new Date().toISOString(),
          partial: false,
          results: [],
        }),
        workerInventory: () => ({
          version: 1,
          deviceId: fabric.status().localDeviceId,
          platform: "darwin",
          architecture: "arm64",
          paused: false,
          totalMemoryMb: 16_384,
          providers: [
            {
              id: "codex",
              available: true,
              version: "1.0.0",
              modelPolicy: "provider-default",
            },
          ],
          roots: [
            {
              root: "/tmp/project",
              profileId: "profile_remote_0001",
              profileName: "Remote worker",
              filesystem: "workspace-write",
              network: "provider-only",
              tools: ["provider-native"],
              approval: "on-write",
              maxDurationMs: 120_000,
            },
          ],
        }),
        submitRemoteWork: (order) => workerStore.accept(order),
        remoteWorkStatus: (jobId, requesterDeviceId) => {
          const record = workerStore.record(jobId);
          if (record.order.controllerDeviceId !== requesterDeviceId)
            throw new Error("controller mismatch");
          return record;
        },
        cancelRemoteWork: (jobId) => workerStore.cancel(jobId),
      })),
      pc = await runtime("Worker PC");
    try {
      pc.fabric.trustDevice({
        device: mac.fabric.localIdentity(),
        metadata: mac.fabric.status().metadata,
        certificateFingerprintSha256:
          mac.fabric.hostIdentity()!.fingerprintSha256,
      });
      mac.fabric.trustDevice({
        device: pc.fabric.localIdentity(),
        metadata: pc.fabric.status().metadata,
        certificateFingerprintSha256:
          pc.fabric.hostIdentity()!.fingerprintSha256,
      });
      pc.network.observeAdvertisement(mac.network.advertisement());
      mac.network.observeAdvertisement(pc.network.advertisement());
      await expect(
        pc.network.fetchWorkerInventory(mac.fabric.status().localDeviceId),
      ).resolves.toMatchObject({
        platform: "darwin",
        totalMemoryMb: 16_384,
        roots: [{ root: "/tmp/project" }],
      });
      const order = createFleetRemoteWorkOrder({
        idempotencyKey: "runtime_remote_request_01",
        controllerDeviceId: pc.fabric.status().localDeviceId,
        targetDeviceId: mac.fabric.status().localDeviceId,
        workspaceId: "runtime_workspace_remote",
        provider: "codex",
        mode: "supervised",
        instruction: "Run target-local tests",
        controllerRoot: "/tmp/controller-project",
        controllerProfileId: "profile_controller_001",
        targetRoot: "/tmp/project",
        targetProfileId: "profile_remote_0001",
        timeoutMs: 60_000,
      });
      await expect(
        pc.network.submitRemoteWork(mac.fabric.status().localDeviceId, order),
      ).resolves.toMatchObject({ status: "waiting_approval" });
      await expect(
        pc.network.remoteWorkStatus(
          mac.fabric.status().localDeviceId,
          order.jobId,
          order,
        ),
      ).resolves.toMatchObject({ order: { jobId: order.jobId } });
      await expect(
        pc.network.remoteWorkStatus(
          mac.fabric.status().localDeviceId,
          order.jobId,
          { ...order, instruction: "Tampered after dispatch" },
        ),
      ).rejects.toThrow(/provenance|order mismatch/i);
      await expect(
        pc.network.cancelRemoteWork(
          mac.fabric.status().localDeviceId,
          order.jobId,
          order,
        ),
      ).resolves.toMatchObject({ status: "canceled" });
      pc.network.unlink(mac.fabric.status().localDeviceId);
      await expect(
        pc.network.remoteWorkStatus(
          mac.fabric.status().localDeviceId,
          order.jobId,
          order,
        ),
      ).rejects.toThrow(/trusted|available|unknown/i);
    } finally {
      await Promise.allSettled([pc.network.stop(), mac.network.stop()]);
    }
  });

  it("rolls back an incoming session when protected persistence fails", async () => {
    const pc = await runtime("Rollback PC"),
      mac = await runtime("Rollback Mac");
    try {
      pc.network.observeAdvertisement(mac.network.advertisement());
      vi.spyOn(mac.fabric, "savePairingSessions").mockImplementationOnce(() => {
        throw new Error("protected persistence unavailable");
      });
      await expect(
        pc.network.requestPairing(
          mac.network.advertisement().device.fingerprintSha256,
        ),
      ).rejects.toThrow(/protected persistence unavailable/);
      expect(mac.fabric.pairingSessions()).toEqual([]);
      expect(mac.network.status().peers).toEqual([]);
    } finally {
      await Promise.allSettled([pc.network.stop(), mac.network.stop()]);
    }
  });

  it("requires matching reciprocal confirmation, pins TLS, reconnects, and unlinks", async () => {
    const pc = await runtime("Scott PC"),
      mac = await runtime("Studio Mac");
    try {
      pc.network.observeAdvertisement(mac.network.advertisement());
      mac.network.observeAdvertisement(pc.network.advertisement());
      expect(pc.network.status().peers[0]).toMatchObject({
        displayName: "Studio Mac",
        status: "unlinked",
        trusted: false,
      });
      await pc.network.requestPairing(
        mac.network.advertisement().device.fingerprintSha256,
      );
      const pcPending = pc.network.status().peers[0].pairing;
      expect(pcPending?.code).toMatch(/^\d{6}$/);
      const macPending = mac.network.status().peers[0].pairing;
      expect(macPending?.code).toBe(pcPending?.code);
      await pc.network.confirmPairing(pcPending!.sessionId);
      expect(pc.fabric.trustedDevices()).toEqual([]);
      await mac.network.confirmPairing(macPending!.sessionId);
      await vi.waitFor(() =>
        expect(pc.fabric.trustedDevices()).toHaveLength(1),
      );
      await vi.waitFor(() =>
        expect(mac.fabric.trustedDevices()).toHaveLength(1),
      );
      expect(pc.network.status().peers[0].status).toBe("trusted-online");
      const certificate = pc.fabric.hostIdentity()!.fingerprintSha256;
      await pc.network.stop();
      const restarted = new DeviceNetworkRuntime(pc.fabric, () => ({
        capabilities: ["presence", "pairing"],
        runningJobs: 0,
        attentionItems: 0,
      }));
      await restarted.start({ bindAddress: "127.0.0.1", discovery: false });
      expect(pc.fabric.hostIdentity()!.fingerprintSha256).toBe(certificate);
      restarted.observeAdvertisement(mac.network.advertisement());
      await vi.waitFor(() =>
        expect(restarted.status().peers[0].status).toBe("trusted-online"),
      );
      restarted.unlink(mac.fabric.status().localDeviceId);
      expect(pc.fabric.trustedDevices()).toEqual([]);
      await restarted.stop();
    } finally {
      await Promise.allSettled([pc.network.stop(), mac.network.stop()]);
    }
  });

  it("does not commit the second confirmer while the first device is offline", async () => {
    const pc = await runtime("Interrupted PC"),
      mac = await runtime("Interrupted Mac");
    let restartedPc: DeviceNetworkRuntime | undefined;
    try {
      pc.network.observeAdvertisement(mac.network.advertisement());
      mac.network.observeAdvertisement(pc.network.advertisement());
      await pc.network.requestPairing(
        mac.network.advertisement().device.fingerprintSha256,
      );
      const pcPairing = pc.network.status().peers[0].pairing!,
        macPairing = mac.network.status().peers[0].pairing!;
      await pc.network.confirmPairing(pcPairing.sessionId);
      await pc.network.stop();
      await expect(
        mac.network.confirmPairing(macPairing.sessionId),
      ).rejects.toThrow();
      expect(pc.fabric.trustedDevices()).toEqual([]);
      expect(mac.fabric.trustedDevices()).toEqual([]);

      restartedPc = new DeviceNetworkRuntime(pc.fabric, () => ({
        capabilities: ["presence", "pairing"],
        runningJobs: 0,
        attentionItems: 0,
      }));
      await restartedPc.start({ bindAddress: "127.0.0.1", discovery: false });
      restartedPc.observeAdvertisement(mac.network.advertisement());
      mac.network.observeAdvertisement(restartedPc.advertisement());
      await vi.waitFor(() => {
        expect(pc.fabric.trustedDevices()).toHaveLength(1);
        expect(mac.fabric.trustedDevices()).toHaveLength(1);
      });
    } finally {
      await Promise.allSettled([
        pc.network.stop(),
        mac.network.stop(),
        restartedPc?.stop(),
      ]);
    }
  });

  it("keeps response-loss completion pending until reciprocal presence proves both receipts", async () => {
    const pc = await runtime("Response PC"),
      mac = await runtime("Response Mac"),
      receiver = pc.network as unknown as {
        receivePairConfirm(input: unknown): unknown;
      },
      original = receiver.receivePairConfirm.bind(pc.network);
    try {
      pc.network.observeAdvertisement(mac.network.advertisement());
      mac.network.observeAdvertisement(pc.network.advertisement());
      await pc.network.requestPairing(
        mac.network.advertisement().device.fingerprintSha256,
      );
      await pc.network.confirmPairing(
        pc.network.status().peers[0].pairing!.sessionId,
      );
      receiver.receivePairConfirm = (input) => {
        original(input);
        throw new Error("simulated final response loss");
      };
      await expect(
        mac.network.confirmPairing(
          mac.network.status().peers[0].pairing!.sessionId,
        ),
      ).rejects.toThrow(/simulated final response loss/);
      expect(pc.fabric.trustedDevices()).toEqual([]);
      expect(mac.fabric.trustedDevices()).toEqual([]);
      expect(
        pc.fabric.trustedDevices(false, true)[0]?.reciprocalState,
      ).toBe("pending");

      receiver.receivePairConfirm = original;
      pc.network.observeAdvertisement(mac.network.advertisement());
      mac.network.observeAdvertisement(pc.network.advertisement());
      await vi.waitFor(() =>
        expect(pc.fabric.trustedDevices()).toHaveLength(1),
      );
      await vi.waitFor(() =>
        expect(mac.fabric.trustedDevices()).toHaveLength(1),
      );
    } finally {
      receiver.receivePairConfirm = original;
      await Promise.allSettled([pc.network.stop(), mac.network.stop()]);
    }
  });

  it("propagates authenticated revocation to the other trusted device", async () => {
    const revoked = vi.fn(),
      pc = await runtime("Revoking PC"),
      mac = await runtime("Revoked Mac", (fabric) => ({
        revoked,
        catalog: () => ({
          version: 1,
          deviceId: fabric.status().localDeviceId,
          generatedAt: new Date().toISOString(),
          workspaces: [],
        }),
        search: (query) => ({
          version: 1,
          deviceId: fabric.status().localDeviceId,
          query,
          generatedAt: new Date().toISOString(),
          partial: false,
          results: [],
        }),
      }));
    try {
      pc.network.observeAdvertisement(mac.network.advertisement());
      mac.network.observeAdvertisement(pc.network.advertisement());
      await pc.network.requestPairing(
        mac.network.advertisement().device.fingerprintSha256,
      );
      await pc.network.confirmPairing(
        pc.network.status().peers[0].pairing!.sessionId,
      );
      await mac.network.confirmPairing(
        mac.network.status().peers[0].pairing!.sessionId,
      );
      pc.network.unlink(mac.fabric.status().localDeviceId);
      mac.network.observeAdvertisement(pc.network.advertisement());
      await vi.waitFor(() => {
        expect(mac.fabric.trustedDevices()).toEqual([]);
        expect(revoked).toHaveBeenCalledWith(
          pc.fabric.status().localDeviceId,
        );
        expect(mac.network.status().peers[0]).toMatchObject({
          status: "unlinked",
          trusted: false,
        });
      });
    } finally {
      await Promise.allSettled([pc.network.stop(), mac.network.stop()]);
    }
  });

  it("reports independent pause state honestly while pairing stays available", async () => {
    const pc = await runtime("Paused PC"),
      mac = await runtime("Other Mac");
    try {
      pc.network.observeAdvertisement(mac.network.advertisement());
      pc.network.setPauseState({ pauseWork: true, pauseSync: false });
      await pc.network.requestPairing(
        mac.network.advertisement().device.fingerprintSha256,
      );
      expect(pc.network.status().host).toMatchObject({
        running: true,
        paused: true,
        pauseWork: true,
        pauseSync: false,
      });
    } finally {
      await Promise.allSettled([pc.network.stop(), mac.network.stop()]);
    }
  });

  it("resolves simultaneous pairing requests to one matching ceremony", async () => {
    const pc = await runtime("Simultaneous PC"),
      mac = await runtime("Simultaneous Mac");
    try {
      pc.network.observeAdvertisement(mac.network.advertisement());
      mac.network.observeAdvertisement(pc.network.advertisement());
      await Promise.allSettled([
        pc.network.requestPairing(
          mac.network.advertisement().device.fingerprintSha256,
        ),
        mac.network.requestPairing(
          pc.network.advertisement().device.fingerprintSha256,
        ),
      ]);
      const pcPairing = pc.network.status().peers[0].pairing,
        macPairing = mac.network.status().peers[0].pairing;
      expect(pcPairing?.sessionId).toBe(macPairing?.sessionId);
      expect(pcPairing?.code).toMatch(/^\d{6}$/);
      expect(pcPairing?.code).toBe(macPairing?.code);
    } finally {
      await Promise.allSettled([pc.network.stop(), mac.network.stop()]);
    }
  });

  it("persists an interrupted reciprocal ceremony across both restarts", async () => {
    const pc = await runtime("Persistent PC"),
      mac = await runtime("Persistent Mac");
    let restartedPc: DeviceNetworkRuntime | undefined,
      restartedMac: DeviceNetworkRuntime | undefined;
    try {
      pc.network.observeAdvertisement(mac.network.advertisement());
      mac.network.observeAdvertisement(pc.network.advertisement());
      await pc.network.requestPairing(
        mac.network.advertisement().device.fingerprintSha256,
      );
      await pc.network.confirmPairing(
        pc.network.status().peers[0].pairing!.sessionId,
      );
      expect(pc.fabric.trustedDevices()).toEqual([]);
      expect(mac.fabric.trustedDevices()).toEqual([]);
      await Promise.all([pc.network.stop(), mac.network.stop()]);
      restartedPc = new DeviceNetworkRuntime(pc.fabric, () => ({
        capabilities: ["presence", "pairing"],
        runningJobs: 0,
        attentionItems: 0,
      }));
      restartedMac = new DeviceNetworkRuntime(mac.fabric, () => ({
        capabilities: ["presence", "pairing"],
        runningJobs: 0,
        attentionItems: 0,
      }));
      await restartedPc.start({ bindAddress: "127.0.0.1", discovery: false });
      await restartedMac.start({
        bindAddress: "127.0.0.1",
        discovery: false,
      });
      restartedPc.observeAdvertisement(restartedMac.advertisement());
      restartedMac.observeAdvertisement(restartedPc.advertisement());
      const macPairing = restartedMac.status().peers[0].pairing;
      expect(macPairing?.code).toBe(
        restartedPc.status().peers[0].pairing?.code,
      );
      await restartedMac.confirmPairing(macPairing!.sessionId);
      await vi.waitFor(() =>
        expect(pc.fabric.trustedDevices()).toHaveLength(1),
      );
      await vi.waitFor(() =>
        expect(mac.fabric.trustedDevices()).toHaveLength(1),
      );
    } finally {
      await Promise.allSettled([
        pc.network.stop(),
        mac.network.stop(),
        restartedPc?.stop(),
        restartedMac?.stop(),
      ]);
    }
  });

  it("fails closed on the first post-restart advert for a trusted ID with different keys", async () => {
    const pc = await runtime("Trusted PC"),
      mac = await runtime("Trusted Mac"),
      attacker = await runtime("Attacker");
    let restarted: DeviceNetworkRuntime | undefined;
    try {
      pc.fabric.trustDevice({
        device: mac.fabric.localIdentity(),
        metadata: mac.fabric.status().metadata,
        certificateFingerprintSha256:
          mac.fabric.hostIdentity()!.fingerprintSha256,
      });
      await pc.network.stop();
      restarted = new DeviceNetworkRuntime(pc.fabric, () => ({
        capabilities: ["presence", "pairing"],
        runningJobs: 0,
        attentionItems: 0,
      }));
      await restarted.start({ bindAddress: "127.0.0.1", discovery: false });
      const forged = attacker.network.advertisement();
      forged.device = {
        ...forged.device,
        fingerprintSha256: mac.fabric.hostIdentity()!.fingerprintSha256,
      };
      forged.signature = attacker.fabric.sign(advertisementPayload(forged));
      restarted.observeAdvertisement(forged);
      expect(restarted.status().peers[0]).toMatchObject({
        displayName: "Trusted Mac",
        status: "identity-conflict",
        trusted: true,
        online: false,
        endpoint: undefined,
        capabilities: [],
      });
    } finally {
      await Promise.allSettled([
        pc.network.stop(),
        mac.network.stop(),
        attacker.network.stop(),
        restarted?.stop(),
      ]);
    }
  });
});
