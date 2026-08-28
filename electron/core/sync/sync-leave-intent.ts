import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { syncDirectoryDurably, syncFileDurably } from "../durable-fs.js";
import type { SecretProtector } from "./protected-sync-vault.js";

const ID = /^[A-Za-z0-9_-]{16,128}$/;

export interface SyncLeaveIntent {
  version: 1;
  workspaceId: string;
  createdAt: string;
}

export class SyncLeaveIntentStore {
  constructor(
    private readonly root: string,
    private readonly protector: SecretProtector,
  ) {
    if (!protector.available())
      throw new Error("OS-protected sync leave recovery is unavailable");
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  begin(workspaceId: string, at = new Date()): SyncLeaveIntent {
    this.assertId(workspaceId);
    const existing = this.read(workspaceId);
    if (existing) return existing;
    const value: SyncLeaveIntent = {
      version: 1,
      workspaceId,
      createdAt: at.toISOString(),
    };
    const target = this.path(workspaceId),
      temporary = `${target}.${process.pid}.${Date.now()}.partial`;
    try {
      writeFileSync(
        temporary,
        Buffer.from(this.protector.encrypt(JSON.stringify(value))),
        {
          flag: "wx",
          mode: 0o600,
        },
      );
      syncFileDurably(temporary);
      renameSync(temporary, target);
      syncDirectoryDurably(this.root);
      return value;
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  list(): SyncLeaveIntent[] {
    return readdirSync(this.root)
      .map((name) => ({
        name,
        match: /^([A-Za-z0-9_-]{16,128})\.leave\.json$/.exec(name),
      }))
      .filter((item): item is { name: string; match: RegExpExecArray } =>
        Boolean(item.match),
      )
      .map((item) =>
        this.readFile(path.join(this.root, item.name), item.match[1]),
      );
  }

  complete(workspaceId: string): void {
    this.assertId(workspaceId);
    rmSync(this.path(workspaceId), { force: true });
    syncDirectoryDurably(this.root);
  }

  private read(workspaceId: string): SyncLeaveIntent | undefined {
    const file = this.path(workspaceId);
    return existsSync(file) ? this.readFile(file, workspaceId) : undefined;
  }

  private readFile(file: string, expectedWorkspaceId: string): SyncLeaveIntent {
    let value: unknown;
    try {
      value = JSON.parse(this.protector.decrypt(readFileSync(file)));
    } catch {
      throw new Error("Sync leave recovery intent cannot be opened");
    }
    const item = value as Partial<SyncLeaveIntent>;
    if (
      item.version !== 1 ||
      !ID.test(String(item.workspaceId)) ||
      item.workspaceId !== expectedWorkspaceId ||
      !Number.isFinite(Date.parse(String(item.createdAt)))
    )
      throw new Error("Invalid sync leave recovery intent");
    return item as SyncLeaveIntent;
  }

  private path(workspaceId: string): string {
    return path.join(this.root, `${workspaceId}.leave.json`);
  }

  private assertId(workspaceId: string): void {
    if (!ID.test(workspaceId)) throw new Error("Invalid workspace identity");
  }
}
