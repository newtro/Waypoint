import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  renameSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "./store.js";
import { DatabaseSync } from "node:sqlite";
import {
  createExecutionBudget,
  serializeExecutionBudget,
} from "./execution-budget.js";
import { archiveIntegrity } from "./backup.js";

function setup() {
  const root = mkdtempSync(
      path.join(tmpdir(), "waypoint-provider-foundation-"),
    ),
    data = path.join(root, "private"),
    repo = path.join(root, "repo");
  mkdirSync(data);
  mkdirSync(repo);
  const database = path.join(data, "workspace.sqlite"),
    store = new WorkspaceStore(database),
    workspace = store.createWorkspace("Engineering", data);
  return { root, data, repo, database, store, workspace };
}
function running(
  store: WorkspaceStore,
  workspaceId: string,
  chatId: string,
  profile: ReturnType<WorkspaceStore["listSecurityProfiles"]>[number],
  prompt = "work",
  cli: "codex" | "claude" | "grok" = "codex",
) {
  const run = store.createExecution({
    workspaceId,
    chatId,
    cli,
    securityProfileId: profile.id,
    prompt,
    budgetReceipt: serializeExecutionBudget(
      createExecutionBudget({
        kind: "root",
        profile,
        prompt,
        attachmentCount: 0,
      }),
    ),
  });
  store.startExecution(run, workspaceId, "C:\\trusted\\codex.exe", "test");
  return run;
}

describe("provider agent foundation", () => {
  it("stales pre-dynamic-tool Codex sessions during the schema 43 upgrade", () => {
    const { repo, database, store, workspace } = setup(),
      updated = store.setWorkspaceExecutionRoot(workspace.id, repo),
      chat = store.createChat(workspace.id, "Legacy Codex"),
      profile = store.listSecurityProfiles(workspace.id)[1];
    store.bindProviderSession({
      workspaceId: workspace.id,
      chatId: chat,
      provider: "codex",
      providerSessionId: "legacy-thread",
      executionRoot: updated.executionRoot!,
      securityProfileId: profile.id,
      model: "gpt-test",
    });
    store.close();
    const raw = new DatabaseSync(database);
    raw.prepare("DELETE FROM schema_versions WHERE version>=43").run();
    raw.close();
    const reopened = new WorkspaceStore(database);
    expect(reopened.providerSession(workspace.id, chat, "codex")).toMatchObject(
      {
        providerSessionId: "legacy-thread",
        status: "stale",
      },
    );
    reopened.close();
  });

  it("stales legacy Codex and Grok sessions once for model-directed configuration tools", () => {
    const { repo, database, store, workspace } = setup(),
      updated = store.setWorkspaceExecutionRoot(workspace.id, repo),
      profile = store.listSecurityProfiles(workspace.id)[1];
    for (const provider of ["codex", "grok", "claude"] as const) {
      const chat = store.createChat(workspace.id, `Legacy ${provider}`);
      store.bindProviderSession({
        workspaceId: workspace.id,
        chatId: chat,
        provider,
        providerSessionId: `${provider}-legacy-session`,
        executionRoot: updated.executionRoot!,
        securityProfileId: profile.id,
        model: `${provider}-model`,
      });
    }
    store.close();
    const raw = new DatabaseSync(database);
    raw.prepare("DELETE FROM schema_versions WHERE version=46").run();
    raw.close();
    const reopened = new WorkspaceStore(database);
    for (const chat of reopened.listChats(workspace.id)) {
      const provider = chat.title.replace("Legacy ", "") as
        | "codex"
        | "grok"
        | "claude";
      expect(reopened.providerSession(workspace.id, chat.id, provider)).toMatchObject({
        providerSessionId: `${provider}-legacy-session`,
        status: provider === "claude" ? "active" : "stale",
      });
    }
    reopened.close();
  });

  it("separates a canonical execution root from private workspace data and blocks unsafe changes", () => {
    const { data, repo, store, workspace } = setup();
    expect(workspace.executionRoot).toBeUndefined();
    expect(() =>
      store.setWorkspaceExecutionRoot(workspace.id, path.join(data, "nested")),
    ).toThrow(/existing absolute|private data/);
    mkdirSync(path.join(data, "nested"));
    expect(() =>
      store.setWorkspaceExecutionRoot(workspace.id, path.join(data, "nested")),
    ).toThrow(/private data/);
    const updated = store.setWorkspaceExecutionRoot(workspace.id, repo);
    expect(updated.executionRoot).toBe(realpathSync.native(repo));
    expect(store.listSecurityProfiles(workspace.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Chat · read only",
          roots: [realpathSync.native(repo)],
        }),
        expect.objectContaining({
          name: "Developer · approve changes",
          roots: [realpathSync.native(repo)],
        }),
        expect.objectContaining({
          name: "Full agent · network enabled",
          roots: [realpathSync.native(repo)],
        }),
      ]),
    );
    const chat = store.createChat(workspace.id, "Active"),
      profile = store.listSecurityProfiles(workspace.id)[0],
      run = store.createExecution({
        workspaceId: workspace.id,
        chatId: chat,
        cli: "codex",
        securityProfileId: profile.id,
        prompt: "queued",
        budgetReceipt: serializeExecutionBudget(
          createExecutionBudget({
            kind: "root",
            profile,
            prompt: "queued",
            attachmentCount: 0,
          }),
        ),
      });
    expect(() => store.setWorkspaceExecutionRoot(workspace.id)).toThrow(
      /active AI work/,
    );
    expect(store.cancelQueuedExecution(workspace.id, run)).toBe(true);
    expect(
      store.setWorkspaceExecutionRoot(workspace.id).executionRoot,
    ).toBeUndefined();
    store.close();
  });

  it("blocks repository changes while a hosted provider run is active", () => {
    const { repo, store, workspace } = setup();
    store.setWorkspaceExecutionRoot(workspace.id, repo);
    const chat = store.createChat(workspace.id, "Hosted"),
      source = store.addMessage(workspace.id, chat, "user", "Run with tools"),
      run = store.createHostedRun(
        workspace.id,
        chat,
        source,
        "everyday",
        "test-model",
      );
    store.startHostedRun(workspace.id, run);
    expect(() => store.setWorkspaceExecutionRoot(workspace.id)).toThrow(
      /active AI work/,
    );
    store.close();
  });

  it("binds provider sessions to the exact route and durably resolves or expires requests", () => {
    const { repo, database, store, workspace } = setup(),
      updated = store.setWorkspaceExecutionRoot(workspace.id, repo),
      chat = store.createChat(workspace.id, "Provider session"),
      profile = store.listSecurityProfiles(workspace.id)[1],
      run = running(store, workspace.id, chat, profile);
    expect(
      store.bindProviderSession({
        workspaceId: workspace.id,
        chatId: chat,
        provider: "codex",
        providerSessionId: "thread-123",
        executionRoot: updated.executionRoot!,
        securityProfileId: profile.id,
        model: "gpt-test",
      }),
    ).toMatchObject({
      status: "active",
      providerSessionId: "thread-123",
      executionRoot: updated.executionRoot,
    });
    const approval = store.createProviderRequest({
      workspaceId: workspace.id,
      chatId: chat,
      executionId: run,
      provider: "codex",
      providerRequestId: "approval-1",
      kind: "command",
      title: "Run tests",
      detail: { command: "npm test" },
      options: [{ id: "accept", label: "Allow" }],
    });
    expect(approval).toMatchObject({
      status: "pending",
      detail: { command: "npm test" },
    });
    expect(
      store.createProviderRequest({
        workspaceId: workspace.id,
        chatId: chat,
        executionId: run,
        provider: "codex",
        providerRequestId: "approval-1",
        kind: "command",
        title: "Run tests",
        detail: { command: "npm test" },
        options: [{ id: "accept", label: "Allow" }],
      }),
    ).toEqual(approval);
    expect(() =>
      store.createProviderRequest({
        workspaceId: workspace.id,
        chatId: chat,
        executionId: run,
        provider: "codex",
        providerRequestId: "approval-1",
        kind: "command",
        title: "Run a different command",
        detail: { command: "npm publish" },
      }),
    ).toThrow("reused with a different permission payload");
    expect(
      store.resolveProviderRequest(
        workspace.id,
        String(approval!.id),
        "accepted",
        { scope: "turn" },
      ),
    ).toMatchObject({ status: "accepted", decision: { scope: "turn" } });
    store.createProviderRequest({
      workspaceId: workspace.id,
      chatId: chat,
      executionId: run,
      provider: "codex",
      providerRequestId: "approval-2",
      kind: "file_change",
      title: "Edit file",
      detail: { path: "src/a.ts" },
    });
    store.close();
    const reopened = new WorkspaceStore(database);
    expect(reopened.listProviderRequests(workspace.id, chat)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerRequestId: "approval-1",
          status: "accepted",
        }),
        expect.objectContaining({
          providerRequestId: "approval-2",
          status: "expired",
          decision: { reason: "application_restarted" },
        }),
      ]),
    );
    expect(reopened.listExecutions(workspace.id, chat)[0]).toMatchObject({
      status: "failed",
      errorCode: "interrupted",
    });
    reopened.close();
  });

  it("fails closed when a selected execution root is replaced before restart", () => {
    const { root, repo, database, store, workspace } = setup(),
      updated = store.setWorkspaceExecutionRoot(workspace.id, repo),
      chat = store.createChat(workspace.id, "Root identity"),
      profile = store.listSecurityProfiles(workspace.id)[1],
      run = running(store, workspace.id, chat, profile);
    store.bindProviderSession({
      workspaceId: workspace.id,
      chatId: chat,
      provider: "codex",
      providerSessionId: "thread-root",
      executionRoot: updated.executionRoot!,
      securityProfileId: profile.id,
    });
    store.finishExecution(run, workspace.id, {
      status: "completed",
      exitCode: 0,
    });
    store.close();
    const original = `${repo}-original`,
      replacement = path.join(root, "replacement");
    renameSync(repo, original);
    mkdirSync(replacement);
    symlinkSync(
      replacement,
      repo,
      process.platform === "win32" ? "junction" : "dir",
    );
    const reopened = new WorkspaceStore(database),
      summary = reopened
        .listWorkspaces()
        .find((item) => item.id === workspace.id)!;
    expect(summary.executionRoot).toBeUndefined();
    expect(reopened.listProviderSessions(workspace.id, chat)).toEqual([
      expect.objectContaining({ status: "stale" }),
    ]);
    expect(
      reopened
        .listSecurityProfiles(workspace.id)
        .every(
          (item) =>
            !item.roots.some(
              (candidate) =>
                realpathSync.native(candidate) ===
                realpathSync.native(replacement),
            ),
        ),
    ).toBe(true);
    reopened.close();
  });

  it("fails closed when a selected execution root is replaced while Waypoint is still running", () => {
    const { root, repo, store, workspace } = setup(),
      updated = store.setWorkspaceExecutionRoot(workspace.id, repo),
      chat = store.createChat(workspace.id, "Live root identity"),
      profile = store.listSecurityProfiles(workspace.id)[1],
      run = running(store, workspace.id, chat, profile);
    store.bindProviderSession({
      workspaceId: workspace.id,
      chatId: chat,
      provider: "codex",
      providerSessionId: "thread-live-root",
      executionRoot: updated.executionRoot!,
      securityProfileId: profile.id,
    });
    store.finishExecution(run, workspace.id, {
      status: "completed",
      exitCode: 0,
    });
    const original = `${repo}-original`,
      replacement = path.join(root, "replacement-live");
    renameSync(repo, original);
    mkdirSync(replacement);
    symlinkSync(
      replacement,
      repo,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => store.assertWorkspaceExecutionRoot(workspace.id)).toThrow(
      /changed|unavailable/,
    );
    expect(
      store.listWorkspaces().find((item) => item.id === workspace.id)
        ?.executionRoot,
    ).toBeUndefined();
    expect(store.listProviderSessions(workspace.id, chat)).toEqual([
      expect.objectContaining({ status: "stale" }),
    ]);
    store.close();
  });

  it("repairs an interrupted root-clear by reconciling every active session on startup", () => {
    const { repo, database, store, workspace } = setup(),
      updated = store.setWorkspaceExecutionRoot(workspace.id, repo),
      chat = store.createChat(workspace.id, "Interrupted clear"),
      profile = store.listSecurityProfiles(workspace.id)[1],
      run = running(store, workspace.id, chat, profile);
    store.bindProviderSession({
      workspaceId: workspace.id,
      chatId: chat,
      provider: "codex",
      providerSessionId: "thread-interrupted-clear",
      executionRoot: updated.executionRoot!,
      securityProfileId: profile.id,
    });
    store.finishExecution(run, workspace.id, {
      status: "completed",
      exitCode: 0,
    });
    store.close();
    const raw = new DatabaseSync(database);
    raw
      .prepare(
        "UPDATE workspaces SET execution_root=NULL,execution_root_identity=NULL WHERE id=?",
      )
      .run(workspace.id);
    raw.close();
    const reopened = new WorkspaceStore(database);
    expect(reopened.listProviderSessions(workspace.id, chat)).toEqual([
      expect.objectContaining({ status: "stale" }),
    ]);
    expect(
      reopened.listWorkspaces().find((item) => item.id === workspace.id)
        ?.executionRoot,
    ).toBeUndefined();
    reopened.close();
  });

  it("restores provider history without silently reactivating old provider authority", () => {
    const { root, repo, store, workspace } = setup(),
      updated = store.setWorkspaceExecutionRoot(workspace.id, repo),
      chat = store.createChat(workspace.id, "Portable history"),
      profile = store.listSecurityProfiles(workspace.id)[1],
      run = running(store, workspace.id, chat, profile, "work", "grok");
    store.bindProviderSession({
      workspaceId: workspace.id,
      chatId: chat,
      provider: "grok",
      providerSessionId: "grok-session-portable",
      executionRoot: updated.executionRoot!,
      securityProfileId: profile.id,
    });
    const request = store.createProviderRequest({
      workspaceId: workspace.id,
      chatId: chat,
      executionId: run,
      provider: "grok",
      providerRequestId: "grok-request-portable",
      kind: "command",
      title: "Status",
      detail: { command: "git status" },
    })!;
    store.resolveProviderRequest(workspace.id, String(request.id), "declined", {
      reason: "user",
    });
    store.finishExecution(run, workspace.id, {
      status: "canceled",
      exitCode: null,
    });
    const archive = store.exportWorkspace(workspace.id),
      restored = store.restoreWorkspace(
        archive,
        "Restored history",
        path.join(root, "restored-private"),
      );
    expect(store.listProviderSessions(restored.id)).toEqual([
      expect.objectContaining({
        provider: "grok",
        providerSessionId: "grok-session-portable",
        status: "stale",
      }),
    ]);
    expect(store.listProviderRequests(restored.id)).toEqual([
      expect.objectContaining({
        provider: "grok",
        providerRequestId: "grok-request-portable",
        status: "expired",
        decision: { reason: "workspace_restored" },
      }),
    ]);
    expect(restored.executionRoot).toBeUndefined();
    store.close();
  });

  it("rejects malformed provider request JSON atomically during restore", () => {
    const { root, repo, store, workspace } = setup();
    store.setWorkspaceExecutionRoot(workspace.id, repo);
    const chat = store.createChat(workspace.id, "Malformed backup"),
      profile = store.listSecurityProfiles(workspace.id)[1],
      run = running(store, workspace.id, chat, profile);
    store.createProviderRequest({
      workspaceId: workspace.id,
      chatId: chat,
      executionId: run,
      provider: "codex",
      providerRequestId: "bad-json-probe",
      kind: "command",
      title: "Probe",
      detail: { command: "status" },
    });
    store.finishExecution(run, workspace.id, {
      status: "canceled",
      exitCode: null,
    });
    const archive = store.exportWorkspace(workspace.id),
      row = archive.objects.provider_requests![0] as Record<string, unknown>,
      before = store.listWorkspaces().length;
    row.detail_json = "not-json";
    archive.integrity = archiveIntegrity({
      version: archive.version,
      exportedAt: archive.exportedAt,
      workspace: archive.workspace,
      objects: archive.objects,
    });
    expect(() =>
      store.restoreWorkspace(
        archive,
        "Must not restore",
        path.join(root, "invalid-restore"),
      ),
    ).toThrow(/Provider request detail archive is invalid/);
    expect(store.listWorkspaces()).toHaveLength(before);
    store.close();
  });
});
