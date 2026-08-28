import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  DeviceIdentity,
  EnrollmentApproval,
  EnrollmentConsumeProof,
  EnrollmentInvitation,
  EnrollmentRequest,
  RotationClaimProof,
} from "../../electron/core/sync/types.js";
import { WaypointCrypto } from "../../electron/core/sync/crypto.js";
import { verifyOpaqueRelayMessage } from "../../electron/core/sync/relay-adapter.js";
import sodium from "libsodium-wrappers-sumo";
import type { OpaqueRelayMessage, RelayAuthority } from "./types.js";

const now = () => new Date().toISOString(),
  hash = (value: string) => createHash("sha256").update(value).digest("hex"),
  ID = /^[A-Za-z0-9_-]{16,128}$/;
export class RelayAuthorityStore implements RelayAuthority {
  private constructor(
    private readonly db: DatabaseSync,
    private readonly crypto: WaypointCrypto,
  ) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS relay_workspaces(workspace_id TEXT PRIMARY KEY,key_epoch INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS relay_devices(workspace_id TEXT NOT NULL,device_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','peer')),signing_public_key TEXT NOT NULL UNIQUE,encryption_public_key TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','revoked')),enrolled_at TEXT NOT NULL,revoked_at TEXT,PRIMARY KEY(workspace_id,device_id));CREATE TABLE IF NOT EXISTS relay_invitations(invitation_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,secret_hash TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT,request_json TEXT);CREATE TABLE IF NOT EXISTS relay_enrollment_approvals(request_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,device_id TEXT NOT NULL,approval_json TEXT NOT NULL,wrapped_workspace_key TEXT NOT NULL,consumed_at TEXT);CREATE TABLE IF NOT EXISTS relay_rotations(workspace_id TEXT PRIMARY KEY,target_epoch INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('wrapping','ready')),created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS relay_rotation_wraps(workspace_id TEXT NOT NULL,target_epoch INTEGER NOT NULL,device_id TEXT NOT NULL,wrapped_workspace_key TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(workspace_id,target_epoch,device_id));`,
    );
  }
  static async open(databasePath: string): Promise<RelayAuthorityStore> {
    await sodium.ready;
    return new RelayAuthorityStore(
      new DatabaseSync(databasePath),
      await WaypointCrypto.create(),
    );
  }
  close() {
    this.db.close();
  }
  seedWorkspace(
    workspaceId: string,
    keyEpoch: number,
    devices: Array<
      DeviceIdentity & { role: "owner" | "peer"; active: boolean }
    >,
  ) {
    if (this.epoch(workspaceId)) return;
    if (
      !ID.test(workspaceId) ||
      !Number.isSafeInteger(keyEpoch) ||
      keyEpoch < 1 ||
      devices.filter((item) => item.role === "owner" && item.active).length !==
        1
    )
      throw new Error("Invalid authority seed");
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO relay_workspaces VALUES (?,?)")
        .run(workspaceId, keyEpoch);
      for (const device of devices) {
        if (
          !ID.test(device.deviceId) ||
          !validPublicKey(device.signingPublicKey) ||
          !validPublicKey(device.encryptionPublicKey)
        )
          throw new Error("Invalid authority seed device");
        this.db
          .prepare("INSERT INTO relay_devices VALUES (?,?,?,?,?,?,?,?)")
          .run(
            workspaceId,
            device.deviceId,
            device.role,
            device.signingPublicKey,
            device.encryptionPublicKey,
            device.active ? "active" : "revoked",
            now(),
            device.active ? null : now(),
          );
      }
    });
  }
  bootstrapOwner(workspaceId: string, owner: DeviceIdentity) {
    if (!ID.test(workspaceId) || !ID.test(owner.deviceId))
      throw new Error("Invalid bootstrap identity");
    this.transaction(() => {
      if (
        this.db
          .prepare("SELECT 1 FROM relay_workspaces WHERE workspace_id=?")
          .get(workspaceId)
      )
        throw new Error("Workspace authority already exists");
      this.db
        .prepare("INSERT INTO relay_workspaces VALUES (?,1)")
        .run(workspaceId);
      this.db
        .prepare(
          "INSERT INTO relay_devices VALUES (?,?, 'owner',?,?, 'active',?,NULL)",
        )
        .run(
          workspaceId,
          owner.deviceId,
          owner.signingPublicKey,
          owner.encryptionPublicKey,
          now(),
        );
    });
  }
  registerInvitation(invitation: EnrollmentInvitation) {
    const owner = this.requireOwner(
        invitation.workspaceId,
        invitation.ownerDeviceId,
      ),
      expiry = Date.parse(invitation.expiresAt);
    if (
      invitation.membershipEpoch !== this.epoch(invitation.workspaceId) ||
      !this.crypto.verifyEnrollmentInvitation(invitation, owner) ||
      !Number.isFinite(expiry)
    )
      throw new Error("Invitation signature or authority is invalid");
    this.db
      .prepare("INSERT INTO relay_invitations VALUES (?,?,?,?,NULL,NULL)")
      .run(
        invitation.invitationId,
        invitation.workspaceId,
        invitation.secretHash,
        invitation.expiresAt,
      );
    return invitation;
  }
  submitEnrollment(
    invitationId: string,
    secret: string,
    request: EnrollmentRequest,
    at = new Date(),
  ) {
    this.transaction(() => {
      const invite = this.db
          .prepare("SELECT * FROM relay_invitations WHERE invitation_id=?")
          .get(invitationId) as Record<string, unknown> | undefined,
        exactRetry =
          invite?.consumed_at &&
          String(invite.workspace_id) === request.workspaceId &&
          String(invite.secret_hash) === hash(secret) &&
          String(invite.request_json) === JSON.stringify(request);
      if (exactRetry) return;
      if (!this.crypto.verifyEnrollmentRequest(request, at))
        throw new Error("Enrollment request is invalid or expired");
      if (
        !invite ||
        invite.consumed_at ||
        String(invite.workspace_id) !== request.workspaceId ||
        String(invite.secret_hash) !== hash(secret) ||
        Date.parse(String(invite.expires_at)) <= at.getTime()
      )
        throw new Error("Invitation is invalid, expired, or consumed");
      const prior = this.db
        .prepare(
          "SELECT status,signing_public_key,encryption_public_key FROM relay_devices WHERE workspace_id=? AND device_id=?",
        )
        .get(request.workspaceId, request.device.deviceId) as
        Record<string, unknown> | undefined;
      if (prior)
        throw new Error(
          String(prior.status) === "revoked"
            ? "Revoked identity requires a fresh device identity"
            : "Device identity is already enrolled",
        );
      this.db
        .prepare(
          "UPDATE relay_invitations SET consumed_at=?,request_json=? WHERE invitation_id=? AND consumed_at IS NULL",
        )
        .run(at.toISOString(), JSON.stringify(request), invitationId);
    });
    return { requestId: request.requestId, status: "pending" as const };
  }
  pendingEnrollments(
    workspaceId: string,
    ownerDeviceId: string,
  ): EnrollmentRequest[] {
    this.requireOwner(workspaceId, ownerDeviceId);
    return (
      this.db
        .prepare(
          "SELECT request_json FROM relay_invitations WHERE workspace_id=? AND request_json IS NOT NULL",
        )
        .all(workspaceId) as Array<{ request_json: string }>
    )
      .map((row) => JSON.parse(row.request_json) as EnrollmentRequest)
      .filter(
        (request) =>
          !this.db
            .prepare(
              "SELECT 1 FROM relay_enrollment_approvals WHERE request_id=?",
            )
            .get(request.requestId),
      );
  }
  approveEnrollment(
    workspaceId: string,
    ownerDeviceId: string,
    approval: EnrollmentApproval,
    wrappedWorkspaceKey: string,
  ) {
    const owner = this.requireOwner(workspaceId, ownerDeviceId),
      row = this.db
        .prepare(
          "SELECT request_json FROM relay_invitations WHERE workspace_id=? AND request_json IS NOT NULL",
        )
        .all(workspaceId)
        .map(
          (item) =>
            JSON.parse(
              String((item as { request_json: string }).request_json),
            ) as EnrollmentRequest,
        )
        .find((request) => request.requestId === approval.requestId),
      keyDigest = row
        ? hash(
            JSON.stringify([
              row.device.deviceId,
              row.device.signingPublicKey,
              row.device.encryptionPublicKey,
            ]),
          )
        : "";
    if (
      !row ||
      approval.workspaceId !== workspaceId ||
      approval.ownerDeviceId !== ownerDeviceId ||
      approval.membershipEpoch !== this.epoch(workspaceId) ||
      approval.deviceKeyDigest !== keyDigest ||
      approval.wrappedWorkspaceKeyDigest !== hash(wrappedWorkspaceKey) ||
      !this.crypto.verifyEnrollmentApproval(approval, owner) ||
      !validWrappedKey(wrappedWorkspaceKey)
    )
      throw new Error("Enrollment approval is invalid");
    this.db
      .prepare("INSERT INTO relay_enrollment_approvals VALUES (?,?,?,?,?,NULL)")
      .run(
        approval.requestId,
        workspaceId,
        row.device.deviceId,
        JSON.stringify(approval),
        wrappedWorkspaceKey,
      );
    return { requestId: approval.requestId, status: "approved" as const };
  }
  enrollmentApproval(requestId: string) {
    const row = this.db
      .prepare(
        "SELECT approval_json FROM relay_enrollment_approvals WHERE request_id=?",
      )
      .get(requestId) as { approval_json: string } | undefined;
    return row
      ? (JSON.parse(row.approval_json) as EnrollmentApproval)
      : undefined;
  }
  consumeApproval(proof: EnrollmentConsumeProof) {
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM relay_enrollment_approvals WHERE request_id=?")
        .get(proof.requestId) as Record<string, unknown> | undefined;
      if (!row || String(row.device_id) !== proof.deviceId)
        throw new Error("Enrollment approval is unavailable");
      const requestRow = this.db
        .prepare(
          "SELECT request_json FROM relay_invitations WHERE json_extract(request_json,'$.requestId')=?",
        )
        .get(proof.requestId) as { request_json: string } | undefined;
      if (!requestRow) throw new Error("Enrollment request is unavailable");
      const request = JSON.parse(requestRow.request_json) as EnrollmentRequest,
        approval = JSON.parse(String(row.approval_json)) as EnrollmentApproval;
      if (
        !this.crypto.verifyEnrollmentConsumeProof(
          proof,
          request.device,
          approval,
        )
      )
        throw new Error("Fresh enrollment proof of possession is invalid");
      if (
        !row.consumed_at &&
        approval.membershipEpoch !== this.epoch(request.workspaceId)
      )
        throw new Error("Enrollment approval key epoch is stale");
      if (row.consumed_at) {
        const active = this.db
          .prepare(
            "SELECT signing_public_key signingPublicKey,encryption_public_key encryptionPublicKey FROM relay_devices WHERE workspace_id=? AND device_id=? AND status='active'",
          )
          .get(request.workspaceId, request.device.deviceId) as
          { signingPublicKey: string; encryptionPublicKey: string } | undefined;
        if (
          !active ||
          active.signingPublicKey !== request.device.signingPublicKey ||
          active.encryptionPublicKey !== request.device.encryptionPublicKey
        )
          throw new Error("Consumed enrollment authority mismatch");
      } else {
        this.db
          .prepare(
            "INSERT INTO relay_devices VALUES (?,?, 'peer',?,?, 'active',?,NULL)",
          )
          .run(
            request.workspaceId,
            request.device.deviceId,
            request.device.signingPublicKey,
            request.device.encryptionPublicKey,
            now(),
          );
        this.db
          .prepare(
            "UPDATE relay_enrollment_approvals SET consumed_at=? WHERE request_id=?",
          )
          .run(now(), proof.requestId);
      }
      return {
        approval,
        wrappedWorkspaceKey: String(row.wrapped_workspace_key),
        keyEpoch: approval.membershipEpoch,
      };
    });
  }
  listDevices(workspaceId: string, requesterDeviceId: string) {
    this.requireActive(workspaceId, requesterDeviceId);
    return this.db
      .prepare(
        "SELECT device_id deviceId,role,status,signing_public_key signingPublicKey,encryption_public_key encryptionPublicKey,enrolled_at enrolledAt,revoked_at revokedAt FROM relay_devices WHERE workspace_id=? ORDER BY enrolled_at",
      )
      .all(workspaceId);
  }
  isOwner(workspaceId: string, deviceId: string) {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM relay_devices WHERE workspace_id=? AND device_id=? AND role='owner' AND status='active'",
        )
        .get(workspaceId, deviceId),
    );
  }
  revoke(workspaceId: string, ownerDeviceId: string, deviceId: string) {
    this.requireOwner(workspaceId, ownerDeviceId);
    if (deviceId === ownerDeviceId)
      throw new Error("Owner self-revocation requires workspace teardown");
    const result = this.db
      .prepare(
        "UPDATE relay_devices SET status='revoked',revoked_at=? WHERE workspace_id=? AND device_id=? AND status='active'",
      )
      .run(now(), workspaceId, deviceId);
    if (!result.changes) throw new Error("Active peer device not found");
    return { deviceId, status: "revoked" as const };
  }
  beginRotation(workspaceId: string, ownerDeviceId: string) {
    this.requireOwner(workspaceId, ownerDeviceId);
    const existing = this.rotationStatus(workspaceId, ownerDeviceId);
    if (existing?.status === "wrapping")
      return {
        workspaceId,
        targetEpoch: existing.targetEpoch,
        status: "wrapping" as const,
      };
    if (
      existing?.status === "ready" &&
      this.hasUndrainedPreviousEpoch(workspaceId)
    )
      throw new Error(
        "Previous key epoch messages must drain before another rotation",
      );
    const targetEpoch = this.epoch(workspaceId) + 1;
    this.db
      .prepare(
        "INSERT INTO relay_rotations VALUES (?,?,'wrapping',?) ON CONFLICT(workspace_id) DO UPDATE SET target_epoch=excluded.target_epoch,status='wrapping',created_at=excluded.created_at",
      )
      .run(workspaceId, targetEpoch, now());
    this.db
      .prepare("DELETE FROM relay_rotation_wraps WHERE workspace_id=?")
      .run(workspaceId);
    return { workspaceId, targetEpoch, status: "wrapping" as const };
  }
  recordRotationWrap(
    workspaceId: string,
    ownerDeviceId: string,
    targetEpoch: number,
    deviceId: string,
    wrappedWorkspaceKey: string,
  ) {
    this.requireOwner(workspaceId, ownerDeviceId);
    const rotation = this.db
      .prepare("SELECT target_epoch FROM relay_rotations WHERE workspace_id=?")
      .get(workspaceId) as { target_epoch: number } | undefined;
    if (
      rotation?.target_epoch !== targetEpoch ||
      !this.db
        .prepare(
          "SELECT 1 FROM relay_devices WHERE workspace_id=? AND device_id=? AND status='active'",
        )
        .get(workspaceId, deviceId) ||
      !validWrappedKey(wrappedWorkspaceKey)
    )
      throw new Error("Rotation wrap is invalid");
    this.db
      .prepare(
        "INSERT INTO relay_rotation_wraps VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,target_epoch,device_id) DO UPDATE SET wrapped_workspace_key=excluded.wrapped_workspace_key,created_at=excluded.created_at",
      )
      .run(workspaceId, targetEpoch, deviceId, wrappedWorkspaceKey, now());
    return this.rotationStatus(workspaceId, ownerDeviceId);
  }
  rotationStatus(workspaceId: string, requesterDeviceId: string) {
    this.requireActive(workspaceId, requesterDeviceId);
    const rotation = this.db
      .prepare(
        "SELECT target_epoch targetEpoch,status FROM relay_rotations WHERE workspace_id=?",
      )
      .get(workspaceId) as { targetEpoch: number; status: string } | undefined;
    if (!rotation) return undefined;
    const devices = this.db
        .prepare(
          "SELECT device_id deviceId FROM relay_devices WHERE workspace_id=? AND status='active' ORDER BY device_id",
        )
        .all(workspaceId) as Array<{ deviceId: string }>,
      wrapped = new Set(
        (
          this.db
            .prepare(
              "SELECT device_id deviceId FROM relay_rotation_wraps WHERE workspace_id=? AND target_epoch=?",
            )
            .all(workspaceId, rotation.targetEpoch) as Array<{
            deviceId: string;
          }>
        ).map((item) => item.deviceId),
      );
    return {
      ...rotation,
      pendingDeviceIds: devices
        .filter((item) => !wrapped.has(item.deviceId))
        .map((item) => item.deviceId),
      wrappedDeviceIds: devices
        .filter((item) => wrapped.has(item.deviceId))
        .map((item) => item.deviceId),
    };
  }
  commitRotation(workspaceId: string, ownerDeviceId: string) {
    const status = this.rotationStatus(workspaceId, ownerDeviceId);
    if (!status || status.pendingDeviceIds.length)
      throw new Error("Rotation cannot commit with pending devices");
    this.transaction(() => {
      this.db
        .prepare("UPDATE relay_workspaces SET key_epoch=? WHERE workspace_id=?")
        .run(status.targetEpoch, workspaceId);
      this.db
        .prepare(
          "UPDATE relay_rotations SET status='ready' WHERE workspace_id=?",
        )
        .run(workspaceId);
    });
    return { keyEpoch: status.targetEpoch };
  }
  claimRotation(proof: RotationClaimProof) {
    const device = this.identity(proof.workspaceId, proof.deviceId),
      epoch = this.epoch(proof.workspaceId);
    if (
      !device ||
      proof.targetEpoch !== epoch ||
      !this.crypto.verifyRotationClaim(proof, device)
    )
      throw new Error("Rotation claim is invalid");
    const row = this.db
      .prepare(
        "SELECT wrapped_workspace_key wrappedWorkspaceKey FROM relay_rotation_wraps WHERE workspace_id=? AND target_epoch=? AND device_id=?",
      )
      .get(proof.workspaceId, epoch, proof.deviceId) as
      { wrappedWorkspaceKey: string } | undefined;
    if (!row) throw new Error("Rotation wrap is unavailable");
    return { keyEpoch: epoch, wrappedWorkspaceKey: row.wrappedWorkspaceKey };
  }
  isActive(workspaceId: string, deviceId: string, keyEpoch: number) {
    return (
      keyEpoch === this.epoch(workspaceId) &&
      Boolean(
        this.db
          .prepare(
            "SELECT 1 FROM relay_devices WHERE workspace_id=? AND device_id=? AND status='active'",
          )
          .get(workspaceId, deviceId),
      )
    );
  }
  canReadEpoch(workspaceId: string, deviceId: string, keyEpoch: number) {
    const current = this.epoch(workspaceId),
      previousAllowed = Boolean(
        this.db
          .prepare(
            "SELECT 1 FROM relay_rotations WHERE workspace_id=? AND target_epoch=? AND status='ready'",
          )
          .get(workspaceId, current),
      );
    return (
      Boolean(this.identity(workspaceId, deviceId)) &&
      (keyEpoch === current || (previousAllowed && keyEpoch === current - 1))
    );
  }
  verifySignature(message: OpaqueRelayMessage) {
    const sender = this.identity(message.workspaceId, message.senderDeviceId);
    return Boolean(
      sender && verifyOpaqueRelayMessage(message, sender, this.crypto),
    );
  }
  verifyRequest(
    workspaceId: string,
    deviceId: string,
    keyEpoch: number,
    canonical: string,
    signature: string,
  ) {
    const device = this.identity(workspaceId, deviceId);
    if (!device || !this.isActive(workspaceId, deviceId, keyEpoch))
      return false;
    try {
      return sodium.crypto_sign_verify_detached(
        sodium.from_base64(signature, sodium.base64_variants.ORIGINAL),
        sodium.from_string(canonical),
        sodium.from_base64(
          device.signingPublicKey,
          sodium.base64_variants.ORIGINAL,
        ),
      );
    } catch {
      return false;
    }
  }
  identity(workspaceId: string, deviceId: string): DeviceIdentity | undefined {
    const row = this.db
      .prepare(
        "SELECT device_id deviceId,signing_public_key signingPublicKey,encryption_public_key encryptionPublicKey FROM relay_devices WHERE workspace_id=? AND device_id=? AND status='active'",
      )
      .get(workspaceId, deviceId) as DeviceIdentity | undefined;
    return row;
  }
  private epoch(workspaceId: string) {
    return Number(
      (
        this.db
          .prepare(
            "SELECT key_epoch keyEpoch FROM relay_workspaces WHERE workspace_id=?",
          )
          .get(workspaceId) as { keyEpoch: number } | undefined
      )?.keyEpoch ?? 0,
    );
  }
  private hasUndrainedPreviousEpoch(workspaceId: string): boolean {
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='relay_messages'",
        )
        .get()
    )
      return false;
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM relay_messages WHERE workspace_id=? AND key_epoch=? LIMIT 1",
        )
        .get(workspaceId, this.epoch(workspaceId) - 1),
    );
  }
  private requireActive(workspaceId: string, deviceId: string) {
    const value = this.identity(workspaceId, deviceId);
    if (!value) throw new Error("Active device authority required");
    return value;
  }
  private requireOwner(workspaceId: string, deviceId: string) {
    const value = this.db
      .prepare(
        "SELECT device_id deviceId,signing_public_key signingPublicKey,encryption_public_key encryptionPublicKey FROM relay_devices WHERE workspace_id=? AND device_id=? AND role='owner' AND status='active'",
      )
      .get(workspaceId, deviceId) as DeviceIdentity | undefined;
    if (!value) throw new Error("Active owner authority required");
    return value;
  }
  private transaction<T>(operation: () => T) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
function validWrappedKey(value: string) {
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length >= 48 && bytes.toString("base64") === value;
  } catch {
    return false;
  }
}
function validPublicKey(value: string) {
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length === 32 && bytes.toString("base64") === value;
  } catch {
    return false;
  }
}
