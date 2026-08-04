import { createHash, randomUUID } from "node:crypto";

export const CROSS_DEVICE_CAPABILITIES = [
  "waypoint.workspace_summary",
  "agent.codex",
  "agent.claude",
] as const;
export type CrossDeviceCapability = (typeof CROSS_DEVICE_CAPABILITIES)[number];
export function remotePolicyDigest(capability: CrossDeviceCapability) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        profile: "trusted-waypoint-worker",
        capability,
      }),
    )
    .digest("hex");
}
export type WorkerPolicy = {
  version: 1;
  enabled: boolean;
  preferredDeviceId?: string;
  failover: boolean;
  allowedCapabilities: CrossDeviceCapability[];
  maxDurationMs: number;
  maxConcurrency: 1;
};
export type DeviceCandidate = {
  deviceId: string;
  platform: "darwin" | "win32" | "linux" | "unknown";
  online: boolean;
  active: boolean;
  workerEnabled: boolean;
  capabilities: CrossDeviceCapability[];
  availableMemoryMb?: number;
};
export type TaskRequirement = {
  capability: CrossDeviceCapability;
  platform?: DeviceCandidate["platform"];
  projectDeviceId?: string;
};
const ID = /^[A-Za-z0-9._-]{1,128}$/;

export function defaultWorkerPolicy(): WorkerPolicy {
  return {
    version: 1,
    enabled: false,
    failover: false,
    allowedCapabilities: ["waypoint.workspace_summary"],
    maxDurationMs: 60_000,
    maxConcurrency: 1,
  };
}
export function validateWorkerPolicy(value: unknown): WorkerPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("worker_policy_invalid");
  const row = value as Record<string, unknown>,
    caps = Array.isArray(row.allowedCapabilities)
      ? row.allowedCapabilities.map(String)
      : [];
  if (
    row.version !== 1 ||
    typeof row.enabled !== "boolean" ||
    typeof row.failover !== "boolean" ||
    row.maxConcurrency !== 1 ||
    !Number.isSafeInteger(row.maxDurationMs) ||
    Number(row.maxDurationMs) < 5_000 ||
    Number(row.maxDurationMs) > 300_000 ||
    caps.length < 1 ||
    caps.length > CROSS_DEVICE_CAPABILITIES.length ||
    new Set(caps).size !== caps.length ||
    caps.some(
      (item) =>
        !CROSS_DEVICE_CAPABILITIES.includes(item as CrossDeviceCapability),
    ) ||
    (row.preferredDeviceId != null && !ID.test(String(row.preferredDeviceId)))
  )
    throw new Error("worker_policy_invalid");
  return {
    version: 1,
    enabled: row.enabled,
    failover: row.failover,
    allowedCapabilities: caps as CrossDeviceCapability[],
    maxDurationMs: Number(row.maxDurationMs),
    maxConcurrency: 1,
    ...(row.preferredDeviceId
      ? { preferredDeviceId: String(row.preferredDeviceId) }
      : {}),
  };
}

export function selectTarget(input: {
  localDeviceId: string;
  preference: "automatic" | "local" | string;
  requirement: TaskRequirement;
  devices: DeviceCandidate[];
  allowFailover: boolean;
}): {
  selected?: DeviceCandidate;
  explanation: string[];
  eligible: DeviceCandidate[];
} {
  const eligible = input.devices.filter(
    (item) =>
      item.online &&
      item.workerEnabled &&
      item.capabilities.includes(input.requirement.capability) &&
      (!input.requirement.platform ||
        item.platform === input.requirement.platform) &&
      (!input.requirement.projectDeviceId ||
        item.deviceId === input.requirement.projectDeviceId),
  );
  if (!eligible.length)
    return {
      eligible,
      explanation: [
        "No online trusted worker satisfies the requested capability, platform, and project location.",
      ],
    };
  const exact =
    input.preference === "local"
      ? eligible.find((item) => item.deviceId === input.localDeviceId)
      : input.preference === "automatic"
        ? undefined
        : eligible.find((item) => item.deviceId === input.preference);
  if (exact)
    return {
      selected: exact,
      eligible,
      explanation: [
        input.preference === "local"
          ? "This device was explicitly selected."
          : "The preferred trusted device is eligible.",
      ],
    };
  if (input.preference !== "automatic" && !input.allowFailover)
    return {
      eligible,
      explanation: [
        "The selected device is unavailable or ineligible and failover is disabled.",
      ],
    };
  const project = input.requirement.projectDeviceId
    ? eligible.find(
        (item) => item.deviceId === input.requirement.projectDeviceId,
      )
    : undefined;
  if (project)
    return {
      selected: project,
      eligible,
      explanation: ["Project location requires this trusted device."],
    };
  const platform = input.requirement.platform
    ? eligible.find((item) => item.platform === input.requirement.platform)
    : undefined;
  if (platform)
    return {
      selected: platform,
      eligible,
      explanation: [`The task requires ${input.requirement.platform}.`],
    };
  const active = eligible.find((item) => item.active);
  if (active)
    return {
      selected: active,
      eligible,
      explanation: ["The actively used eligible device is preferred."],
    };
  const local = eligible.find((item) => item.deviceId === input.localDeviceId);
  return {
    selected:
      local ??
      eligible.sort(
        (a, b) =>
          (b.availableMemoryMb ?? 0) - (a.availableMemoryMb ?? 0) ||
          a.deviceId.localeCompare(b.deviceId),
      )[0],
    eligible,
    explanation: [
      local
        ? "This device is eligible and available."
        : "Selected the deterministic highest-capacity eligible device.",
    ],
  };
}

export type RemoteJobEnvelope = {
  version: 1;
  id: string;
  workspaceId: string;
  controllerDeviceId: string;
  targetDeviceId: string;
  capability: CrossDeviceCapability;
  instruction: string;
  idempotencyKey: string;
  profileDigest: string;
  keyEpoch: number;
  createdAt: string;
  timeoutMs: number;
  origin: "user";
};
export function validateRemoteJob(value: unknown): RemoteJobEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("remote_job_invalid");
  const input = value as RemoteJobEnvelope;
  if (
    input.version !== 1 ||
    !ID.test(input.id) ||
    !ID.test(input.workspaceId) ||
    !ID.test(input.controllerDeviceId) ||
    !ID.test(input.targetDeviceId) ||
    !CROSS_DEVICE_CAPABILITIES.includes(input.capability) ||
    !input.instruction.trim() ||
    input.instruction.length > 8_000 ||
    !ID.test(input.idempotencyKey) ||
    !/^[a-f0-9]{64}$/.test(input.profileDigest) ||
    !Number.isSafeInteger(input.keyEpoch) ||
    input.keyEpoch < 1 ||
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 5_000 ||
    input.timeoutMs > 300_000 ||
    input.origin !== "user" ||
    !Number.isFinite(Date.parse(input.createdAt)) ||
    new Date(input.createdAt).toISOString() !== input.createdAt
  )
    throw new Error("remote_job_invalid");
  return { ...input, instruction: input.instruction.trim() };
}
export function createRemoteJob(
  input: Omit<RemoteJobEnvelope, "version" | "id" | "createdAt">,
  now = new Date(),
): RemoteJobEnvelope {
  return validateRemoteJob({
    ...input,
    version: 1,
    id: randomUUID(),
    createdAt: now.toISOString(),
  });
}
export function jobRequestDigest(job: RemoteJobEnvelope): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        job.version,
        job.workspaceId,
        job.controllerDeviceId,
        job.targetDeviceId,
        job.capability,
        job.instruction,
        job.idempotencyKey,
        job.profileDigest,
        job.keyEpoch,
        job.timeoutMs,
        job.origin,
      ]),
    )
    .digest("hex");
}
export type JobLease = {
  version: 1;
  leaseId: string;
  jobId: string;
  workspaceId: string;
  targetDeviceId: string;
  profileDigest: string;
  keyEpoch: number;
  capability: CrossDeviceCapability;
  issuedAt: string;
  expiresAt: string;
};
export function issueJobLease(
  job: RemoteJobEnvelope,
  now = new Date(),
  targetProfileDigest=job.profileDigest,
): JobLease {
  const expires = new Date(now.getTime() + Math.min(job.timeoutMs, 60_000));
  return {
    version: 1,
    leaseId: randomUUID(),
    jobId: job.id,
    workspaceId: job.workspaceId,
    targetDeviceId: job.targetDeviceId,
    profileDigest: targetProfileDigest,
    keyEpoch: job.keyEpoch,
    capability: job.capability,
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
}
export function validateJobLease(
  lease: JobLease,
  job: RemoteJobEnvelope,
  input: {
    deviceId: string;
    profileDigest: string;
    keyEpoch: number;
    now?: Date;
  },
): void {
  const now = input.now ?? new Date();
  if (
    lease.version !== 1 ||
    lease.jobId !== job.id ||
    lease.workspaceId !== job.workspaceId ||
    lease.targetDeviceId !== job.targetDeviceId ||
    lease.targetDeviceId !== input.deviceId ||
    lease.profileDigest !== input.profileDigest ||
    lease.keyEpoch !== job.keyEpoch ||
    lease.keyEpoch !== input.keyEpoch ||
    lease.capability !== job.capability ||
    Date.parse(lease.expiresAt) <= now.getTime() ||
    Date.parse(lease.issuedAt) > now.getTime() + 30_000
  )
    throw new Error("remote_job_lease_invalid");
}
