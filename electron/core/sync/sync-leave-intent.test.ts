import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SyncLeaveIntentStore } from "./sync-leave-intent.js";

const protector = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).map((byte) => byte ^ 0x36),
  decrypt: (value: Uint8Array) =>
    Buffer.from(Buffer.from(value).map((byte) => byte ^ 0x36)).toString("utf8"),
};

describe("sync leave recovery intent", () => {
  it("persists an idempotent intent across restart until completion", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-sync-leave-"));
    const first = new SyncLeaveIntentStore(root, protector),
      workspaceId = "leave_workspace_001";
    const intent = first.begin(
      workspaceId,
      new Date("2026-08-21T16:00:00.000Z"),
    );
    expect(first.begin(workspaceId)).toEqual(intent);
    const reopened = new SyncLeaveIntentStore(root, protector);
    expect(reopened.list()).toEqual([intent]);
    reopened.complete(workspaceId);
    expect(new SyncLeaveIntentStore(root, protector).list()).toEqual([]);
  });

  it("fails closed for malformed recovery state", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-sync-leave-bad-"));
    const substituted = JSON.stringify({
      version: 1,
      workspaceId: "leave_workspace_003",
      createdAt: "2026-08-21T16:00:00.000Z",
    });
    writeFileSync(
      path.join(root, "leave_workspace_002.leave.json"),
      Buffer.from(protector.encrypt(substituted)),
    );
    expect(() => new SyncLeaveIntentStore(root, protector).list()).toThrow(
      /Invalid sync leave recovery intent/,
    );
  });
});
