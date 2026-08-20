import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkspaceStore } from "../../electron/core/store.js";
import {
  readBackupReadonly,
  writeAtomicBackup,
} from "../../electron/core/backup.js";

const recoveryRoot =
  "C:\\Users\\scott\\Documents\\Waypoint Recovery\\2026-08-13-profile-split";
const sourceRoot = path.join(recoveryRoot, "scv2-reconstructed-source");
const canonicalRoot = "C:\\Users\\scott\\AppData\\Roaming\\waypoint";
const substituteCapturePath =
  "C:\\Users\\scott\\AppData\\Local\\Temp\\codex-clipboard-3d7dbc26-2cee-464e-9e17-d2ad17993084.png";
const archivePath = path.join(
  recoveryRoot,
  "SCv2-recovered-complete.waypoint.json",
);
const substituteCaptureSha256 =
  "95b33a1437b4f899431fd29ef362a7bd6d66a3c16fe188d88fefdc5d10a840be";
const durableSubstituteCapturePath = path.join(
  recoveryRoot,
  `SCv2-substitute-capture-${substituteCaptureSha256.slice(0, 16)}.png`,
);
const amendmentReceiptPath = path.join(
  recoveryRoot,
  "SCv2-recovery-amendment-receipt.json",
);
const originalCapture = {
  id: "3f64f663-762b-4a40-bfd5-eae055c5ebe3",
  attachmentId: "d93b87cc-2ae9-4d1f-8c8a-ec521908500d",
  title: "Quick capture · Screen 1 region",
  mode: "region",
  sourceId: "screen:0:0",
  sourceName: "Screen 1 region",
  capturedAt: "2026-08-13T13:11:16.724Z",
  width: 1434,
  height: 624,
  sha256: "09e1c4941f6bd6ae71b9b6de620f22e01883d1e0531fa4365c5da7e70d78628d",
  relativePath:
    "d93b87cc-2ae9-4d1f-8c8a-ec521908500d-screen-capture.png",
  status:
    "metadata recovered; original attachment bytes absent from live and preserved redirected profiles",
};
const failure =
  "Claude Code native binary at C:\\Program Files\\Waypoint\\resources\\app.asar\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe exists but failed to launch. This usually means the binary does not match this system's libc — e.g. spawning a musl-linked binary on a glibc Linux host fails because the musl dynamic loader (/lib/ld-musl-*) is missing. Specify a matching binary with options.pathToClaudeCodeExecutable.";
const prompt =
  "I want to have the pr-review skill triggered when a new PR is created by Tim Or Michael in devops. Once the PR is created you should wait for the AI Review to either post it's own findings or post the all clear comment on the PR. In order to do this you will need to modify the pr-review skill, create a new skill call auto-pr-review, which bypasses all the user input such as which adversarial reviews to use, I want the auto-pr-preview skill to use codex sol on high thinking and a fresh claude opus 5 agent on high thinking. You should be able to create the new skill based off the old one and you should be able to use the az cli to wire up the webhook";

const originalExecutions = [
  {
    id: "2adeac20-4e84-44a0-a9df-e2e78064a07e",
    chatTitle: "Morning Greeting",
    sourceText: "Good morning",
    cli: "codex",
    executable: "C:\\Users\\scott\\AppData\\Roaming\\npm\\codex.CMD",
    cliVersion: "codex-cli 0.146.0",
    model: "gpt-5.6-sol",
    promptSha256:
      "87753e8f83f667e29ad78f2ab6e21f381d28d3ac573d51d4bc1dac4511272611",
    status: "completed",
    startedAt: "2026-08-13T13:01:48.252Z",
    finishedAt: "2026-08-13T13:02:00.837Z",
    exitCode: 0,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-13T13:01:48.142Z",
  },
  {
    id: "7b9b5c9d-0752-4790-9ac2-b761187273e0",
    chatTitle: "New chat",
    sourceText: "pr-review skill triggered",
    cli: "claude",
    executable: "@anthropic-ai/claude-agent-sdk",
    cliVersion: "SDK 0.3.229 · Claude Code 2.1.229",
    model: "claude-opus-5",
    promptSha256:
      "089bf15da1b9b1dfd188aecbe0fbfac538a9928be9a8329da71249d4754d1c17",
    status: "failed",
    startedAt: "2026-08-13T13:10:58.365Z",
    finishedAt: "2026-08-13T13:10:58.367Z",
    exitCode: null,
    errorCode: "failed",
    errorMessage: failure,
    createdAt: "2026-08-13T13:10:58.190Z",
  },
] as const;
const originalEvents = [
  ["c3d6ef63-4e32-4b31-ba66-580249442755", originalExecutions[0].id, 1, "policy", null, "budget:local-v1", '{"version":1,"kind":"root","approvalOrigin":"explicit-chat-action","device":"local","maxPromptBytes":2000000,"maxOutputBytes":8388608,"maxDurationMs":120000,"maxConcurrency":1,"maxDepth":1,"maxChildren":1,"maxAttempts":1,"maxAttachments":20,"fallbackAllowed":false,"externalCostAllowed":false,"peerAllowed":false,"profileDigest":"909c07c23f08043fe67ff6705be425156334a94c3323cfaa4c9ea8d5119de341"}', "2026-08-13T13:01:48.142Z"],
  ["7cb0963a-2f61-4664-976c-fd57f4048a7d", originalExecutions[0].id, 2, "text", "Good", null, "item/agentMessage/delta", "2026-08-13T13:02:00.452Z"],
  ["f864711a-b155-4822-80de-c4201e5b77fe", originalExecutions[0].id, 3, "text", " morning", null, "item/agentMessage/delta", "2026-08-13T13:02:00.455Z"],
  ["0e4e8ed7-0fb6-4dc3-bc0e-7b40278db74c", originalExecutions[0].id, 4, "text", "!", null, "item/agentMessage/delta", "2026-08-13T13:02:00.467Z"],
  ["3dc28eec-26a1-476f-bbac-35cead80bac2", originalExecutions[0].id, 5, "text", " What", null, "item/agentMessage/delta", "2026-08-13T13:02:00.513Z"],
  ["c4ee93c3-4314-419d-b090-ca3a61491a80", originalExecutions[0].id, 6, "text", " are", null, "item/agentMessage/delta", "2026-08-13T13:02:00.513Z"],
  ["af03db46-588f-49a6-8a39-ab1d2808336f", originalExecutions[0].id, 7, "text", " we", null, "item/agentMessage/delta", "2026-08-13T13:02:00.540Z"],
  ["f6d3c570-afc0-499b-8822-8bd6b3bacf34", originalExecutions[0].id, 8, "text", " working", null, "item/agentMessage/delta", "2026-08-13T13:02:00.553Z"],
  ["036bb785-afb6-4416-9b79-6b63a3e3a27a", originalExecutions[0].id, 9, "text", " on", null, "item/agentMessage/delta", "2026-08-13T13:02:00.570Z"],
  ["cd87c463-bf7d-4a5d-ad0c-79c9f5679e38", originalExecutions[0].id, 10, "text", " today", null, "item/agentMessage/delta", "2026-08-13T13:02:00.602Z"],
  ["4ee70e5a-b860-4b9b-a213-5c330f2eb67b", originalExecutions[0].id, 11, "text", "?", null, "item/agentMessage/delta", "2026-08-13T13:02:00.616Z"],
  ["6842f8be-0d5c-4d72-914a-5074621f8294", originalExecutions[0].id, 12, "diagnostic", null, "Token usage updated", "thread/tokenUsage/updated", "2026-08-13T13:02:00.819Z"],
  ["26088777-9959-4c2e-b18d-16ae067c2a93", originalExecutions[0].id, 13, "diagnostic", "Codex app-server stopped", "Codex MCP discovery unavailable", "codex.mcp.unavailable", "2026-08-13T13:02:00.838Z"],
  ["e294fe2e-7bdb-4ecf-bdea-d5c4720dba85", originalExecutions[1].id, 1, "policy", null, "budget:local-v1", '{"version":1,"kind":"root","approvalOrigin":"explicit-chat-action","device":"local","maxPromptBytes":2000000,"maxOutputBytes":8388608,"maxDurationMs":120000,"maxConcurrency":1,"maxDepth":1,"maxChildren":1,"maxAttempts":1,"maxAttachments":20,"fallbackAllowed":false,"externalCostAllowed":false,"peerAllowed":false,"profileDigest":"909c07c23f08043fe67ff6705be425156334a94c3323cfaa4c9ea8d5119de341"}', "2026-08-13T13:10:58.190Z"],
] as const;
const generatedPromptHashes = [
  "90a90a48e23dcc51ad4a821a301e3440ffeb5e986bd69d7bf347a2ba2da23bd3",
  "a627564bdbb4f63ce2b06482a98c66a861cbe666888178d03c5c975d35e2c610",
];

function atomicallyWriteJson(filePath: string, value: unknown): void {
  const temporary = `${filePath}.partial-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temporary, filePath);
}

function validatedSubstituteBytes(): Buffer {
  let bytes: Buffer | undefined;
  if (existsSync(durableSubstituteCapturePath))
    bytes = readFileSync(durableSubstituteCapturePath);
  else if (existsSync(substituteCapturePath)) bytes = readFileSync(substituteCapturePath);
  else if (existsSync(path.join(sourceRoot, "waypoint.sqlite"))) {
    const source = new WorkspaceStore(path.join(sourceRoot, "waypoint.sqlite"));
    const workspace = source
      .listWorkspaces()
      .find((item) => item.name === "SCv2");
    const capture = workspace
      ? source
          .listScreenCaptures(workspace.id)
          .find((item) => item.sha256 === substituteCaptureSha256)
      : undefined;
    if (workspace && capture)
      bytes = Buffer.from(
        source.readScreenCapture(workspace.id, capture.id).dataBase64,
        "base64",
      );
    source.close();
  }
  if (!bytes && existsSync(archivePath)) {
    const archive = readBackupReadonly(archivePath);
    const attachment = (archive.objects.attachments ?? []).find(
      (value) =>
        String((value as Record<string, unknown>).sha256) ===
        substituteCaptureSha256,
    ) as Record<string, unknown> | undefined;
    if (attachment?.data_base64)
      bytes = Buffer.from(String(attachment.data_base64), "base64");
  }
  if (
    !bytes ||
    createHash("sha256").update(bytes).digest("hex") !== substituteCaptureSha256
  )
    throw new Error("Durable substitute capture is unavailable or invalid");
  if (!existsSync(durableSubstituteCapturePath))
    writeFileSync(durableSubstituteCapturePath, bytes, {
      flag: "wx",
      mode: 0o600,
    });
  return bytes;
}

function ensureCapture(
  store: WorkspaceStore,
  workspaceId: string,
  bytes: Uint8Array,
) {
  const existing = store
    .listScreenCaptures(workspaceId)
    .find(
      (capture) =>
        capture.sha256 ===
        substituteCaptureSha256,
    );
  if (existing) return existing;
  return store.createScreenCapture(
    workspaceId,
    {
      title: "Recovered reference · original Quick capture bytes missing",
      mode: "region",
      sourceId: "recovery:codex-clipboard",
      sourceName: "User-provided screenshot captured 16 seconds later",
      capturedAt: "2026-08-13T13:11:32.651Z",
      width: 1434,
      height: 624,
    },
    bytes,
  );
}

function reconcileExecutionProvenance(
  databasePath: string,
  workspaceId: string,
): void {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys=ON");
  const chats = database
    .prepare("SELECT id,title FROM chats WHERE workspace_id=?")
    .all(workspaceId) as Array<{ id: string; title: string }>;
  const profile = database
    .prepare(
      "SELECT id FROM security_profiles WHERE workspace_id=? AND name='Full agent · network enabled'",
    )
    .get(workspaceId) as { id: string } | undefined;
  if (!profile) {
    database.close();
    throw new Error("Recovered Full agent profile is missing");
  }
  const resolved = originalExecutions.map((execution) => {
    const chat = chats.find((item) => item.title === execution.chatTitle);
    if (!chat) throw new Error(`Recovered chat is missing: ${execution.chatTitle}`);
    const source = database
      .prepare(
        "SELECT id FROM messages WHERE chat_id=? AND role='user' AND body LIKE ?",
      )
      .get(chat.id, `%${execution.sourceText}%`) as { id: string } | undefined;
    if (!source) throw new Error("Recovered execution source message is missing");
    return { ...execution, chatId: chat.id, sourceMessageId: source.id };
  });
  database.exec("BEGIN IMMEDIATE");
  try {
    const generated = database.prepare(
      "SELECT id FROM executions WHERE workspace_id=? AND prompt_sha256 IN (?,?)",
    ).all(workspaceId, ...generatedPromptHashes) as Array<{ id: string }>;
    for (const row of generated) {
      database
        .prepare("DELETE FROM activities WHERE workspace_id=? AND object_id=?")
        .run(workspaceId, row.id);
      database.prepare("DELETE FROM executions WHERE id=?").run(row.id);
    }
    for (const execution of resolved) {
      const collision = database
        .prepare("SELECT workspace_id FROM executions WHERE id=?")
        .get(execution.id) as { workspace_id: string } | undefined;
      if (collision && collision.workspace_id !== workspaceId)
        throw new Error("Recovered execution ID collides with another workspace");
      database
        .prepare(
          "INSERT INTO executions(id,workspace_id,chat_id,source_message_id,parent_execution_id,cli,executable,cli_version,model,device,security_profile_id,prompt_sha256,status,depth,started_at,finished_at,exit_code,error_code,error_message,created_at) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,chat_id=excluded.chat_id,source_message_id=excluded.source_message_id,cli=excluded.cli,executable=excluded.executable,cli_version=excluded.cli_version,model=excluded.model,device=excluded.device,security_profile_id=excluded.security_profile_id,prompt_sha256=excluded.prompt_sha256,status=excluded.status,depth=excluded.depth,started_at=excluded.started_at,finished_at=excluded.finished_at,exit_code=excluded.exit_code,error_code=excluded.error_code,error_message=excluded.error_message,created_at=excluded.created_at",
        )
        .run(
          execution.id,
          workspaceId,
          execution.chatId,
          execution.sourceMessageId,
          execution.cli,
          execution.executable,
          execution.cliVersion,
          execution.model,
          "local",
          profile.id,
          execution.promptSha256,
          execution.status,
          execution.startedAt,
          execution.finishedAt,
          execution.exitCode,
          execution.errorCode,
          execution.errorMessage,
          execution.createdAt,
        );
      database
        .prepare("DELETE FROM execution_events WHERE execution_id=?")
        .run(execution.id);
    }
    const insertEvent = database.prepare(
      "INSERT INTO execution_events(id,execution_id,sequence,type,text,name,raw_type,created_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?)",
    );
    for (const event of originalEvents)
      insertEvent.run(...event, "{}");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    database.close();
    throw error;
  }
  const count = (
    database
      .prepare(
        "SELECT count(*) count FROM executions WHERE workspace_id=? AND id IN (?,?)",
      )
      .get(workspaceId, ...originalExecutions.map((item) => item.id)) as {
      count: number;
    }
  ).count;
  const eventCount = (
    database
      .prepare(
        "SELECT count(*) count FROM execution_events WHERE execution_id IN (?,?)",
      )
      .get(...originalExecutions.map((item) => item.id)) as { count: number }
  ).count;
  database.close();
  if (count !== 2 || eventCount !== 14)
    throw new Error("Recovered execution provenance is incomplete");
}

function executionProvenanceMatches(
  databasePath: string,
  workspaceId: string,
): boolean {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const executions = database
      .prepare(
        "SELECT id,cli,executable,cli_version cliVersion,model,device,prompt_sha256 promptSha256,status,depth,started_at startedAt,finished_at finishedAt,exit_code exitCode,error_code errorCode,error_message errorMessage,created_at createdAt FROM executions WHERE workspace_id=? AND id IN (?,?) ORDER BY id",
      )
      .all(workspaceId, ...originalExecutions.map((item) => item.id)) as Array<
      Record<string, unknown>
    >;
    if (
      !originalExecutions.every((expected) => {
        const actual = executions.find((item) => item.id === expected.id);
        return (
          actual?.cli === expected.cli &&
          actual.executable === expected.executable &&
          actual.cliVersion === expected.cliVersion &&
          actual.model === expected.model &&
          actual.device === "local" &&
          actual.promptSha256 === expected.promptSha256 &&
          actual.status === expected.status &&
          actual.depth === 0 &&
          actual.startedAt === expected.startedAt &&
          actual.finishedAt === expected.finishedAt &&
          actual.exitCode === expected.exitCode &&
          actual.errorCode === expected.errorCode &&
          actual.errorMessage === expected.errorMessage &&
          actual.createdAt === expected.createdAt
        );
      })
    )
      return false;
    const events = database
      .prepare(
        "SELECT id,execution_id executionId,sequence,type,text,name,raw_type rawType,created_at createdAt,metadata_json metadataJson FROM execution_events WHERE execution_id IN (?,?) ORDER BY execution_id,sequence",
      )
      .all(...originalExecutions.map((item) => item.id)) as Array<
      Record<string, unknown>
    >;
    if (events.length !== originalEvents.length) return false;
    return originalEvents.every((expected) => {
      const actual = events.find((item) => item.id === expected[0]);
      return (
        actual?.executionId === expected[1] &&
        actual.sequence === expected[2] &&
        actual.type === expected[3] &&
        actual.text === expected[4] &&
        actual.name === expected[5] &&
        actual.rawType === expected[6] &&
        actual.createdAt === expected[7] &&
        actual.metadataJson === "{}"
      );
    });
  } finally {
    database.close();
  }
}

function canonicalWorkspaceContractMatches(
  databasePath: string,
  workspaceId: string,
): boolean {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const workspace = database
      .prepare("SELECT name,execution_root executionRoot FROM workspaces WHERE id=?")
      .get(workspaceId) as
      | { name: string; executionRoot: string | null }
      | undefined;
    if (
      workspace?.name !== "SCv2" ||
      workspace.executionRoot !== "D:\\Mathew Repos\\SCV2"
    )
      return false;
    const messages = database
      .prepare(
        "SELECT c.title,m.role,m.body FROM chats c JOIN messages m ON m.chat_id=c.id WHERE c.workspace_id=? ORDER BY c.created_at,m.created_at",
      )
      .all(workspaceId) as Array<{
      title: string;
      role: string;
      body: string;
    }>;
    const expectedMessages = [
      { title: "Morning Greeting", role: "user", body: "Good morning" },
      {
        title: "Morning Greeting",
        role: "assistant",
        body: "Good morning! What are we working on today?",
      },
      { title: "New chat", role: "user", body: prompt },
    ];
    if (
      messages.length !== expectedMessages.length ||
      !expectedMessages.every(
        (expected, index) =>
          messages[index]?.title === expected.title &&
          messages[index]?.role === expected.role &&
          messages[index]?.body === expected.body,
      )
    )
      return false;
    const capture = database
      .prepare(
        "SELECT c.title,c.mode,c.source_id sourceId,c.source_name sourceName,c.captured_at capturedAt,c.width,c.height,c.sha256,a.relative_path relativePath FROM screen_captures c JOIN attachments a ON a.id=c.attachment_id WHERE c.workspace_id=? AND c.sha256=?",
      )
      .get(workspaceId, substituteCaptureSha256) as
      | Record<string, unknown>
      | undefined;
    return Boolean(
      capture &&
        capture.title ===
          "Recovered reference · original Quick capture bytes missing" &&
        capture.mode === "region" &&
        capture.sourceId === "recovery:codex-clipboard" &&
        capture.sourceName ===
          "User-provided screenshot captured 16 seconds later" &&
        capture.capturedAt === "2026-08-13T13:11:32.651Z" &&
        capture.width === 1434 &&
        capture.height === 624 &&
        capture.sha256 === substituteCaptureSha256 &&
        typeof capture.relativePath === "string",
    );
  } finally {
    database.close();
  }
}

function archiveContractMatches(archive: ReturnType<typeof readBackupReadonly>) {
  const workspace = archive.workspace as Record<string, unknown>;
  if (workspace.name !== "SCv2") return false;
  const chats = (archive.objects.chats ?? []) as Array<Record<string, unknown>>;
  const messages = (archive.objects.messages ?? []) as Array<
    Record<string, unknown>
  >;
  if (chats.length !== 2 || messages.length !== 3) return false;
  const titled = new Map(chats.map((chat) => [String(chat.id), String(chat.title)]));
  const archivedMessages = messages
    .map((message) => ({
      title: titled.get(String(message.chat_id)),
      role: String(message.role),
      body: String(message.body),
    }))
    .sort((left, right) =>
      `${left.title}:${left.role}:${left.body}`.localeCompare(
        `${right.title}:${right.role}:${right.body}`,
      ),
    );
  const expectedMessages = [
    { title: "Morning Greeting", role: "user", body: "Good morning" },
    {
      title: "Morning Greeting",
      role: "assistant",
      body: "Good morning! What are we working on today?",
    },
    { title: "New chat", role: "user", body: prompt },
  ].sort((left, right) =>
    `${left.title}:${left.role}:${left.body}`.localeCompare(
      `${right.title}:${right.role}:${right.body}`,
    ),
  );
  if (JSON.stringify(archivedMessages) !== JSON.stringify(expectedMessages))
    return false;
  const executions = (archive.objects.executions ?? []) as Array<
    Record<string, unknown>
  >;
  if (
    !originalExecutions.every((expected) => {
      const actual = executions.find((item) => item.id === expected.id);
      return (
        actual?.cli === expected.cli &&
        actual.executable === expected.executable &&
        actual.cli_version === expected.cliVersion &&
        actual.model === expected.model &&
        actual.device === "local" &&
        actual.prompt_sha256 === expected.promptSha256 &&
        actual.status === expected.status &&
        actual.depth === 0 &&
        actual.started_at === expected.startedAt &&
        actual.finished_at === expected.finishedAt &&
        actual.exit_code === expected.exitCode &&
        actual.error_code === expected.errorCode &&
        actual.error_message === expected.errorMessage &&
        actual.created_at === expected.createdAt
      );
    })
  )
    return false;
  const events = (archive.objects.execution_events ?? []) as Array<
    Record<string, unknown>
  >;
  if (
    events.length !== originalEvents.length ||
    !originalEvents.every((expected) => {
      const actual = events.find((item) => item.id === expected[0]);
      return (
        actual?.execution_id === expected[1] &&
        actual.sequence === expected[2] &&
        actual.type === expected[3] &&
        actual.text === expected[4] &&
        actual.name === expected[5] &&
        actual.raw_type === expected[6] &&
        actual.created_at === expected[7] &&
        actual.metadata_json === "{}"
      );
    })
  )
    return false;
  const captures = (archive.objects.screen_captures ?? []) as Array<
    Record<string, unknown>
  >;
  const capture = captures.find(
    (item) => item.sha256 === substituteCaptureSha256,
  );
  const attachments = (archive.objects.attachments ?? []) as Array<
    Record<string, unknown>
  >;
  const attachment = capture
    ? attachments.find((item) => item.id === capture.attachment_id)
    : undefined;
  if (!capture || !attachment || typeof attachment.data_base64 !== "string")
    return false;
  const bytes = Buffer.from(attachment.data_base64, "base64");
  return (
    capture.title ===
      "Recovered reference · original Quick capture bytes missing" &&
    capture.mode === "region" &&
    capture.source_id === "recovery:codex-clipboard" &&
    capture.source_name ===
      "User-provided screenshot captured 16 seconds later" &&
    capture.captured_at === "2026-08-13T13:11:32.651Z" &&
    capture.width === 1434 &&
    capture.height === 624 &&
    bytes.byteLength === 75394 &&
    createHash("sha256").update(bytes).digest("hex") ===
      substituteCaptureSha256 &&
    attachment.sha256 === substituteCaptureSha256
  );
}

function validateReceipt(receipt: {
  version?: number;
  canonicalWorkspaceId: string;
  archivePath: string;
  archiveReceipt: { bytes: number; integrity: string };
  durableSubstituteCapture?: {
    path: string;
    bytes: number;
    sha256: string;
  };
  originalCapture?: typeof originalCapture;
}): boolean {
  try {
    if (
      receipt.version !== 4 ||
      !existsSync(receipt.archivePath) ||
      receipt.durableSubstituteCapture?.path !== durableSubstituteCapturePath ||
      receipt.durableSubstituteCapture.bytes !== 75394 ||
      receipt.durableSubstituteCapture.sha256 !== substituteCaptureSha256 ||
      JSON.stringify(receipt.originalCapture) !== JSON.stringify(originalCapture)
    )
      return false;
    const archive = readBackupReadonly(receipt.archivePath);
    if (
      archive.integrity !== receipt.archiveReceipt.integrity ||
      statSync(receipt.archivePath).size !== receipt.archiveReceipt.bytes ||
      !archiveContractMatches(archive)
    )
      return false;
    if (
      !existsSync(durableSubstituteCapturePath) ||
      statSync(durableSubstituteCapturePath).size !== 75394 ||
      createHash("sha256")
        .update(readFileSync(durableSubstituteCapturePath))
        .digest("hex") !== substituteCaptureSha256
    )
      return false;
    const databasePath = path.join(canonicalRoot, "waypoint.sqlite");
    if (
      !canonicalWorkspaceContractMatches(
        databasePath,
        receipt.canonicalWorkspaceId,
      ) ||
      !executionProvenanceMatches(databasePath, receipt.canonicalWorkspaceId)
    )
      return false;
    const canonical = new WorkspaceStore(databasePath);
    const capture = canonical
      .listScreenCaptures(receipt.canonicalWorkspaceId)
      .find((item) => item.sha256 === substituteCaptureSha256);
    const captureBytes = capture
      ? Buffer.from(
          canonical.readScreenCapture(receipt.canonicalWorkspaceId, capture.id)
            .dataBase64,
          "base64",
        )
      : undefined;
    canonical.close();
    return Boolean(
      captureBytes &&
        captureBytes.byteLength === 75394 &&
        createHash("sha256").update(captureBytes).digest("hex") ===
          substituteCaptureSha256,
    );
  } catch {
    return false;
  }
}

const priorReceipt = existsSync(amendmentReceiptPath)
  ? (JSON.parse(readFileSync(amendmentReceiptPath, "utf8")) as {
      version?: number;
      canonicalWorkspaceId: string;
      archivePath: string;
      archiveReceipt: { bytes: number; integrity: string };
      durableSubstituteCapture?: {
        path: string;
        bytes: number;
        sha256: string;
      };
      originalCapture?: typeof originalCapture;
    })
  : undefined;
if (priorReceipt && validateReceipt(priorReceipt)) {
  console.log(
    JSON.stringify({ status: "already_amended", ...priorReceipt }, null, 2),
  );
} else {
  const substituteBytes = validatedSubstituteBytes();
  const source = new WorkspaceStore(path.join(sourceRoot, "waypoint.sqlite"));
  const sourceWorkspace = source
    .listWorkspaces()
    .find((workspace) => workspace.name === "SCv2");
  if (!sourceWorkspace)
    throw new Error("Reconstructed source workspace is missing");
  const sourceCapture = ensureCapture(
    source,
    sourceWorkspace.id,
    substituteBytes,
  );
  source.close();
  reconcileExecutionProvenance(
    path.join(sourceRoot, "waypoint.sqlite"),
    sourceWorkspace.id,
  );
  const sourceForExport = new WorkspaceStore(
    path.join(sourceRoot, "waypoint.sqlite"),
  );
  const archive = sourceForExport.exportWorkspace(sourceWorkspace.id);
  const archiveReceipt = writeAtomicBackup(archivePath, archive);
  sourceForExport.close();

  const canonical = new WorkspaceStore(path.join(canonicalRoot, "waypoint.sqlite"));
  const canonicalWorkspace = canonical
    .listWorkspaces()
    .find((workspace) => workspace.name === "SCv2");
  if (!canonicalWorkspace)
    throw new Error("Canonical SCv2 workspace is missing");
  const canonicalCapture = ensureCapture(
    canonical,
    canonicalWorkspace.id,
    substituteBytes,
  );
  canonical.close();
  reconcileExecutionProvenance(
    path.join(canonicalRoot, "waypoint.sqlite"),
    canonicalWorkspace.id,
  );

  const receipt = {
    version: 4,
    amendedAt: new Date().toISOString(),
    canonicalWorkspaceId: canonicalWorkspace.id,
    archivePath,
    archiveReceipt,
    durableSubstituteCapture: {
      path: durableSubstituteCapturePath,
      bytes: substituteBytes.byteLength,
      sha256: substituteCaptureSha256,
    },
    recoveredExecutionProvenance: originalExecutions.map((execution) => ({
      id: execution.id,
      cli: execution.cli,
      model: execution.model,
      status: execution.status,
      promptSha256: execution.promptSha256,
      createdAt: execution.createdAt,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      errorCode: execution.errorCode,
      errorMessage: execution.errorMessage,
      eventCount: originalEvents.filter((event) => event[1] === execution.id)
        .length,
    })),
    recoveredCaptureSubstitute: {
      source: sourceCapture,
      canonical: canonicalCapture,
    },
    originalCapture,
  };
  atomicallyWriteJson(amendmentReceiptPath, receipt);
  if (!validateReceipt(receipt))
    throw new Error("Recovered amendment receipt failed reconciliation");
  console.log(JSON.stringify(receipt, null, 2));
}
