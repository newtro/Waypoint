import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { WorkspaceStore } from "../../electron/core/store.js";
import {
  readBackupReadonly,
  writeAtomicBackup,
} from "../../electron/core/backup.js";

const recoveryRoot =
  "C:\\Users\\scott\\Documents\\Waypoint Recovery\\2026-08-13-profile-split";
const reconstructedRoot = path.join(recoveryRoot, "scv2-reconstructed-source");
const canonicalRoot = "C:\\Users\\scott\\AppData\\Roaming\\waypoint";
const executionRoot = "D:\\Mathew Repos\\SCV2";
const archivePath = path.join(recoveryRoot, "SCv2-recovered.waypoint.json");
const receiptPath = path.join(recoveryRoot, "SCv2-recovery-receipt.json");
const prompt =
  "I want to have the pr-review skill triggered when a new PR is created by Tim Or Michael in devops. Once the PR is created you should wait for the AI Review to either post it's own findings or post the all clear comment on the PR. In order to do this you will need to modify the pr-review skill, create a new skill call auto-pr-review, which bypasses all the user input such as which adversarial reviews to use, I want the auto-pr-preview skill to use codex sol on high thinking and a fresh claude opus 5 agent on high thinking. You should be able to create the new skill based off the old one and you should be able to use the az cli to wire up the webhook";

type Receipt = {
  version?: number;
  recoveredAt: string;
  sourceWorkspaceId: string;
  restoredWorkspaceId: string;
  workspaceName: string;
  executionRoot: string;
  canonicalBefore: Array<{ id: string; name: string }>;
  canonicalAfter: Array<{ id: string; name: string }>;
  chats: Array<{
    title: string;
    messages: Array<{ role: string; body: string }>;
  }>;
  archivePath: string;
  archiveReceipt: { bytes: number; integrity: string };
};

function atomicallyWriteReceipt(receipt: Receipt): void {
  const temporary = `${receiptPath}.partial-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temporary, receiptPath);
}

function exactWorkspace(store: WorkspaceStore, workspaceId?: string) {
  const candidates = store
    .listWorkspaces()
    .filter(
      (workspace) =>
        workspace.name === "SCv2" && (!workspaceId || workspace.id === workspaceId),
    );
  return candidates.find((workspace) =>
    store
      .listChats(workspace.id)
      .flatMap((chat) => chat.messages)
      .some((message) => message.body === prompt),
  );
}

function receiptIsValid(receipt: Receipt): boolean {
  if (
    receipt.version !== 2 ||
    !existsSync(receipt.archivePath) ||
    statSync(receipt.archivePath).size !== receipt.archiveReceipt.bytes
  )
    return false;
  let archive;
  try {
    archive = readBackupReadonly(receipt.archivePath);
  } catch {
    return false;
  }
  if (archive.integrity !== receipt.archiveReceipt.integrity) return false;
  const canonical = new WorkspaceStore(path.join(canonicalRoot, "waypoint.sqlite"));
  const workspace = exactWorkspace(canonical, receipt.restoredWorkspaceId);
  const valid =
    Boolean(workspace) && workspace?.executionRoot === receipt.executionRoot;
  canonical.close();
  return valid;
}

const priorReceipt = existsSync(receiptPath)
  ? (JSON.parse(readFileSync(receiptPath, "utf8")) as Receipt)
  : undefined;
if (priorReceipt && receiptIsValid(priorReceipt)) {
  console.log(
    JSON.stringify({ status: "already_recovered", ...priorReceipt }, null, 2),
  );
} else {
  mkdirSync(reconstructedRoot, { recursive: true });
  const source = new WorkspaceStore(path.join(reconstructedRoot, "waypoint.sqlite"));
  let sourceWorkspace = exactWorkspace(source);
  if (!sourceWorkspace) {
    if (source.listWorkspaces().some((workspace) => workspace.name === "SCv2")) {
      source.close();
      throw new Error("Reconstructed source contains a conflicting SCv2 workspace");
    }
    sourceWorkspace = source.createWorkspace("SCv2", reconstructedRoot);
    source.setWorkspaceExecutionRoot(sourceWorkspace.id, executionRoot);
    const greeting = source.createChat(sourceWorkspace.id, "Morning Greeting");
    source.addMessage(sourceWorkspace.id, greeting, "user", "Good morning");
    source.addMessage(
      sourceWorkspace.id,
      greeting,
      "assistant",
      "Good morning! What are we working on today?",
    );
    const request = source.createChat(sourceWorkspace.id, "New chat");
    source.addMessage(sourceWorkspace.id, request, "user", prompt);
  }
  const archive = source.exportWorkspace(sourceWorkspace.id);
  const archiveReceipt = writeAtomicBackup(archivePath, archive);
  source.close();

  const canonical = new WorkspaceStore(path.join(canonicalRoot, "waypoint.sqlite"));
  const before = canonical.listWorkspaces();
  let restored = exactWorkspace(canonical, priorReceipt?.restoredWorkspaceId);
  if (!restored) {
    const conflicts = canonical
      .listWorkspaces()
      .filter((workspace) => workspace.name === "SCv2");
    if (conflicts.length) {
      canonical.close();
      throw new Error("Canonical profile contains a conflicting SCv2 workspace");
    }
    restored = canonical.restoreWorkspace(archive, "SCv2", canonicalRoot);
  }
  if (restored.executionRoot !== executionRoot) {
    canonical.setWorkspaceExecutionRoot(restored.id, executionRoot);
    restored = canonical
      .listWorkspaces()
      .find((workspace) => workspace.id === restored?.id)!;
  }
  const after = canonical.listWorkspaces();
  const chats = canonical.listChats(restored.id);
  const restoredPrompt = chats
    .flatMap((chat) => chat.messages)
    .find((message) => message.body.includes("pr-review skill triggered"))?.body;
  if (restoredPrompt !== prompt) {
    canonical.close();
    throw new Error("Recovered prompt does not match the original bytes");
  }
  canonical.close();

  const receipt: Receipt = {
    version: 2,
    recoveredAt: priorReceipt?.recoveredAt ?? new Date().toISOString(),
    sourceWorkspaceId: "6f850903-ffa2-412d-9e0c-0c45e52d9084",
    restoredWorkspaceId: restored.id,
    workspaceName: restored.name,
    executionRoot,
    canonicalBefore:
      priorReceipt?.canonicalBefore ??
      before.map(({ id, name }) => ({ id, name })),
    canonicalAfter: after.map(({ id, name }) => ({ id, name })),
    chats: chats.map((chat) => ({
      title: chat.title,
      messages: chat.messages.map((message) => ({
        role: message.role,
        body: message.body,
      })),
    })),
    archivePath,
    archiveReceipt,
  };
  atomicallyWriteReceipt(receipt);
  if (!receiptIsValid(receipt))
    throw new Error("SCv2 recovery receipt failed reconciliation");
  console.log(JSON.stringify(receipt, null, 2));
}
