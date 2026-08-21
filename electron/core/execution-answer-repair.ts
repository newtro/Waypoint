import type { DatabaseSync } from "node:sqlite";
import { canonicalExecutionText } from "./execution-output.js";

type ExecutionAnswerRow = {
  executionId: string;
  cli: "codex" | "grok";
  messageId: string;
  workspaceId: string;
  chatId: string;
  title: string;
  body: string;
  createdAt: string;
};

export type RepairedExecutionAnswer = Pick<
  ExecutionAnswerRow,
  "workspaceId" | "chatId" | "messageId" | "createdAt"
> & { body: string };

/**
 * Repairs only an assistant body that is byte-for-byte equal to Waypoint's
 * legacy delimiter-free event join. User edits are therefore not rewritten.
 * A byte-identical historical answer override cannot be distinguished from
 * the old mechanical join, so the repair intentionally makes no stronger
 * claim about those legacy rows.
 */
export function repairLegacySectionlessAnswers(
  database: DatabaseSync,
  onRepair?: (answer: RepairedExecutionAnswer) => void,
  limit = 250,
): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 250)
    throw new Error("Execution answer repair limit is invalid");
  const rows = database
      .prepare(
        `SELECT e.id executionId,e.cli,m.id messageId,e.workspace_id workspaceId,e.chat_id chatId,c.title,m.body,m.created_at createdAt
         FROM activities a
         JOIN executions e ON e.workspace_id=a.workspace_id
           AND e.id=CASE WHEN json_valid(a.metadata_json) THEN json_extract(a.metadata_json,'$.executionId') END
         JOIN chats c ON c.id=e.chat_id AND c.workspace_id=e.workspace_id
         JOIN messages m ON m.id=a.object_id AND m.chat_id=e.chat_id AND m.role='assistant'
         WHERE a.action='message.created' AND json_valid(a.metadata_json)
           AND e.status='completed' AND e.cli IN ('codex','grok')
         ORDER BY e.created_at DESC,e.id DESC LIMIT ?`,
      )
      .all(limit) as ExecutionAnswerRow[],
    eventQuery = database.prepare(
      "SELECT sequence,type,text,name,raw_type rawType,metadata_json metadataJson,created_at createdAt FROM execution_events WHERE execution_id=? ORDER BY sequence",
    ),
    updateMessage = database.prepare("UPDATE messages SET body=? WHERE id=?"),
    deleteSearch = database.prepare(
      "DELETE FROM search_fts WHERE workspace_id=? AND object_id=? AND object_kind='message'",
    ),
    insertSearch = database.prepare(
      "INSERT INTO search_fts VALUES (?,?, 'message',NULL,?,?)",
    );
  let repaired = 0;
  for (const row of rows) {
    const events: Array<Record<string, unknown>> = (
        eventQuery.all(row.executionId) as Array<Record<string, unknown>>
      ).map((event) => {
        let metadata: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(String(event.metadataJson ?? "{}"));
          if (
            parsed &&
            !Array.isArray(parsed) &&
            typeof parsed === "object"
          )
            metadata = parsed as Record<string, unknown>;
        } catch {
          // Corrupt legacy metadata is non-authoritative; retain the event text
          // and use the recoverable tool boundary instead of blocking startup.
        }
        return {
          ...event,
          metadata,
          metadataJson: undefined,
        } as Record<string, unknown>;
      }),
      legacy = events
        .filter(
          (event) => event.type === "text" && typeof event.text === "string",
        )
        .map((event) => String(event.text))
        .join("")
        .trim(),
      sectioned = canonicalExecutionText(row.cli, events);
    if (!legacy || row.body !== legacy || sectioned === legacy) continue;
    updateMessage.run(sectioned, row.messageId);
    deleteSearch.run(row.workspaceId, row.messageId);
    insertSearch.run(
      row.workspaceId,
      row.messageId,
      row.title,
      sectioned,
    );
    onRepair?.({
      workspaceId: row.workspaceId,
      chatId: row.chatId,
      messageId: row.messageId,
      createdAt: row.createdAt,
      body: sectioned,
    });
    repaired += 1;
  }
  return repaired;
}
