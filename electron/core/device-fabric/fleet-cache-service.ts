import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { syncDirectoryDurably, syncFileDurably } from "../durable-fs.js";
import type { SecretProtector } from "../sync/protected-sync-vault.js";

const ID = /^[A-Za-z0-9_-]{16,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_OBJECT_BYTES = 10 * 1024 * 1024;
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_OBJECTS = 4_096;

export interface FleetWorkspaceGrant {
  workspaceId: string;
  sourceDeviceId: string;
  keyEpoch: number;
  workspaceKey: string;
  grantedAt: string;
}

export interface FleetEncryptedObject {
  version: 1;
  sourceDeviceId: string;
  workspaceId: string;
  objectId: string;
  objectKind: string;
  revisionId?: string;
  keyEpoch: number;
  updatedAt: string;
  plaintextSha256: string;
  bytes: number;
  nonce: string;
  ciphertext: string;
  authTag: string;
}

interface CachedObject extends FleetEncryptedObject {
  cachedAt: string;
  lastOpenedAt: string;
}

export interface FleetWorkspacePin {
  sourceDeviceId: string;
  workspaceId: string;
  completeWithinBounds: boolean;
  attachmentLimitBytes: number;
  omittedAttachments: number;
  pinnedAt: string;
}

export interface FleetPersistedCatalog {
  version: 1;
  deviceId: string;
  generatedAt: string;
  workspaces: Array<{
    workspaceId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    authoritativeDeviceId: string;
    keyEpoch: number;
    counts: {
      chats: number;
      documents: number;
      memories: number;
      attachments: number;
    };
  }>;
}

export interface FleetCachedSearchResult {
  sourceDeviceId: string;
  workspaceId: string;
  workspaceName: string;
  objectId: string;
  objectKind: string;
  revisionId?: string;
  title: string;
  excerpt: string;
  score: number;
  method: "cached_text";
}

export function fleetFetchFailureAction(
  error: unknown,
  hasCachedPlaintext: boolean,
): "discard" | "fallback" | "fail" {
  if (
    (error as { statusCode?: unknown })?.statusCode === 404 &&
    (error as { deviceCode?: unknown })?.deviceCode ===
      "fleet_object_not_found"
  )
    return "discard";
  return hasCachedPlaintext ? "fallback" : "fail";
}

interface FleetCacheState {
  version: 1;
  grants: FleetWorkspaceGrant[];
  pins: FleetWorkspacePin[];
  objects: CachedObject[];
  catalogs: FleetPersistedCatalog[];
  updatedAt: string;
}

function validBase64(value: unknown, bytes?: number): value is string {
  if (typeof value !== "string") return false;
  try {
    const decoded = Buffer.from(value, "base64");
    return (
      (!bytes || decoded.length === bytes) &&
      decoded.toString("base64") === value
    );
  } catch {
    return false;
  }
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}

function validateGrant(value: unknown): value is FleetWorkspaceGrant {
  const item = value as FleetWorkspaceGrant;
  return (
    Boolean(item) &&
    ID.test(String(item.workspaceId)) &&
    ID.test(String(item.sourceDeviceId)) &&
    Number.isSafeInteger(item.keyEpoch) &&
    item.keyEpoch >= 1 &&
    validBase64(item.workspaceKey, 32) &&
    timestamp(item.grantedAt)
  );
}

function validatePin(value: unknown): value is FleetWorkspacePin {
  const item = value as FleetWorkspacePin;
  return (
    Boolean(item) &&
    ID.test(String(item.sourceDeviceId)) &&
    ID.test(String(item.workspaceId)) &&
    typeof item.completeWithinBounds === "boolean" &&
    Number.isSafeInteger(item.attachmentLimitBytes) &&
    item.attachmentLimitBytes >= 0 &&
    item.attachmentLimitBytes <= MAX_OBJECT_BYTES &&
    Number.isSafeInteger(item.omittedAttachments) &&
    item.omittedAttachments >= 0 &&
    timestamp(item.pinnedAt)
  );
}

function validateCatalog(value: unknown): value is FleetPersistedCatalog {
  const item = value as FleetPersistedCatalog;
  return (
    Boolean(item) &&
    item.version === 1 &&
    ID.test(String(item.deviceId)) &&
    timestamp(item.generatedAt) &&
    Array.isArray(item.workspaces) &&
    item.workspaces.length <= 512 &&
    new Set(item.workspaces.map((workspace) => workspace.workspaceId)).size ===
      item.workspaces.length &&
    item.workspaces.every(
      (workspace) =>
        ID.test(String(workspace.workspaceId)) &&
        typeof workspace.name === "string" &&
        Boolean(workspace.name.trim()) &&
        workspace.name.length <= 120 &&
        timestamp(workspace.createdAt) &&
        timestamp(workspace.updatedAt) &&
        workspace.authoritativeDeviceId === item.deviceId &&
        Number.isSafeInteger(workspace.keyEpoch) &&
        workspace.keyEpoch >= 1 &&
        [
          workspace.counts?.chats,
          workspace.counts?.documents,
          workspace.counts?.memories,
          workspace.counts?.attachments,
        ].every(
          (count) =>
            Number.isSafeInteger(count) &&
            Number(count) >= 0 &&
            Number(count) <= 1_000_000,
        ),
    )
  );
}

export function validateFleetEncryptedObject(
  value: unknown,
): FleetEncryptedObject {
  const item = value as FleetEncryptedObject;
  if (
    !item ||
    item.version !== 1 ||
    !ID.test(String(item.sourceDeviceId)) ||
    !ID.test(String(item.workspaceId)) ||
    !ID.test(String(item.objectId)) ||
    typeof item.objectKind !== "string" ||
    !/^[a-z_]{1,64}$/.test(item.objectKind) ||
    (item.revisionId !== undefined && !ID.test(String(item.revisionId))) ||
    !Number.isSafeInteger(item.keyEpoch) ||
    item.keyEpoch < 1 ||
    !timestamp(item.updatedAt) ||
    !SHA256.test(String(item.plaintextSha256)) ||
    !Number.isSafeInteger(item.bytes) ||
    item.bytes < 0 ||
    item.bytes > MAX_OBJECT_BYTES ||
    !validBase64(item.nonce, 12) ||
    !validBase64(item.authTag, 16) ||
    !validBase64(item.ciphertext) ||
    Buffer.from(item.ciphertext, "base64").length !== item.bytes
  )
    throw new Error("Invalid encrypted fleet object");
  return { ...item };
}

function validateState(value: unknown): FleetCacheState {
  const item = value as FleetCacheState;
  if (
    !item ||
    item.version !== 1 ||
    !Array.isArray(item.grants) ||
    item.grants.length > 4_096 ||
    item.grants.some((grant) => !validateGrant(grant)) ||
    new Set(
      item.grants.map(
        (grant) => `${grant.sourceDeviceId}:${grant.workspaceId}:${grant.keyEpoch}`,
      ),
    ).size !== item.grants.length ||
    !Array.isArray(item.pins) ||
    item.pins.length > 512 ||
    item.pins.some((pin) => !validatePin(pin)) ||
    new Set(
      item.pins.map((pin) => `${pin.sourceDeviceId}:${pin.workspaceId}`),
    ).size !== item.pins.length ||
    !Array.isArray(item.objects) ||
    item.objects.length > MAX_OBJECTS ||
    item.objects.some((object) => {
      try {
        validateFleetEncryptedObject(object);
        return !timestamp(object.cachedAt) || !timestamp(object.lastOpenedAt);
      } catch {
        return true;
      }
    }) ||
    item.objects.reduce((bytes, object) => bytes + object.bytes, 0) >
      MAX_CACHE_BYTES ||
    !Array.isArray(item.catalogs) ||
    item.catalogs.length > 128 ||
    item.catalogs.some((catalog) => !validateCatalog(catalog)) ||
    new Set(item.catalogs.map((catalog) => catalog.deviceId)).size !==
      item.catalogs.length ||
    item.catalogs.reduce(
      (count, catalog) => count + catalog.workspaces.length,
      0,
    ) > 4_096 ||
    !timestamp(item.updatedAt)
  )
    throw new Error("Invalid protected fleet cache state");
  return item;
}

function associatedData(value: {
  sourceDeviceId: string;
  workspaceId: string;
  objectId: string;
  objectKind: string;
  revisionId?: string;
  keyEpoch: number;
  updatedAt: string;
}): Buffer {
  return Buffer.from(
    JSON.stringify([
      1,
      value.sourceDeviceId,
      value.workspaceId,
      value.objectId,
      value.objectKind,
      value.revisionId ?? "",
      value.keyEpoch,
      value.updatedAt,
    ]),
  );
}

function validatePlaintextProvenance(
  plaintext: Buffer,
  envelope: FleetEncryptedObject,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("Fleet object plaintext is invalid");
  }
  const item = parsed as {
    version?: unknown;
    sourceDeviceId?: unknown;
    workspace?: { id?: unknown; name?: unknown };
    objectKind?: unknown;
    object?: { id?: unknown; revisionId?: unknown };
  };
  if (
    item?.version !== 1 ||
    item.sourceDeviceId !== envelope.sourceDeviceId ||
    item.workspace?.id !== envelope.workspaceId ||
    typeof item.workspace?.name !== "string" ||
    !item.workspace.name.trim() ||
    item.workspace.name.length > 120 ||
    item.objectKind !== envelope.objectKind ||
    item.object?.id !== envelope.objectId ||
    (envelope.revisionId !== undefined &&
      item.object?.revisionId !== envelope.revisionId)
  )
    throw new Error("Fleet object plaintext provenance mismatch");
  return JSON.stringify(parsed);
}

export class FleetCacheService {
  private readonly file: string;
  private state: FleetCacheState;

  constructor(
    root: string,
    private readonly protector: SecretProtector,
    now = new Date(),
  ) {
    if (!protector.available())
      throw new Error("OS-protected fleet cache storage is unavailable");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.file = path.join(root, "fleet-cache.protected");
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(protector.decrypt(readFileSync(this.file))) as
          | (Omit<FleetCacheState, "catalogs"> & {
              catalogs?: FleetPersistedCatalog[];
            })
          | (Omit<FleetCacheState, "pins" | "catalogs"> & {
              pins: string[];
              catalogs?: FleetPersistedCatalog[];
            });
        this.state = validateState({
          ...parsed,
          pins:
            Array.isArray(parsed.pins) &&
            parsed.pins.every((pin) => typeof pin === "string")
              ? []
              : parsed.pins,
          catalogs: parsed.catalogs ?? [],
        });
      } catch {
        throw new Error("Protected fleet cache cannot be opened");
      }
    } else {
      this.state = {
        version: 1,
        grants: [],
        pins: [],
        objects: [],
        catalogs: [],
        updatedAt: now.toISOString(),
      };
      this.save(this.state);
    }
  }

  ensureAuthoritativeGrant(
    workspaceId: string,
    localDeviceId: string,
    now = new Date(),
  ): FleetWorkspaceGrant {
    if (!ID.test(workspaceId) || !ID.test(localDeviceId))
      throw new Error("Invalid fleet workspace authority");
    const existing = this.grant(workspaceId, localDeviceId);
    if (existing) return existing;
    const grant: FleetWorkspaceGrant = {
      workspaceId,
      sourceDeviceId: localDeviceId,
      keyEpoch: 1,
      workspaceKey: randomBytes(32).toString("base64"),
      grantedAt: now.toISOString(),
    };
    this.replaceGrant(grant, now);
    return { ...grant };
  }

  rotateAuthoritativeGrant(
    workspaceId: string,
    localDeviceId: string,
    now = new Date(),
  ): FleetWorkspaceGrant {
    const current = this.ensureAuthoritativeGrant(
        workspaceId,
        localDeviceId,
        now,
      ),
      grant: FleetWorkspaceGrant = {
        workspaceId,
        sourceDeviceId: localDeviceId,
        keyEpoch: current.keyEpoch + 1,
        workspaceKey: randomBytes(32).toString("base64"),
        grantedAt: now.toISOString(),
      };
    this.replaceGrant(grant, now);
    return { ...grant };
  }

  acceptGrant(grant: FleetWorkspaceGrant, now = new Date()): void {
    if (!validateGrant(grant)) throw new Error("Invalid fleet workspace grant");
    const current = this.grant(grant.workspaceId, grant.sourceDeviceId);
    if (current && current.keyEpoch > grant.keyEpoch)
      throw new Error("Fleet workspace grant is stale");
    if (
      current?.keyEpoch === grant.keyEpoch &&
      current.workspaceKey !== grant.workspaceKey
    )
      throw new Error("Fleet workspace grant key collision");
    this.replaceGrant({ ...grant }, now);
  }

  grant(
    workspaceId: string,
    sourceDeviceId: string,
  ): FleetWorkspaceGrant | undefined {
    const grant = this.state.grants
      .filter(
        (item) =>
          item.workspaceId === workspaceId &&
          item.sourceDeviceId === sourceDeviceId,
      )
      .sort((left, right) => right.keyEpoch - left.keyEpoch)[0];
    return grant ? { ...grant } : undefined;
  }

  encryptAuthoritativeObject(
    input: Omit<
      FleetEncryptedObject,
      | "version"
      | "keyEpoch"
      | "plaintextSha256"
      | "bytes"
      | "nonce"
      | "ciphertext"
      | "authTag"
    > & { plaintext: string },
  ): FleetEncryptedObject {
    const grant = this.ensureAuthoritativeGrant(
        input.workspaceId,
        input.sourceDeviceId,
      ),
      plaintext = Buffer.from(input.plaintext),
      nonce = randomBytes(12),
      base = {
        sourceDeviceId: input.sourceDeviceId,
        workspaceId: input.workspaceId,
        objectId: input.objectId,
        objectKind: input.objectKind,
        ...(input.revisionId ? { revisionId: input.revisionId } : {}),
        keyEpoch: grant.keyEpoch,
        updatedAt: input.updatedAt,
      },
      cipher = createCipheriv(
        "aes-256-gcm",
        Buffer.from(grant.workspaceKey, "base64"),
        nonce,
      );
    cipher.setAAD(associatedData(base));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      version: 1,
      ...base,
      plaintextSha256: createHash("sha256").update(plaintext).digest("hex"),
      bytes: ciphertext.length,
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
    };
  }

  cacheEncryptedObject(value: unknown, now = new Date()): string {
    const object = validateFleetEncryptedObject(value),
      grant = this.grant(object.workspaceId, object.sourceDeviceId);
    if (!grant || grant.keyEpoch !== object.keyEpoch)
      throw new Error("Fleet workspace key is unavailable");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(grant.workspaceKey, "base64"),
      Buffer.from(object.nonce, "base64"),
    );
    decipher.setAAD(associatedData(object));
    decipher.setAuthTag(Buffer.from(object.authTag, "base64"));
    let plaintext: Buffer;
    try {
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(object.ciphertext, "base64")),
        decipher.final(),
      ]);
    } catch {
      throw new Error("Fleet object authentication failed");
    }
    if (
      createHash("sha256").update(plaintext).digest("hex") !==
      object.plaintextSha256
    )
      throw new Error("Fleet object digest mismatch");
    const validatedPlaintext = validatePlaintextProvenance(plaintext, object),
      cached: CachedObject = {
        ...object,
        cachedAt: now.toISOString(),
        lastOpenedAt: now.toISOString(),
      },
      retained = this.state.objects.filter(
        (item) =>
          !(
            item.sourceDeviceId === object.sourceDeviceId &&
            item.workspaceId === object.workspaceId &&
            item.objectId === object.objectId
          ),
      ),
      objects = this.evict([...retained, cached]);
    this.update({ ...this.state, objects, updatedAt: now.toISOString() });
    return validatedPlaintext;
  }

  openCachedObject(
    sourceDeviceId: string,
    workspaceId: string,
    objectId: string,
    now = new Date(),
  ): string | undefined {
    const object = this.state.objects.find(
      (item) =>
        item.sourceDeviceId === sourceDeviceId &&
        item.workspaceId === workspaceId &&
        item.objectId === objectId,
    );
    if (!object) return undefined;
    const plaintext = this.decrypt(object);
    this.update({
      ...this.state,
      objects: this.state.objects.map((item) =>
        item === object ? { ...item, lastOpenedAt: now.toISOString() } : item,
      ),
      updatedAt: now.toISOString(),
    });
    return plaintext;
  }

  setPinned(
    sourceDeviceId: string,
    workspaceId: string,
    pinned: boolean,
    details: {
      completeWithinBounds?: boolean;
      attachmentLimitBytes?: number;
      omittedAttachments?: number;
    } = {},
    now = new Date(),
  ): void {
    if (!ID.test(sourceDeviceId) || !ID.test(workspaceId))
      throw new Error("Invalid fleet workspace pin");
    const retained = this.state.pins.filter(
        (pin) =>
          !(
            pin.sourceDeviceId === sourceDeviceId &&
            pin.workspaceId === workspaceId
          ),
      ),
      pins = pinned
        ? [
            ...retained,
            {
              sourceDeviceId,
              workspaceId,
              completeWithinBounds: details.completeWithinBounds ?? false,
              attachmentLimitBytes: details.attachmentLimitBytes ?? 0,
              omittedAttachments: details.omittedAttachments ?? 0,
              pinnedAt: now.toISOString(),
            },
          ]
        : retained;
    this.update({
      ...this.state,
      pins: pins.sort(
        (left, right) =>
          left.sourceDeviceId.localeCompare(right.sourceDeviceId) ||
          left.workspaceId.localeCompare(right.workspaceId),
      ),
      updatedAt: now.toISOString(),
    });
  }

  status(): {
    grants: number;
    objects: number;
    bytes: number;
    pinnedWorkspaceIds: string[];
    pins: FleetWorkspacePin[];
  } {
    return {
      grants: this.state.grants.length,
      objects: this.state.objects.length,
      bytes: this.state.objects.reduce((sum, object) => sum + object.bytes, 0),
      pinnedWorkspaceIds: [
        ...new Set(this.state.pins.map((pin) => pin.workspaceId)),
      ].sort(),
      pins: this.state.pins.map((pin) => ({ ...pin })),
    };
  }

  sourceDeviceIds(): string[] {
    return [
      ...new Set([
        ...this.state.grants.map((grant) => grant.sourceDeviceId),
        ...this.state.objects.map((object) => object.sourceDeviceId),
        ...this.state.pins.map((pin) => pin.sourceDeviceId),
        ...this.state.catalogs.map((catalog) => catalog.deviceId),
      ]),
    ].sort();
  }

  saveCatalog(catalog: FleetPersistedCatalog, now = new Date()): void {
    if (!validateCatalog(catalog)) throw new Error("Invalid fleet catalog cache");
    this.update({
      ...this.state,
      catalogs: [
        ...this.state.catalogs.filter(
          (item) => item.deviceId !== catalog.deviceId,
        ),
        structuredClone(catalog),
      ],
      updatedAt: now.toISOString(),
    });
  }

  applyCatalog(catalog: FleetPersistedCatalog, now = new Date()): void {
    if (!validateCatalog(catalog)) throw new Error("Invalid fleet catalog cache");
    const retained = new Set(
      catalog.workspaces.map((workspace) => workspace.workspaceId),
    );
    this.update({
      ...this.state,
      catalogs: [
        ...this.state.catalogs.filter(
          (item) => item.deviceId !== catalog.deviceId,
        ),
        structuredClone(catalog),
      ],
      grants: this.state.grants.filter(
        (grant) =>
          grant.sourceDeviceId !== catalog.deviceId ||
          retained.has(grant.workspaceId),
      ),
      objects: this.state.objects.filter(
        (object) =>
          object.sourceDeviceId !== catalog.deviceId ||
          retained.has(object.workspaceId),
      ),
      pins: this.state.pins.filter(
        (pin) =>
          pin.sourceDeviceId !== catalog.deviceId ||
          retained.has(pin.workspaceId),
      ),
      updatedAt: now.toISOString(),
    });
  }

  catalogs(allowedSourceDeviceIds: ReadonlySet<string>): FleetPersistedCatalog[] {
    return this.state.catalogs
      .filter((catalog) => allowedSourceDeviceIds.has(catalog.deviceId))
      .map((catalog) => structuredClone(catalog));
  }

  searchCached(
    query: string,
    allowedSourceDeviceIds: ReadonlySet<string>,
    limit = 20,
  ): FleetCachedSearchResult[] {
    const terms = query
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 20);
    if (!terms.length || limit < 1) return [];
    return this.state.objects
      .filter((object) => allowedSourceDeviceIds.has(object.sourceDeviceId))
      .flatMap((object): FleetCachedSearchResult[] => {
        let parsed: {
          workspace?: { name?: unknown };
          object?: Record<string, unknown>;
        };
        try {
          parsed = JSON.parse(this.decrypt(object)) as typeof parsed;
        } catch {
          return [];
        }
        const value = parsed.object ?? {},
          searchable = JSON.stringify(value).toLocaleLowerCase(),
          matched = terms.filter((term) => searchable.includes(term)).length;
        if (!matched) return [];
        const titleCandidate = [value.title, value.name, value.subject].find(
            (item) => typeof item === "string" && item.trim(),
          ),
          title =
            typeof titleCandidate === "string"
              ? titleCandidate.trim().slice(0, 300)
              : `${object.objectKind.replaceAll("_", " ")} ${object.objectId.slice(0, 8)}`,
          excerpt = JSON.stringify(value)
            .replace(/\s+/g, " ")
            .slice(0, 500);
        return [
          {
            sourceDeviceId: object.sourceDeviceId,
            workspaceId: object.workspaceId,
            workspaceName:
              typeof parsed.workspace?.name === "string"
                ? parsed.workspace.name
                : object.workspaceId,
            objectId: object.objectId,
            objectKind: object.objectKind,
            ...(object.revisionId ? { revisionId: object.revisionId } : {}),
            title,
            excerpt,
            score: matched / terms.length,
            method: "cached_text",
          },
        ];
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.workspaceId.localeCompare(right.workspaceId) ||
          left.objectId.localeCompare(right.objectId),
      )
      .slice(0, Math.min(limit, 50));
  }

  revokeSource(sourceDeviceId: string, now = new Date()): void {
    this.update({
      ...this.state,
      grants: this.state.grants.filter(
        (grant) => grant.sourceDeviceId !== sourceDeviceId,
      ),
      objects: this.state.objects.filter(
        (object) => object.sourceDeviceId !== sourceDeviceId,
      ),
      pins: this.state.pins.filter(
        (pin) => pin.sourceDeviceId !== sourceDeviceId,
      ),
      catalogs: this.state.catalogs.filter(
        (catalog) => catalog.deviceId !== sourceDeviceId,
      ),
      updatedAt: now.toISOString(),
    });
  }

  reconcileCatalog(
    sourceDeviceId: string,
    workspaceIds: string[],
    now = new Date(),
  ): void {
    if (!ID.test(sourceDeviceId) || workspaceIds.some((id) => !ID.test(id)))
      throw new Error("Invalid fleet catalog reconciliation");
    const retained = new Set(workspaceIds);
    this.update({
      ...this.state,
      grants: this.state.grants.filter(
        (grant) =>
          grant.sourceDeviceId !== sourceDeviceId ||
          retained.has(grant.workspaceId),
      ),
      objects: this.state.objects.filter(
        (object) =>
          object.sourceDeviceId !== sourceDeviceId ||
          retained.has(object.workspaceId),
      ),
      pins: this.state.pins.filter(
        (pin) =>
          pin.sourceDeviceId !== sourceDeviceId || retained.has(pin.workspaceId),
      ),
      updatedAt: now.toISOString(),
    });
  }

  reconcileInventory(
    sourceDeviceId: string,
    workspaceId: string,
    objectIds: string[],
    now = new Date(),
  ): void {
    if (
      !ID.test(sourceDeviceId) ||
      !ID.test(workspaceId) ||
      objectIds.some((id) => !ID.test(id))
    )
      throw new Error("Invalid fleet inventory reconciliation");
    const retained = new Set(objectIds);
    this.update({
      ...this.state,
      objects: this.state.objects.filter(
        (object) =>
          object.sourceDeviceId !== sourceDeviceId ||
          object.workspaceId !== workspaceId ||
          retained.has(object.objectId),
      ),
      updatedAt: now.toISOString(),
    });
  }

  removeCachedObject(
    sourceDeviceId: string,
    workspaceId: string,
    objectId: string,
    now = new Date(),
  ): void {
    this.update({
      ...this.state,
      objects: this.state.objects.filter(
        (object) =>
          !(
            object.sourceDeviceId === sourceDeviceId &&
            object.workspaceId === workspaceId &&
            object.objectId === objectId
          ),
      ),
      updatedAt: now.toISOString(),
    });
  }

  hasCompleteInventory(
    sourceDeviceId: string,
    workspaceId: string,
    objectIds: string[],
  ): boolean {
    const cached = new Set(
      this.state.objects
        .filter(
          (object) =>
            object.sourceDeviceId === sourceDeviceId &&
            object.workspaceId === workspaceId,
        )
        .map((object) => object.objectId),
    );
    return objectIds.every((id) => cached.has(id));
  }

  private decrypt(object: CachedObject): string {
    const grant = this.state.grants.find(
      (item) =>
        item.workspaceId === object.workspaceId &&
        item.sourceDeviceId === object.sourceDeviceId &&
        item.keyEpoch === object.keyEpoch,
    );
    if (!grant || grant.keyEpoch !== object.keyEpoch)
      throw new Error("Fleet workspace key is unavailable");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(grant.workspaceKey, "base64"),
      Buffer.from(object.nonce, "base64"),
    );
    decipher.setAAD(associatedData(object));
    decipher.setAuthTag(Buffer.from(object.authTag, "base64"));
    try {
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(object.ciphertext, "base64")),
        decipher.final(),
      ]);
      return validatePlaintextProvenance(plaintext, object);
    } catch {
      throw new Error("Fleet object authentication failed");
    }
  }

  private replaceGrant(grant: FleetWorkspaceGrant, now: Date): void {
    this.update({
      ...this.state,
      grants: [
        ...this.state.grants.filter(
          (item) =>
            !(
              item.workspaceId === grant.workspaceId &&
              item.sourceDeviceId === grant.sourceDeviceId &&
              item.keyEpoch === grant.keyEpoch
            ),
        ),
        grant,
      ],
      updatedAt: now.toISOString(),
    });
  }

  private evict(objects: CachedObject[]): CachedObject[] {
    const sorted = [...objects].sort((left, right) =>
      left.lastOpenedAt.localeCompare(right.lastOpenedAt),
    );
    let bytes = sorted.reduce((sum, object) => sum + object.bytes, 0);
    while (sorted.length > MAX_OBJECTS || bytes > MAX_CACHE_BYTES) {
      const index = sorted.findIndex(
        (object) =>
          !this.state.pins.some(
            (pin) =>
              pin.sourceDeviceId === object.sourceDeviceId &&
              pin.workspaceId === object.workspaceId,
          ),
      );
      if (index < 0) throw new Error("Pinned fleet cache capacity reached");
      bytes -= sorted[index].bytes;
      sorted.splice(index, 1);
    }
    return sorted;
  }

  private update(state: FleetCacheState): void {
    validateState(state);
    this.save(state);
    this.state = state;
  }

  private save(state: FleetCacheState): void {
    validateState(state);
    const temporary = `${this.file}.${process.pid}.${Date.now()}.partial`,
      backup = `${this.file}.backup`;
    try {
      writeFileSync(
        temporary,
        Buffer.from(this.protector.encrypt(JSON.stringify(state))),
        { flag: "wx", mode: 0o600 },
      );
      syncFileDurably(temporary);
      rmSync(backup, { force: true });
      if (existsSync(this.file)) renameSync(this.file, backup);
      try {
        renameSync(temporary, this.file);
      } catch (error) {
        if (existsSync(backup)) renameSync(backup, this.file);
        throw error;
      }
      syncDirectoryDurably(path.dirname(this.file));
      rmSync(backup, { force: true });
      syncDirectoryDurably(path.dirname(this.file));
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}
