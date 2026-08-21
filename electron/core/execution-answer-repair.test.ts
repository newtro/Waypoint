import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repairLegacySectionlessAnswers } from "./execution-answer-repair.js";
import { WorkspaceStore } from "./store.js";
import {
  createExecutionBudget,
  serializeExecutionBudget,
} from "./execution-budget.js";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE executions(id TEXT PRIMARY KEY,workspace_id TEXT,chat_id TEXT,cli TEXT,status TEXT,created_at TEXT);
    CREATE TABLE chats(id TEXT PRIMARY KEY,workspace_id TEXT,title TEXT);
    CREATE TABLE messages(id TEXT PRIMARY KEY,chat_id TEXT,role TEXT,body TEXT,created_at TEXT);
    CREATE TABLE activities(object_id TEXT,workspace_id TEXT,action TEXT,metadata_json TEXT,created_at TEXT);
    CREATE TABLE execution_events(execution_id TEXT,sequence INTEGER,type TEXT,text TEXT,name TEXT,raw_type TEXT,metadata_json TEXT,created_at TEXT);
    CREATE VIRTUAL TABLE search_fts USING fts5(workspace_id UNINDEXED,object_id UNINDEXED,object_kind UNINDEXED,revision_id UNINDEXED,title,body);
    INSERT INTO chats VALUES ('chat','workspace','Latest chat');
    INSERT INTO executions VALUES ('run','workspace','chat','codex','completed','2026-08-20T00:00:00.000Z');
    INSERT INTO messages VALUES ('answer','chat','assistant','Inspecting.Finished.','2026-08-20T00:00:00.000Z');
    INSERT INTO activities VALUES ('answer','workspace','message.created','{"executionId":"run"}','2026-08-20T00:00:00.000Z');
    INSERT INTO search_fts VALUES ('workspace','answer','message',NULL,'Latest chat','Inspecting.Finished.');
    INSERT INTO execution_events VALUES ('run',1,'text','Inspecting.',NULL,'item/agentMessage/delta','{}','now');
    INSERT INTO execution_events VALUES ('run',2,'tool','safe receipt','Command completed','codex.command.completed','{}','now');
    INSERT INTO execution_events VALUES ('run',3,'text','Finished.',NULL,'item/agentMessage/delta','{}','now');
  `);
  return database;
}

describe("legacy durable execution answer repair", () => {
  it("restores section boundaries and the matching search index", () => {
    const database = fixture(), repaired: unknown[] = [];
    expect(
      repairLegacySectionlessAnswers(database, (answer) =>
        repaired.push(answer),
      ),
    ).toBe(1);
    expect(
      (database.prepare("SELECT body FROM messages").get() as { body: string })
        .body,
    ).toBe("Inspecting.\n\nFinished.");
    expect(repaired).toEqual([
      expect.objectContaining({
        workspaceId: "workspace",
        chatId: "chat",
        messageId: "answer",
        body: "Inspecting.\n\nFinished.",
      }),
    ]);
    expect(
      (database.prepare("SELECT body FROM search_fts").get() as { body: string })
        .body,
    ).toBe("Inspecting.\n\nFinished.");
    expect(repairLegacySectionlessAnswers(database)).toBe(0);
    database.close();
  });

  it("never overwrites an edited body", () => {
    const database = fixture();
    database
      .prepare("UPDATE messages SET body='User-preserved answer' WHERE id='answer'")
      .run();
    expect(repairLegacySectionlessAnswers(database)).toBe(0);
    expect(
      (database.prepare("SELECT body FROM messages").get() as { body: string })
        .body,
    ).toBe("User-preserved answer");
    database.close();
  });

  it("bounds candidate work and tolerates corrupt legacy event metadata", () => {
    const database = fixture();
    database
      .prepare(
        "UPDATE execution_events SET metadata_json='{broken' WHERE sequence=1",
      )
      .run();
    expect(repairLegacySectionlessAnswers(database, undefined, 1)).toBe(1);
    expect(
      (database.prepare("SELECT body FROM messages").get() as { body: string })
        .body,
    ).toBe("Inspecting.\n\nFinished.");
    expect(() => repairLegacySectionlessAnswers(database, undefined, 251)).toThrow(
      "limit",
    );
    database.close();
  });

  it("marks the bounded repair once and rolls it back with sync journaling", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-answer-repair-")),
      databasePath = path.join(root, "waypoint.sqlite"),
      store = new WorkspaceStore(databasePath),
      workspace = store.createWorkspace("Repair", root),
      chat = store.createChat(workspace.id, "Durable sections"),
      profile = store.listSecurityProfiles(workspace.id)[0],
      prompt = "Show progress",
      run = store.createExecution({
        workspaceId: workspace.id,
        chatId: chat,
        cli: "codex",
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
    store.startExecution(run, workspace.id, "/trusted/codex", "0.149.0");
    store.appendExecutionEvent(run, workspace.id, {
      type: "text",
      text: "First.",
      rawType: "item/agentMessage/delta",
    });
    store.appendExecutionEvent(run, workspace.id, {
      type: "tool",
      name: "Command completed",
      rawType: "codex.command.completed",
    });
    store.appendExecutionEvent(run, workspace.id, {
      type: "text",
      text: "Second.",
      rawType: "item/agentMessage/delta",
    });
    store.finishExecution(
      run,
      workspace.id,
      { status: "completed", exitCode: 0 },
      "First.Second.",
    );
    store.close();

    let raw = new DatabaseSync(databasePath);
    raw.exec(
      "UPDATE maintenance_tasks SET completed_at=NULL WHERE id='execution_sections_v1';CREATE TRIGGER reject_repair_sync BEFORE INSERT ON sync_mutations WHEN NEW.object_kind='message' AND NEW.payload_json LIKE '%First.%Second.%' BEGIN SELECT RAISE(ABORT,'repair sync failed'); END;",
    );
    raw.close();
    expect(() => new WorkspaceStore(databasePath)).toThrow("repair sync failed");
    raw = new DatabaseSync(databasePath);
    expect(
      (raw
        .prepare("SELECT body FROM messages WHERE role='assistant'")
        .get() as { body: string }).body,
    ).toBe("First.Second.");
    expect(
      (raw
        .prepare(
          "SELECT completed_at completedAt FROM maintenance_tasks WHERE id='execution_sections_v1'",
        )
        .get() as { completedAt: string | null }).completedAt,
    ).toBeNull();
    raw.exec("DROP TRIGGER reject_repair_sync");
    raw.close();

    const reopened = new WorkspaceStore(databasePath);
    expect(
      reopened
        .listChats(workspace.id)[0]
        .messages.find((message) => message.role === "assistant")?.body,
    ).toBe("First.\n\nSecond.");
    expect(
      reopened
        .pendingSyncChanges(workspace.id)
        .some(
          (change) =>
            change.objectKind === "message" &&
            JSON.stringify(change.payload).includes("First.\\n\\nSecond."),
        ),
    ).toBe(true);
    reopened.close();
  });
});
