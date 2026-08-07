import {
  DesktopRelayClient,
  WAYPOINT_RELAY_ORIGIN,
} from "./desktop-relay-client.js";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { WaypointCrypto } from "./crypto.js";
import { ProtectedSyncVault } from "./protected-sync-vault.js";
import type { EnrollmentInvitation } from "./types.js";
import { DesktopSyncPump, type SyncPumpStore } from "./desktop-sync-pump.js";
import { openInboundWebhook } from "./webhook-crypto.js";
import { PeerHostRuntime } from "./peer-host-runtime.js";
import type { DesktopHostDescriptor } from "./peer-host-transport.js";

interface InvitationToken {
  invitation: EnrollmentInvitation;
  secret: string;
  transport?: { mode: "hosted-relay" } | DesktopHostDescriptor;
}
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (value: string): InvitationToken => {
  if (value.length > 8192) throw new Error("Enrollment token is too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("Enrollment token is invalid");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("invitation" in parsed) ||
    !("secret" in parsed)
  )
    throw new Error("Enrollment token is invalid");
  return parsed as InvitationToken;
};

export class DesktopSyncService {
  private constructor(
    private readonly vault: ProtectedSyncVault,
    private readonly crypto: WaypointCrypto,
    private readonly peerHost?: PeerHostRuntime,
  ) {}
  static async create(vault: ProtectedSyncVault, peerHost?: PeerHostRuntime) {
    return new DesktopSyncService(
      vault,
      await WaypointCrypto.create(),
      peerHost,
    );
  }
  initializeOwner(workspaceId: string) {
    if (this.vault.load(workspaceId))
      throw new Error("Workspace sync is already configured");
    const device = this.crypto.generateDevice(),
      workspaceKey = this.crypto.generateWorkspaceKey();
    this.vault.save({
      version: 1,
      workspaceId,
      device,
      workspaceKey,
      keyEpoch: 1,
      endpoint: WAYPOINT_RELAY_ORIGIN,
    });
    return {
      workspaceId,
      deviceId: device.deviceId,
      signingPublicKey: device.signingPublicKey,
      encryptionPublicKey: device.encryptionPublicKey,
      endpoint: WAYPOINT_RELAY_ORIGIN,
      bootstrapRequired: true,
    };
  }
  status(workspaceId: string) {
    const active = this.vault.load(workspaceId),
      pending = this.vault.loadPending(workspaceId),
      currentHost = this.peerHost?.status(),
      host = currentHost?.workspaceId === workspaceId ? currentHost : undefined;
    return active
      ? {
          configured: true,
          pendingEnrollment: false,
          deviceId: active.device.deviceId,
          keyEpoch: active.keyEpoch,
          rotationTargetEpoch: active.rotation?.targetEpoch,
          endpoint: active.endpoint,
          transportMode: active.transport?.mode ?? "hosted-relay",
          peerHost: host,
        }
      : pending
        ? {
            configured: false,
            pendingEnrollment: true,
            deviceId: pending.device.deviceId,
            keyEpoch: 0,
            endpoint: pending.endpoint,
            transportMode: pending.transport?.mode ?? "hosted-relay",
            peerHost: host,
          }
        : {
            configured: false,
            pendingEnrollment: false,
            keyEpoch: 0,
            endpoint: WAYPOINT_RELAY_ORIGIN,
            transportMode: "hosted-relay" as const,
            peerHost: host,
          };
  }
  async startPeerHost(workspaceId: string, bindAddress?: string) {
    if (!this.peerHost)
      throw new Error("Desktop hosting is unavailable in this runtime");
    const active = this.required(workspaceId),
      result = await this.peerHost.start(active, bindAddress),
      next = {
        ...active,
        endpoint: result.descriptor.endpoint,
        transport: result.descriptor,
      };
    this.vault.save(next);
    return result;
  }
  async stopPeerHost(workspaceId: string) {
    if (!this.peerHost)
      throw new Error("Desktop hosting is unavailable in this runtime");
    const status = this.peerHost.status();
    if (status.running && status.workspaceId !== workspaceId)
      throw new Error("Desktop host belongs to another workspace");
    await this.peerHost.stop();
    return this.peerHost.status();
  }
  async createInvitation(workspaceId: string) {
    const active = this.required(workspaceId),
      client = await DesktopRelayClient.create(active),
      value = this.crypto.createEnrollmentInvitation(
        workspaceId,
        active.device,
        active.keyEpoch,
        new Date(Date.now() + 15 * 60_000),
      );
    await client.registerInvitation(value.invitation);
    return {
      token: encode({ ...value, transport: active.transport }),
      expiresAt: value.invitation.expiresAt,
    };
  }
  async submitEnrollment(token: string) {
    const value = decode(token),
      device = this.crypto.generateDevice(),
      request = this.crypto.createEnrollmentRequest({
        workspaceId: value.invitation.workspaceId,
        device,
      }),
      endpoint =
        value.transport?.mode === "desktop-host"
          ? value.transport.endpoint
          : WAYPOINT_RELAY_ORIGIN,
      peer =
        value.transport?.mode === "desktop-host" ? value.transport : undefined;
    await DesktopRelayClient.submitEnrollment(
      endpoint,
      value.invitation.invitationId,
      value.secret,
      request,
      undefined,
      peer,
    );
    this.vault.savePending({
      version: 1,
      workspaceId: request.workspaceId,
      device,
      request,
      endpoint,
      transport: value.transport,
    });
    return {
      workspaceId: request.workspaceId,
      requestId: request.requestId,
      status: "pending" as const,
    };
  }
  async completeEnrollment(workspaceId: string) {
    const pending = this.vault.loadPending(workspaceId);
    if (!pending) throw new Error("No protected pending enrollment");
    const peer =
        pending.transport?.mode === "desktop-host"
          ? pending.transport
          : undefined,
      { approval } = await DesktopRelayClient.enrollmentApproval(
        pending.endpoint,
        pending.request.requestId,
        undefined,
        peer,
      ),
      proof = this.crypto.createEnrollmentConsumeProof(
        pending.request,
        approval,
        pending.device,
      ),
      result = await DesktopRelayClient.consumeEnrollment(
        pending.endpoint,
        proof,
        undefined,
        peer,
      ),
      workspaceKey = this.crypto.unwrapWorkspaceKey(
        result.wrappedWorkspaceKey,
        pending.device,
      );
    this.vault.save({
      version: 1,
      workspaceId,
      device: pending.device,
      workspaceKey,
      keyEpoch: result.keyEpoch,
      endpoint: pending.endpoint,
      transport: pending.transport,
      snapshotRequired: true,
    });
    this.vault.removePending(workspaceId);
    return {
      configured: true,
      deviceId: pending.device.deviceId,
      keyEpoch: result.keyEpoch,
    };
  }
  async pendingEnrollments(workspaceId: string) {
    const active = this.required(workspaceId),
      result = await (
        await DesktopRelayClient.create(active)
      ).pendingEnrollments();
    return result.requests.map((request) => ({
      requestId: request.requestId,
      deviceId: request.device.deviceId,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    }));
  }
  async approveEnrollment(workspaceId: string, requestId: string) {
    const active = this.required(workspaceId),
      client = await DesktopRelayClient.create(active),
      pending = await client.pendingEnrollments(),
      request = pending.requests.find((item) => item.requestId === requestId);
    if (!request) throw new Error("Pending enrollment not found");
    const wrapped = this.crypto.wrapWorkspaceKey(
        active.workspaceKey,
        request.device,
      ),
      approval = this.crypto.approveEnrollment(
        request,
        active.device,
        active.keyEpoch,
        new Date(),
        wrapped,
      );
    await client.approveEnrollment(approval, wrapped);
    return { requestId, status: "approved" as const };
  }
  async devices(workspaceId: string) {
    const active = this.required(workspaceId),
      result = await (await DesktopRelayClient.create(active)).listDevices();
    return result.devices.map((device) => ({
      deviceId: device.deviceId,
      role: device.role,
      status: device.status,
      enrolledAt: device.enrolledAt,
      revokedAt: device.revokedAt,
    }));
  }
  async revoke(workspaceId: string, deviceId: string) {
    const active = this.required(workspaceId);
    return (await DesktopRelayClient.create(active)).revokeDevice(deviceId);
  }
  planWebhookChannel(workspaceId:string,connectorId="generic"){const active=this.required(workspaceId),channelId=randomBytes(24).toString("base64url"),transportMode=active.transport?.mode??"hosted-relay";return{channelId,endpoint:`${active.endpoint.replace(/\/$/,"")}/${connectorId==="generic"?"v1/hooks":"v1/native-hooks"}/${channelId}`,reachability:transportMode==="hosted-relay"?"public_relay" as const:"local_network" as const}}
  async createWebhookChannel(workspaceId: string, label: string, connectorId = "generic", requestedChannelId?:string) {
    let active = this.requiredWebhookTransport(workspaceId);
    const plannedChannelId=requestedChannelId,plannedEndpoint=plannedChannelId?`${active.endpoint.replace(/\/$/, "")}/${connectorId === "generic" ? "v1/hooks" : "v1/native-hooks"}/${plannedChannelId}`:undefined;
    let result:Awaited<ReturnType<DesktopRelayClient['createWebhookChannel']>>;
    try{result=await (await DesktopRelayClient.create(active)).createWebhookChannel(label, connectorId, requestedChannelId)}catch(error){throw Object.assign(new Error("Waypoint channel creation outcome is uncertain; inspect the approved channel before retrying",{cause:error}),{waypointMutation:{outcome:'uncertain',channelId:plannedChannelId,endpoint:plannedEndpoint,rollback:{operation:'inspect_revoke_and_delete_channel',channelId:plannedChannelId}}})}
    active = {
      ...active,
      webhookSecrets: [
        ...(active.webhookSecrets ?? []).filter(
          (item) => item.channelId !== result.channelId,
        ),
        {
          channelId: result.channelId,
          secretVersion: result.secretVersion,
          secret: result.secret,
        },
      ],
    };
    try{this.vault.save(active)}catch(error){throw Object.assign(new Error("Waypoint channel was created but its signing secret could not be persisted locally",{cause:error}),{waypointMutation:{outcome:'known',channelId:result.channelId,endpoint:`${active.endpoint.replace(/\/$/, "")}/${result.connectorId === "generic" ? "v1/hooks" : "v1/native-hooks"}/${result.channelId}`,rollback:{operation:'revoke_and_delete_channel',channelId:result.channelId}}})}
    return {
      ...result,
      endpoint: `${active.endpoint.replace(/\/$/, "")}/${result.connectorId === "generic" ? "v1/hooks" : "v1/native-hooks"}/${result.channelId}`,
      transportMode: active.transport?.mode ?? "hosted-relay",
      ...(active.transport?.mode === "desktop-host"
        ? { certificatePem: active.transport.certificatePem, fingerprintSha256: this.peerHost?.status().fingerprintSha256 }
        : {}),
    };
  }
  async webhookChannels(workspaceId: string) {
    const active = this.required(workspaceId),
      transportMode = active.transport?.mode ?? "hosted-relay",
      host = this.peerHost?.status();
    if (transportMode === "desktop-host" && (!host?.running || host.workspaceId !== workspaceId)) return {
      channels: [],
      killSwitch: null,
      managementState: "unknown" as const,
      endpoint: active.endpoint,
      transportMode,
      reachability: "local-network" as const,
      reachable: false,
      reason: "Desktop host is stopped. Channel and kill-switch state are unavailable until it starts; retained TLS trust remains available for sender configuration.",
      ...(active.transport?.mode === "desktop-host" ? { certificatePem: active.transport.certificatePem, fingerprintSha256: createHash("sha256").update(new X509Certificate(active.transport.certificatePem).raw).digest("hex") } : {}),
    };
    const result = await (await DesktopRelayClient.create(active)).webhookChannels();
    return {
      ...result,
      endpoint: active.endpoint,
      transportMode,
      reachability:
        transportMode === "desktop-host"
          ? "local-network"
          : "public-relay",
      reachable: true,
      managementState: "current" as const,
      reason: transportMode === "desktop-host" ? "Desktop host is running with a self-signed HTTPS certificate; configure senders with the pinned certificate and full SHA-256 fingerprint." : "Hosted relay is reachable over public trusted HTTPS.",
      ...(transportMode === "desktop-host" ? { fingerprintSha256: host?.fingerprintSha256, certificatePem: active.transport?.mode === "desktop-host" ? active.transport.certificatePem : undefined } : {}),
    } as const;
  }
  async rotateWebhookChannel(workspaceId: string, channelId: string) {
    let active = this.requiredWebhookTransport(workspaceId);
    const result = await (
      await DesktopRelayClient.create(active)
    ).rotateWebhookChannel(channelId);
    active = {
      ...active,
      webhookSecrets: [
        ...(active.webhookSecrets ?? []).filter(
          (item) => item.channelId !== channelId,
        ),
        {
          channelId,
          secretVersion: result.secretVersion,
          secret: result.secret,
        },
      ],
    };
    this.vault.save(active);
    return result;
  }
  async revokeWebhookChannel(workspaceId: string, channelId: string) {
    const active = this.requiredWebhookTransport(workspaceId),
      result = await (
        await DesktopRelayClient.create(active)
      ).revokeWebhookChannel(channelId);
    this.vault.save({
      ...active,
      webhookSecrets: (active.webhookSecrets ?? []).filter(
        (item) => item.channelId !== channelId,
      ),
    });
    return result;
  }
  async deleteWebhookChannel(workspaceId: string, channelId: string) {
    const active = this.requiredWebhookTransport(workspaceId),
      result = await (
        await DesktopRelayClient.create(active)
      ).deleteWebhookChannel(channelId);
    this.vault.save({
      ...active,
      webhookSecrets: (active.webhookSecrets ?? []).filter(
        (item) => item.channelId !== channelId,
      ),
    });
    return result;
  }
  async setWebhookKill(workspaceId: string, activeValue: boolean) {
    const active = this.requiredWebhookTransport(workspaceId);
    return (await DesktopRelayClient.create(active)).setWebhookKill(
      activeValue,
    );
  }
  async fetchWebhookEvents(
    workspaceId: string,
    store: {
      importExternalInboundEvent(
        workspaceId: string,
        input: {
          eventId: string;
          channelId: string;
          connectorId?: "generic" | "github" | "azure_devops" | "stripe" | "resend";
          eventType: string;
          occurredAt: string;
          receivedAt: string;
          payload: Record<string, string | number | boolean | null>;
        },
      ): unknown;
      recordRejectedInboundEvent(
        workspaceId: string,
        input: { eventId: string; channelId: string; receivedAt: string; reason: string },
      ): void;
    },
    signal?: AbortSignal,
  ) {
    const active = this.requiredWebhookTransport(workspaceId),
      client = await DesktopRelayClient.create(active),
      result = await client.pullWebhookEvents(50, signal);
    let imported = 0, rejected = 0;
    for (const event of result.events) {
      let payload: Awaited<ReturnType<typeof openInboundWebhook>>;
      try {
        payload = await openInboundWebhook(
          event.ciphertextBase64,
          active.device.encryptionPublicKey,
          active.device.encryptionPrivateKey,
        );
      } catch (error) {
        store.recordRejectedInboundEvent(workspaceId, {
          eventId: event.eventId,
          channelId: event.channelId,
          receivedAt: event.receivedAt,
          reason: error instanceof Error ? error.message : "Inbound webhook payload is invalid",
        });
        rejected++;
        if (!(await client.acknowledgeWebhookEvent(event.eventId, signal)).acknowledged) throw new Error("Inbound webhook acknowledgement failed", { cause: error });
        continue;
      }
      try {
        store.importExternalInboundEvent(workspaceId, {
          eventId: payload.sourceEventId ?? event.eventId,
          channelId: event.channelId,
          connectorId: payload.connectorId ?? "generic",
          eventType: payload.connectorId ? payload.eventType : `generic.${payload.eventType}`,
          occurredAt: payload.occurredAt,
          receivedAt: event.receivedAt,
          payload: payload.payload,
        });
      } catch (error) {
        if ((error as { code?: string }).code !== "inbound_poison") throw error;
        store.recordRejectedInboundEvent(workspaceId, {
          eventId: event.eventId,
          channelId: event.channelId,
          receivedAt: event.receivedAt,
          reason: error instanceof Error ? error.message : "Inbound webhook storage validation rejected the event",
        });
        rejected++;
        if (!(await client.acknowledgeWebhookEvent(event.eventId, signal)).acknowledged) throw new Error("Inbound webhook acknowledgement failed", { cause: error });
        continue;
      }
      if (!(await client.acknowledgeWebhookEvent(event.eventId, signal)).acknowledged) throw new Error("Inbound webhook acknowledgement failed");
      imported++;
    }
    return { imported, rejected };
  }
  async syncOnce(
    workspaceId: string,
    store: SyncPumpStore,
    signal?: AbortSignal,
  ) {
    let active = await this.activateRotation(
        this.required(workspaceId),
        signal,
      ),
      pump = new DesktopSyncPump(
        active,
        this.crypto,
        await DesktopRelayClient.create(active),
        store,
      );
    if (active.snapshotRequired) {
      await pump.requestSnapshot(signal);
      active = { ...active, snapshotRequired: false };
      this.vault.save(active);
      pump = new DesktopSyncPump(
        active,
        this.crypto,
        await DesktopRelayClient.create(active),
        store,
      );
    }
    return pump.runOnce(signal);
  }
  async rotate(workspaceId: string) {
    let active = this.required(workspaceId);
    const client = await DesktopRelayClient.create(active),
      started = await client.beginRotation();
    if (!active.rotation) {
      active = {
        ...active,
        rotation: {
          targetEpoch: started.targetEpoch,
          workspaceKey: this.crypto.generateWorkspaceKey(),
        },
      };
      this.vault.save(active);
    }
    const rotation = active.rotation;
    if (!rotation || rotation.targetEpoch !== started.targetEpoch)
      throw new Error("Local and relay rotation epochs disagree");
    const listed = await client.listDevices();
    for (const device of listed.devices.filter(
      (item) => item.status === "active",
    ))
      await client.recordRotationWrap(
        started.targetEpoch,
        device.deviceId,
        this.crypto.wrapWorkspaceKey(rotation.workspaceKey, device),
      );
    const committed = await client.commitRotation();
    this.vault.save({
      ...active,
      previous: {
        keyEpoch: active.keyEpoch,
        workspaceKey: active.workspaceKey,
      },
      workspaceKey: rotation.workspaceKey,
      keyEpoch: committed.keyEpoch,
      rotation: undefined,
    });
    return { keyEpoch: committed.keyEpoch };
  }
  private required(workspaceId: string) {
    const value = this.vault.load(workspaceId);
    if (!value) throw new Error("Workspace sync is not configured");
    return value;
  }
  private requiredWebhookTransport(workspaceId: string) {
    const value = this.required(workspaceId);
    if (
      value.transport?.mode === "desktop-host" &&
      (!this.peerHost?.status().running ||
        this.peerHost.status().workspaceId !== workspaceId)
    )
      throw new Error(
        "Start the desktop host to receive signed webhooks on this network",
      );
    return value;
  }
  webhookProvisioningSecret(workspaceId:string,channelId:string){const active=this.requiredWebhookTransport(workspaceId),secret=active.webhookSecrets?.find((item)=>item.channelId===channelId);if(!secret)throw new Error('Webhook channel secret is unavailable; rotate or recreate the channel');return{secret:secret.secret,secretVersion:secret.secretVersion}}
  private async activateRotation(
    active: ReturnType<DesktopSyncService["required"]>,
    signal?: AbortSignal,
  ) {
    const proof = this.crypto.createRotationClaim(
        active.workspaceId,
        active.keyEpoch + 1,
        active.device,
      ),
      peer =
        active.transport?.mode === "desktop-host"
          ? active.transport
          : undefined,
      claimed = await DesktopRelayClient.claimRotation(
        active.endpoint,
        proof,
        signal,
        peer,
      );
    if (!claimed) return active;
    const next = {
      ...active,
      previous: {
        keyEpoch: active.keyEpoch,
        workspaceKey: active.workspaceKey,
      },
      workspaceKey: this.crypto.unwrapWorkspaceKey(
        claimed.wrappedWorkspaceKey,
        active.device,
      ),
      keyEpoch: claimed.keyEpoch,
    };
    this.vault.save(next);
    return next;
  }
}
