import { describe, expect, it } from "vitest";
import {
  createRemoteJob,
  defaultWorkerPolicy,
  issueJobLease,
  jobRequestDigest,
  selectTarget,
  validateJobLease,
  validateWorkerPolicy,
} from "./cross-device-control.js";
const devices = [
  {
    deviceId: "mac",
    platform: "darwin" as const,
    online: true,
    active: false,
    workerEnabled: true,
    capabilities: ["waypoint.workspace_summary", "agent.claude"] as const,
    availableMemoryMb: 32000,
  },
  {
    deviceId: "pc",
    platform: "win32" as const,
    online: true,
    active: true,
    workerEnabled: true,
    capabilities: ["waypoint.workspace_summary", "agent.codex"] as const,
    availableMemoryMb: 16000,
  },
];
describe("cross-device routing and leases", () => {
  it("keeps idempotency identity stable across generated IDs and timestamps",()=>{const base={workspaceId:"workspace-a",controllerDeviceId:"pc",targetDeviceId:"mac",capability:"waypoint.workspace_summary" as const,instruction:"Summary",idempotencyKey:"request-00000001",profileDigest:"a".repeat(64),keyEpoch:3,timeoutMs:60_000,origin:"user" as const};expect(jobRequestDigest(createRemoteJob(base,new Date(0)))).toBe(jobRequestDigest(createRemoteJob(base,new Date(10_000))))});
  it("defaults worker and failover off", () =>
    expect(defaultWorkerPolicy()).toMatchObject({
      enabled: false,
      failover: false,
      maxConcurrency: 1,
    }));
  it("prefers active device but routes platform work to Mac", () => {
    expect(
      selectTarget({
        localDeviceId: "pc",
        preference: "automatic",
        requirement: { capability: "waypoint.workspace_summary" },
        devices: devices as never,
        allowFailover: false,
      }).selected?.deviceId,
    ).toBe("pc");
    expect(
      selectTarget({
        localDeviceId: "pc",
        preference: "automatic",
        requirement: { capability: "agent.claude", platform: "darwin" },
        devices: devices as never,
        allowFailover: false,
      }).selected?.deviceId,
    ).toBe("mac");
  });
  it("does not fail over a selected offline target unless explicitly allowed", () => {
    const offline = [
      ...devices,
      { ...devices[0], deviceId: "preferred", online: false },
    ];
    expect(
      selectTarget({
        localDeviceId: "pc",
        preference: "preferred",
        requirement: { capability: "waypoint.workspace_summary" },
        devices: offline as never,
        allowFailover: false,
      }).selected,
    ).toBeUndefined();
    expect(
      selectTarget({
        localDeviceId: "pc",
        preference: "preferred",
        requirement: { capability: "waypoint.workspace_summary" },
        devices: offline as never,
        allowFailover: true,
      }).selected?.deviceId,
    ).toBe("pc");
  });
  it("binds finite leases to target/profile/epoch and rejects stale or replayed context", () => {
    const job = createRemoteJob(
        {
          workspaceId: "workspace-a",
          controllerDeviceId: "pc",
          targetDeviceId: "mac",
          capability: "waypoint.workspace_summary",
          instruction: "Return a bounded workspace summary",
          idempotencyKey: "request-00000001",
          profileDigest: "a".repeat(64),
          keyEpoch: 3,
          timeoutMs: 60_000,
          origin: "user",
        },
        new Date(0),
      ),
      lease = issueJobLease(job, new Date(0));
    expect(jobRequestDigest(job)).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      validateJobLease(lease, job, {
        deviceId: "mac",
        profileDigest: "a".repeat(64),
        keyEpoch: 3,
        now: new Date(1),
      }),
    ).not.toThrow();
    expect(() =>
      validateJobLease(lease, job, {
        deviceId: "pc",
        profileDigest: "a".repeat(64),
        keyEpoch: 3,
        now: new Date(1),
      }),
    ).toThrow();
    expect(() =>
      validateJobLease(lease, job, {
        deviceId: "mac",
        profileDigest: "a".repeat(64),
        keyEpoch: 4,
        now: new Date(1),
      }),
    ).toThrow();
    expect(() =>
      validateJobLease(lease, job, {
        deviceId: "mac",
        profileDigest: "a".repeat(64),
        keyEpoch: 3,
        now: new Date(61_000),
      }),
    ).toThrow();
  });
  it("rejects policy expansion and non-user jobs", () => {
    expect(() =>
      validateWorkerPolicy({
        ...defaultWorkerPolicy(),
        allowedCapabilities: ["terminal.run"],
      }),
    ).toThrow();
    expect(() =>
      createRemoteJob({
        workspaceId: "w",
        controllerDeviceId: "pc",
        targetDeviceId: "mac",
        capability: "waypoint.workspace_summary",
        instruction: "x",
        idempotencyKey: "request-00000001",
        profileDigest: "a".repeat(64),
        keyEpoch: 1,
        timeoutMs: 60_000,
        origin: "ai" as never,
      }),
    ).toThrow();
  });
});
