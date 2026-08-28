import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { WaypointCrypto } from "../../electron/core/sync/crypto.js";
import { RelayAuthorityStore } from "./authority-store.js";

describe("durable enrollment and key authority", () => {
  it("consumes one-use enrollment, resumes the exact request, lists/revokes, and rejects identity reuse", async () => {
    const crypto = await WaypointCrypto.create(),
      db = path.join(
        mkdtempSync(path.join(tmpdir(), "waypoint-authority-")),
        "authority.sqlite",
      ),
      store = await RelayAuthorityStore.open(db),
      owner = crypto.generateDevice("opaque_owner_00001"),
      peer = crypto.generateDevice("opaque_peer_000001"),
      workspaceId = "opaque_workspace_01",
      at = new Date();
    store.bootstrapOwner(workspaceId, owner);
    const invite = crypto.createEnrollmentInvitation(
      workspaceId,
      owner,
      1,
      new Date(Date.now() + 60_000),
    );
    store.registerInvitation(invite.invitation);
    const request = crypto.createEnrollmentRequest({
      workspaceId,
      device: peer,
      now: at,
    });
    expect(
      store.submitEnrollment(
        invite.invitation.invitationId,
        invite.secret,
        request,
        at,
      ).status,
    ).toBe("pending");
    expect(
      store.submitEnrollment(
        invite.invitation.invitationId,
        invite.secret,
        request,
        at,
      ).requestId,
    ).toBe(request.requestId);
    const wrapped = crypto.wrapWorkspaceKey(
        crypto.generateWorkspaceKey(),
        peer,
      ),
      approval = crypto.approveEnrollment(request, owner, 1, at, wrapped);
    store.approveEnrollment(workspaceId, owner.deviceId, approval, wrapped);
    const proof = crypto.createEnrollmentConsumeProof(
      request,
      approval,
      peer,
      at,
    );
    expect(store.consumeApproval(proof).keyEpoch).toBe(1);
    expect(store.consumeApproval(proof).keyEpoch).toBe(1);
    expect(store.listDevices(workspaceId, peer.deviceId)).toHaveLength(2);
    store.revoke(workspaceId, owner.deviceId, peer.deviceId);
    expect(store.isActive(workspaceId, peer.deviceId, 1)).toBe(false);
    const second = crypto.createEnrollmentInvitation(
      workspaceId,
      owner,
      1,
      new Date(Date.now() + 60_000),
    );
    store.registerInvitation(second.invitation);
    expect(() =>
      store.submitEnrollment(
        second.invitation.invitationId,
        second.secret,
        crypto.createEnrollmentRequest({ workspaceId, device: peer, now: at }),
        at,
      ),
    ).toThrow("fresh");
    store.close();
  });
  it("resumes rotation and refuses cutover until every active device is wrapped", async () => {
    const crypto = await WaypointCrypto.create(),
      db = path.join(
        mkdtempSync(path.join(tmpdir(), "waypoint-rotation-")),
        "authority.sqlite",
      ),
      owner = crypto.generateDevice("opaque_owner_00001"),
      peer = crypto.generateDevice("opaque_peer_000001"),
      workspaceId = "opaque_workspace_01",
      store = await RelayAuthorityStore.open(db);
    store.bootstrapOwner(workspaceId, owner);
    const invite = crypto.createEnrollmentInvitation(
      workspaceId,
      owner,
      1,
      new Date(Date.now() + 60_000),
    );
    store.registerInvitation(invite.invitation);
    const request = crypto.createEnrollmentRequest({
      workspaceId,
      device: peer,
    });
    store.submitEnrollment(
      invite.invitation.invitationId,
      invite.secret,
      request,
    );
    const wrapped = crypto.wrapWorkspaceKey(
        crypto.generateWorkspaceKey(),
        peer,
      ),
      approval = crypto.approveEnrollment(
        request,
        owner,
        1,
        new Date(),
        wrapped,
      );
    store.approveEnrollment(workspaceId, owner.deviceId, approval, wrapped);
    store.consumeApproval(
      crypto.createEnrollmentConsumeProof(request, approval, peer),
    );
    const rotation = store.beginRotation(workspaceId, owner.deviceId),
      nextKey = crypto.generateWorkspaceKey(),
      ownerWrap = crypto.wrapWorkspaceKey(nextKey, owner),
      peerWrap = crypto.wrapWorkspaceKey(nextKey, peer);
    store.recordRotationWrap(
      workspaceId,
      owner.deviceId,
      rotation.targetEpoch,
      owner.deviceId,
      ownerWrap,
    );
    expect(store.beginRotation(workspaceId, owner.deviceId)).toEqual(rotation);
    expect(() => store.commitRotation(workspaceId, owner.deviceId)).toThrow(
      "pending",
    );
    store.close();
    const reopened = await RelayAuthorityStore.open(db);
    expect(
      reopened.rotationStatus(workspaceId, owner.deviceId)?.pendingDeviceIds,
    ).toEqual([peer.deviceId]);
    reopened.recordRotationWrap(
      workspaceId,
      owner.deviceId,
      rotation.targetEpoch,
      peer.deviceId,
      peerWrap,
    );
    expect(reopened.commitRotation(workspaceId, owner.deviceId).keyEpoch).toBe(
      2,
    );
    expect(reopened.isActive(workspaceId, peer.deviceId, 1)).toBe(false);
    expect(reopened.isActive(workspaceId, peer.deviceId, 2)).toBe(true);
    expect(reopened.canReadEpoch(workspaceId, peer.deviceId, 1)).toBe(true);
    const claim = reopened.claimRotation(
      crypto.createRotationClaim(workspaceId, 2, peer),
    );
    expect(crypto.unwrapWorkspaceKey(claim.wrappedWorkspaceKey, peer)).toBe(
      nextKey,
    );
    reopened.revoke(workspaceId, owner.deviceId, peer.deviceId);
    expect(reopened.canReadEpoch(workspaceId, peer.deviceId, 1)).toBe(false);
    expect(() =>
      reopened.claimRotation(crypto.createRotationClaim(workspaceId, 2, peer)),
    ).toThrow("invalid");
    reopened.close();
  });
  it("refuses a second rotation until previous-epoch relay messages drain", async () => {
    const crypto = await WaypointCrypto.create(),
      db = path.join(
        mkdtempSync(path.join(tmpdir(), "waypoint-rotation-drain-")),
        "authority.sqlite",
      ),
      owner = crypto.generateDevice("opaque_owner_drain1"),
      workspaceId = "opaque_workspace_drain",
      store = await RelayAuthorityStore.open(db);
    store.bootstrapOwner(workspaceId, owner);
    const first = store.beginRotation(workspaceId, owner.deviceId),
      nextKey = crypto.generateWorkspaceKey();
    store.recordRotationWrap(
      workspaceId,
      owner.deviceId,
      first.targetEpoch,
      owner.deviceId,
      crypto.wrapWorkspaceKey(nextKey, owner),
    );
    store.commitRotation(workspaceId, owner.deviceId);
    const relayDb = new DatabaseSync(db);
    relayDb.exec(
      "CREATE TABLE relay_messages(workspace_id TEXT NOT NULL,key_epoch INTEGER NOT NULL)",
    );
    relayDb
      .prepare("INSERT INTO relay_messages VALUES (?,?)")
      .run(workspaceId, 1);
    expect(() => store.beginRotation(workspaceId, owner.deviceId)).toThrow(
      "drain",
    );
    relayDb.prepare("DELETE FROM relay_messages").run();
    expect(store.beginRotation(workspaceId, owner.deviceId).targetEpoch).toBe(
      3,
    );
    relayDb.close();
    store.close();
  });

  it("rejects an unconsumed stale approval after rotation commits", async () => {
    const crypto = await WaypointCrypto.create(),
      db = path.join(
        mkdtempSync(path.join(tmpdir(), "waypoint-stale-enrollment-")),
        "authority.sqlite",
      ),
      store = await RelayAuthorityStore.open(db),
      owner = crypto.generateDevice("opaque_owner_stale01"),
      peer = crypto.generateDevice("opaque_peer_stale_01"),
      workspaceId = "opaque_workspace_stale";
    store.bootstrapOwner(workspaceId, owner);
    const invite = crypto.createEnrollmentInvitation(
        workspaceId,
        owner,
        1,
        new Date(Date.now() + 60_000),
      ),
      request = crypto.createEnrollmentRequest({ workspaceId, device: peer });
    store.registerInvitation(invite.invitation);
    store.submitEnrollment(
      invite.invitation.invitationId,
      invite.secret,
      request,
    );
    const wrapped = crypto.wrapWorkspaceKey(
        crypto.generateWorkspaceKey(),
        peer,
      ),
      approval = crypto.approveEnrollment(
        request,
        owner,
        1,
        new Date(),
        wrapped,
      );
    store.approveEnrollment(workspaceId, owner.deviceId, approval, wrapped);
    const rotation = store.beginRotation(workspaceId, owner.deviceId),
      nextKey = crypto.generateWorkspaceKey();
    store.recordRotationWrap(
      workspaceId,
      owner.deviceId,
      rotation.targetEpoch,
      owner.deviceId,
      crypto.wrapWorkspaceKey(nextKey, owner),
    );
    store.commitRotation(workspaceId, owner.deviceId);
    expect(() =>
      store.consumeApproval(
        crypto.createEnrollmentConsumeProof(request, approval, peer),
      ),
    ).toThrow(/epoch is stale/);
    store.close();
  });

  it("returns the wrapped key original epoch when consumed enrollment retries after rotation", async () => {
    const crypto = await WaypointCrypto.create(),
      db = path.join(
        mkdtempSync(path.join(tmpdir(), "waypoint-consume-retry-")),
        "authority.sqlite",
      ),
      store = await RelayAuthorityStore.open(db),
      owner = crypto.generateDevice("opaque_owner_retry01"),
      peer = crypto.generateDevice("opaque_peer_retry_01"),
      workspaceId = "opaque_workspace_retry";
    store.bootstrapOwner(workspaceId, owner);
    const invite = crypto.createEnrollmentInvitation(
        workspaceId,
        owner,
        1,
        new Date(Date.now() + 60_000),
      ),
      request = crypto.createEnrollmentRequest({ workspaceId, device: peer });
    store.registerInvitation(invite.invitation);
    store.submitEnrollment(
      invite.invitation.invitationId,
      invite.secret,
      request,
    );
    const wrapped = crypto.wrapWorkspaceKey(
        crypto.generateWorkspaceKey(),
        peer,
      ),
      approval = crypto.approveEnrollment(
        request,
        owner,
        1,
        new Date(),
        wrapped,
      ),
      proof = crypto.createEnrollmentConsumeProof(request, approval, peer);
    store.approveEnrollment(workspaceId, owner.deviceId, approval, wrapped);
    expect(store.consumeApproval(proof).keyEpoch).toBe(1);
    const rotation = store.beginRotation(workspaceId, owner.deviceId),
      nextKey = crypto.generateWorkspaceKey();
    for (const device of [owner, peer])
      store.recordRotationWrap(
        workspaceId,
        owner.deviceId,
        rotation.targetEpoch,
        device.deviceId,
        crypto.wrapWorkspaceKey(nextKey, device),
      );
    store.commitRotation(workspaceId, owner.deviceId);
    expect(store.consumeApproval(proof)).toMatchObject({ keyEpoch: 1 });
    store.close();
  });
});
