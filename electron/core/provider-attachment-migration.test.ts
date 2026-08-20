import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "./store.js";
import { CURRENT_SCHEMA_VERSION, schemaVersion } from "./migrations.js";

describe("provider attachment route migration", () => {
  it("preserves existing OpenRouter roles and adds a non-executing curated image default", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-provider-route-")),
      database = path.join(root, "waypoint.sqlite"),
      store = new WorkspaceStore(database);
    store.setOpenRouterSettings({
      enabled: true,
      liveRequestsEnabled: true,
      strategicModel: "legacy/strategy",
      everydayModel: "legacy/everyday",
      attachmentModel: "qwen/qwen3.8-max",
      fallbackProvider: "claude",
      monthlyCapMicros: 123,
      ytdCapMicros: 456,
      perRequestCapMicros: 78,
      warningPercent: 75,
    });
    store.close();
    const legacy = new DatabaseSync(database);
    legacy.exec("ALTER TABLE provider_settings DROP COLUMN attachment_model");
    legacy.prepare("DELETE FROM schema_versions WHERE version>=39").run();
    expect(schemaVersion(legacy)).toBe(38);
    legacy.close();
    const migrated = new WorkspaceStore(database),
      settings = migrated.openRouterSettings(),
      verification = new DatabaseSync(database);
    expect(schemaVersion(verification)).toBe(CURRENT_SCHEMA_VERSION);
    verification.close();
    expect(settings).toMatchObject({
      enabled: true,
      liveRequestsEnabled: true,
      strategicModel: "legacy/strategy",
      everydayModel: "legacy/everyday",
      attachmentModel: "moonshotai/kimi-k3",
      fallbackProvider: "claude",
      monthlyCapMicros: 123,
      ytdCapMicros: 456,
      perRequestCapMicros: 78,
      warningPercent: 75,
    });
    migrated.close();
  });
  it("preserves OpenRouter settings, receipts, hosted runs, and events from v44 while enabling Grok fallback", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-provider-v45-")),
      database = path.join(root, "waypoint.sqlite"),
      store = new WorkspaceStore(database),
      workspace = store.createWorkspace("V45 migration", root),
      chat = store.createChat(workspace.id, "Migration"),
      message = store.addMessage(
        workspace.id,
        chat,
        "user",
        "Preserve this hosted run",
      ),
      startedAt = "2026-08-14T12:00:00.000Z";
    store.setOpenRouterSettings({
      enabled: true,
      liveRequestsEnabled: true,
      strategicModel: "legacy/strategy",
      everydayModel: "legacy/everyday",
      attachmentModel: "moonshotai/kimi-k3",
      fallbackProvider: "claude",
      monthlyCapMicros: 123,
      ytdCapMicros: 456,
      perRequestCapMicros: 78,
      warningPercent: 75,
    });
    const run = store.createHostedRun(
      workspace.id,
      chat,
      message,
      "everyday",
      "legacy/everyday",
    );
    store.startHostedRun(workspace.id, run);
    store.addHostedRunEvent(
      workspace.id,
      run,
      "progress",
      "Preserved progress",
    );
    store.finishHostedRun(
      workspace.id,
      run,
      "completed",
      {
        id: "v44-receipt",
        workspaceId: workspace.id,
        provider: "openrouter",
        model: "legacy/everyday",
        role: "everyday",
        status: "completed",
        costMicros: 12,
        promptTokens: 3,
        completionTokens: 2,
        requestDigest: "a".repeat(64),
        fallbackProvider: "claude",
        startedAt,
        finishedAt: startedAt,
      },
      "Preserved answer",
    );
    store.close();
    const legacy = new DatabaseSync(database);
    legacy.exec(`
      PRAGMA defer_foreign_keys=ON;
      CREATE TEMP TABLE old_settings AS SELECT * FROM provider_settings;
      CREATE TEMP TABLE old_receipts AS SELECT * FROM provider_usage_receipts;
      CREATE TEMP TABLE old_runs AS SELECT * FROM hosted_runs;
      CREATE TEMP TABLE old_events AS SELECT * FROM hosted_run_events;
      DROP TABLE hosted_run_events;
      DROP TABLE hosted_runs;
      DROP INDEX IF EXISTS idx_provider_usage_workspace_time;
      DROP TABLE provider_usage_receipts;
      DROP TABLE provider_settings;
      CREATE TABLE provider_settings(provider TEXT PRIMARY KEY CHECK(provider='openrouter'),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),live_requests_enabled INTEGER NOT NULL CHECK(live_requests_enabled IN (0,1)),strategic_model TEXT NOT NULL,everyday_model TEXT NOT NULL,attachment_model TEXT NOT NULL DEFAULT 'moonshotai/kimi-k3',fallback_provider TEXT CHECK(fallback_provider IN ('codex','claude')),monthly_cap_micros INTEGER NOT NULL,ytd_cap_micros INTEGER NOT NULL,per_request_cap_micros INTEGER NOT NULL,warning_percent INTEGER NOT NULL,updated_at TEXT NOT NULL);
      INSERT INTO provider_settings SELECT * FROM old_settings;
      CREATE TABLE provider_usage_receipts(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,provider TEXT NOT NULL CHECK(provider='openrouter'),model TEXT NOT NULL,route_role TEXT NOT NULL CHECK(route_role IN ('strategic','everyday')),status TEXT NOT NULL CHECK(status IN ('completed','failed','canceled','blocked')),cost_micros INTEGER NOT NULL,prompt_tokens INTEGER NOT NULL,completion_tokens INTEGER NOT NULL,request_digest TEXT NOT NULL,response_id TEXT,error_code TEXT,fallback_provider TEXT CHECK(fallback_provider IN ('codex','claude')),started_at TEXT NOT NULL,finished_at TEXT NOT NULL);
      INSERT INTO provider_usage_receipts SELECT * FROM old_receipts;
      CREATE INDEX idx_provider_usage_workspace_time ON provider_usage_receipts(workspace_id,finished_at DESC,id);
      CREATE TABLE hosted_runs(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,route_role TEXT NOT NULL CHECK(route_role IN ('strategic','everyday')),model TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','canceled')),started_at TEXT,finished_at TEXT,error_code TEXT,usage_receipt_id TEXT REFERENCES provider_usage_receipts(id) ON DELETE SET NULL,created_at TEXT NOT NULL);
      INSERT INTO hosted_runs SELECT * FROM old_runs;
      CREATE TABLE hosted_run_events(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES hosted_runs(id) ON DELETE CASCADE,sequence INTEGER NOT NULL,type TEXT NOT NULL,text TEXT,created_at TEXT NOT NULL,UNIQUE(run_id,sequence));
      INSERT INTO hosted_run_events SELECT * FROM old_events;
      DELETE FROM schema_versions WHERE version>=45;
    `);
    expect(schemaVersion(legacy)).toBe(44);
    legacy.close();
    const migrated = new WorkspaceStore(database);
    expect(migrated.openRouterSettings().fallbackProvider).toBe("claude");
    expect(migrated.providerUsage(workspace.id).receipts).toEqual([
      expect.objectContaining({
        id: "v44-receipt",
        fallbackProvider: "claude",
      }),
    ]);
    expect(migrated.listHostedRuns(workspace.id, chat)).toEqual([
      expect.objectContaining({
        id: run,
        status: "completed",
        events: expect.arrayContaining([
          expect.objectContaining({ text: "Preserved progress" }),
          expect.objectContaining({ type: "terminal" }),
        ]),
      }),
    ]);
    migrated.setOpenRouterSettings({
      ...migrated.openRouterSettings(),
      fallbackProvider: "grok",
    });
    expect(migrated.openRouterSettings().fallbackProvider).toBe("grok");
    migrated.close();
    const verification = new DatabaseSync(database);
    expect(schemaVersion(verification)).toBe(CURRENT_SCHEMA_VERSION);
    expect(verification.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(verification.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    verification.close();
  });
});
