import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopSyncService } from "./desktop-sync-service.js";
import { PeerHostRuntime } from "./peer-host-runtime.js";
import {
  ProtectedSyncVault,
  type SecretProtector,
} from "./protected-sync-vault.js";

const protector: SecretProtector = {
  available: () => true,
  encrypt: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a),
  decrypt: (value) =>
    Buffer.from(value)
      .map((byte) => byte ^ 0x5a)
      .toString(),
};

describe("desktop peer host", () => {
  it("enrolls a second isolated identity without the hosted relay and preserves its pin across restart", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-peer-host-")),
      ownerVault = new ProtectedSyncVault(
        path.join(root, "owner-secrets"),
        protector,
      ),
      peerVault = new ProtectedSyncVault(
        path.join(root, "peer-secrets"),
        protector,
      ),
      runtime = new PeerHostRuntime(path.join(root, "runtime"), ownerVault),
      owner = await DesktopSyncService.create(ownerVault, runtime),
      peer = await DesktopSyncService.create(peerVault);
    owner.initializeOwner("workspace_peer_host_01");
    const firstStart = owner.startPeerHost(
        "workspace_peer_host_01",
        "127.0.0.1",
      ),
      competingStart = owner.startPeerHost(
        "workspace_peer_host_01",
        "127.0.0.1",
      ),
      started = await firstStart;
    await expect(competingStart).rejects.toThrow(/already running/);
    expect(started.endpoint).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
    const invitation = await owner.createInvitation("workspace_peer_host_01"),
      submitted = await peer.submitEnrollment(invitation.token);
    expect(submitted.status).toBe("pending");
    const uncertain = peerVault.loadPending("workspace_peer_host_01")!;
    peerVault.savePending({
      ...uncertain,
      submission: { ...uncertain.submission!, status: "prepared" },
    });
    const resumed = await peer.submitEnrollment(invitation.token);
    expect(resumed.requestId).toBe(submitted.requestId);
    expect(
      peerVault.loadPending("workspace_peer_host_01")!.submission?.status,
    ).toBe("submitted");
    expect(
      (await owner.pendingEnrollments("workspace_peer_host_01")).map(
        (item) => item.requestId,
      ),
    ).toContain(submitted.requestId);
    await owner.approveEnrollment(
      "workspace_peer_host_01",
      submitted.requestId,
    );
    const completionPending = peerVault.loadPending("workspace_peer_host_01")!;
    await peer.completeEnrollment("workspace_peer_host_01");
    peerVault.remove("workspace_peer_host_01");
    peerVault.savePending(completionPending);
    expect(peer.status("workspace_peer_host_01")).toMatchObject({
      configured: false,
      pendingEnrollment: true,
    });
    await peer.completeEnrollment("workspace_peer_host_01");
    await expect(peer.submitEnrollment(invitation.token)).rejects.toThrow(
      /already sync-configured/,
    );
    expect(
      (await owner.devices("workspace_peer_host_01")).filter(
        (item) => item.status === "active",
      ),
    ).toHaveLength(2);
    const firstPin = ownerVault.load("workspace_peer_host_01")!.transport;
    await owner.stopPeerHost("workspace_peer_host_01");
    await expect(
      owner.createInvitation(
        "workspace_peer_host_01",
        AbortSignal.abort("fixture canceled"),
      ),
    ).rejects.toThrow(/did not respond in time/);
    const stoppedChannels = await owner.webhookChannels(
      "workspace_peer_host_01",
    );
    expect(stoppedChannels).toMatchObject({
      reachable: false,
      managementState: "unknown",
      killSwitch: null,
      certificatePem:
        firstPin?.mode === "desktop-host" ? firstPin.certificatePem : undefined,
      fingerprintSha256: started.fingerprintSha256,
    });
    await expect(owner.devices("workspace_peer_host_01")).rejects.toThrow();
    const restarted = await owner.startPeerHost(
      "workspace_peer_host_01",
      "127.0.0.1",
    );
    expect(restarted.descriptor.certificatePem).toBe(
      firstPin?.mode === "desktop-host" ? firstPin.certificatePem : "",
    );
    expect(restarted.endpoint).toBe(started.endpoint);
    expect(
      (await peer.devices("workspace_peer_host_01")).filter(
        (item) => item.status === "active",
      ),
    ).toHaveLength(2);
    await owner.stopPeerHost("workspace_peer_host_01");
    await peer.leave("workspace_peer_host_01");
    expect(peer.status("workspace_peer_host_01")).toMatchObject({
      configured: false,
      pendingEnrollment: false,
    });
    expect(peerVault.load("workspace_peer_host_01")).toBeUndefined();
  });
});
