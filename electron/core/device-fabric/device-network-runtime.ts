import { createHash, randomBytes } from "node:crypto";
import {
  createServer as createHttpsServer,
  request as httpsRequest,
  type Server as HttpsServer,
} from "node:https";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type { TLSSocket } from "node:tls";
import type { DeviceIdentity } from "../sync/types.js";
import type { DeviceFabricService } from "./device-fabric-service.js";
import {
  validateFleetEncryptedObject,
  type FleetEncryptedObject,
} from "./fleet-cache-service.js";
import {
  fleetRemoteWorkDigest,
  validateFleetRemoteWorkOrder,
  validateFleetRemoteWorkRecord,
  type FleetRemoteWorkOrder,
  type FleetRemoteWorkRecord,
} from "./fleet-remote-work-service.js";
import {
  createSignedAdvertisement,
  parseSignedAdvertisement,
  verifySignedAdvertisement,
  type SignedDeviceAdvertisement,
} from "./device-network-protocol.js";
import {
  LanDiscoveryService,
  deviceEndpoint,
  privateInterfaceAddresses,
  preferredDeviceAddress,
  preferredDeviceAddressForPeer,
} from "./lan-discovery.js";
import type {
  DeviceMetadata,
  DeviceOperationAuthorization,
  DeviceOperationAuthorizationProposal,
  DevicePairingPeerRecord,
  DevicePairingSessionRecord,
  FleetSearchResponse,
  FleetWorkspaceCatalog,
} from "./types.js";

const ID = /^[A-Za-z0-9_-]{16,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PAIR_TTL_MS = 5 * 60_000;
const PAIR_RECOVERY_MS = 30 * 24 * 60 * 60_000;
const MAX_BODY = 64 * 1024;
const MAX_REMOTE_WORK_BODY = 12 * 1024 * 1024;
const MAX_RESPONSE_BODY = 64 * 1024;
const MAX_PAIRING_SESSIONS = 32;
const PAIR_ADMISSION_WINDOW_MS = 60_000;
const MAX_PAIR_REQUESTS_PER_SOURCE = 12;
const MAX_PAIRING_ADMISSION_SOURCES = 256;

interface OperationalPresence {
  capabilities: string[];
  runningJobs: number;
  attentionItems: number;
}

interface PairRequest {
  version: 1;
  sessionId: string;
  requester: SignedDeviceAdvertisement;
  requesterIdentity: DeviceIdentity;
  requesterMetadata: DeviceMetadata;
  requesterNonce: string;
  expiresAt: string;
  signature: string;
}
interface PairResponse {
  version: 1;
  sessionId: string;
  responder: SignedDeviceAdvertisement;
  responderIdentity: DeviceIdentity;
  responderMetadata: DeviceMetadata;
  requesterNonce: string;
  responderNonce: string;
  expiresAt: string;
  signature: string;
}
interface TrustedPresenceRequest {
  version: 1;
  requesterDeviceId: string;
  nonce: string;
  sentAt: string;
  signature: string;
}
interface TrustedPresenceResponse {
  version: 1;
  deviceId: string;
  nonce: string;
  sentAt: string;
  expiresAt: string;
  requesterRevoked: boolean;
  architecture?: string;
  pauseWork?: boolean;
  pauseSync?: boolean;
  capabilities?: string[];
  runningJobs?: number;
  attentionItems?: number;
  signature: string;
}
interface PairConfirm {
  version: 1;
  sessionId: string;
  confirmerDeviceId: string;
  codeDigest: string;
  expiresAt: string;
  signature: string;
}
interface PairConfirmResponse {
  version: 1;
  sessionId: string;
  deviceId: string;
  status: "pending" | "completed";
  expiresAt: string;
  signature: string;
}

export interface FleetWorkerInventory {
  version: 1;
  deviceId: string;
  platform: string;
  architecture: string;
  paused: boolean;
  totalMemoryMb: number;
  providers: Array<{
    id: "codex" | "claude" | "grok";
    available: boolean;
    version?: string;
    reason?: string;
    modelPolicy: "provider-default";
  }>;
  roots: Array<{
    root: string;
    profileId: string;
    profileName: string;
    filesystem: string;
    network: string;
    tools: string[];
    approval: string;
    maxDurationMs: number;
  }>;
}

export function validateFleetWorkerInventory(
  value: unknown,
  expectedDeviceId?: string,
): FleetWorkerInventory {
  const item = value as FleetWorkerInventory;
  if (
    !item ||
    item.version !== 1 ||
    !ID.test(String(item.deviceId)) ||
    (expectedDeviceId !== undefined && item.deviceId !== expectedDeviceId) ||
    typeof item.platform !== "string" ||
    !item.platform ||
    item.platform.length > 64 ||
    typeof item.architecture !== "string" ||
    !item.architecture ||
    item.architecture.length > 64 ||
    typeof item.paused !== "boolean" ||
    !Number.isSafeInteger(item.totalMemoryMb) ||
    item.totalMemoryMb < 0 ||
    !Array.isArray(item.providers) ||
    item.providers.length > 3 ||
    new Set(item.providers.map((provider) => provider.id)).size !==
      item.providers.length ||
    item.providers.some(
      (provider) =>
        !["codex", "claude", "grok"].includes(provider.id) ||
        typeof provider.available !== "boolean" ||
        provider.modelPolicy !== "provider-default" ||
        (provider.version !== undefined &&
          (typeof provider.version !== "string" ||
            provider.version.length > 200)) ||
        (provider.reason !== undefined &&
          (typeof provider.reason !== "string" ||
            provider.reason.length > 500)),
    ) ||
    !Array.isArray(item.roots) ||
    item.roots.length > 128 ||
    item.roots.some(
      (root) =>
        typeof root.root !== "string" ||
        !path.isAbsolute(root.root) ||
        root.root.length > 1_024 ||
        !ID.test(String(root.profileId)) ||
        typeof root.profileName !== "string" ||
        !root.profileName ||
        root.profileName.length > 200 ||
        typeof root.filesystem !== "string" ||
        root.filesystem.length > 64 ||
        typeof root.network !== "string" ||
        root.network.length > 64 ||
        typeof root.approval !== "string" ||
        root.approval.length > 64 ||
        !Number.isSafeInteger(root.maxDurationMs) ||
        root.maxDurationMs < 0 ||
        !Array.isArray(root.tools) ||
        root.tools.length > 64 ||
        root.tools.some(
          (tool) => typeof tool !== "string" || tool.length > 200,
        ),
    )
  )
    throw new Error("Remote worker inventory is invalid");
  return structuredClone(item);
}

export interface DeviceNetworkOperations {
  catalog(): FleetWorkspaceCatalog;
  catalogReceived?(catalog: FleetWorkspaceCatalog): Promise<void> | void;
  search(query: string, limit: number): FleetSearchResponse;
  workspaceGrant?(
    workspaceId: string,
    requesterDeviceId: string,
  ): FleetWorkspaceGrantEnvelope;
  encryptedObject?(input: {
    workspaceId: string;
    objectId: string;
    objectKind: string;
    requesterDeviceId: string;
  }): FleetEncryptedObject;
  workspaceInventory?(
    workspaceId: string,
    requesterDeviceId: string,
  ): FleetWorkspaceInventory;
  revoked?(sourceDeviceId: string): void;
  workerInventory?(
    requesterDeviceId: string,
  ): FleetWorkerInventory | Promise<FleetWorkerInventory>;
  submitRemoteWork?(
    order: FleetRemoteWorkOrder,
    requesterDeviceId: string,
  ): FleetRemoteWorkRecord | Promise<FleetRemoteWorkRecord>;
  remoteWorkStatus?(
    jobId: string,
    requesterDeviceId: string,
  ): FleetRemoteWorkRecord | Promise<FleetRemoteWorkRecord>;
  cancelRemoteWork?(
    jobId: string,
    requesterDeviceId: string,
  ): FleetRemoteWorkRecord | Promise<FleetRemoteWorkRecord>;
  discardRemoteWork?(
    jobId: string,
    requesterDeviceId: string,
  ): FleetRemoteWorkRecord | Promise<FleetRemoteWorkRecord>;
}

export interface FleetWorkspaceGrantEnvelope {
  version: 1;
  sourceDeviceId: string;
  recipientDeviceId: string;
  workspaceId: string;
  keyEpoch: number;
  wrappedWorkspaceKey: string;
  grantedAt: string;
}

export interface FleetWorkspaceInventory {
  version: 1;
  sourceDeviceId: string;
  workspaceId: string;
  generatedAt: string;
  attachmentLimitBytes: number;
  omittedAttachments: number;
  objects: Array<{ objectId: string; objectKind: string }>;
}

type PairingSession = DevicePairingSessionRecord;

export interface DeviceNetworkPeerView {
  deviceId: string;
  displayName: string;
  platform: string;
  architecture: string;
  appVersion: string;
  fingerprintSha256: string;
  status:
    | "unlinked"
    | "link-requested"
    | "trusted-online"
    | "trusted-offline"
    | "working"
    | "needs-attention"
    | "paused"
    | "identity-conflict";
  trusted: boolean;
  online: boolean;
  lastSeenAt?: string;
  endpoint?: string;
  capabilities: string[];
  pauseWork: boolean;
  pauseSync: boolean;
  runningJobs: number;
  attentionItems: number;
  defaultMode?: "supervised" | "autonomous";
  catalogWorkspaceCount?: number;
  catalogUpdatedAt?: string;
  pairing?: {
    sessionId: string;
    direction: "incoming" | "outgoing";
    code: string;
    expiresAt: string;
    localConfirmed: boolean;
    remoteConfirmed: boolean;
  };
}

export interface DeviceNetworkStatus {
  version: 1;
  host: {
    running: boolean;
    endpoint?: string;
    paused: boolean;
    pauseWork: boolean;
    pauseSync: boolean;
    reason: string;
  };
  local: ReturnType<DeviceFabricService["status"]>;
  peers: DeviceNetworkPeerView[];
}

export class PairingAdmissionGate {
  private readonly sources = new Map<
    string,
    { windowStartedAt: number; count: number }
  >();

  admitRequest(source: string, now = Date.now()): void {
    const key = normalizedRemoteAddress(source),
      prior = this.sources.get(key);
    if (!prior || now - prior.windowStartedAt >= PAIR_ADMISSION_WINDOW_MS) {
      if (!prior && this.sources.size >= MAX_PAIRING_ADMISSION_SOURCES) {
        const oldest = [...this.sources.entries()].sort(
          (left, right) =>
            left[1].windowStartedAt - right[1].windowStartedAt,
        )[0]?.[0];
        if (oldest) this.sources.delete(oldest);
      }
      this.sources.set(key, { windowStartedAt: now, count: 1 });
      return;
    }
    if (prior.count >= MAX_PAIR_REQUESTS_PER_SOURCE)
      throw new Error("Pairing requests are temporarily rate limited");
    prior.count += 1;
  }

  admitCapacity(activeSessions: number, replacesExisting: boolean): void {
    if (!replacesExisting && activeSessions >= MAX_PAIRING_SESSIONS)
      throw new Error("Pairing request capacity reached");
  }
}

export class DeviceNetworkRuntime {
  private readonly discovery: LanDiscoveryService;
  private readonly sessions = new Map<string, PairingSession>();
  private server?: HttpsServer;
  private servers: HttpsServer[] = [];
  private readonly listenerByAddress = new Map<string, HttpsServer>();
  private listeningAddresses: string[] = [];
  private hostTls?: { key: string; certificate: string };
  private listenerRefreshTimer?: NodeJS.Timeout;
  private hostPort?: number;
  private fixedAddress?: string;
  private certificateFingerprintSha256?: string;
  private pauseWork = false;
  private pauseSync = false;
  private transition: Promise<void> = Promise.resolve();
  private recoveryQueued = false;
  private readonly remotePresence = new Map<
    string,
    TrustedPresenceResponse
  >();
  private readonly presenceFetchAt = new Map<string, number>();
  private readonly remoteCatalogs = new Map<string, FleetWorkspaceCatalog>();
  private readonly pairingAdmission = new PairingAdmissionGate();

  constructor(
    private readonly fabric: DeviceFabricService,
    private readonly presence: () => OperationalPresence,
    private readonly changed: () => void = () => undefined,
    private readonly interfaceAddresses: () => string[] =
      privateInterfaceAddresses,
    private readonly operations?: DeviceNetworkOperations,
  ) {
    for (const session of fabric.pairingSessions())
      this.sessions.set(session.sessionId, session);
    this.discovery = new LanDiscoveryService(fabric, () => {
        this.scheduleRecovery();
        changed();
      });
  }

  async start(
    options: {
      bindAddress?: string;
      port?: number;
      discovery?: boolean;
    } = {},
  ): Promise<DeviceNetworkStatus> {
    return this.serialize(async () => {
      if (this.server) return this.status();
      if (
        options.bindAddress &&
        !validHostBindAddress(options.bindAddress)
      )
        throw new Error("Device Host bind address must be private or loopback");
      const identity = await this.fabric.ensureHostIdentity(),
        addresses = options.bindAddress
          ? [options.bindAddress]
          : this.interfaceAddresses(),
        listenAddresses = addresses.length ? addresses : ["127.0.0.1"],
        servers: HttpsServer[] = [];
      let port = options.port ?? 0;
      try {
        for (const address of listenAddresses) {
          const server = this.createHostServer(
            identity.privateKeyPem,
            identity.certificatePem,
          );
          servers.push(server);
          port = await listen(server, address, port);
        }
      } catch (error) {
        await Promise.allSettled(servers.map((server) => close(server)));
        throw error;
      }
      this.server = servers[0];
      this.servers = servers;
      this.listeningAddresses = listenAddresses;
      this.listenerByAddress.clear();
      for (let index = 0; index < listenAddresses.length; index += 1)
        this.listenerByAddress.set(listenAddresses[index], servers[index]);
      this.hostTls = {
        key: identity.privateKeyPem,
        certificate: identity.certificatePem,
      };
      this.hostPort = port;
      this.fixedAddress = options.bindAddress;
      this.certificateFingerprintSha256 = identity.fingerprintSha256;
      if (!options.bindAddress) {
        this.listenerRefreshTimer = setInterval(() => {
          void this.serialize(() => this.reconcileListeners()).catch(
            () => undefined,
          );
        }, 10_000);
        this.listenerRefreshTimer.unref();
      }
      try {
        if (options.discovery !== false)
          await this.discovery.start(
            options.bindAddress ? this.endpoint()! : port,
            identity.fingerprintSha256,
            listenAddresses,
          );
      } catch (error) {
        this.server = undefined;
        this.servers = [];
        this.listeningAddresses = [];
        this.listenerByAddress.clear();
        this.hostTls = undefined;
        if (this.listenerRefreshTimer)
          clearInterval(this.listenerRefreshTimer);
        this.listenerRefreshTimer = undefined;
        this.hostPort = undefined;
        this.fixedAddress = undefined;
        this.certificateFingerprintSha256 = undefined;
        await Promise.allSettled([
          this.discovery.stop(),
          ...servers.map((server) => close(server)),
        ]);
        throw error;
      }
      this.scheduleRecovery();
      this.changed();
      return this.status();
    });
  }

  async stop(): Promise<void> {
    return this.serialize(async () => {
      await this.discovery.stop();
      if (this.listenerRefreshTimer)
        clearInterval(this.listenerRefreshTimer);
      this.listenerRefreshTimer = undefined;
      const servers = this.servers;
      this.server = undefined;
      this.servers = [];
      this.listeningAddresses = [];
      this.listenerByAddress.clear();
      this.hostTls = undefined;
      this.hostPort = undefined;
      this.fixedAddress = undefined;
      this.certificateFingerprintSha256 = undefined;
      await Promise.all(servers.map((server) => close(server)));
      this.changed();
    });
  }

  setPauseState(input: {
    pauseWork: boolean;
    pauseSync: boolean;
  }): DeviceNetworkStatus {
    this.pauseWork = input.pauseWork;
    this.pauseSync = input.pauseSync;
    this.discovery.announce();
    this.changed();
    return this.status();
  }

  observeAdvertisement(input: unknown, now = new Date()): void {
    this.discovery.observe(input, now);
  }

  advertisement(now = new Date()): SignedDeviceAdvertisement {
    const endpoint = this.endpoint();
    if (!endpoint || !this.certificateFingerprintSha256)
      throw new Error("Device Host is not running");
    return this.signedAdvertisement(endpoint, now);
  }

  private signedAdvertisement(
    endpoint: string,
    now = new Date(),
  ): SignedDeviceAdvertisement {
    if (!this.certificateFingerprintSha256)
      throw new Error("Device Host is not running");
    return createSignedAdvertisement(this.fabric, {
      endpoint,
      fingerprintSha256: this.certificateFingerprintSha256,
      now,
    });
  }

  private advertisementForPeer(
    peerEndpoint: string,
    now = new Date(),
  ): SignedDeviceAdvertisement {
    if (!this.hostPort) throw new Error("Device Host is not running");
    const preferred = preferredDeviceAddressForPeer(peerEndpoint),
      address =
        this.fixedAddress ??
        (this.listeningAddresses.includes(preferred)
          ? preferred
          : this.listeningAddresses[0] ?? preferredDeviceAddress());
    return this.signedAdvertisement(
      deviceEndpoint(address, this.hostPort),
      now,
    );
  }

  async requestPairing(deviceId: string): Promise<DeviceNetworkStatus> {
    return this.serialize(async () => {
      this.requireRunning();
      const discovered = this.discovery
        .snapshot()
        .find(
          (item) =>
            item.advertisement.device.fingerprintSha256 === deviceId,
        );
      if (!discovered || discovered.identityConflict)
        throw new Error("Pairable device is not currently available");
      const existing = this.activeSession(deviceId);
      if (existing) return this.status();
      const peer = pairingPeer(discovered.advertisement, {
        ...discovered.advertisement.metadata,
        architecture: "unknown",
      }),
        session: PairingSession = {
          sessionId: randomBytes(24).toString("base64url"),
          direction: "outgoing",
          peer,
          requesterNonce: randomBytes(24).toString("base64url"),
          expiresAt: new Date(Date.now() + PAIR_TTL_MS).toISOString(),
          localConfirmed: false,
          remoteConfirmed: false,
          completed: false,
        };
      this.sessions.set(session.sessionId, session);
      this.persistSessions();
      try {
        await this.sendPairRequest(session);
      } catch (error) {
        const canonical = this.activeSession(deviceId);
        if (canonical && canonical.sessionId !== session.sessionId)
          return this.status();
        this.sessions.delete(session.sessionId);
        this.persistSessions();
        throw error;
      }
      this.changed();
      return this.status();
    });
  }

  async confirmPairing(sessionId: string): Promise<DeviceNetworkStatus> {
    return this.serialize(async () => {
      this.requireRunning();
      const session = this.requiredSession(sessionId);
      if (!session.code || !session.responderNonce || !session.peer.device)
        throw new Error("Pairing session is still negotiating");
      session.localConfirmed = true;
      session.recoveryUntil ??= new Date(
        Date.now() + PAIR_RECOVERY_MS,
      ).toISOString();
      this.persistSessions();
      await this.sendConfirmation(session);
      this.changed();
      return this.status();
    });
  }

  async authorizeOperation(
    deviceId: string,
    scope: string,
    requestBytes: string | Uint8Array,
  ): Promise<DeviceOperationAuthorization> {
    this.requireRunning();
    const record = this.fabric
        .trustedDevices(false, true)
        .find((peer) => peer.device.deviceId === deviceId),
      certificateFingerprint = record?.certificateFingerprintSha256;
    if (!record || !certificateFingerprint)
      throw new Error("Trusted device authorization endpoint is unavailable");
    const discovered = this.discovery.snapshot().find(
      (item) =>
        !item.identityConflict &&
        item.advertisement.device.fingerprintSha256 === certificateFingerprint,
    );
    if (!discovered)
      throw new Error("Trusted device is not currently available");
    const proposal = this.fabric.createOperationAuthorization(
        deviceId,
        scope,
        requestBytes,
      ),
      authorization =
        await requestPinnedJson<DeviceOperationAuthorization>(
          new URL("v1/authorize", discovered.advertisement.endpoint).toString(),
          certificateFingerprint,
          proposal,
        );
    if (
      !this.fabric.verifyOperationAuthorization(
        authorization,
        deviceId,
        scope,
        requestBytes,
      )
    )
      throw new Error("Device operation authorization is invalid");
    return authorization;
  }

  catalog(deviceId?: string): FleetWorkspaceCatalog[] {
    const catalogs = deviceId
      ? [this.remoteCatalogs.get(deviceId)].filter(
          (value): value is FleetWorkspaceCatalog => Boolean(value),
        )
      : [...this.remoteCatalogs.values()];
    return catalogs.map((catalog) => ({
      ...catalog,
      workspaces: catalog.workspaces.map((workspace) => ({
        ...workspace,
        counts: { ...workspace.counts },
      })),
    }));
  }

  async refreshCatalog(deviceId: string): Promise<FleetWorkspaceCatalog> {
    const requestBody = JSON.stringify({
        version: 1,
        requesterDeviceId: this.fabric.status().localDeviceId,
      }),
      scope = "catalog:read",
      authorization = await this.authorizeOperation(
        deviceId,
        scope,
        requestBody,
      ),
      endpoint = this.trustedEndpoint(deviceId),
      catalog = validateFleetCatalog(
        await requestPinnedJson<FleetWorkspaceCatalog>(
          new URL("v1/catalog", endpoint.endpoint).toString(),
          endpoint.certificateFingerprint,
          requestBody,
          authorizationHeader(authorization),
          1024 * 1024,
        ),
        deviceId,
      );
    this.remoteCatalogs.set(deviceId, catalog);
    await this.operations?.catalogReceived?.(catalog);
    this.changed();
    return this.catalog(deviceId)[0];
  }

  async searchDevice(
    deviceId: string,
    query: string,
    limit = 20,
  ): Promise<FleetSearchResponse> {
    const normalized = query.trim();
    if (!normalized || normalized.length > 500)
      throw new Error("Fleet search query is invalid");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new Error("Fleet search limit is invalid");
    const requestBody = JSON.stringify({
        version: 1,
        requesterDeviceId: this.fabric.status().localDeviceId,
        query: normalized,
        limit,
      }),
      scope = "fleet-search:read",
      authorization = await this.authorizeOperation(
        deviceId,
        scope,
        requestBody,
      ),
      endpoint = this.trustedEndpoint(deviceId);
    return validateFleetSearchResponse(
      await requestPinnedJson<FleetSearchResponse>(
        new URL("v1/search", endpoint.endpoint).toString(),
        endpoint.certificateFingerprint,
        requestBody,
        authorizationHeader(authorization),
        256 * 1024,
      ),
      deviceId,
      normalized,
    );
  }

  async requestWorkspaceGrant(
    deviceId: string,
    workspaceId: string,
  ): Promise<FleetWorkspaceGrantEnvelope> {
    if (!ID.test(workspaceId)) throw new Error("Fleet workspace ID is invalid");
    const requestBody = JSON.stringify({
        version: 1,
        requesterDeviceId: this.fabric.status().localDeviceId,
        workspaceId,
      }),
      scope = `workspace:${workspaceId}:grant`,
      authorization = await this.authorizeOperation(
        deviceId,
        scope,
        requestBody,
      ),
      endpoint = this.trustedEndpoint(deviceId);
    return validateWorkspaceGrantEnvelope(
      await requestPinnedJson<FleetWorkspaceGrantEnvelope>(
        new URL("v1/workspace/grant", endpoint.endpoint).toString(),
        endpoint.certificateFingerprint,
        requestBody,
        authorizationHeader(authorization),
      ),
      deviceId,
      this.fabric.status().localDeviceId,
      workspaceId,
    );
  }

  async fetchEncryptedObject(
    deviceId: string,
    input: { workspaceId: string; objectId: string; objectKind: string },
  ): Promise<FleetEncryptedObject> {
    if (
      !ID.test(input.workspaceId) ||
      !ID.test(input.objectId) ||
      !/^[a-z_]{1,64}$/.test(input.objectKind)
    )
      throw new Error("Fleet object request is invalid");
    const requestBody = JSON.stringify({
        version: 1,
        requesterDeviceId: this.fabric.status().localDeviceId,
        ...input,
      }),
      scope = `workspace:${input.workspaceId}:object:${input.objectKind}:read`,
      authorization = await this.authorizeOperation(
        deviceId,
        scope,
        requestBody,
      ),
      endpoint = this.trustedEndpoint(deviceId),
      object = validateFleetEncryptedObject(
        await requestPinnedJson<FleetEncryptedObject>(
          new URL("v1/object", endpoint.endpoint).toString(),
          endpoint.certificateFingerprint,
          requestBody,
          authorizationHeader(authorization),
          16 * 1024 * 1024,
        ),
      );
    if (
      object.sourceDeviceId !== deviceId ||
      object.workspaceId !== input.workspaceId ||
      object.objectId !== input.objectId ||
      object.objectKind !== input.objectKind
    )
      throw new Error("Fleet object response provenance is invalid");
    return object;
  }

  async fetchWorkspaceInventory(
    deviceId: string,
    workspaceId: string,
  ): Promise<FleetWorkspaceInventory> {
    if (!ID.test(workspaceId)) throw new Error("Fleet workspace ID is invalid");
    const requestBody = JSON.stringify({
        version: 1,
        requesterDeviceId: this.fabric.status().localDeviceId,
        workspaceId,
      }),
      scope = `workspace:${workspaceId}:inventory:read`,
      authorization = await this.authorizeOperation(
        deviceId,
        scope,
        requestBody,
      ),
      endpoint = this.trustedEndpoint(deviceId);
    return validateWorkspaceInventory(
      await requestPinnedJson<FleetWorkspaceInventory>(
        new URL("v1/workspace/inventory", endpoint.endpoint).toString(),
        endpoint.certificateFingerprint,
        requestBody,
        authorizationHeader(authorization),
        512 * 1024,
      ),
      deviceId,
      workspaceId,
    );
  }

  async fetchWorkerInventory(deviceId: string): Promise<FleetWorkerInventory> {
    const requestBody = JSON.stringify({
        version: 1,
        requesterDeviceId: this.fabric.status().localDeviceId,
      }),
      authorization = await this.authorizeOperation(
        deviceId,
        "remote-work:inventory:read",
        requestBody,
      ),
      endpoint = this.trustedEndpoint(deviceId);
    return validateFleetWorkerInventory(
      await requestPinnedJson<unknown>(
        new URL("v1/remote-work/inventory", endpoint.endpoint).toString(),
        endpoint.certificateFingerprint,
        requestBody,
        authorizationHeader(authorization),
        256 * 1024,
      ),
      deviceId,
    );
  }

  async submitRemoteWork(
    deviceId: string,
    order: FleetRemoteWorkOrder,
  ): Promise<FleetRemoteWorkRecord> {
    const validated = validateFleetRemoteWorkOrder(order);
    if (validated.targetDeviceId !== deviceId)
      throw new Error("Remote work target device mismatch");
    const requestBody = JSON.stringify({
        version: 1,
        requesterDeviceId: this.fabric.status().localDeviceId,
        order: validated,
      }),
      authorization = await this.authorizeOperation(
        deviceId,
        `remote-work:job:${validated.jobId}:submit`,
        requestBody,
      ),
      endpoint = this.trustedEndpoint(deviceId);
    const record = validateFleetRemoteWorkRecord(
      await requestPinnedJson<unknown>(
        new URL("v1/remote-work/submit", endpoint.endpoint).toString(),
        endpoint.certificateFingerprint,
        requestBody,
        authorizationHeader(authorization),
        MAX_REMOTE_WORK_BODY,
      ),
    );
    if (
      record.order.jobId !== validated.jobId ||
      record.order.controllerDeviceId !== this.fabric.status().localDeviceId ||
      record.order.targetDeviceId !== deviceId ||
      fleetRemoteWorkDigest(record.order) !== fleetRemoteWorkDigest(validated)
    )
      throw new Error("Remote work response provenance is invalid");
    return record;
  }

  async remoteWorkStatus(
    deviceId: string,
    jobId: string,
    expectedOrder: FleetRemoteWorkOrder,
  ): Promise<FleetRemoteWorkRecord> {
    return this.remoteWorkControl(deviceId, jobId, "status", expectedOrder);
  }

  async cancelRemoteWork(
    deviceId: string,
    jobId: string,
    expectedOrder: FleetRemoteWorkOrder,
  ): Promise<FleetRemoteWorkRecord> {
    return this.remoteWorkControl(deviceId, jobId, "cancel", expectedOrder);
  }

  async discardRemoteWork(
    deviceId: string,
    jobId: string,
    expectedOrder: FleetRemoteWorkOrder,
  ): Promise<FleetRemoteWorkRecord> {
    return this.remoteWorkControl(deviceId, jobId, "discard", expectedOrder);
  }

  private async remoteWorkControl(
    deviceId: string,
    jobId: string,
    action: "status" | "cancel" | "discard",
    expectedOrder: FleetRemoteWorkOrder,
  ): Promise<FleetRemoteWorkRecord> {
    if (!ID.test(jobId)) throw new Error("Remote work job ID is invalid");
    const requestBody = JSON.stringify({
        version: 1,
        requesterDeviceId: this.fabric.status().localDeviceId,
        jobId,
      }),
      authorization = await this.authorizeOperation(
        deviceId,
        `remote-work:job:${jobId}:${action}`,
        requestBody,
      ),
      endpoint = this.trustedEndpoint(deviceId);
    const record = validateFleetRemoteWorkRecord(
      await requestPinnedJson<unknown>(
        new URL(`v1/remote-work/${action}`, endpoint.endpoint).toString(),
        endpoint.certificateFingerprint,
        requestBody,
        authorizationHeader(authorization),
        MAX_REMOTE_WORK_BODY,
      ),
    );
    if (
      record.order.jobId !== jobId ||
      record.order.controllerDeviceId !== this.fabric.status().localDeviceId ||
      record.order.targetDeviceId !== deviceId ||
      fleetRemoteWorkDigest(record.order) !==
        fleetRemoteWorkDigest(expectedOrder)
    )
      throw new Error("Remote work response provenance is invalid");
    return record;
  }

  unlink(deviceId: string): DeviceNetworkStatus {
    this.fabric.revokeDevice(deviceId);
    this.remoteCatalogs.delete(deviceId);
    for (const [sessionId, session] of this.sessions)
      if (session.peer.deviceId === deviceId) this.sessions.delete(sessionId);
    this.persistSessions();
    this.changed();
    return this.status();
  }

  private trustedEndpoint(deviceId: string): {
    endpoint: string;
    certificateFingerprint: string;
  } {
    const record = this.fabric
        .trustedDevices(false, true)
        .find((peer) => peer.device.deviceId === deviceId),
      certificateFingerprint = record?.certificateFingerprintSha256;
    if (!record || !certificateFingerprint)
      throw new Error("Trusted device endpoint is unavailable");
    const discovered = this.discovery.snapshot().find(
      (item) =>
        !item.identityConflict &&
        item.advertisement.device.fingerprintSha256 === certificateFingerprint,
    );
    if (!discovered)
      throw new Error("Trusted device is not currently available");
    return {
      endpoint: discovered.advertisement.endpoint,
      certificateFingerprint,
    };
  }

  status(now = new Date()): DeviceNetworkStatus {
    this.expireSessions(now);
    const discovered = this.discovery.snapshot(now),
      trustedRecords = this.fabric.trustedDevices(false, true),
      trustedByCertificate = new Map(
        trustedRecords
          .filter((item) => item.certificateFingerprintSha256)
          .map((item) => [item.certificateFingerprintSha256!, item]),
      ),
      online = new Map(
        discovered.map((item) => {
          const fingerprint = item.advertisement.device.fingerprintSha256,
            record = trustedByCertificate.get(fingerprint);
          return [record?.device.deviceId ?? fingerprint, item] as const;
        }),
      ),
      trusted = new Map(
        trustedRecords.map((item) => [item.device.deviceId, item]),
      ),
      ids = new Set([...online.keys(), ...trusted.keys()]),
      peers: DeviceNetworkPeerView[] = [];
    for (const deviceId of ids) {
      const seen = online.get(deviceId),
        record = trusted.get(deviceId),
        conflict = seen?.identityConflict === true,
        advert = seen?.advertisement,
        operational =
          record &&
          Date.parse(this.remotePresence.get(deviceId)?.expiresAt ?? "") >
            now.getTime()
            ? this.remotePresence.get(deviceId)
            : undefined,
        catalog = this.remoteCatalogs.get(deviceId),
        pairing = this.activeSession(deviceId),
        metadata =
          conflict && record
            ? record.metadata
            : (advert?.metadata ?? record?.metadata);
      if (!metadata) continue;
      let status: DeviceNetworkPeerView["status"];
      if (conflict) status = "identity-conflict";
      else if (pairing?.code) status = "link-requested";
      else if (
        advert &&
        record &&
        (operational?.pauseWork || operational?.pauseSync)
      )
        status = "paused";
      else if (advert && record && (operational?.attentionItems ?? 0) > 0)
        status = "needs-attention";
      else if (advert && record && (operational?.runningJobs ?? 0) > 0)
        status = "working";
      else if (advert && record && operational) status = "trusted-online";
      else if (record) status = "trusted-offline";
      else status = "unlinked";
      peers.push({
        deviceId,
        displayName: metadata.displayName,
        platform: metadata.platform,
        architecture: record?.metadata.architecture ?? "unknown",
        appVersion: metadata.appVersion,
        fingerprintSha256:
          record?.fingerprintSha256 ??
          advert?.device.fingerprintSha256 ??
          "",
        status,
        trusted: Boolean(record && record.reciprocalState !== "pending"),
        online: Boolean(advert && !conflict && (!record || operational)),
        lastSeenAt: seen?.lastSeenAt ?? record?.lastSeenAt,
        endpoint: conflict ? undefined : advert?.endpoint,
        capabilities: conflict ? [] : (operational?.capabilities ?? []),
        pauseWork: conflict ? false : (operational?.pauseWork ?? false),
        pauseSync: conflict ? false : (operational?.pauseSync ?? false),
        runningJobs: conflict ? 0 : (operational?.runningJobs ?? 0),
        attentionItems: conflict ? 0 : (operational?.attentionItems ?? 0),
        defaultMode: record?.defaultMode,
        ...(catalog
          ? {
              catalogWorkspaceCount: catalog.workspaces.length,
              catalogUpdatedAt: catalog.generatedAt,
            }
          : {}),
        ...(pairing?.code
          ? {
              pairing: {
                sessionId: pairing.sessionId,
                direction: pairing.direction,
                code: pairing.code,
                expiresAt: pairing.expiresAt,
                localConfirmed: pairing.localConfirmed,
                remoteConfirmed: pairing.remoteConfirmed,
              },
            }
          : {}),
      });
    }
    peers.sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
    const paused = this.pauseWork || this.pauseSync;
    return {
      version: 1,
      host: {
        running: Boolean(this.server),
        endpoint: this.endpoint(),
        paused,
        pauseWork: this.pauseWork,
        pauseSync: this.pauseSync,
        reason: this.server
          ? paused
            ? `Device Host is online; ${[
                this.pauseWork ? "remote work" : "",
                this.pauseSync ? "sync" : "",
              ]
                .filter(Boolean)
                .join(" and ")} paused.`
            : "Device Host is available to this local network."
          : "Device Host is stopped.",
      },
      local: this.fabric.status(),
      peers,
    };
  }

  private endpoint(): string | undefined {
    if (!this.hostPort) return undefined;
    return deviceEndpoint(
      this.fixedAddress ??
        this.listeningAddresses[0] ??
        preferredDeviceAddress(),
      this.hostPort,
    );
  }

  private async handle(
    request: import("node:http").IncomingMessage,
    response: import("node:http").ServerResponse,
  ): Promise<void> {
    if (!isAllowedLanRequest(request.socket.remoteAddress)) {
      response.writeHead(403, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ error: "local_network_only" }));
      return;
    }
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json");
    if (request.method !== "POST") {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    this.requireRunning();
    const requestLimit =
        request.url === "/v1/remote-work/submit"
          ? MAX_REMOTE_WORK_BODY
          : MAX_BODY,
      contentLength = Number(request.headers["content-length"] ?? 0);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > requestLimit
    ) {
      request.resume();
      response.writeHead(413);
      response.end(JSON.stringify({ error: "request_too_large" }));
      return;
    }
    if (request.url === "/v1/pair/request")
      this.pairingAdmission.admitRequest(
        request.socket.remoteAddress ?? "",
      );
    const bodyBytes = await readBytes(request, requestLimit),
      body = parseJson(bodyBytes);
    if (request.url === "/v1/presence") {
      response.end(JSON.stringify(this.receivePresenceRequest(body)));
      return;
    }
    if (request.url === "/v1/authorize") {
      response.end(
        JSON.stringify(
          this.fabric.countersignOperationAuthorization(
            body as DeviceOperationAuthorizationProposal,
          ),
        ),
      );
      return;
    }
    if (request.url === "/v1/catalog") {
      if (!this.operations)
        throw new Error("Fleet catalog is unavailable on this device");
      const requesterDeviceId = authorizedRequester(
        request.headers["x-waypoint-authorization"],
        body,
      );
      if (
        !this.fabric.consumeOperationAuthorization(
          parseAuthorizationHeader(
            request.headers["x-waypoint-authorization"],
          ),
          requesterDeviceId,
          "catalog:read",
          bodyBytes,
        )
      )
        throw new Error("Fleet catalog authorization was rejected");
      response.end(JSON.stringify(this.operations.catalog()));
      return;
    }
    if (request.url === "/v1/search") {
      if (!this.operations)
        throw new Error("Fleet search is unavailable on this device");
      const requesterDeviceId = authorizedRequester(
          request.headers["x-waypoint-authorization"],
          body,
        ),
        input = validateFleetSearchRequest(body);
      if (
        !this.fabric.consumeOperationAuthorization(
          parseAuthorizationHeader(
            request.headers["x-waypoint-authorization"],
          ),
          requesterDeviceId,
          "fleet-search:read",
          bodyBytes,
        )
      )
        throw new Error("Fleet search authorization was rejected");
      response.end(JSON.stringify(this.operations.search(input.query, input.limit)));
      return;
    }
    if (request.url === "/v1/workspace/grant") {
      if (!this.operations?.workspaceGrant)
        throw new Error("Fleet workspace grants are unavailable on this device");
      const requesterDeviceId = authorizedRequester(
          request.headers["x-waypoint-authorization"],
          body,
        ),
        input = validateWorkspaceGrantRequest(body),
        scope = `workspace:${input.workspaceId}:grant`;
      if (
        !this.fabric.consumeOperationAuthorization(
          parseAuthorizationHeader(
            request.headers["x-waypoint-authorization"],
          ),
          requesterDeviceId,
          scope,
          bodyBytes,
        )
      )
        throw new Error("Fleet workspace grant authorization was rejected");
      response.end(
        JSON.stringify(
          this.operations.workspaceGrant(input.workspaceId, requesterDeviceId),
        ),
      );
      return;
    }
    if (request.url === "/v1/object") {
      if (!this.operations?.encryptedObject)
        throw new Error("Fleet object access is unavailable on this device");
      const requesterDeviceId = authorizedRequester(
          request.headers["x-waypoint-authorization"],
          body,
        ),
        input = validateFleetObjectRequest(body),
        scope = `workspace:${input.workspaceId}:object:${input.objectKind}:read`;
      if (
        !this.fabric.consumeOperationAuthorization(
          parseAuthorizationHeader(
            request.headers["x-waypoint-authorization"],
          ),
          requesterDeviceId,
          scope,
          bodyBytes,
        )
      )
        throw new Error("Fleet object authorization was rejected");
      response.end(
        JSON.stringify(
          this.operations.encryptedObject({
            ...input,
            requesterDeviceId,
          }),
        ),
      );
      return;
    }
    if (request.url === "/v1/workspace/inventory") {
      if (!this.operations?.workspaceInventory)
        throw new Error("Fleet workspace inventory is unavailable on this device");
      const requesterDeviceId = authorizedRequester(
          request.headers["x-waypoint-authorization"],
          body,
        ),
        input = validateWorkspaceGrantRequest(body),
        scope = `workspace:${input.workspaceId}:inventory:read`;
      if (
        !this.fabric.consumeOperationAuthorization(
          parseAuthorizationHeader(
            request.headers["x-waypoint-authorization"],
          ),
          requesterDeviceId,
          scope,
          bodyBytes,
        )
      )
        throw new Error("Fleet workspace inventory authorization was rejected");
      response.end(
        JSON.stringify(
          this.operations.workspaceInventory(
            input.workspaceId,
            requesterDeviceId,
          ),
        ),
      );
      return;
    }
    if (request.url === "/v1/remote-work/inventory") {
      if (!this.operations?.workerInventory)
        throw new Error("Remote worker inventory is unavailable");
      const requesterDeviceId = authorizedRequester(
        request.headers["x-waypoint-authorization"],
        body,
      );
      if (
        !this.fabric.consumeOperationAuthorization(
          parseAuthorizationHeader(
            request.headers["x-waypoint-authorization"],
          ),
          requesterDeviceId,
          "remote-work:inventory:read",
          bodyBytes,
        )
      )
        throw new Error("Remote worker inventory authorization was rejected");
      response.end(
        JSON.stringify(
          validateFleetWorkerInventory(
            await this.operations.workerInventory(requesterDeviceId),
            this.fabric.status().localDeviceId,
          ),
        ),
      );
      return;
    }
    if (request.url === "/v1/remote-work/submit") {
      if (!this.operations?.submitRemoteWork)
        throw new Error("Remote work submission is unavailable");
      const requesterDeviceId = authorizedRequester(
          request.headers["x-waypoint-authorization"],
          body,
        ),
        wrapper = body as { order?: unknown },
        order = validateFleetRemoteWorkOrder(wrapper.order),
        scope = `remote-work:job:${order.jobId}:submit`;
      if (
        order.controllerDeviceId !== requesterDeviceId ||
        order.targetDeviceId !== this.fabric.status().localDeviceId ||
        !this.fabric.consumeOperationAuthorization(
          parseAuthorizationHeader(
            request.headers["x-waypoint-authorization"],
          ),
          requesterDeviceId,
          scope,
          bodyBytes,
        )
      )
        throw new Error("Remote work submission authorization was rejected");
      response.end(
        JSON.stringify(
          validateFleetRemoteWorkRecord(
            await this.operations.submitRemoteWork(order, requesterDeviceId),
          ),
        ),
      );
      return;
    }
    if (
      request.url === "/v1/remote-work/status" ||
      request.url === "/v1/remote-work/cancel" ||
      request.url === "/v1/remote-work/discard"
    ) {
      const action = request.url.endsWith("cancel")
          ? "cancel"
          : request.url.endsWith("discard")
            ? "discard"
            : "status",
        operation =
          action === "cancel"
            ? this.operations?.cancelRemoteWork
            : action === "discard"
              ? this.operations?.discardRemoteWork
              : this.operations?.remoteWorkStatus;
      if (!operation) throw new Error(`Remote work ${action} is unavailable`);
      const requesterDeviceId = authorizedRequester(
          request.headers["x-waypoint-authorization"],
          body,
        ),
        jobId = String((body as { jobId?: unknown }).jobId ?? ""),
        scope = `remote-work:job:${jobId}:${action}`;
      if (
        !ID.test(jobId) ||
        !this.fabric.consumeOperationAuthorization(
          parseAuthorizationHeader(
            request.headers["x-waypoint-authorization"],
          ),
          requesterDeviceId,
          scope,
          bodyBytes,
        )
      )
        throw new Error(`Remote work ${action} authorization was rejected`);
      response.end(
        JSON.stringify(
          validateFleetRemoteWorkRecord(
            await operation(jobId, requesterDeviceId),
          ),
        ),
      );
      return;
    }
    if (request.url === "/v1/pair/request") {
      response.end(
        JSON.stringify(
          this.receivePairRequest(body),
        ),
      );
      return;
    }
    if (request.url === "/v1/pair/confirm") {
      response.end(JSON.stringify(this.receivePairConfirm(body)));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: "not_found" }));
  }

  private receivePresenceRequest(input: unknown): TrustedPresenceResponse {
    const validated = validateTrustedPresenceRequest(input, this.fabric),
      request = validated.request,
      current = this.presence(),
      now = new Date(),
      base = {
        version: 1 as const,
        deviceId: this.fabric.status().localDeviceId,
        nonce: request.nonce,
        sentAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 8_000).toISOString(),
        requesterRevoked: validated.requesterRevoked,
      },
      unsigned: Omit<TrustedPresenceResponse, "signature"> =
        validated.requesterRevoked
          ? base
          : {
              ...base,
              architecture: this.fabric.status().metadata.architecture,
              pauseWork: this.pauseWork,
              pauseSync: this.pauseSync,
              capabilities: current.capabilities,
              runningJobs: current.runningJobs,
              attentionItems: current.attentionItems,
            };
    return {
      ...unsigned,
      signature: this.fabric.sign(trustedPresenceResponsePayload(unsigned)),
    };
  }

  private receivePairRequest(input: unknown): PairResponse {
    const request = validatePairRequest(input, this.fabric),
      sameId = this.sessions.get(request.sessionId);
    if (sameId) {
      if (
        sameId.peer.deviceId !== request.requesterIdentity.deviceId ||
        sameId.requesterNonce !== request.requesterNonce ||
        sameId.direction !== "incoming"
      )
        throw new Error("Pairing session identity collision");
      return this.pairResponse(sameId);
    }
    const crossed = this.activeSession(
      request.requesterIdentity.deviceId,
      request.requester.device.fingerprintSha256,
    );
    this.pairingAdmission.admitCapacity(
      this.sessions.size,
      Boolean(crossed),
    );
    if (crossed) {
      if (crossed.sessionId.localeCompare(request.sessionId) < 0)
        throw new Error("Pairing request superseded by canonical session");
      this.sessions.delete(crossed.sessionId);
    }
    const responderNonce = randomBytes(24).toString("base64url"),
      peer = pairingPeer(
        request.requester,
        request.requesterMetadata,
        request.requesterIdentity,
      ),
      session: PairingSession = {
        sessionId: request.sessionId,
        direction: "incoming",
        peer,
        requesterNonce: request.requesterNonce,
        responderNonce,
        code: pairingCode(
          request.sessionId,
          request.requesterNonce,
          responderNonce,
          peer.fingerprintSha256,
          this.fabric.status().fingerprintSha256,
        ),
        expiresAt: request.expiresAt,
        localConfirmed: false,
        remoteConfirmed: false,
        completed: false,
      };
    this.sessions.set(session.sessionId, session);
    try {
      this.persistSessions();
    } catch (error) {
      this.sessions.delete(session.sessionId);
      if (crossed) this.sessions.set(crossed.sessionId, crossed);
      throw error;
    }
    this.changed();
    return this.pairResponse(session);
  }

  private pairResponse(session: PairingSession): PairResponse {
    if (!session.responderNonce)
      throw new Error("Pairing response is not ready");
    const unsigned = {
      version: 1 as const,
      sessionId: session.sessionId,
      responder: this.advertisementForPeer(session.peer.endpoint),
      responderIdentity: this.fabric.localIdentity(),
      responderMetadata: this.fabric.status().metadata,
      requesterNonce: session.requesterNonce,
      responderNonce: session.responderNonce,
      expiresAt: session.expiresAt,
    };
    return {
      ...unsigned,
      signature: this.fabric.sign(pairResponsePayload(unsigned)),
    };
  }

  private receivePairConfirm(input: unknown): PairConfirmResponse {
    const sessionId = String((input as { sessionId?: unknown })?.sessionId),
      session = this.requiredSession(sessionId),
      confirmation = validatePairConfirm(input, session, this.fabric);
    if (confirmation.confirmerDeviceId !== session.peer.deviceId)
      throw new Error("Pairing confirmation peer mismatch");
    session.remoteConfirmed = true;
    this.persistSessions();
    if (session.localConfirmed) this.commitTrust(session);
    const unsigned = {
      version: 1 as const,
      sessionId,
      deviceId: this.fabric.status().localDeviceId,
      status: session.completed ? ("completed" as const) : ("pending" as const),
      expiresAt: session.expiresAt,
    };
    return {
      ...unsigned,
      signature: this.fabric.sign(confirmResponsePayload(unsigned)),
    };
  }

  private async sendPairRequest(session: PairingSession): Promise<void> {
    const discovered = this.discovery
      .snapshot()
      .find(
        (item) =>
          !item.identityConflict &&
          item.advertisement.device.fingerprintSha256 ===
            session.peer.certificateFingerprintSha256,
      );
    if (!discovered) throw new Error("Pairing peer is offline");
    session.peer = {
      ...session.peer,
      endpoint: discovered.advertisement.endpoint,
      certificateFingerprintSha256:
        discovered.advertisement.device.fingerprintSha256,
    };
    this.persistSessions();
    const unsigned = {
        version: 1 as const,
        sessionId: session.sessionId,
        requester: this.advertisementForPeer(session.peer.endpoint),
        requesterIdentity: this.fabric.localIdentity(),
        requesterMetadata: this.fabric.status().metadata,
        requesterNonce: session.requesterNonce,
        expiresAt: session.expiresAt,
      },
      request: PairRequest = {
        ...unsigned,
        signature: this.fabric.sign(pairRequestPayload(unsigned)),
      },
      response = await requestPinnedJson<PairResponse>(
        new URL("v1/pair/request", session.peer.endpoint).toString(),
        session.peer.certificateFingerprintSha256,
        request,
      ),
      validated = validatePairResponse(
        response,
        request,
        discovered.advertisement,
        this.fabric,
      );
    const canonical = this.sessions.get(session.sessionId);
    if (canonical !== session) return;
    session.peer = pairingPeer(
      validated.responder,
      validated.responderMetadata,
      validated.responderIdentity,
    );
    session.peer.endpoint = discovered.advertisement.endpoint;
    session.peer.certificateFingerprintSha256 =
      discovered.advertisement.device.fingerprintSha256;
    session.responderNonce = response.responderNonce;
    session.code = pairingCode(
      session.sessionId,
      session.requesterNonce,
      response.responderNonce,
      this.fabric.status().fingerprintSha256,
      session.peer.fingerprintSha256,
    );
    this.persistSessions();
  }

  private async sendConfirmation(session: PairingSession): Promise<void> {
    if (!session.code || !session.peer.device)
      throw new Error("Pairing confirmation is not ready");
    const discovered = this.discovery
      .snapshot()
      .find(
        (item) =>
          !item.identityConflict &&
          item.advertisement.device.fingerprintSha256 ===
            session.peer.certificateFingerprintSha256,
      );
    if (discovered) {
      session.peer.endpoint = discovered.advertisement.endpoint;
      session.peer.certificateFingerprintSha256 =
        discovered.advertisement.device.fingerprintSha256;
      this.persistSessions();
    }
    const unsigned = {
        version: 1 as const,
        sessionId: session.sessionId,
        confirmerDeviceId: this.fabric.status().localDeviceId,
        codeDigest: codeDigest(session.code),
        expiresAt: session.expiresAt,
      },
      confirmation: PairConfirm = {
        ...unsigned,
        signature: this.fabric.sign(pairConfirmPayload(unsigned)),
      },
      response = await requestPinnedJson<PairConfirmResponse>(
        new URL("v1/pair/confirm", session.peer.endpoint).toString(),
        session.peer.certificateFingerprintSha256,
        confirmation,
      );
    validateConfirmResponse(
      response,
      session.peer,
      this.fabric,
      session.sessionId,
      session.expiresAt,
    );
    if (response.status === "completed") {
      session.remoteConfirmed = true;
      this.persistSessions();
      this.commitTrust(session);
    }
  }

  private commitTrust(session: PairingSession): void {
    if (session.completed) return;
    if (!session.peer.device)
      throw new Error("Pairing identity was not authenticated");
    session.completed = true;
    try {
      this.fabric.trustDevice(
        {
          device: session.peer.device,
          metadata: session.peer.metadata,
          certificateFingerprintSha256:
            session.peer.certificateFingerprintSha256,
          allowRevoked: true,
          reciprocalState: "pending",
        },
        [...this.sessions.values()],
      );
    } catch (error) {
      session.completed = false;
      throw error;
    }
    this.scheduleRecovery();
  }

  private activeSession(
    deviceId: string,
    certificateFingerprintSha256?: string,
  ): PairingSession | undefined {
    const activeTrustedIds = new Set(
      this.fabric
        .trustedDevices()
        .map((record) => record.device.deviceId),
    );
    return [...this.sessions.values()]
      .filter(
        (session) =>
          (session.peer.deviceId === deviceId ||
            session.peer.certificateFingerprintSha256 === deviceId ||
            (certificateFingerprintSha256 !== undefined &&
          session.peer.certificateFingerprintSha256 ===
                certificateFingerprintSha256)) &&
          (!session.completed ||
            !activeTrustedIds.has(session.peer.deviceId)) &&
          Date.parse(session.recoveryUntil ?? session.expiresAt) > Date.now(),
      )
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId))[0];
  }

  private requiredSession(sessionId: string): PairingSession {
    if (!ID.test(sessionId)) throw new Error("Invalid pairing session");
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      (Date.parse(session.expiresAt) <= Date.now() &&
        (!session.recoveryUntil ||
          Date.parse(session.recoveryUntil) <= Date.now()))
    )
      throw new Error("Pairing session expired");
    return session;
  }

  private expireSessions(now: Date): void {
    let changed = false;
    for (const [sessionId, session] of this.sessions)
      if (
        Date.parse(session.expiresAt) <= now.getTime() &&
        (!session.recoveryUntil ||
          Date.parse(session.recoveryUntil) <= now.getTime())
      ) {
        this.sessions.delete(sessionId);
        changed = true;
      }
    if (changed) this.persistSessions(now);
  }

  private persistSessions(at = new Date()): void {
    this.fabric.savePairingSessions([...this.sessions.values()], at);
  }

  private scheduleRecovery(): void {
    if (this.recoveryQueued || !this.server) return;
    this.recoveryQueued = true;
    queueMicrotask(() => {
      this.recoveryQueued = false;
      void this.serialize(() => this.recoverNetworkState()).catch(
        () => undefined,
      );
    });
  }

  private async recoverNetworkState(): Promise<void> {
    await this.recoverSessions();
    await this.refreshTrustedPresence();
  }

  private async recoverSessions(): Promise<void> {
    for (const session of [...this.sessions.values()]) {
      if (session.completed) continue;
      if (
        Date.parse(session.expiresAt) <= Date.now() &&
        (!session.recoveryUntil ||
          Date.parse(session.recoveryUntil) <= Date.now())
      )
        continue;
      try {
        if (session.direction === "outgoing" && !session.code)
          await this.sendPairRequest(session);
        if (session.localConfirmed && session.code) {
          if (session.remoteConfirmed) this.commitTrust(session);
          await this.sendConfirmation(session);
        }
      } catch {
        // A later signed advert or the user opening Device Network retries it.
      }
    }
    this.changed();
  }

  private async refreshTrustedPresence(): Promise<void> {
    const now = Date.now(),
      trusted = new Map(
        this.fabric
          .trustedDevices(false, true)
          .filter((record) => record.certificateFingerprintSha256)
          .map((record) => [record.certificateFingerprintSha256!, record]),
      );
    for (const discovered of this.discovery.snapshot()) {
      const discoveryFingerprint =
          discovered.advertisement.device.fingerprintSha256,
        record = trusted.get(discoveryFingerprint),
        deviceId = record?.device.deviceId ?? discoveryFingerprint;
      if (
        !record ||
        discovered.identityConflict ||
        !record.certificateFingerprintSha256 ||
        now - (this.presenceFetchAt.get(deviceId) ?? 0) < 1_500
      )
        continue;
      this.presenceFetchAt.set(deviceId, now);
      try {
        const unsigned = {
            version: 1 as const,
            requesterDeviceId: this.fabric.status().localDeviceId,
            nonce: randomBytes(24).toString("base64url"),
            sentAt: new Date().toISOString(),
          },
          request: TrustedPresenceRequest = {
            ...unsigned,
            signature: this.fabric.sign(
              trustedPresenceRequestPayload(unsigned),
            ),
          },
          response = await requestPinnedJson<TrustedPresenceResponse>(
            new URL("v1/presence", discovered.advertisement.endpoint).toString(),
            record.certificateFingerprintSha256,
            request,
          );
        validateTrustedPresenceResponse(
          response,
          request,
          record.device,
          this.fabric,
        );
        if (response.requesterRevoked) {
          this.fabric.revokeDevice(deviceId);
          this.operations?.revoked?.(deviceId);
          for (const [sessionId, session] of this.sessions)
            if (session.peer.deviceId === deviceId)
              this.sessions.delete(sessionId);
          this.persistSessions();
          this.remotePresence.delete(deviceId);
          this.remoteCatalogs.delete(deviceId);
          continue;
        }
        this.fabric.activateReciprocalTrust(deviceId);
        this.remotePresence.set(deviceId, {
          ...response,
          capabilities: [...(response.capabilities ?? [])],
        });
        if (response.capabilities?.includes("workspace-catalog")) {
          try {
            await this.refreshCatalog(deviceId);
          } catch {
            this.remoteCatalogs.delete(deviceId);
          }
        } else this.remoteCatalogs.delete(deviceId);
      } catch {
        this.remotePresence.delete(deviceId);
        this.remoteCatalogs.delete(deviceId);
      }
    }
    this.changed();
  }

  private createHostServer(key: string, certificate: string): HttpsServer {
    return createHttpsServer(
      {
        key,
        cert: certificate,
        minVersion: "TLSv1.2",
      },
      (request, response) => {
        void this.handle(request, response).catch((error) => {
          if (!response.headersSent)
            response.writeHead(
              error instanceof Error &&
                error.message === "Fleet object was not found"
                ? 404
                : 400,
              {
                "content-type": "application/json",
                "cache-control": "no-store",
              },
            );
          response.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "invalid",
              ...(error instanceof Error &&
              error.message === "Fleet object was not found"
                ? { code: "fleet_object_not_found" }
                : {}),
            }),
          );
        });
      },
    );
  }

  private async reconcileListeners(): Promise<void> {
    if (this.fixedAddress || !this.hostPort || !this.hostTls) return;
    const privateAddresses = this.interfaceAddresses(),
      desired = privateAddresses.length ? privateAddresses : ["127.0.0.1"];
    for (const address of desired) {
      if (this.listenerByAddress.has(address)) continue;
      const server = this.createHostServer(
        this.hostTls.key,
        this.hostTls.certificate,
      );
      try {
        await listen(server, address, this.hostPort);
        this.listenerByAddress.set(address, server);
      } catch {
        await Promise.allSettled([close(server)]);
      }
    }
    const successfullyBound = desired.filter((address) =>
      this.listenerByAddress.has(address),
    );
    if (!successfullyBound.length) {
      const obsolete = [...this.listenerByAddress.values()];
      this.listenerByAddress.clear();
      this.servers = [];
      this.listeningAddresses = [];
      this.server = undefined;
      this.hostPort = undefined;
      this.certificateFingerprintSha256 = undefined;
      this.hostTls = undefined;
      if (this.listenerRefreshTimer)
        clearInterval(this.listenerRefreshTimer);
      this.listenerRefreshTimer = undefined;
      await Promise.allSettled([
        this.discovery.stop(),
        ...obsolete.map((server) => close(server)),
      ]);
      this.changed();
      return;
    }
    const stale = [...this.listenerByAddress.entries()].filter(
      ([address]) => !desired.includes(address),
    );
    for (const [address, server] of stale) {
      this.listenerByAddress.delete(address);
      await Promise.allSettled([close(server)]);
    }
    this.listeningAddresses = [...successfullyBound].sort();
    this.servers = this.listeningAddresses.map(
      (address) => this.listenerByAddress.get(address)!,
    );
    this.server = this.servers[0];
    this.discovery.updateListenAddresses(this.listeningAddresses);
    this.changed();
  }

  private requireRunning(): void {
    if (!this.server) throw new Error("Device Host is not running");
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transition.then(operation, operation);
    this.transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function pairRequestPayload(value: Omit<PairRequest, "signature">): string {
  return JSON.stringify({
    version: value.version,
    sessionId: value.sessionId,
    requester: value.requester,
    requesterIdentity: value.requesterIdentity,
    requesterMetadata: value.requesterMetadata,
    requesterNonce: value.requesterNonce,
    expiresAt: value.expiresAt,
  });
}
function pairResponsePayload(value: Omit<PairResponse, "signature">): string {
  return JSON.stringify({
    version: value.version,
    sessionId: value.sessionId,
    responder: value.responder,
    responderIdentity: value.responderIdentity,
    responderMetadata: value.responderMetadata,
    requesterNonce: value.requesterNonce,
    responderNonce: value.responderNonce,
    expiresAt: value.expiresAt,
  });
}

function trustedPresenceRequestPayload(
  value: Omit<TrustedPresenceRequest, "signature">,
): string {
  return JSON.stringify({
    version: value.version,
    requesterDeviceId: value.requesterDeviceId,
    nonce: value.nonce,
    sentAt: value.sentAt,
  });
}

function trustedPresenceResponsePayload(
  value: Omit<TrustedPresenceResponse, "signature">,
): string {
  return JSON.stringify({
    version: value.version,
    deviceId: value.deviceId,
    nonce: value.nonce,
    sentAt: value.sentAt,
    expiresAt: value.expiresAt,
    requesterRevoked: value.requesterRevoked,
    architecture: value.architecture,
    pauseWork: value.pauseWork,
    pauseSync: value.pauseSync,
    capabilities: value.capabilities
      ? [...value.capabilities].sort()
      : undefined,
    runningJobs: value.runningJobs,
    attentionItems: value.attentionItems,
  });
}
function pairConfirmPayload(value: Omit<PairConfirm, "signature">): string {
  return JSON.stringify({
    version: value.version,
    sessionId: value.sessionId,
    confirmerDeviceId: value.confirmerDeviceId,
    codeDigest: value.codeDigest,
    expiresAt: value.expiresAt,
  });
}
function confirmResponsePayload(
  value: Omit<PairConfirmResponse, "signature">,
): string {
  return JSON.stringify({
    version: value.version,
    sessionId: value.sessionId,
    deviceId: value.deviceId,
    status: value.status,
    expiresAt: value.expiresAt,
  });
}

function validatePairRequest(
  input: unknown,
  fabric: DeviceFabricService,
): PairRequest {
  const item = input as PairRequest;
  if (
    item?.version !== 1 ||
    !ID.test(String(item.sessionId)) ||
    !ID.test(String(item.requesterNonce)) ||
    !validExpiry(item.expiresAt) ||
    !validSignature(item.signature) ||
    !validDeviceIdentity(item.requesterIdentity) ||
    !validDeviceMetadata(item.requesterMetadata)
  )
    throw new Error("Invalid pairing request");
  const requester = parseSignedAdvertisement(item.requester);
  assertAdvertIdentity(requester, item.requesterIdentity, fabric);
  const unsigned = {
    version: item.version,
    sessionId: item.sessionId,
    requester,
    requesterIdentity: item.requesterIdentity,
    requesterMetadata: item.requesterMetadata,
    requesterNonce: item.requesterNonce,
    expiresAt: item.expiresAt,
  };
  if (
    !fabric.verify(
      pairRequestPayload(unsigned),
      item.signature,
      item.requesterIdentity,
    )
  )
    throw new Error("Pairing request signature is invalid");
  return { ...unsigned, signature: item.signature };
}

function validatePairResponse(
  response: PairResponse,
  request: PairRequest,
  expected: SignedDeviceAdvertisement,
  fabric: DeviceFabricService,
): {
  responder: SignedDeviceAdvertisement;
  responderIdentity: DeviceIdentity;
  responderMetadata: DeviceMetadata;
} {
  const responder = parseSignedAdvertisement(response?.responder);
  if (
    !validDeviceIdentity(response?.responderIdentity) ||
    !validDeviceMetadata(response?.responderMetadata)
  )
    throw new Error("Invalid pairing response");
  assertAdvertIdentity(responder, response.responderIdentity, fabric);
  const unsigned = {
    version: response?.version,
    sessionId: response?.sessionId,
    responder,
    responderIdentity: response?.responderIdentity,
    responderMetadata: response?.responderMetadata,
    requesterNonce: response?.requesterNonce,
    responderNonce: response?.responderNonce,
    expiresAt: response?.expiresAt,
  } as Omit<PairResponse, "signature">;
  if (
    response.version !== 1 ||
    response.sessionId !== request.sessionId ||
    response.requesterNonce !== request.requesterNonce ||
    !ID.test(String(response.responderNonce)) ||
    response.expiresAt !== request.expiresAt ||
    responder.device.fingerprintSha256 !== expected.device.fingerprintSha256 ||
    !fabric.verify(
      pairResponsePayload(unsigned),
      response.signature,
      response.responderIdentity,
    )
  )
    throw new Error("Invalid pairing response");
  return {
    responder,
    responderIdentity: response.responderIdentity,
    responderMetadata: response.responderMetadata,
  };
}

function validatePairConfirm(
  input: unknown,
  session: PairingSession,
  fabric: DeviceFabricService,
): PairConfirm {
  if (!session.code || !session.peer.device)
    throw new Error("Pairing confirmation is not ready");
  const item = input as PairConfirm,
    unsigned = {
      version: item?.version,
      sessionId: item?.sessionId,
      confirmerDeviceId: item?.confirmerDeviceId,
      codeDigest: item?.codeDigest,
      expiresAt: item?.expiresAt,
    } as Omit<PairConfirm, "signature">;
  if (
    item?.version !== 1 ||
    item.sessionId !== session.sessionId ||
    item.confirmerDeviceId !== session.peer.deviceId ||
    item.codeDigest !== codeDigest(session.code) ||
    item.expiresAt !== session.expiresAt ||
    !validSignature(item.signature) ||
    !fabric.verify(
      pairConfirmPayload(unsigned),
      item.signature,
      session.peer.device,
    )
  )
    throw new Error("Invalid pairing confirmation");
  return { ...unsigned, signature: item.signature };
}

function validateConfirmResponse(
  item: PairConfirmResponse,
  peer: DevicePairingPeerRecord,
  fabric: DeviceFabricService,
  sessionId: string,
  expiresAt: string,
): void {
  if (!peer.device) throw new Error("Pairing identity was not authenticated");
  const unsigned = {
    version: item?.version,
    sessionId: item?.sessionId,
    deviceId: item?.deviceId,
    status: item?.status,
    expiresAt: item?.expiresAt,
  } as Omit<PairConfirmResponse, "signature">;
  if (
    item?.version !== 1 ||
    item.sessionId !== sessionId ||
    item.deviceId !== peer.deviceId ||
    !["pending", "completed"].includes(String(item.status)) ||
    item.expiresAt !== expiresAt ||
    !fabric.verify(confirmResponsePayload(unsigned), item.signature, peer.device)
  )
    throw new Error("Invalid pairing confirmation response");
}

function authorizationHeader(
  authorization: DeviceOperationAuthorization,
): Record<string, string> {
  return {
    "x-waypoint-authorization": Buffer.from(
      JSON.stringify(authorization),
    ).toString("base64url"),
  };
}

function parseAuthorizationHeader(
  value: string | string[] | undefined,
): DeviceOperationAuthorization {
  if (typeof value !== "string" || value.length < 32 || value.length > 8_192)
    throw new Error("Device operation authorization header is invalid");
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value)
      throw new Error("non-canonical");
    return JSON.parse(decoded.toString("utf8")) as DeviceOperationAuthorization;
  } catch {
    throw new Error("Device operation authorization header is invalid");
  }
}

function authorizedRequester(
  header: string | string[] | undefined,
  body: unknown,
): string {
  const authorization = parseAuthorizationHeader(header),
    item = body as { version?: unknown; requesterDeviceId?: unknown };
  if (
    item?.version !== 1 ||
    !ID.test(String(item.requesterDeviceId)) ||
    item.requesterDeviceId !== authorization.initiatorDeviceId
  )
    throw new Error("Authorized device requester is invalid");
  return String(item.requesterDeviceId);
}

function validateFleetSearchRequest(input: unknown): {
  query: string;
  limit: number;
} {
  const item = input as {
    version?: unknown;
    requesterDeviceId?: unknown;
    query?: unknown;
    limit?: unknown;
  };
  if (
    item?.version !== 1 ||
    !ID.test(String(item.requesterDeviceId)) ||
    typeof item.query !== "string" ||
    !item.query.trim() ||
    item.query !== item.query.trim() ||
    item.query.length > 500 ||
    !Number.isInteger(item.limit) ||
    Number(item.limit) < 1 ||
    Number(item.limit) > 50
  )
    throw new Error("Fleet search request is invalid");
  return { query: item.query, limit: Number(item.limit) };
}

function validateWorkspaceGrantRequest(input: unknown): {
  workspaceId: string;
} {
  const item = input as {
    version?: unknown;
    requesterDeviceId?: unknown;
    workspaceId?: unknown;
  };
  if (
    item?.version !== 1 ||
    !ID.test(String(item.requesterDeviceId)) ||
    !ID.test(String(item.workspaceId))
  )
    throw new Error("Fleet workspace grant request is invalid");
  return { workspaceId: String(item.workspaceId) };
}

function validateFleetObjectRequest(input: unknown): {
  workspaceId: string;
  objectId: string;
  objectKind: string;
} {
  const item = input as {
    version?: unknown;
    requesterDeviceId?: unknown;
    workspaceId?: unknown;
    objectId?: unknown;
    objectKind?: unknown;
  };
  if (
    item?.version !== 1 ||
    !ID.test(String(item.requesterDeviceId)) ||
    !ID.test(String(item.workspaceId)) ||
    !ID.test(String(item.objectId)) ||
    !/^[a-z_]{1,64}$/.test(String(item.objectKind))
  )
    throw new Error("Fleet object request is invalid");
  return {
    workspaceId: String(item.workspaceId),
    objectId: String(item.objectId),
    objectKind: String(item.objectKind),
  };
}

function validFleetTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}

function freshFleetTimestamp(value: unknown): value is string {
  if (!validFleetTimestamp(value)) return false;
  const time = Date.parse(value),
    now = Date.now();
  return time <= now + 5_000 && time >= now - 5 * 60_000;
}

function validateFleetCatalog(
  input: unknown,
  expectedDeviceId: string,
): FleetWorkspaceCatalog {
  const item = input as FleetWorkspaceCatalog;
  if (
    item?.version !== 1 ||
    item.deviceId !== expectedDeviceId ||
    !freshFleetTimestamp(item.generatedAt) ||
    !Array.isArray(item.workspaces) ||
    item.workspaces.length > 512 ||
    new Set(item.workspaces.map((workspace) => workspace.workspaceId)).size !==
      item.workspaces.length ||
    item.workspaces.some(
      (workspace) =>
        !ID.test(String(workspace?.workspaceId)) ||
        typeof workspace.name !== "string" ||
        !workspace.name.trim() ||
        workspace.name.length > 120 ||
        !validFleetTimestamp(workspace.createdAt) ||
        !validFleetTimestamp(workspace.updatedAt) ||
        workspace.authoritativeDeviceId !== expectedDeviceId ||
        !Number.isSafeInteger(workspace.keyEpoch) ||
        workspace.keyEpoch < 1 ||
        !workspace.counts ||
        [
          workspace.counts.chats,
          workspace.counts.documents,
          workspace.counts.memories,
          workspace.counts.attachments,
        ].some(
          (count) =>
            !Number.isSafeInteger(count) || Number(count) < 0 || count > 1e9,
        ),
    )
  )
    throw new Error("Fleet catalog response is invalid");
  return {
    ...item,
    workspaces: item.workspaces.map((workspace) => ({
      ...workspace,
      counts: { ...workspace.counts },
    })),
  };
}

function validateFleetSearchResponse(
  input: unknown,
  expectedDeviceId: string,
  expectedQuery: string,
): FleetSearchResponse {
  const item = input as FleetSearchResponse;
  if (
    item?.version !== 1 ||
    item.deviceId !== expectedDeviceId ||
    item.query !== expectedQuery ||
    !freshFleetTimestamp(item.generatedAt) ||
    typeof item.partial !== "boolean" ||
    !Array.isArray(item.results) ||
    item.results.length > 50 ||
    item.results.some(
      (result) =>
        result?.sourceDeviceId !== expectedDeviceId ||
        !ID.test(String(result.workspaceId)) ||
        typeof result.workspaceName !== "string" ||
        !result.workspaceName.trim() ||
        result.workspaceName.length > 120 ||
        !ID.test(String(result.objectId)) ||
        typeof result.objectKind !== "string" ||
        result.objectKind.length < 1 ||
        result.objectKind.length > 64 ||
        (result.revisionId !== undefined &&
          !ID.test(String(result.revisionId))) ||
        typeof result.title !== "string" ||
        result.title.length > 500 ||
        typeof result.excerpt !== "string" ||
        result.excerpt.length > 2_000 ||
        !Number.isFinite(result.score) ||
        result.method !== "text",
    )
  )
    throw new Error("Fleet search response is invalid");
  return {
    ...item,
    results: item.results.map((result) => ({ ...result })),
  };
}

function validateWorkspaceGrantEnvelope(
  input: unknown,
  sourceDeviceId: string,
  recipientDeviceId: string,
  workspaceId: string,
): FleetWorkspaceGrantEnvelope {
  const item = input as FleetWorkspaceGrantEnvelope;
  if (
    item?.version !== 1 ||
    item.sourceDeviceId !== sourceDeviceId ||
    item.recipientDeviceId !== recipientDeviceId ||
    item.workspaceId !== workspaceId ||
    !Number.isSafeInteger(item.keyEpoch) ||
    item.keyEpoch < 1 ||
    typeof item.wrappedWorkspaceKey !== "string" ||
    item.wrappedWorkspaceKey.length < 64 ||
    item.wrappedWorkspaceKey.length > 512 ||
    !freshFleetTimestamp(item.grantedAt)
  )
    throw new Error("Fleet workspace grant response is invalid");
  return { ...item };
}

function validateWorkspaceInventory(
  input: unknown,
  sourceDeviceId: string,
  workspaceId: string,
): FleetWorkspaceInventory {
  const item = input as FleetWorkspaceInventory;
  if (
    item?.version !== 1 ||
    item.sourceDeviceId !== sourceDeviceId ||
    item.workspaceId !== workspaceId ||
    !freshFleetTimestamp(item.generatedAt) ||
    !Number.isSafeInteger(item.attachmentLimitBytes) ||
    item.attachmentLimitBytes < 0 ||
    item.attachmentLimitBytes > 10 * 1024 * 1024 ||
    !Number.isSafeInteger(item.omittedAttachments) ||
    item.omittedAttachments < 0 ||
    item.omittedAttachments > 1_000_000 ||
    !Array.isArray(item.objects) ||
    item.objects.length > 4_096 ||
    new Set(
      item.objects.map((object) => `${object.objectKind}:${object.objectId}`),
    ).size !== item.objects.length ||
    item.objects.some(
      (object) =>
        !ID.test(String(object?.objectId)) ||
        !/^[a-z_]{1,64}$/.test(String(object?.objectKind)),
    )
  )
    throw new Error("Fleet workspace inventory response is invalid");
  return { ...item, objects: item.objects.map((object) => ({ ...object })) };
}

function pairingPeer(
  advertisement: SignedDeviceAdvertisement,
  metadata: DeviceMetadata,
  identity?: DeviceIdentity,
): DevicePairingPeerRecord {
  return {
    deviceId: identity?.deviceId ?? advertisement.device.fingerprintSha256,
    ...(identity ? { signingPublicKey: identity.signingPublicKey } : {}),
    ...(identity ? { device: { ...identity } } : {}),
    fingerprintSha256: identity
      ? fingerprint(identity)
      : advertisement.device.fingerprintSha256,
    metadata: { ...metadata },
    endpoint: advertisement.endpoint,
    certificateFingerprintSha256:
      advertisement.device.fingerprintSha256,
    capabilities: [],
  };
}

function assertAdvertIdentity(
  advertisement: SignedDeviceAdvertisement,
  identity: DeviceIdentity,
  fabric: Pick<DeviceFabricService, "verifySigningKey">,
): void {
  if (
    !verifySignedAdvertisement(
      advertisement,
      fabric,
      identity.signingPublicKey,
    )
  )
    throw new Error("Pairing identity does not match discovery fingerprint");
}

function validateTrustedPresenceRequest(
  input: unknown,
  fabric: DeviceFabricService,
): { request: TrustedPresenceRequest; requesterRevoked: boolean } {
  const item = input as TrustedPresenceRequest,
    sentAt = Date.parse(String(item?.sentAt)),
    peer = fabric
      .trustedDevices(true, true)
      .find((record) => record.device.deviceId === item?.requesterDeviceId),
    unsigned = {
      version: item?.version,
      requesterDeviceId: item?.requesterDeviceId,
      nonce: item?.nonce,
      sentAt: item?.sentAt,
    } as Omit<TrustedPresenceRequest, "signature">;
  if (
    item?.version !== 1 ||
    !peer ||
    !ID.test(String(item.requesterDeviceId)) ||
    !ID.test(String(item.nonce)) ||
    !Number.isFinite(sentAt) ||
    Math.abs(Date.now() - sentAt) > 15_000 ||
    !validSignature(item.signature) ||
    !fabric.verify(
      trustedPresenceRequestPayload(unsigned),
      item.signature,
      peer.device,
    )
  )
    throw new Error("Trusted presence request is invalid");
  return {
    request: { ...unsigned, signature: item.signature },
    requesterRevoked: Boolean(peer.revokedAt),
  };
}

function validateTrustedPresenceResponse(
  item: TrustedPresenceResponse,
  request: TrustedPresenceRequest,
  peer: DeviceIdentity,
  fabric: DeviceFabricService,
): void {
  const sentAt = Date.parse(String(item?.sentAt)),
    expiresAt = Date.parse(String(item?.expiresAt)),
    unsigned = {
      version: item?.version,
      deviceId: item?.deviceId,
      nonce: item?.nonce,
      sentAt: item?.sentAt,
      expiresAt: item?.expiresAt,
      requesterRevoked: item?.requesterRevoked,
      architecture: item?.architecture,
      pauseWork: item?.pauseWork,
      pauseSync: item?.pauseSync,
      capabilities: item?.capabilities,
      runningJobs: item?.runningJobs,
      attentionItems: item?.attentionItems,
    } as Omit<TrustedPresenceResponse, "signature">;
  if (
    item?.version !== 1 ||
    item.deviceId !== peer.deviceId ||
    item.nonce !== request.nonce ||
    !Number.isFinite(sentAt) ||
    !Number.isFinite(expiresAt) ||
    Math.abs(Date.now() - sentAt) > 15_000 ||
    expiresAt <= Date.now() ||
    expiresAt - sentAt > 15_000 ||
    typeof item.requesterRevoked !== "boolean" ||
    !validOperationalPresence(item) ||
    !validSignature(item.signature) ||
    !fabric.verify(
      trustedPresenceResponsePayload(unsigned),
      item.signature,
      peer,
    )
  )
    throw new Error("Trusted presence response is invalid");
}

function validDeviceMetadata(value: unknown): value is DeviceMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<DeviceMetadata>;
  return (
    typeof item.displayName === "string" &&
    item.displayName.trim().length > 0 &&
    item.displayName.length <= 120 &&
    ["darwin", "win32", "linux", "unknown"].includes(String(item.platform)) &&
    /^[A-Za-z0-9.+_-]{1,64}$/.test(String(item.architecture)) &&
    /^[A-Za-z0-9.+_-]{1,64}$/.test(String(item.appVersion))
  );
}

const TRUSTED_CAPABILITIES = new Set([
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
]);

function validOperationalPresence(value: unknown): boolean {
  const item = value as Partial<TrustedPresenceResponse>;
  if (item.requesterRevoked)
    return (
      item.architecture === undefined &&
      item.pauseWork === undefined &&
      item.pauseSync === undefined &&
      item.capabilities === undefined &&
      item.runningJobs === undefined &&
      item.attentionItems === undefined
    );
  return (
    typeof item.architecture === "string" &&
    /^[A-Za-z0-9.+_-]{1,64}$/.test(item.architecture) &&
    typeof item.pauseWork === "boolean" &&
    typeof item.pauseSync === "boolean" &&
    Array.isArray(item.capabilities) &&
    item.capabilities.length <= 16 &&
    new Set(item.capabilities).size === item.capabilities.length &&
    item.capabilities.every(
      (capability) =>
        typeof capability === "string" &&
        TRUSTED_CAPABILITIES.has(capability),
    ) &&
    Number.isSafeInteger(item.runningJobs) &&
    Number(item.runningJobs) >= 0 &&
    Number(item.runningJobs) <= 1_000 &&
    Number.isSafeInteger(item.attentionItems) &&
    Number(item.attentionItems) >= 0 &&
    Number(item.attentionItems) <= 1_000
  );
}

function validDeviceIdentity(value: unknown): value is DeviceIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<DeviceIdentity>;
  return (
    ID.test(String(item.deviceId)) &&
    validBase64(item.signingPublicKey, 32) &&
    validBase64(item.encryptionPublicKey, 32)
  );
}

function fingerprint(identity: DeviceIdentity): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        identity.deviceId,
        identity.signingPublicKey,
        identity.encryptionPublicKey,
      ]),
    )
    .digest("hex");
}
function pairingCode(
  sessionId: string,
  requesterNonce: string,
  responderNonce: string,
  requesterFingerprint: string,
  responderFingerprint: string,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "waypoint-pair-v1",
        sessionId,
        requesterNonce,
        responderNonce,
        requesterFingerprint,
        responderFingerprint,
      ]),
    )
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}
function codeDigest(code: string): string {
  return createHash("sha256").update(`waypoint-pair-v1:${code}`).digest("hex");
}
function validSignature(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return Buffer.from(value, "base64").byteLength === 64;
  } catch {
    return false;
  }
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
function validExpiry(value: unknown): value is string {
  const expires = Date.parse(String(value));
  return (
    Number.isFinite(expires) &&
    expires > Date.now() &&
    expires <= Date.now() + PAIR_TTL_MS + 5_000
  );
}

async function requestPinnedJson<T>(
  url: string,
  expectedFingerprint: string,
  body: unknown,
  additionalHeaders: Record<string, string> = {},
  maxResponseBytes = MAX_RESPONSE_BODY,
): Promise<T> {
  if (!SHA256.test(expectedFingerprint))
    throw new Error("Invalid pinned device certificate");
  const payload = Buffer.from(
    typeof body === "string" ? body : JSON.stringify(body),
  );
  return new Promise<T>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "POST",
        agent: false,
        rejectUnauthorized: false,
        headers: {
          "content-type": "application/json",
          "content-length": payload.byteLength,
          ...additionalHeaders,
        },
        timeout: 10_000,
      },
      async (response) => {
        try {
          const bytes = await readBytes(response, maxResponseBytes);
          if ((response.statusCode ?? 500) >= 300) {
            const failure = JSON.parse(bytes.toString()) as {
              error?: string;
              code?: string;
            };
            const error = new Error(
              String(failure.error ?? "Device Host rejected the request"),
            );
            Object.assign(error, {
              statusCode: response.statusCode ?? 500,
              ...(failure.code ? { deviceCode: failure.code } : {}),
            });
            throw error;
          }
          resolve(JSON.parse(bytes.toString()) as T);
        } catch (error) {
          reject(error);
        }
      },
    );
    request.once("error", reject);
    request.once("timeout", () =>
      request.destroy(new Error("Device Host timed out")),
    );
    request.once("socket", (socket) => {
      const tls = socket as TLSSocket;
      tls.once("secureConnect", () => {
        const raw = tls.getPeerCertificate(true).raw as Buffer | undefined,
          actual = raw ? createHash("sha256").update(raw).digest("hex") : "";
        if (actual !== expectedFingerprint) {
          request.destroy(new Error("Pinned device certificate mismatch"));
          return;
        }
        request.end(payload);
      });
    });
  });
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("Invalid JSON request");
  }
}
export function readBytes(
  stream: NodeJS.ReadableStream,
  limit = MAX_BODY,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0,
      settled = false;
    const onData = (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.byteLength;
      if (bytes > limit) {
        settled = true;
        chunks.length = 0;
        stream.removeListener("data", onData);
        reject(new Error("Device Host request is too large"));
        const destroy = (stream as NodeJS.ReadableStream & {
          destroy?: (error?: Error) => void;
        }).destroy;
        if (typeof destroy === "function")
          destroy.call(stream, new Error("Device Host request is too large"));
        else if (typeof stream.resume === "function") stream.resume();
        return;
      }
      chunks.push(Buffer.from(chunk));
    };
    stream.on("data", onData);
    stream.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    stream.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export function isAllowedLanRequest(
  remoteAddress: string | undefined,
  interfaces = networkInterfaces(),
): boolean {
  const normalized = normalizedRemoteAddress(remoteAddress ?? "");
  if (normalized === "127.0.0.1") return true;
  let remote: number;
  try {
    remote = ipv4Number(normalized);
  } catch {
    return false;
  }
  if (!isPrivateIpv4(normalized)) return false;
  for (const item of Object.values(interfaces).flatMap((entries) => entries ?? [])) {
    if (
      item.family !== "IPv4" ||
      item.internal ||
      !isPrivateIpv4(item.address)
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

export function validHostBindAddress(value: string): boolean {
  const normalized = normalizedRemoteAddress(value);
  return normalized === "127.0.0.1" || isPrivateIpv4(normalized);
}

function normalizedRemoteAddress(value: string): string {
  if (value === "::1") return "127.0.0.1";
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  return (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31))
  );
}

function ipv4Number(value: string): number {
  const parts = value.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    throw new Error("Invalid IPv4 address");
  return (
    ((parts[0] << 24) >>> 0) +
    (parts[1] << 16) +
    (parts[2] << 8) +
    parts[3]
  );
}
function listen(
  server: HttpsServer,
  host: string,
  port: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve((server.address() as { port: number }).port);
    });
  });
}
function close(server: HttpsServer): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
