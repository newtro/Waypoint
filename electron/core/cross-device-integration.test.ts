import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "./store.js";

describe("isolated two-store remote job convergence", () => {
  it("returns results, makes controller cancellation dominate, rejects stale epoch, deduplicates, and prevents resurrection after delete", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-remote-pair-")),
      seedPath = path.join(root, "seed.sqlite"),
      seed = new WorkspaceStore(seedPath),
      workspace = seed.createWorkspace("Paired fixture", root);
    seed.close();
    const controllerPath = path.join(root, "controller.sqlite"),
      workerPath = path.join(root, "worker.sqlite");
    copyFileSync(seedPath, controllerPath);
    copyFileSync(seedPath, workerPath);
    const controller = new WorkspaceStore(controllerPath),
      worker = new WorkspaceStore(workerPath),
      controllerId = "controller_device_01",
      workerId = "worker_device_00001",
      requestPolicy = "a".repeat(64),
      targetPolicy = "b".repeat(64);
    controller.configureSyncDevice(workspace.id, controllerId);
    worker.configureSyncDevice(workspace.id, workerId);
    worker.setDeviceControlPolicy(workspace.id, {
      version: 1,
      enabled: true,
      failover: false,
      allowedCapabilities: ["waypoint.workspace_summary"],
      maxDurationMs: 60_000,
      maxConcurrency: 1,
    });
    const job = controller.createRemoteJobRecord({
        workspaceId: workspace.id,
        controllerDeviceId: controllerId,
        targetDeviceId: workerId,
        capability: "waypoint.workspace_summary",
        instruction: "Return summary",
        idempotencyKey: "paired_request_0001",
        profileDigest: requestPolicy,
        keyEpoch: 4,
        timeoutMs: 60_000,
      }),
      queued = controller
        .pendingSyncChanges(workspace.id)
        .find((item) => item.objectId === job.id)!;
    expect(
      worker.applyInboundSyncChange({
        ...queued,
        envelopeId: "paired-envelope-queued",
      }),
    ).toBe("applied");
    expect(
      worker.applyInboundSyncChange({
        ...queued,
        envelopeId: "paired-envelope-queued",
      }),
    ).toBe("replay");
    expect(
      worker.claimRemoteJob(workspace.id, workerId, 3, targetPolicy),
    ).toBeUndefined();
    const claim = worker.claimRemoteJob(
      workspace.id,
      workerId,
      4,
      targetPolicy,
    )!;
    worker.startRemoteJob(workspace.id, job.id, claim.leaseId);
    expect(controller.cancelRemoteJob(workspace.id, job.id)).toBe(true);
    worker.finishRemoteJob(
      workspace.id,
      job.id,
      claim.leaseId,
      "completed",
      "Late worker result",
    );
    const completed = [...worker.pendingSyncChanges(workspace.id)]
        .reverse()
        .find(
          (item) =>
            item.objectId === job.id &&
            String((item.payload as Record<string,unknown>).status) === "completed",
        )!,
      canceled = [...controller.pendingSyncChanges(workspace.id)]
        .reverse()
        .find(
          (item) =>
            item.objectId === job.id &&
            String((item.payload as Record<string,unknown>).status) === "canceled",
        )!;
    worker.applyInboundSyncChange({
      ...canceled,
      envelopeId: "paired-envelope-cancel",
    });
    controller.applyInboundSyncChange({
      ...completed,
      envelopeId: "paired-envelope-complete",
    });
    expect((worker.listRemoteJobs(workspace.id)[0] as Record<string,unknown>).status).toBe("canceled");
    expect((controller.listRemoteJobs(workspace.id)[0] as Record<string,unknown>).status).toBe("canceled");
    controller.deleteRemoteJob(workspace.id, job.id);
    const deletion = [...controller.pendingSyncChanges(workspace.id)]
      .reverse()
      .find((item) => item.objectId === job.id && item.operation === "delete")!;
    worker.applyInboundSyncChange({
      ...deletion,
      envelopeId: "paired-envelope-delete",
    });
    expect(worker.listRemoteJobs(workspace.id)).toHaveLength(0);
    expect([
      worker.applyInboundSyncChange({
        ...completed,
        envelopeId: "paired-envelope-late",
      }),
    ]).toEqual(expect.arrayContaining([expect.stringMatching(/^(?:ignored|replay)$/)]));
    expect(worker.listRemoteJobs(workspace.id)).toHaveLength(0);
    controller.close();
    worker.close();
  });
});
