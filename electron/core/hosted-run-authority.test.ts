import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "./store.js";

describe("hosted run authority provenance", () => {
  it("exposes the exact profile recorded when a hosted run is created", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-hosted-authority-")),
      store = new WorkspaceStore(path.join(root, "waypoint.sqlite")),
      workspace = store.createWorkspace("Hosted authority", root),
      chat = store.createChat(workspace.id, "Hosted work"),
      source = store.addMessage(workspace.id, chat, "user", "Do bounded work"),
      profile = store.listSecurityProfiles(workspace.id)[1],
      run = store.createHostedRun(
        workspace.id,
        chat,
        source,
        "everyday",
        "test-model",
        profile.id,
      );

    expect(store.listHostedRuns(workspace.id, chat)[0]).toMatchObject({
      id: run,
      securityProfileId: profile.id,
    });
    store.close();
  });
});
