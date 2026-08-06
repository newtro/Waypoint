import { randomUUID } from "node:crypto";
import sodium from "libsodium-wrappers-sumo";
import type { DeviceKeyPair } from "./types.js";
import type {
  EnrollmentApproval,
  EnrollmentConsumeProof,
  EnrollmentInvitation,
  EnrollmentRequest,
  RotationClaimProof,
} from "./types.js";
import type {
  OpaqueRelayMessage,
  RelayReceipt,
} from "../../../node/relay/types.js";
import { canonicalRelayRequest } from "./relay-request.js";
import {
  createPinnedPeerFetch,
  validateDesktopHostDescriptor,
  type DesktopHostDescriptor,
} from "./peer-host-transport.js";

export interface RelayClientConfig {
  endpoint: string;
  workspaceId: string;
  device: DeviceKeyPair;
  keyEpoch: number;
  transport?: { mode: "hosted-relay" } | DesktopHostDescriptor;
}
export const WAYPOINT_RELAY_ORIGIN = "https://waypoint-relay.johnnycode.ai";
export class DesktopRelayClient {
  private constructor(
    private readonly config: RelayClientConfig,
    private readonly request: typeof fetch,
  ) {}
  static async create(
    config: RelayClientConfig,
    request?: typeof fetch,
  ): Promise<DesktopRelayClient> {
    await sodium.ready;
    const resolved = transport(config.endpoint, config.transport, request);
    if (
      !/^[A-Za-z0-9_-]{16,128}$/.test(config.workspaceId) ||
      !Number.isSafeInteger(config.keyEpoch) ||
      config.keyEpoch < 1
    )
      throw new Error("Invalid relay client authority");
    return new DesktopRelayClient(
      { ...config, endpoint: resolved.endpoint },
      resolved.request,
    );
  }
  async enqueue(
    message: OpaqueRelayMessage,
    signal?: AbortSignal,
  ): Promise<RelayReceipt> {
    if (
      message.workspaceId !== this.config.workspaceId ||
      message.senderDeviceId !== this.config.device.deviceId ||
      message.keyEpoch !== this.config.keyEpoch
    )
      throw new Error("Outbound relay authority mismatch");
    const body = {
        ...message,
        envelope: undefined,
        envelopeBase64: Buffer.from(message.envelope).toString("base64"),
      },
      response = await this.signed("POST", "/v1/messages", body, signal);
    if (response.status !== 202) throw await failure(response);
    return (await response.json()) as RelayReceipt;
  }
  async pull(limit = 100, signal?: AbortSignal): Promise<OpaqueRelayMessage[]> {
    const bounded = Math.max(0, Math.min(1000, Math.floor(limit))),
      path = `/v1/messages?workspaceId=${encodeURIComponent(this.config.workspaceId)}&recipientDeviceId=${encodeURIComponent(this.config.device.deviceId)}&limit=${bounded}`,
      response = await this.signed("GET", path, undefined, signal);
    if (response.status !== 200) throw await failure(response);
    const payload = (await response.json()) as { messages?: unknown };
    if (!Array.isArray(payload.messages) || payload.messages.length > bounded)
      throw new Error("Relay response is invalid or exceeds bounds");
    return payload.messages.map((item) => parseMessage(item, this.config));
  }
  async acknowledge(messageId: string, signal?: AbortSignal): Promise<boolean> {
    const response = await this.signed(
      "POST",
      "/v1/acks",
      {
        workspaceId: this.config.workspaceId,
        recipientDeviceId: this.config.device.deviceId,
        messageId,
      },
      signal,
    );
    if (response.status !== 200) throw await failure(response);
    return Boolean(
      ((await response.json()) as { acknowledged: boolean }).acknowledged,
    );
  }
  async registerInvitation(
    invitation: EnrollmentInvitation,
    signal?: AbortSignal,
  ) {
    return this.json("POST", "/v1/invitations", { invitation }, 201, signal);
  }
  async pendingEnrollments(signal?: AbortSignal) {
    return this.json(
      "GET",
      "/v1/enrollments",
      undefined,
      200,
      signal,
    ) as Promise<{ requests: EnrollmentRequest[] }>;
  }
  async approveEnrollment(
    approval: EnrollmentApproval,
    wrappedWorkspaceKey: string,
    signal?: AbortSignal,
  ) {
    return this.json(
      "POST",
      "/v1/enrollments/approve",
      { approval, wrappedWorkspaceKey },
      200,
      signal,
    );
  }
  async listDevices(signal?: AbortSignal) {
    return this.json("GET", "/v1/devices", undefined, 200, signal) as Promise<{
      devices: Array<{
        deviceId: string;
        role: string;
        status: string;
        signingPublicKey: string;
        encryptionPublicKey: string;
        enrolledAt: string;
        revokedAt?: string;
      }>;
    }>;
  }
  async revokeDevice(deviceId: string, signal?: AbortSignal) {
    return this.json("POST", "/v1/devices/revoke", { deviceId }, 200, signal);
  }
  async beginRotation(signal?: AbortSignal) {
    return this.json(
      "POST",
      "/v1/rotations/start",
      {},
      200,
      signal,
    ) as Promise<{ targetEpoch: number; status: string }>;
  }
  async rotationStatus(signal?: AbortSignal) {
    return this.json(
      "GET",
      "/v1/rotations",
      undefined,
      200,
      signal,
    ) as Promise<{
      rotation?: {
        targetEpoch: number;
        status: string;
        pendingDeviceIds: string[];
        wrappedDeviceIds: string[];
      };
    }>;
  }
  async recordRotationWrap(
    targetEpoch: number,
    deviceId: string,
    wrappedWorkspaceKey: string,
    signal?: AbortSignal,
  ) {
    return this.json(
      "POST",
      "/v1/rotations/wrap",
      { targetEpoch, deviceId, wrappedWorkspaceKey },
      200,
      signal,
    );
  }
  async commitRotation(signal?: AbortSignal) {
    return this.json(
      "POST",
      "/v1/rotations/commit",
      {},
      200,
      signal,
    ) as Promise<{ keyEpoch: number }>;
  }
  async createWebhookChannel(label: string, signal?: AbortSignal) {
    return this.json(
      "POST",
      "/v1/webhook-channels",
      { label },
      201,
      signal,
    ) as Promise<WebhookChannelSecret>;
  }
  async webhookChannels(signal?: AbortSignal) {
    return this.json(
      "GET",
      "/v1/webhook-channels",
      undefined,
      200,
      signal,
    ) as Promise<{ channels: WebhookChannel[]; killSwitch: boolean }>;
  }
  async rotateWebhookChannel(channelId: string, signal?: AbortSignal) {
    return this.json(
      "POST",
      `/v1/webhook-channels/${encodeURIComponent(channelId)}/rotate`,
      {},
      200,
      signal,
    ) as Promise<WebhookChannelSecret>;
  }
  async revokeWebhookChannel(channelId: string, signal?: AbortSignal) {
    return this.json(
      "POST",
      `/v1/webhook-channels/${encodeURIComponent(channelId)}/revoke`,
      {},
      200,
      signal,
    ) as Promise<WebhookChannel>;
  }
  async deleteWebhookChannel(channelId: string, signal?: AbortSignal) {
    return this.json(
      "POST",
      `/v1/webhook-channels/${encodeURIComponent(channelId)}/delete`,
      {},
      200,
      signal,
    ) as Promise<{ deleted: boolean }>;
  }
  async setWebhookKill(active: boolean, signal?: AbortSignal) {
    return this.json(
      "POST",
      "/v1/webhook-kill",
      { active },
      200,
      signal,
    ) as Promise<{ active: boolean }>;
  }
  async pullWebhookEvents(limit = 50, signal?: AbortSignal) {
    return this.json(
      "GET",
      `/v1/webhook-events?limit=${Math.max(0, Math.min(100, Math.floor(limit)))}`,
      undefined,
      200,
      signal,
    ) as Promise<{ events: InboundWebhookEnvelope[] }>;
  }
  async acknowledgeWebhookEvent(eventId: string, signal?: AbortSignal) {
    return this.json(
      "POST",
      "/v1/webhook-acks",
      { eventId },
      200,
      signal,
    ) as Promise<{ acknowledged: boolean }>;
  }
  static async submitEnrollment(
    endpoint: string,
    invitationId: string,
    secret: string,
    request: EnrollmentRequest,
    signal?: AbortSignal,
    peer?: DesktopHostDescriptor,
  ) {
    return unsigned(
      endpoint,
      "/v1/enrollments/submit",
      { invitationId, secret, request },
      202,
      signal,
      peer,
    );
  }
  static async enrollmentApproval(
    endpoint: string,
    requestId: string,
    signal?: AbortSignal,
    peer?: DesktopHostDescriptor,
  ) {
    return unsigned(
      endpoint,
      "/v1/enrollments/approval",
      { requestId },
      200,
      signal,
      peer,
    ) as Promise<{ approval: EnrollmentApproval }>;
  }
  static async consumeEnrollment(
    endpoint: string,
    proof: EnrollmentConsumeProof,
    signal?: AbortSignal,
    peer?: DesktopHostDescriptor,
  ) {
    return unsigned(
      endpoint,
      "/v1/enrollments/consume",
      { proof },
      200,
      signal,
      peer,
    ) as Promise<{
      approval: EnrollmentApproval;
      wrappedWorkspaceKey: string;
      keyEpoch: number;
    }>;
  }
  static async claimRotation(
    endpoint: string,
    proof: RotationClaimProof,
    signal?: AbortSignal,
    peer?: DesktopHostDescriptor,
  ) {
    const response = await unsignedResponse(
      endpoint,
      "/v1/rotations/claim",
      { proof },
      signal,
      peer,
    );
    if (response.status === 404) return undefined;
    if (response.status !== 200) throw await failure(response);
    return response.json() as Promise<{
      wrappedWorkspaceKey: string;
      keyEpoch: number;
    }>;
  }
  private async json(
    method: string,
    path: string,
    value: unknown,
    status: number,
    signal?: AbortSignal,
  ) {
    const response = await this.signed(method, path, value, signal);
    if (response.status !== status) throw await failure(response);
    return response.json() as Promise<unknown>;
  }
  private async signed(
    method: string,
    path: string,
    value?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const body =
        value === undefined
          ? Buffer.alloc(0)
          : Buffer.from(JSON.stringify(value)),
      timestamp = new Date().toISOString(),
      nonce = randomUUID(),
      canonical = canonicalRelayRequest(
        this.config.workspaceId,
        this.config.device.deviceId,
        this.config.keyEpoch,
        method,
        path,
        timestamp,
        nonce,
        body,
      ),
      signature = sodium.to_base64(
        sodium.crypto_sign_detached(
          sodium.from_string(canonical),
          sodium.from_base64(
            this.config.device.signingPrivateKey,
            sodium.base64_variants.ORIGINAL,
          ),
        ),
        sodium.base64_variants.ORIGINAL,
      );
    return this.request(`${this.config.endpoint}${path}`, {
      method,
      redirect: "error",
      signal,
      headers: {
        "content-type": "application/json",
        "x-waypoint-workspace": this.config.workspaceId,
        "x-waypoint-device": this.config.device.deviceId,
        "x-waypoint-epoch": String(this.config.keyEpoch),
        "x-waypoint-timestamp": timestamp,
        "x-waypoint-nonce": nonce,
        "x-waypoint-signature": signature,
      },
      body: method === "GET" ? undefined : body,
    });
  }
}
export interface WebhookChannel {
  channelId: string;
  workspaceId: string;
  recipientDeviceId: string;
  recipientPublicKey: string;
  label: string;
  secretVersion: number;
  status: "active" | "revoked";
  createdAt: string;
  rotatedAt: string;
  revokedAt?: string;
}
export interface WebhookChannelSecret extends WebhookChannel {
  secret: string;
}
export interface InboundWebhookEnvelope {
  eventId: string;
  channelId: string;
  secretVersion: number;
  receivedAt: string;
  expiresAt: string;
  ciphertextBase64: string;
}
async function unsigned(
  endpoint: string,
  path: string,
  value: unknown,
  status: number,
  signal?: AbortSignal,
  peer?: DesktopHostDescriptor,
) {
  const response = await unsignedResponse(endpoint, path, value, signal, peer);
  if (response.status !== status) throw await failure(response);
  return response.json() as Promise<unknown>;
}
async function unsignedResponse(
  endpoint: string,
  path: string,
  value: unknown,
  signal?: AbortSignal,
  peer?: DesktopHostDescriptor,
) {
  const resolved = transport(endpoint, peer);
  return resolved.request(`${resolved.endpoint}${path}`, {
    method: "POST",
    redirect: "error",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
function transport(
  endpoint: string,
  value?: RelayClientConfig["transport"] | DesktopHostDescriptor,
  override?: typeof fetch,
) {
  const parsed = new URL(endpoint);
  if (
    parsed.origin === WAYPOINT_RELAY_ORIGIN &&
    parsed.href === `${WAYPOINT_RELAY_ORIGIN}/` &&
    (!value || value.mode === "hosted-relay")
  )
    return { endpoint: parsed.origin, request: override ?? fetch };
  if (!value || value.mode !== "desktop-host")
    throw new Error(
      "Sync endpoint requires a protected pinned desktop-host descriptor",
    );
  validateDesktopHostDescriptor(value);
  if (parsed.origin !== new URL(value.endpoint).origin)
    throw new Error(
      "Sync endpoint requires a protected pinned desktop-host descriptor",
    );
  return {
    endpoint: parsed.origin,
    request: override ?? createPinnedPeerFetch(value),
  };
}
function parseMessage(
  item: unknown,
  config: RelayClientConfig,
): OpaqueRelayMessage {
  if (!item || typeof item !== "object")
    throw new Error("Relay message is invalid");
  const value = item as Record<string, unknown>,
    encoded = String(value.envelopeBase64 ?? "");
  if (
    value.workspaceId !== config.workspaceId ||
    value.recipientDeviceId !== config.device.deviceId ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(String(value.messageId)) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(String(value.senderDeviceId)) ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    ![config.keyEpoch, config.keyEpoch - 1].includes(Number(value.keyEpoch)) ||
    encoded.length > 8 * 1024 * 1024 ||
    !/^[-A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new Error("Relay message authority or shape is invalid");
  const envelope = Buffer.from(encoded, "base64");
  if (envelope.toString("base64") !== encoded)
    throw new Error("Relay message encoding is invalid");
  return {
    protocolVersion: Number(value.protocolVersion),
    messageId: String(value.messageId),
    workspaceId: String(value.workspaceId),
    recipientDeviceId: String(value.recipientDeviceId),
    senderDeviceId: String(value.senderDeviceId),
    keyEpoch: Number(value.keyEpoch),
    sequence: Number(value.sequence),
    createdAt: String(value.createdAt),
    expiresAt: String(value.expiresAt),
    envelope: new Uint8Array(envelope),
  };
}
async function failure(response: Response) {
  let code = "relay_error";
  try {
    code = String(
      ((await response.json()) as { error?: string }).error ?? code,
    );
  } catch {
    /* Content-free fallback. */
  }
  return new Error(`Relay request failed (${response.status}:${code})`);
}
