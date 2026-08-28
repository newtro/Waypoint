import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "../store.js";
import { syncDirectoryDurably, syncFileDurably } from "../durable-fs.js";
import { WaypointCrypto } from "../sync/crypto.js";
import {
  ProtectedSyncVault,
  type SecretProtector,
} from "../sync/protected-sync-vault.js";
import {
  DeviceFabricService,
  deviceOperationRequestDigest,
} from "./device-fabric-service.js";
import {
  ProtectedDeviceVault,
  type DeviceVaultFileSystem,
} from "./protected-device-vault.js";

const protector: SecretProtector = {
  available: () => true,
  encrypt: (value) => Buffer.from(value).map((byte) => byte ^ 0x6d),
  decrypt: (value) =>
    Buffer.from(Buffer.from(value).map((byte) => byte ^ 0x6d)).toString("utf8"),
};
const metadata = {
  displayName: "Scott's PC",
  platform: "win32" as const,
  architecture: "x64",
  appVersion: "0.0.0",
};

describe("device fabric identity and trust", () => {
  it("requires OS protection and persists one stable installation identity without plaintext keys", async () => {
    expect(
      () =>
        new ProtectedDeviceVault("/unused", {
          ...protector,
          available: () => false,
        }),
    ).toThrow(/unavailable/);
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-device-fabric-"));
    const vault = new ProtectedDeviceVault(root, protector);
    const first = await DeviceFabricService.create(vault, metadata, [
      "legacy_workspace_device_01",
    ]);
    const status = first.status();
    const protectedBytes = readFileSync(path.join(root, readdirSync(root)[0]));
    expect(protectedBytes.includes(Buffer.from(status.localDeviceId))).toBe(
      false,
    );
    expect(protectedBytes.includes(Buffer.from("signingPrivateKey"))).toBe(
      false,
    );
    const reopened = await DeviceFabricService.create(vault, {
      ...metadata,
      displayName: "Renamed PC",
    });
    expect(reopened.status()).toMatchObject({
      localDeviceId: status.localDeviceId,
      fingerprintSha256: status.fingerprintSha256,
      metadata: { displayName: "Renamed PC" },
      legacyWorkspaceIdentityCount: 1,
    });
    expect(
      readdirSync(root).filter((name) =>
        /^device-fabric\.[ab]\.protected$/.test(name),
      ),
    ).toHaveLength(2);
  });

  it("creates full-fleet trust idempotently, rejects identity collisions, and revokes grants", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-device-trust-"));
    const vault = new ProtectedDeviceVault(root, protector);
    const service = await DeviceFabricService.create(vault, metadata);
    const crypto = await WaypointCrypto.create();
    const peer = crypto.generateDevice("trusted_peer_device_01");
    const identity = {
      deviceId: peer.deviceId,
      signingPublicKey: peer.signingPublicKey,
      encryptionPublicKey: peer.encryptionPublicKey,
    };
    const trusted = service.trustDevice({
      device: identity,
      metadata: {
        displayName: "Mac Studio",
        platform: "darwin",
        architecture: "arm64",
        appVersion: "0.0.0",
      },
      defaultMode: "autonomous",
      certificateFingerprintSha256: "a".repeat(64),
      pairedAt: new Date("2026-08-21T12:00:00.000Z"),
    });
    expect(trusted).toMatchObject({
      defaultMode: "autonomous",
      workspaceGrantPolicy: "all_current_and_future",
    });
    expect(
      service.grantsWorkspace(peer.deviceId, "workspace_device_grant_01"),
    ).toBe(false);
    expect(
      service.trustDevice({
        device: identity,
        metadata: trusted.metadata,
      }).pairedAt,
    ).toBe("2026-08-21T12:00:00.000Z");
    const collision = crypto.generateDevice(peer.deviceId);
    expect(() =>
      service.trustDevice({
        device: collision,
        metadata: trusted.metadata,
      }),
    ).toThrow(/collision/);
    service.revokeDevice(peer.deviceId, new Date("2026-08-21T13:00:00.000Z"));
    expect(
      service.grantsWorkspace(peer.deviceId, "workspace_device_grant_01"),
    ).toBe(false);
    expect(service.trustedDevices()).toEqual([]);
    expect(service.trustedDevices(true)[0].revokedAt).toBe(
      "2026-08-21T13:00:00.000Z",
    );
    expect(() =>
      service.trustDevice({ device: identity, metadata: trusted.metadata }),
    ).toThrow(/new explicit pairing ceremony/);
    const newest = readdirSync(root)
      .filter((name) => /^device-fabric\.[ab]\.protected$/.test(name))
      .map((name) => ({
        name,
        generation: Number(
          JSON.parse(protector.decrypt(readFileSync(path.join(root, name))))
            .generation,
        ),
      }))
      .sort((left, right) => right.generation - left.generation)[0];
    rmSync(path.join(root, newest.name));
    const recovered = await DeviceFabricService.create(
      new ProtectedDeviceVault(root, protector),
      metadata,
    );
    expect(recovered.trustedDevices()).toEqual([]);
    expect(
      recovered.grantsWorkspace(peer.deviceId, "workspace_device_grant_01"),
    ).toBe(false);
  });

  it("requires fresh mutual authorization even when reciprocal trust activation diverges", async () => {
    const now = new Date("2026-08-21T12:00:00.000Z"),
      workspaceId = "workspace_device_grant_01",
      scope = `workspace:${workspaceId}:grant`,
      requestBytes = JSON.stringify({
        version: 1,
        workspaceId,
        operation: "grant",
      }),
      firstRoot = mkdtempSync(path.join(tmpdir(), "waypoint-mutual-first-")),
      first = await DeviceFabricService.create(
        new ProtectedDeviceVault(firstRoot, protector),
        metadata,
      ),
      second = await DeviceFabricService.create(
        new ProtectedDeviceVault(
          mkdtempSync(path.join(tmpdir(), "waypoint-mutual-second-")),
          protector,
        ),
        { ...metadata, displayName: "Scott's Mac", platform: "darwin" },
      );
    first.trustDevice({
      device: second.localIdentity(),
      metadata: { ...metadata, displayName: "Scott's Mac", platform: "darwin" },
      reciprocalState: "active",
    });
    second.trustDevice({
      device: first.localIdentity(),
      metadata,
      reciprocalState: "pending",
    });

    expect(first.trustedDevices()).toHaveLength(1);
    expect(second.trustedDevices()).toEqual([]);
    expect(first.grantsWorkspace(second.localIdentity().deviceId, workspaceId)).toBe(
      false,
    );
    expect(second.grantsWorkspace(first.localIdentity().deviceId, workspaceId)).toBe(
      false,
    );

    const proposal = second.createOperationAuthorization(
        first.localIdentity().deviceId,
        scope,
        requestBytes,
        now,
      ),
      authorization = first.countersignOperationAuthorization(proposal, now);
    expect(authorization.requestDigestSha256).toBe(
      deviceOperationRequestDigest(requestBytes),
    );
    expect(
      first.grantsWorkspace(
        second.localIdentity().deviceId,
        workspaceId,
        authorization,
        requestBytes,
        now,
      ),
    ).toBe(true);
    expect(
      second.grantsWorkspace(
        first.localIdentity().deviceId,
        workspaceId,
        authorization,
        requestBytes,
        now,
      ),
    ).toBe(false);
    expect(
      first.grantsWorkspace(
        second.localIdentity().deviceId,
        workspaceId,
        authorization,
        requestBytes,
        now,
      ),
    ).toBe(false);
    const restartedFirst = await DeviceFabricService.create(
      new ProtectedDeviceVault(firstRoot, protector),
      metadata,
    );
    expect(
      restartedFirst.grantsWorkspace(
        second.localIdentity().deviceId,
        workspaceId,
        authorization,
        requestBytes,
        now,
      ),
    ).toBe(false);
    expect(
      first.verifyOperationAuthorization(
        authorization,
        second.localIdentity().deviceId,
        "workspace:wrong_workspace_01:grant",
        requestBytes,
        now,
      ),
    ).toBe(false);
    expect(
      first.verifyOperationAuthorization(
        authorization,
        second.localIdentity().deviceId,
        scope,
        JSON.stringify({ version: 1, workspaceId, operation: "different" }),
        now,
      ),
    ).toBe(false);
    expect(
      first.verifyOperationAuthorization(
        { ...authorization, scope: "workspace:tampered_workspace_01:grant" },
        second.localIdentity().deviceId,
        "workspace:tampered_workspace_01:grant",
        requestBytes,
        now,
      ),
    ).toBe(false);
    expect(
      first.verifyOperationAuthorization(
        authorization,
        second.localIdentity().deviceId,
        scope,
        requestBytes,
        new Date("2026-08-21T12:00:31.000Z"),
      ),
    ).toBe(false);
    first.revokeDevice(second.localIdentity().deviceId, now);
    expect(
      first.verifyOperationAuthorization(
        authorization,
        second.localIdentity().deviceId,
        scope,
        requestBytes,
        now,
      ),
    ).toBe(false);
  });

  it("migrates pre-authorization trust records to explicit non-authorizing trust intent", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-trust-migration-")),
      vault = new ProtectedDeviceVault(root, protector),
      service = await DeviceFabricService.create(vault, metadata),
      crypto = await WaypointCrypto.create(),
      peer = crypto.generateDevice("legacy_trusted_peer_01");
    service.trustDevice({
      device: peer,
      metadata,
      certificateFingerprintSha256: "d".repeat(64),
    });
    const newest = readdirSync(root)
        .filter((name) => /^device-fabric\.[ab]\.protected$/.test(name))
        .map((name) => ({
          name,
          envelope: JSON.parse(
            protector.decrypt(readFileSync(path.join(root, name))),
          ) as {
            generation: number;
            state: Record<string, unknown> & {
              trustedDevices: Array<Record<string, unknown>>;
            };
          },
        }))
        .sort(
          (left, right) => right.envelope.generation - left.envelope.generation,
        )[0],
      legacy = newest.envelope;
    delete legacy.state.trustedDevices[0].reciprocalState;
    delete legacy.state.consumedAuthorizations;
    writeFileSync(
      path.join(root, newest.name),
      protector.encrypt(JSON.stringify(legacy)),
    );

    const migrated = await DeviceFabricService.create(
      new ProtectedDeviceVault(root, protector),
      metadata,
    );
    expect(migrated.trustedDevices(false, true)[0].reciprocalState).toBe(
      "active",
    );
    expect(
      migrated.grantsWorkspace(peer.deviceId, "legacy_workspace_grant_01"),
    ).toBe(false);
  });

  it("signs device-scoped payloads and fails closed for corrupt protected state", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-device-sign-"));
    const vault = new ProtectedDeviceVault(root, protector);
    const service = await DeviceFabricService.create(vault, metadata);
    const payload = JSON.stringify({ version: 1, nonce: "pairing_nonce_001" });
    const signature = service.sign(payload);
    expect(service.verify(payload, signature, service.localIdentity())).toBe(
      true,
    );
    expect(
      service.verify(`${payload}x`, signature, service.localIdentity()),
    ).toBe(false);
    for (const slot of [
      "device-fabric.a.protected",
      "device-fabric.b.protected",
    ])
      writeFileSync(path.join(root, slot), Buffer.from("bad"));
    expect(() => vault.load()).toThrow(/cannot be opened/);
  });

  it("does not publish an in-memory trust mutation when protected persistence fails", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-device-atomic-"));
    const vault = new ProtectedDeviceVault(root, protector);
    const service = await DeviceFabricService.create(vault, metadata);
    const crypto = await WaypointCrypto.create();
    const peer = crypto.generateDevice("trusted_peer_device_02");
    const identity = {
      deviceId: peer.deviceId,
      signingPublicKey: peer.signingPublicKey,
      encryptionPublicKey: peer.encryptionPublicKey,
    };
    const invalidCertificate = "not-a-sha256-fingerprint";
    expect(() =>
      service.trustDevice({
        device: identity,
        metadata: {
          displayName: "MacBook Pro",
          platform: "darwin",
          architecture: "arm64",
          appVersion: "0.0.0",
        },
        certificateFingerprintSha256: invalidCertificate,
      }),
    ).toThrow(/Invalid protected device fabric state/);
    expect(service.trustedDevices()).toEqual([]);
  });

  it("adopts legacy workspace identities without changing workspace content or sync authority", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-device-migrate-"));
    const database = path.join(root, "waypoint.sqlite");
    const store = new WorkspaceStore(database);
    const workspace = store.createWorkspace(
      "Existing workspace",
      path.join(root, "workspace"),
    );
    store.createDocument(
      workspace.id,
      "Existing document",
      "This content must remain unchanged.",
    );
    const crypto = await WaypointCrypto.create();
    const legacyDevice = crypto.generateDevice("legacy_workspace_device_03");
    store.configureSyncDevice(workspace.id, legacyDevice.deviceId);
    const before = store.exportWorkspace(workspace.id);
    const syncVault = new ProtectedSyncVault(
      path.join(root, "sync-secrets"),
      protector,
    );
    const secrets = {
      version: 1 as const,
      workspaceId: workspace.id,
      device: legacyDevice,
      workspaceKey: crypto.generateWorkspaceKey(),
      keyEpoch: 1,
      endpoint: "https://waypoint-relay.johnnycode.ai",
    };
    syncVault.save(secrets);

    const service = await DeviceFabricService.create(
      new ProtectedDeviceVault(path.join(root, "device-fabric"), protector),
      metadata,
      [legacyDevice.deviceId],
    );

    expect(service.status().legacyWorkspaceIdentityCount).toBe(1);
    const after = store.exportWorkspace(workspace.id);
    expect(after.workspace).toEqual(before.workspace);
    expect(after.objects).toEqual(before.objects);
    expect(syncVault.load(workspace.id)).toEqual(secrets);
    store.close();
    const reopened = new WorkspaceStore(database);
    expect(reopened.listDocuments(workspace.id)).toEqual([
      expect.objectContaining({
        title: "Existing document",
        body: "This content must remain unchanged.",
      }),
    ]);
    reopened.close();
  });

  it("retires stale legacy device state and fails closed if both migrated generations disappear", async () => {
    const sourceRoot = mkdtempSync(
        path.join(tmpdir(), "waypoint-device-legacy-source-"),
      ),
      sourceVault = new ProtectedDeviceVault(sourceRoot, protector),
      source = await DeviceFabricService.create(sourceVault, metadata),
      crypto = await WaypointCrypto.create(),
      peer = crypto.generateDevice("legacy_trusted_peer_01"),
      identity = {
        deviceId: peer.deviceId,
        signingPublicKey: peer.signingPublicKey,
        encryptionPublicKey: peer.encryptionPublicKey,
      };
    source.trustDevice({
      device: identity,
      metadata: {
        displayName: "Legacy Mac",
        platform: "darwin",
        architecture: "arm64",
        appVersion: "0.0.0",
      },
      defaultMode: "autonomous",
    });
    const legacyState = sourceVault.load()!,
      root = mkdtempSync(
        path.join(tmpdir(), "waypoint-device-legacy-migrate-"),
      );
    writeFileSync(
      path.join(root, "device-fabric.protected"),
      Buffer.from(protector.encrypt(JSON.stringify(legacyState))),
    );
    const migratedVault = new ProtectedDeviceVault(root, protector),
      migrated = await DeviceFabricService.create(migratedVault, metadata);
    migrated.setDefaultMode(peer.deviceId, "supervised");
    expect(existsSync(path.join(root, "device-fabric.protected"))).toBe(false);
    for (const slot of [
      "device-fabric.a.protected",
      "device-fabric.b.protected",
    ])
      rmSync(path.join(root, slot), { force: true });
    await expect(
      DeviceFabricService.create(
        new ProtectedDeviceVault(root, protector),
        metadata,
      ),
    ).rejects.toThrow(/generations are missing/);
  });

  it("rejects structurally valid keypair and fingerprint corruption", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-device-semantic-"));
    const vault = new ProtectedDeviceVault(root, protector);
    await DeviceFabricService.create(vault, metadata);
    const state = vault.load()!;
    const crypto = await WaypointCrypto.create();
    state.local.device.signingPublicKey = crypto.generateDevice(
      "semantic_corruption_01",
    ).signingPublicKey;
    vault.save(state);
    vault.save(state);
    await expect(DeviceFabricService.create(vault, metadata)).rejects.toThrow(
      /cannot be opened|keypair integrity mismatch/,
    );
  });

  it("recovers from a newer semantically corrupt generation without overwriting the valid fallback", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-device-fallback-"));
    const vault = new ProtectedDeviceVault(root, protector);
    const original = await DeviceFabricService.create(vault, metadata);
    const state = vault.load()!;
    const crypto = await WaypointCrypto.create();
    state.local.device.encryptionPublicKey = crypto.generateDevice(
      "semantic_corruption_02",
    ).encryptionPublicKey;
    vault.save(state);
    const recovered = await DeviceFabricService.create(vault, metadata);
    expect(recovered.status().localDeviceId).toBe(
      original.status().localDeviceId,
    );
    expect(
      new ProtectedDeviceVault(root, protector).load((candidate) => {
        if (!crypto.validateDeviceKeyPair(candidate.local.device))
          throw new Error("invalid");
      }),
    ).toBeDefined();
  });

  it("preserves the sole semantically valid generation when fallback healing cannot rename", async () => {
    const root = mkdtempSync(
      path.join(tmpdir(), "waypoint-device-heal-fault-"),
    );
    const vault = new ProtectedDeviceVault(root, protector);
    await DeviceFabricService.create(vault, metadata);
    const state = vault.load()!;
    const crypto = await WaypointCrypto.create();
    state.local.device.encryptionPublicKey = crypto.generateDevice(
      "semantic_corruption_03",
    ).encryptionPublicKey;
    vault.save(state);
    let failRename = true;
    const fileSystem: DeviceVaultFileSystem = {
      exists: existsSync,
      read: readFileSync,
      write: (file, bytes) =>
        writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }),
      rename: (source, target) => {
        if (failRename) {
          failRename = false;
          throw new Error("injected healing rename failure");
        }
        renameSync(source, target);
      },
      remove: (file) => rmSync(file, { force: true }),
      syncFile: syncFileDurably,
      syncDirectory: syncDirectoryDurably,
    };
    const recovered = await DeviceFabricService.create(
      new ProtectedDeviceVault(root, protector, fileSystem),
      metadata,
    );
    expect(recovered.status().localDeviceId).toBe(state.local.device.deviceId);
    await expect(
      DeviceFabricService.create(
        new ProtectedDeviceVault(root, protector),
        metadata,
      ),
    ).resolves.toBeDefined();
  });

  it("keeps the last committed generation across every pre-commit filesystem failure", async () => {
    for (const failure of [
      "write",
      "syncFile",
      "remove",
      "rename",
      "syncDirectory",
    ] as const) {
      const root = mkdtempSync(
        path.join(tmpdir(), `waypoint-device-${failure}-`),
      );
      const initialVault = new ProtectedDeviceVault(root, protector);
      await DeviceFabricService.create(initialVault, metadata);
      initialVault.load();
      let armed = true;
      const fail = (stage: typeof failure) => {
        if (armed && stage === failure) {
          armed = false;
          throw new Error(`injected ${stage} failure`);
        }
      };
      const fileSystem: DeviceVaultFileSystem = {
        exists: existsSync,
        read: readFileSync,
        write: (file, bytes) => {
          fail("write");
          writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
        },
        rename: (source, target) => {
          fail("rename");
          renameSync(source, target);
        },
        remove: (file) => {
          fail("remove");
          rmSync(file, { force: true });
        },
        syncFile: (file) => {
          fail("syncFile");
          syncFileDurably(file);
        },
        syncDirectory: (directory) => {
          fail("syncDirectory");
          syncDirectoryDurably(directory);
        },
      };
      const failingVault = new ProtectedDeviceVault(
          root,
          protector,
          fileSystem,
        ),
        changed = initialVault.load()!;
      changed.local.metadata.displayName = `Must not commit ${failure}`;
      expect(() => failingVault.save(changed)).toThrow(`injected ${failure}`);
      expect(
        new ProtectedDeviceVault(root, protector).load()!.local.metadata
          .displayName,
      ).toBe(metadata.displayName);
    }
  });

  it("treats an unrollbackable readable generation as committed", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-device-fault-"));
    const initialVault = new ProtectedDeviceVault(root, protector);
    await DeviceFabricService.create(initialVault, metadata);
    initialVault.load();
    let failDirectorySync = true,
      failRollbackRemove = false;
    const fileSystem: DeviceVaultFileSystem = {
      exists: existsSync,
      read: readFileSync,
      write: (file, bytes) =>
        writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }),
      rename: renameSync,
      remove: (file) => {
        if (failRollbackRemove) {
          failRollbackRemove = false;
          throw new Error("injected rollback remove failure");
        }
        rmSync(file, { force: true });
      },
      syncFile: syncFileDurably,
      syncDirectory: (directory) => {
        if (failDirectorySync) {
          failDirectorySync = false;
          failRollbackRemove = true;
          throw new Error("injected directory sync failure");
        }
        syncDirectoryDurably(directory);
      },
    };
    const service = await DeviceFabricService.create(
      new ProtectedDeviceVault(root, protector, fileSystem),
      metadata,
    );
    const crypto = await WaypointCrypto.create();
    const peer = crypto.generateDevice("trusted_peer_device_04");
    const identity = {
      deviceId: peer.deviceId,
      signingPublicKey: peer.signingPublicKey,
      encryptionPublicKey: peer.encryptionPublicKey,
    };
    service.trustDevice({
      device: identity,
      metadata: {
        displayName: "Mac mini",
        platform: "darwin",
        architecture: "arm64",
        appVersion: "0.0.0",
      },
    });
    expect(service.trustedDevices()).toHaveLength(1);
    const reopened = await DeviceFabricService.create(
      new ProtectedDeviceVault(root, protector),
      metadata,
    );
    expect(reopened.trustedDevices()).toHaveLength(1);
  });
});
