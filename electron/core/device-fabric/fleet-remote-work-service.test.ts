import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFleetRemoteWorkOrder,
  FleetRemoteWorkService,
} from "./fleet-remote-work-service.js";

const protector = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).map((byte) => byte ^ 0x3d),
  decrypt: (value: Uint8Array) =>
    Buffer.from(Buffer.from(value).map((byte) => byte ^ 0x3d)).toString(),
};

function order(mode: "supervised" | "autonomous" = "supervised") {
  return createFleetRemoteWorkOrder({
    idempotencyKey: "remote_request_0001",
    controllerDeviceId: "controller_device_0001",
    targetDeviceId: "target_device_0000001",
    workspaceId: "workspace_remote_0001",
    provider: "codex",
    mode,
    instruction: "Make the bounded change and run tests",
    controllerRoot: path.resolve("D:/Repos/Waypoint"),
    controllerProfileId: "profile_controller_001",
    targetRoot: path.resolve("D:/Repos/Waypoint"),
    targetProfileId: "profile_remote_0001",
    timeoutMs: 300_000,
  });
}

describe("fleet remote work durable lifecycle", () => {
  it("requires target approval in supervised mode and survives restart", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-work-")),
      service = new FleetRemoteWorkService(root, protector),
      accepted = service.accept(order());
    expect(accepted.status).toBe("waiting_approval");
    service.approve(accepted.order.jobId);
    const claimed = service.claim()!;
    expect(claimed.status).toBe("running");
    service.finish(
      claimed.order.jobId,
      "completed",
      "Target tests passed",
      {
        worktreePath: "D:/managed/worktree",
        resultArtifact: {
          patchBase64: "",
          patchSha256:
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          baseCommit: "a".repeat(40),
          status: [],
        },
      },
    );
    expect(new FleetRemoteWorkService(root, protector).record(claimed.order.jobId))
      .toMatchObject({
        status: "completed",
        resultSummary: "Target tests passed",
        worktreePath: "D:/managed/worktree",
      });
    service.trackController(service.record(claimed.order.jobId));
    const tracked = new FleetRemoteWorkService(root, protector).controllerJobs();
    expect(tracked).toHaveLength(1);
    expect(tracked[0].order.jobId).toBe(claimed.order.jobId);
    expect(service.discardArtifacts(claimed.order.jobId)).not.toHaveProperty(
      "resultArtifact",
    );
  });

  it("is idempotent, rejects collisions, and lets autonomous work queue", () => {
    const service = new FleetRemoteWorkService(
        mkdtempSync(path.join(tmpdir(), "waypoint-fleet-work-idem-")),
        protector,
      ),
      request = order("autonomous"),
      first = service.accept(request);
    expect(first.status).toBe("queued");
    expect(service.accept(request).order.jobId).toBe(first.order.jobId);
    expect(() =>
      service.accept({ ...request, instruction: "Different request bytes" }),
    ).toThrow(/idempotency_collision/);
    expect(service.cancel(first.order.jobId).status).toBe("canceled");
    expect(service.cancel(first.order.jobId).status).toBe("canceled");
  });

  it("rejects a handoff whose digest does not match its bounded bytes", () => {
    const bytesBase64 = Buffer.from("patch").toString("base64"),
      request = order("autonomous");
    expect(() =>
      new FleetRemoteWorkService(
        mkdtempSync(path.join(tmpdir(), "waypoint-fleet-work-bundle-")),
        protector,
      ).accept({
        ...request,
        handoff: {
          kind: "patch_bundle",
          repositoryName: "Waypoint",
          bytesBase64,
          sha256: "0".repeat(64),
        },
      }),
    ).toThrow(/invalid/);
  });

  it("fails interrupted work, expires queued work, and cancels on controller revoke", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-work-recover-")),
      service = new FleetRemoteWorkService(root, protector),
      runningOrder = order("autonomous"),
      running = service.accept(runningOrder);
    service.claim(new Date(runningOrder.createdAt));
    expect(new FleetRemoteWorkService(root, protector).record(running.order.jobId))
      .toMatchObject({ status: "failed", errorCode: "fleet_remote_interrupted" });

    const later = createFleetRemoteWorkOrder(
      {
        ...order("autonomous"),
        idempotencyKey: "remote_request_timeout_01",
      },
      new Date("2026-08-21T12:00:00.000Z"),
    );
    service.accept(later, new Date("2026-08-21T12:00:00.000Z"));
    service.claim(new Date("2026-08-21T13:00:00.000Z"));
    expect(service.record(later.jobId)).toMatchObject({
      status: "failed",
      errorCode: "fleet_remote_timeout",
    });

    const revoked = createFleetRemoteWorkOrder({
      ...order("supervised"),
      idempotencyKey: "remote_request_revoke_01",
    });
    service.accept(revoked);
    expect(service.cancelByController(revoked.controllerDeviceId)).toContain(
      revoked.jobId,
    );
    expect(service.record(revoked.jobId).status).toBe("canceled");
  });

  it("persists one supervised provider request and resolves only its exact ID", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-approval-")),
      service = new FleetRemoteWorkService(root, protector),
      accepted = service.accept(order("supervised"));
    service.approve(accepted.order.jobId);
    service.claim();
    const request = service.requestProviderApproval(accepted.order.jobId, {
      requestId: "provider_request_0001",
      kind: "command",
      title: "Run the focused tests",
      detail: '{"command":"npm test"}',
      createdAt: new Date().toISOString(),
    });
    expect(request.pendingApproval).toMatchObject({
      requestId: "provider_request_0001",
      kind: "command",
    });
    expect(
      new FleetRemoteWorkService(root, protector).record(accepted.order.jobId)
        .pendingApproval,
    ).toMatchObject({ requestId: "provider_request_0001" });
    expect(() =>
      service.resolveProviderApproval(
        accepted.order.jobId,
        "provider_request_wrong",
        true,
      ),
    ).toThrow(/not_pending/);
    expect(
      service.resolveProviderApproval(
        accepted.order.jobId,
        "provider_request_0001",
        true,
      ).pendingApproval,
    ).toBeUndefined();
  });

  it("journals the exact controller order before send and reconciles retries", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-controller-")),
      service = new FleetRemoteWorkService(root, protector),
      request = order("autonomous"),
      staged = service.stageController(request);
    expect(staged.status).toBe("queued");
    expect(
      new FleetRemoteWorkService(root, protector).controllerByIdempotencyKey(
        request.idempotencyKey,
      )?.order.jobId,
    ).toBe(request.jobId);
    expect(service.stageController(request).order.jobId).toBe(request.jobId);
    expect(() =>
      service.stageController({ ...request, instruction: "Changed contract" }),
    ).toThrow(/idempotency_collision/);
  });

  it("keeps controller progress monotonic and expires an unconfirmed stage", () => {
    const service = new FleetRemoteWorkService(
        mkdtempSync(path.join(tmpdir(), "waypoint-fleet-controller-order-")),
        protector,
      ),
      request = order("autonomous"),
      staged = service.stageController(request),
      running = {
        ...staged,
        status: "running" as const,
        events: [
          {
            sequence: 1,
            type: "started" as const,
            message: "Target execution started",
            createdAt: request.createdAt,
          },
        ],
      },
      completed = {
        ...running,
        status: "completed" as const,
        resultSummary: "done",
        events: [
          ...running.events,
          {
            sequence: 2,
            type: "completed" as const,
            message: "done",
            createdAt: new Date(Date.parse(request.createdAt) + 1_000).toISOString(),
          },
        ],
        updatedAt: new Date(Date.parse(request.createdAt) + 1_000).toISOString(),
      };
    expect(service.trackController(running).status).toBe("running");
    expect(service.trackController(completed).status).toBe("completed");
    expect(service.trackController(running).status).toBe("completed");

    const expiring = createFleetRemoteWorkOrder(
      {
        ...order("autonomous"),
        idempotencyKey: "remote_request_staged_expiry",
      },
      new Date("2026-08-21T12:00:00.000Z"),
    );
    service.stageController(expiring, new Date("2026-08-21T12:00:00.000Z"));
    expect(
      service.expireControllerPending(new Date("2026-08-21T13:00:00.000Z")),
    ).toContain(expiring.jobId);
    expect(service.controllerByIdempotencyKey(expiring.idempotencyKey)).toMatchObject({
      status: "failed",
      errorCode: "fleet_remote_timeout",
    });
  });

  it("never evicts live target or controller records at capacity", () => {
    const target = new FleetRemoteWorkService(
        mkdtempSync(path.join(tmpdir(), "waypoint-fleet-target-capacity-")),
        protector,
      ),
      controller = new FleetRemoteWorkService(
        mkdtempSync(path.join(tmpdir(), "waypoint-fleet-controller-capacity-")),
        protector,
      );
    let firstTarget = "",
      firstController = "";
    for (let index = 0; index < 128; index += 1) {
      const request = createFleetRemoteWorkOrder({
        ...order("supervised"),
        idempotencyKey: `remote_target_capacity_${String(index).padStart(3, "0")}`,
      });
      if (!index) firstTarget = request.jobId;
      target.accept(request);
      const controllerRequest = createFleetRemoteWorkOrder({
        ...order("autonomous"),
        idempotencyKey: `remote_controller_capacity_${String(index).padStart(3, "0")}`,
      });
      if (!index) firstController = controllerRequest.jobId;
      controller.stageController(controllerRequest);
    }
    expect(() =>
      target.accept(
        createFleetRemoteWorkOrder({
          ...order("supervised"),
          idempotencyKey: "remote_target_capacity_overflow",
        }),
      ),
    ).toThrow(/capacity/);
    expect(() =>
      controller.stageController(
        createFleetRemoteWorkOrder({
          ...order("autonomous"),
          idempotencyKey: "remote_controller_capacity_overflow",
        }),
      ),
    ).toThrow(/capacity/);
    expect(target.record(firstTarget).status).toBe("waiting_approval");
    expect(controller.controllerJobs()[0].order.jobId).toBe(firstController);
  });
});
