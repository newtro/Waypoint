import { createHash, randomUUID } from "node:crypto";
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

const ID = /^[A-Za-z0-9._-]{16,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;
const MAX_TRANSFER_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 128;
const TERMINAL_STATUSES = new Set<FleetRemoteWorkRecord["status"]>([
  "completed",
  "failed",
  "canceled",
]);

function retainForInsert(
  records: FleetRemoteWorkRecord[],
  capacityError: string,
): FleetRemoteWorkRecord[] {
  if (records.length < MAX_RECORDS) return records;
  const removable = records.findIndex((record) =>
    TERMINAL_STATUSES.has(record.status),
  );
  if (removable < 0) throw new Error(capacityError);
  return records.filter((_record, index) => index !== removable);
}

function controllerRecordAdvances(
  existing: FleetRemoteWorkRecord,
  incoming: FleetRemoteWorkRecord,
): boolean {
  if (existing.events[0]?.message === "Submitting exact work order to target")
    return true;
  if (TERMINAL_STATUSES.has(existing.status)) return false;
  if (TERMINAL_STATUSES.has(incoming.status)) return true;
  const rank: Record<FleetRemoteWorkRecord["status"], number> = {
    waiting_approval: 0,
    queued: 1,
    running: 2,
    completed: 3,
    failed: 3,
    canceled: 3,
  };
  if (rank[incoming.status] !== rank[existing.status])
    return rank[incoming.status] > rank[existing.status];
  return (
    incoming.events.length > existing.events.length ||
    (incoming.events.length === existing.events.length &&
      Date.parse(incoming.updatedAt) >= Date.parse(existing.updatedAt))
  );
}

export type FleetWorkMode = "supervised" | "autonomous";
export type FleetWorkProvider = "codex" | "claude" | "grok";
export type FleetHandoff =
  | {
      kind: "git_bundle";
      repositoryName: string;
      baseCommit: string;
      headCommit: string;
      bytesBase64: string;
      sha256: string;
    }
  | {
      kind: "patch_bundle";
      repositoryName: string;
      baseCommit?: string;
      bytesBase64: string;
      sha256: string;
    };

export interface FleetRemoteWorkOrder {
  version: 1;
  jobId: string;
  idempotencyKey: string;
  controllerDeviceId: string;
  targetDeviceId: string;
  workspaceId: string;
  provider: FleetWorkProvider;
  providerVersion?: string;
  mode: FleetWorkMode;
  instruction: string;
  controllerRoot: string;
  controllerProfileId: string;
  targetRoot: string;
  targetProfileId: string;
  timeoutMs: number;
  createdAt: string;
  handoff?: FleetHandoff;
}

export interface FleetRemoteWorkEvent {
  sequence: number;
  type: "queued" | "approval_required" | "approval_resolved" | "started" | "output" | "completed" | "failed" | "canceled" | "artifact_discarded";
  message: string;
  createdAt: string;
}

export interface FleetProviderApproval {
  requestId: string;
  kind: string;
  title: string;
  detail: string;
  createdAt: string;
}

export interface FleetRemoteWorkRecord {
  order: FleetRemoteWorkOrder;
  status: "queued" | "waiting_approval" | "running" | "completed" | "failed" | "canceled";
  worktreePath?: string;
  resultSummary?: string;
  errorCode?: string;
  pendingApproval?: FleetProviderApproval;
  resultArtifact?: {
    patchBase64: string;
    patchSha256: string;
    baseCommit: string;
    status: string[];
  };
  events: FleetRemoteWorkEvent[];
  updatedAt: string;
}

interface FleetRemoteWorkState {
  version: 1;
  jobs: FleetRemoteWorkRecord[];
  controllerJobs: FleetRemoteWorkRecord[];
  updatedAt: string;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function portableAbsolutePath(value: string): boolean {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function validHandoff(value: unknown): value is FleetHandoff {
  if (!value || typeof value !== "object") return false;
  const item = value as FleetHandoff;
  if (
    !["git_bundle", "patch_bundle"].includes(item.kind) ||
    typeof item.repositoryName !== "string" ||
    !item.repositoryName.trim() ||
    item.repositoryName.length > 120 ||
    !SHA256.test(String(item.sha256)) ||
    typeof item.bytesBase64 !== "string"
  )
    return false;
  const bytes = Buffer.from(item.bytesBase64, "base64");
  if (
    bytes.length > MAX_TRANSFER_BYTES ||
    bytes.toString("base64") !== item.bytesBase64 ||
    createHash("sha256").update(bytes).digest("hex") !== item.sha256
  )
    return false;
  if (item.kind === "git_bundle")
    return SHA256.test(item.baseCommit) && SHA256.test(item.headCommit);
  return item.baseCommit === undefined || SHA256.test(item.baseCommit);
}

export function validateFleetRemoteWorkOrder(
  value: unknown,
): FleetRemoteWorkOrder {
  const item = value as FleetRemoteWorkOrder;
  if (
    !item ||
    item.version !== 1 ||
    !ID.test(String(item.jobId)) ||
    !ID.test(String(item.idempotencyKey)) ||
    !ID.test(String(item.controllerDeviceId)) ||
    !ID.test(String(item.targetDeviceId)) ||
    !ID.test(String(item.workspaceId)) ||
    !["codex", "claude", "grok"].includes(item.provider) ||
    (item.providerVersion !== undefined &&
      (typeof item.providerVersion !== "string" ||
        !item.providerVersion.trim() ||
        item.providerVersion.length > 200)) ||
    !["supervised", "autonomous"].includes(item.mode) ||
    typeof item.instruction !== "string" ||
    !item.instruction.trim() ||
    item.instruction.length > 8_000 ||
    typeof item.controllerRoot !== "string" ||
    !portableAbsolutePath(item.controllerRoot) ||
    item.controllerRoot.length > 1_024 ||
    !ID.test(String(item.controllerProfileId)) ||
    typeof item.targetRoot !== "string" ||
    !portableAbsolutePath(item.targetRoot) ||
    item.targetRoot.length > 1_024 ||
    !ID.test(String(item.targetProfileId)) ||
    !Number.isSafeInteger(item.timeoutMs) ||
    item.timeoutMs < 30_000 ||
    item.timeoutMs > 24 * 60 * 60_000 ||
    !timestamp(item.createdAt) ||
    (item.handoff !== undefined && !validHandoff(item.handoff))
  )
    throw new Error("fleet_remote_work_order_invalid");
  return structuredClone({ ...item, instruction: item.instruction.trim() });
}

export function fleetRemoteWorkDigest(order: FleetRemoteWorkOrder): string {
  return createHash("sha256")
    .update(JSON.stringify(validateFleetRemoteWorkOrder(order)))
    .digest("hex");
}

function validateState(value: unknown): FleetRemoteWorkState {
  const item = value as FleetRemoteWorkState;
  if (
    !item ||
    item.version !== 1 ||
    !Array.isArray(item.jobs) ||
    item.jobs.length > 128 ||
    !Array.isArray(item.controllerJobs) ||
    item.controllerJobs.length > 128 ||
    !timestamp(item.updatedAt) ||
    new Set(item.jobs.map((job) => job.order.jobId)).size !== item.jobs.length ||
    new Set(item.controllerJobs.map((job) => job.order.jobId)).size !==
      item.controllerJobs.length
  )
    throw new Error("protected_remote_work_invalid");
  for (const job of [...item.jobs, ...item.controllerJobs]) {
    validateFleetRemoteWorkOrder(job.order);
    if (
      !["queued", "waiting_approval", "running", "completed", "failed", "canceled"].includes(job.status) ||
      (job.worktreePath !== undefined &&
        (typeof job.worktreePath !== "string" ||
          !portableAbsolutePath(job.worktreePath) ||
          job.worktreePath.length > 1_024)) ||
      (job.resultSummary !== undefined &&
        (typeof job.resultSummary !== "string" ||
          job.resultSummary.length > 4_000)) ||
      (job.errorCode !== undefined &&
        (typeof job.errorCode !== "string" || job.errorCode.length > 500)) ||
      !Array.isArray(job.events) ||
      job.events.length > 512 ||
      !timestamp(job.updatedAt) ||
      job.events.some(
        (event, index) =>
          event.sequence !== index + 1 ||
          ![
            "queued",
            "approval_required",
            "approval_resolved",
            "started",
            "output",
            "completed",
            "failed",
            "canceled",
            "artifact_discarded",
          ].includes(event.type) ||
          !timestamp(event.createdAt) ||
          typeof event.message !== "string" ||
          event.message.length > 4_000,
      )
    )
      throw new Error("protected_remote_work_invalid");
    if (
      job.pendingApproval &&
      (!ID.test(String(job.pendingApproval.requestId)) ||
        typeof job.pendingApproval.kind !== "string" ||
        !job.pendingApproval.kind ||
        job.pendingApproval.kind.length > 100 ||
        typeof job.pendingApproval.title !== "string" ||
        !job.pendingApproval.title ||
        job.pendingApproval.title.length > 500 ||
        typeof job.pendingApproval.detail !== "string" ||
        job.pendingApproval.detail.length > 4_000 ||
        !timestamp(job.pendingApproval.createdAt))
    )
      throw new Error("protected_remote_work_invalid");
    if (job.resultArtifact) {
      const bytes = Buffer.from(job.resultArtifact.patchBase64, "base64");
      if (
        bytes.length > MAX_TRANSFER_BYTES ||
        bytes.toString("base64") !== job.resultArtifact.patchBase64 ||
        createHash("sha256").update(bytes).digest("hex") !==
          job.resultArtifact.patchSha256 ||
        !COMMIT.test(job.resultArtifact.baseCommit) ||
        !Array.isArray(job.resultArtifact.status) ||
        job.resultArtifact.status.length > 4_096 ||
        job.resultArtifact.status.some(
          (entry) => typeof entry !== "string" || entry.length > 1_024,
        )
      )
        throw new Error("protected_remote_work_invalid");
    }
  }
  return item;
}

export function validateFleetRemoteWorkRecord(
  value: unknown,
): FleetRemoteWorkRecord {
  const now = new Date().toISOString(),
    state = validateState({
      version: 1,
      jobs: [value],
      controllerJobs: [],
      updatedAt: now,
    });
  return structuredClone(state.jobs[0]);
}

export class FleetRemoteWorkService {
  private readonly file: string;
  private state: FleetRemoteWorkState;

  constructor(
    root: string,
    private readonly protector: SecretProtector,
    now = new Date(),
  ) {
    if (!protector.available())
      throw new Error("OS-protected remote work storage is unavailable");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.file = path.join(root, "remote-work.protected");
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(
          protector.decrypt(readFileSync(this.file)),
        ) as Omit<FleetRemoteWorkState, "controllerJobs"> & {
          controllerJobs?: FleetRemoteWorkRecord[];
        };
        this.state = validateState({ ...parsed, controllerJobs: parsed.controllerJobs ?? [] });
        const interrupted = this.state.jobs.filter(
          (job) => job.status === "running",
        );
        if (interrupted.length) {
          this.state = {
            ...this.state,
            jobs: this.state.jobs.map((job) =>
              job.status === "running"
                ? {
                    ...job,
                    status: "failed" as const,
                    errorCode: "fleet_remote_interrupted",
                    resultSummary: "Target restarted during remote execution",
                    events: [
                      ...job.events,
                      {
                        sequence: job.events.length + 1,
                        type: "failed" as const,
                        message: "Target restarted during remote execution",
                        createdAt: now.toISOString(),
                      },
                    ],
                    updatedAt: now.toISOString(),
                  }
                : job,
            ),
            updatedAt: now.toISOString(),
          };
          this.save(this.state);
        }
      } catch {
        throw new Error("Protected remote work cannot be opened");
      }
    } else {
      this.state = {
        version: 1,
        jobs: [],
        controllerJobs: [],
        updatedAt: now.toISOString(),
      };
      this.save(this.state);
    }
  }

  accept(order: FleetRemoteWorkOrder, now = new Date()): FleetRemoteWorkRecord {
    const validated = validateFleetRemoteWorkOrder(order),
      sameKey = this.state.jobs.find(
        (job) => job.order.idempotencyKey === validated.idempotencyKey,
      );
    if (sameKey) {
      if (fleetRemoteWorkDigest(sameKey.order) !== fleetRemoteWorkDigest(validated))
        throw new Error("fleet_remote_work_idempotency_collision");
      return structuredClone(sameKey);
    }
    const record: FleetRemoteWorkRecord = {
      order: validated,
      status: validated.mode === "supervised" ? "waiting_approval" : "queued",
      events: [
        {
          sequence: 1,
          type:
            validated.mode === "supervised" ? "approval_required" : "queued",
          message:
            validated.mode === "supervised"
              ? "Waiting for approval on the target device"
              : "Queued within the target authority contract",
          createdAt: now.toISOString(),
        },
      ],
      updatedAt: now.toISOString(),
    };
    const retained = retainForInsert(
      this.state.jobs,
      "fleet_remote_work_capacity_reached",
    );
    this.update({
      ...this.state,
      jobs: [...retained, record],
      updatedAt: now.toISOString(),
    });
    return structuredClone(record);
  }

  approve(jobId: string, now = new Date()): FleetRemoteWorkRecord {
    const job = this.require(jobId);
    if (job.status !== "waiting_approval")
      throw new Error("fleet_remote_work_not_waiting");
    return this.transition(jobId, "queued", "queued", "Approved on target device", now);
  }

  claim(now = new Date()): FleetRemoteWorkRecord | undefined {
    this.expirePending(now);
    const job = this.state.jobs.find((item) => item.status === "queued");
    return job
      ? this.transition(job.order.jobId, "running", "started", "Target execution started", now)
      : undefined;
  }

  expirePending(now = new Date()): string[] {
    const expired = this.state.jobs.filter(
      (job) =>
        ["queued", "waiting_approval"].includes(job.status) &&
        Date.parse(job.order.createdAt) + job.order.timeoutMs <= now.getTime(),
    );
    for (const job of expired)
      this.transition(
        job.order.jobId,
        "failed",
        "failed",
        "Remote work order timed out before execution",
        now,
        { errorCode: "fleet_remote_timeout" },
      );
    return expired.map((job) => job.order.jobId);
  }

  expireControllerPending(now = new Date()): string[] {
    const expired = this.state.controllerJobs.filter(
      (job) =>
        !TERMINAL_STATUSES.has(job.status) &&
        Date.parse(job.order.createdAt) + job.order.timeoutMs <= now.getTime(),
    );
    if (!expired.length) return [];
    const expiredIds = new Set(expired.map((job) => job.order.jobId));
    this.update({
      ...this.state,
      controllerJobs: this.state.controllerJobs.map((job) =>
        expiredIds.has(job.order.jobId)
          ? {
              ...job,
              status: "failed" as const,
              errorCode: "fleet_remote_timeout",
              resultSummary: "Remote work order expired without a confirmed target result",
              events: [
                ...job.events,
                {
                  sequence: job.events.length + 1,
                  type: "failed" as const,
                  message: "Remote work order expired without a confirmed target result",
                  createdAt: now.toISOString(),
                },
              ],
              updatedAt: now.toISOString(),
            }
          : job,
      ),
      updatedAt: now.toISOString(),
    });
    return [...expiredIds];
  }

  requestProviderApproval(
    jobId: string,
    approval: FleetProviderApproval,
    now = new Date(),
  ): FleetRemoteWorkRecord {
    const job = this.require(jobId);
    if (job.status !== "running" || job.pendingApproval)
      throw new Error("fleet_remote_approval_state_invalid");
    if (
      !ID.test(approval.requestId) ||
      !approval.kind ||
      approval.kind.length > 100 ||
      !approval.title ||
      approval.title.length > 500 ||
      approval.detail.length > 4_000 ||
      !timestamp(approval.createdAt)
    )
      throw new Error("fleet_remote_approval_invalid");
    return this.updateJob(
      jobId,
      {
        pendingApproval: structuredClone(approval),
      },
      "approval_required",
      `Provider approval required: ${approval.title}`,
      now,
    );
  }

  resolveProviderApproval(
    jobId: string,
    requestId: string,
    accepted: boolean,
    now = new Date(),
  ): FleetRemoteWorkRecord {
    const job = this.require(jobId);
    if (
      job.status !== "running" ||
      job.pendingApproval?.requestId !== requestId
    )
      throw new Error("fleet_remote_approval_not_pending");
    return this.updateJob(
      jobId,
      { pendingApproval: undefined },
      "approval_resolved",
      accepted ? "Provider request approved once" : "Provider request declined",
      now,
    );
  }

  finish(
    jobId: string,
    status: "completed" | "failed",
    summary: string,
    details: {
      worktreePath?: string;
      errorCode?: string;
      resultArtifact?: FleetRemoteWorkRecord["resultArtifact"];
    } = {},
    now = new Date(),
  ): FleetRemoteWorkRecord {
    const job = this.require(jobId);
    if (job.status !== "running") throw new Error("fleet_remote_work_not_running");
    const next = this.transition(jobId, status, status, summary, now, details);
    return next;
  }

  cancel(
    jobId: string,
    now = new Date(),
    message = "Canceled by controller",
  ): FleetRemoteWorkRecord {
    const job = this.require(jobId);
    if (["completed", "failed", "canceled"].includes(job.status))
      return structuredClone(job);
    return this.transition(jobId, "canceled", "canceled", message, now);
  }

  cancelByController(
    controllerDeviceId: string,
    now = new Date(),
  ): string[] {
    const canceled = this.state.jobs
      .filter(
        (job) =>
          job.order.controllerDeviceId === controllerDeviceId &&
          !["completed", "failed", "canceled"].includes(job.status),
      )
      .map((job) => job.order.jobId);
    for (const jobId of canceled) this.cancel(jobId, now);
    return canceled;
  }

  record(jobId: string): FleetRemoteWorkRecord {
    return structuredClone(this.require(jobId));
  }

  discardArtifacts(jobId: string, now = new Date()): FleetRemoteWorkRecord {
    const existing = this.require(jobId);
    if (!["completed", "failed", "canceled"].includes(existing.status))
      throw new Error("fleet_remote_work_not_terminal");
    let result: FleetRemoteWorkRecord | undefined;
    const jobs = this.state.jobs.map((job) => {
      if (job.order.jobId !== jobId) return job;
      const retained = structuredClone(job);
      delete retained.worktreePath;
      delete retained.resultArtifact;
      result = {
        ...retained,
        events: [
          ...job.events,
          {
            sequence: job.events.length + 1,
            type: "artifact_discarded",
            message: "Isolated worktree and returned patch discarded",
            createdAt: now.toISOString(),
          },
        ],
        updatedAt: now.toISOString(),
      };
      return result;
    });
    this.update({ ...this.state, jobs, updatedAt: now.toISOString() });
    return structuredClone(result!);
  }

  list(): FleetRemoteWorkRecord[] {
    return this.state.jobs.map((job) => structuredClone(job));
  }

  trackController(
    record: FleetRemoteWorkRecord,
    now = new Date(),
  ): FleetRemoteWorkRecord {
    validateFleetRemoteWorkOrder(record.order);
    validateState({
      version: 1,
      jobs: [],
      controllerJobs: [record],
      updatedAt: now.toISOString(),
    });
    const existing = this.state.controllerJobs.find(
      (item) => item.order.jobId === record.order.jobId,
    );
    if (
      existing &&
      fleetRemoteWorkDigest(existing.order) !== fleetRemoteWorkDigest(record.order)
    )
      throw new Error("fleet_remote_controller_order_mismatch");
    if (existing && !controllerRecordAdvances(existing, record))
      return structuredClone(existing);
    const retained = existing
      ? this.state.controllerJobs.filter(
          (item) => item.order.jobId !== record.order.jobId,
        )
      : retainForInsert(
          this.state.controllerJobs,
          "fleet_remote_controller_capacity_reached",
        );
    this.update({
      ...this.state,
      controllerJobs: [
        ...retained,
        structuredClone(record),
      ],
      updatedAt: now.toISOString(),
    });
    return structuredClone(record);
  }

  controllerJobs(): FleetRemoteWorkRecord[] {
    return this.state.controllerJobs.map((job) => structuredClone(job));
  }

  stageController(
    order: FleetRemoteWorkOrder,
    now = new Date(),
  ): FleetRemoteWorkRecord {
    const validated = validateFleetRemoteWorkOrder(order),
      existing = this.state.controllerJobs.find(
        (job) => job.order.idempotencyKey === validated.idempotencyKey,
      );
    if (existing) {
      if (
        fleetRemoteWorkDigest(existing.order) !==
        fleetRemoteWorkDigest(validated)
      )
        throw new Error("fleet_remote_work_idempotency_collision");
      return structuredClone(existing);
    }
    const record: FleetRemoteWorkRecord = {
      order: validated,
      status: "queued",
      events: [
        {
          sequence: 1,
          type: "queued",
          message: "Submitting exact work order to target",
          createdAt: now.toISOString(),
        },
      ],
      updatedAt: now.toISOString(),
    };
    return this.trackController(record, now);
  }

  controllerByIdempotencyKey(
    idempotencyKey: string,
  ): FleetRemoteWorkRecord | undefined {
    const record = this.state.controllerJobs.find(
      (job) => job.order.idempotencyKey === idempotencyKey,
    );
    return record ? structuredClone(record) : undefined;
  }

  private require(jobId: string): FleetRemoteWorkRecord {
    const job = this.state.jobs.find((item) => item.order.jobId === jobId);
    if (!job) throw new Error("fleet_remote_work_not_found");
    return job;
  }

  private transition(
    jobId: string,
    status: FleetRemoteWorkRecord["status"],
    type: FleetRemoteWorkEvent["type"],
    message: string,
    now: Date,
    details: {
      worktreePath?: string;
      errorCode?: string;
      resultArtifact?: FleetRemoteWorkRecord["resultArtifact"];
    } = {},
  ): FleetRemoteWorkRecord {
    if (!message || message.length > 4_000) throw new Error("fleet_remote_work_event_invalid");
    let result: FleetRemoteWorkRecord | undefined;
    const jobs = this.state.jobs.map((job) => {
      if (job.order.jobId !== jobId) return job;
      result = {
        ...job,
        status,
        ...details,
        ...(["completed", "failed", "canceled"].includes(status)
          ? { pendingApproval: undefined }
          : {}),
        ...(status === "completed" || status === "failed"
          ? { resultSummary: message }
          : {}),
        events: [
          ...job.events,
          {
            sequence: job.events.length + 1,
            type,
            message,
            createdAt: now.toISOString(),
          },
        ],
        updatedAt: now.toISOString(),
      };
      return result;
    });
    if (!result) throw new Error("fleet_remote_work_not_found");
    this.update({ ...this.state, jobs, updatedAt: now.toISOString() });
    return structuredClone(result);
  }

  private updateJob(
    jobId: string,
    patch: Partial<Pick<FleetRemoteWorkRecord, "pendingApproval">>,
    type: FleetRemoteWorkEvent["type"],
    message: string,
    now: Date,
  ): FleetRemoteWorkRecord {
    let result: FleetRemoteWorkRecord | undefined;
    const jobs = this.state.jobs.map((job) => {
      if (job.order.jobId !== jobId) return job;
      result = {
        ...job,
        ...patch,
        events: [
          ...job.events,
          {
            sequence: job.events.length + 1,
            type,
            message,
            createdAt: now.toISOString(),
          },
        ],
        updatedAt: now.toISOString(),
      };
      return result;
    });
    if (!result) throw new Error("fleet_remote_work_not_found");
    this.update({ ...this.state, jobs, updatedAt: now.toISOString() });
    return structuredClone(result);
  }

  private update(state: FleetRemoteWorkState): void {
    validateState(state);
    this.save(state);
    this.state = state;
  }

  private save(state: FleetRemoteWorkState): void {
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

export function createFleetRemoteWorkOrder(
  input: Omit<FleetRemoteWorkOrder, "version" | "jobId" | "createdAt">,
  now = new Date(),
): FleetRemoteWorkOrder {
  return validateFleetRemoteWorkOrder({
    ...input,
    version: 1,
    jobId: randomUUID(),
    createdAt: now.toISOString(),
  });
}
