import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "./store.js";
import { archiveIntegrity } from "./backup.js";

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "waypoint-automation-")),
    store = new WorkspaceStore(path.join(root, "waypoint.sqlite")),
    workspace = store.createWorkspace("Personal", root);
  return { root, store, workspace };
}

describe("fixture automation lab", () => {
  it("requires a current dry run, is idempotent, paused, scoped, and killable", () => {
    const { root, store, workspace } = setup(),
      other = store.createWorkspace("Other", path.join(root, "other"));
    const id = store.createFixturePlaybook(
      workspace.id,
      "Morning fixture review",
      "America/New_York",
      9,
      0,
    );
    expect(store.listFixturePlaybooks(workspace.id)[0]).toMatchObject({
      id,
      status: "paused",
      timezone: "America/New_York",
      hour: 9,
      minute: 0,
    });
    expect(() => store.enableFixtureSchedule()).toThrow(
      /separate user authorization/i,
    );
    expect(() => store.runFixturePlaybook(workspace.id, id, "stale")).toThrow(
      /dry run/i,
    );
    expect(() => store.dryRunFixturePlaybook(other.id, id)).toThrow(
      /not found/i,
    );
    const preview = store.dryRunFixturePlaybook(workspace.id, id);
    expect(preview).toMatchObject({
      inputCount: 3,
      deduplicatedCount: 2,
      proposedEffects: 0,
    });
    expect(JSON.stringify(preview)).not.toContain(
      "ignore previous instructions",
    );
    const first = store.runFixturePlaybook(workspace.id, id, preview.digest);
    expect(first).toMatchObject({ status: "completed", idempotent: false });
    expect(
      store.runFixturePlaybook(workspace.id, id, preview.digest),
    ).toMatchObject({
      runId: first.runId,
      status: "completed",
      idempotent: true,
    });
    expect(
      store
        .pendingSyncChanges(workspace.id)
        .some((change) =>
          JSON.stringify(change).includes("Morning fixture review"),
        ),
    ).toBe(false);
    expect(JSON.stringify(store.listActivity(workspace.id))).not.toContain(
      "ignore previous instructions",
    );
    store.killFixturePlaybook(workspace.id, id);
    expect(() => store.dryRunFixturePlaybook(workspace.id, id)).toThrow(
      /kill switch/i,
    );
    store.deleteFixturePlaybook(workspace.id, id);
    expect(store.listFixturePlaybooks(workspace.id)).toEqual([]);
    expect(
      store.exportWorkspace(workspace.id).objects.fixture_playbook_runs,
    ).toEqual([]);
    store.close();
  });

  it("retries deterministically, dead-letters, and restores without runnable authority", () => {
    const { root, store, workspace } = setup(),
      id = store.createFixturePlaybook(
        workspace.id,
        "Failure fixture",
        "UTC",
        8,
        30,
      ),
      preview = store.dryRunFixturePlaybook(workspace.id, id);
    expect(
      store.runFixturePlaybook(workspace.id, id, preview.digest, true).status,
    ).toBe("retrying");
    expect(
      store.runFixturePlaybook(workspace.id, id, preview.digest, true).status,
    ).toBe("retrying");
    expect(
      store.runFixturePlaybook(workspace.id, id, preview.digest, true).status,
    ).toBe("dead_letter");
    expect(
      store.runFixturePlaybook(workspace.id, id, preview.digest, true),
    ).toMatchObject({ status: "dead_letter", idempotent: true });
    const archive = store.exportWorkspace(workspace.id),
      restored = store.restoreWorkspace(
        archive,
        "Restored",
        path.join(root, "restored"),
      ),
      playbook = store.listFixturePlaybooks(restored.id)[0];
    expect(playbook).toMatchObject({
      title: "Failure fixture",
      status: "paused",
    });
    expect(playbook.runs.some((run) => run.status === "dead_letter")).toBe(
      true,
    );
    expect(() =>
      store.runFixturePlaybook(restored.id, playbook.id, preview.digest),
    ).toThrow(/dry run/i);
    store.close();
  });

  it("rejects archived definition and authority escalation", () => {
    const { root, store, workspace } = setup(),
      id = store.createFixturePlaybook(
        workspace.id,
        "Tamper fixture",
        "UTC",
        8,
        0,
      );
    store.dryRunFixturePlaybook(workspace.id, id);
    const changedDefinition = structuredClone(
      store.exportWorkspace(workspace.id),
    );
    (
      changedDefinition.objects.fixture_playbooks[0] as Record<string, unknown>
    ).definition_json = '{"schemaVersion":999}';
    changedDefinition.integrity = archiveIntegrity({ version: changedDefinition.version, exportedAt: changedDefinition.exportedAt, workspace: changedDefinition.workspace, objects: changedDefinition.objects });
    expect(() =>
      store.restoreWorkspace(
        changedDefinition,
        "Changed definition",
        path.join(root, "changed"),
      ),
    ).toThrow(/integrity|authority|definition/i);
    const changedAuthority = structuredClone(
        store.exportWorkspace(workspace.id),
      ),
      row = changedAuthority.objects.fixture_playbooks[0] as Record<
        string,
        unknown
      >,
      permission = JSON.parse(String(row.permission_json));
    permission.tenantId = "external";
    permission.scopes.push("fixture.write");
    row.permission_json = JSON.stringify(permission);
    changedAuthority.integrity = archiveIntegrity({ version: changedAuthority.version, exportedAt: changedAuthority.exportedAt, workspace: changedAuthority.workspace, objects: changedAuthority.objects });
    expect(() =>
      store.restoreWorkspace(
        changedAuthority,
        "Changed authority",
        path.join(root, "authority"),
      ),
    ).toThrow(/integrity|authority/i);
    store.close();
  });
});
