import { createHmac, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const RUN_SCOPED_ATTACHMENT_DIRECTORY =
  /^(?:\.waypoint-cli-attachments-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\.waypoint-cli-images-[a-z0-9]{6})$/i;
const RUN_SCOPED_OWNERSHIP_MARKER = ".waypoint-owned.json";
let ownershipKey = randomBytes(32);

export function runScopedOwnershipContent(
  directory: string,
  purpose: "run-scoped-provider-attachment" | "grok-automation-isolation",
): string {
  return JSON.stringify({
    owner: "waypoint",
    purpose,
    version: 2,
    signature: createHmac("sha256", ownershipKey)
      .update(purpose)
      .update("\0")
      .update(realpathSync.native(directory))
      .digest("hex"),
  });
}

export function initializeRunScopedAttachmentOwnership(
  storageRoot: string,
): void {
  mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
  const rootStat = lstatSync(storageRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("Run-scoped attachment ownership root is invalid");
  const keyPath = path.join(
    realpathSync.native(storageRoot),
    "run-scoped-attachment-ownership.key",
  );
  if (!existsSync(keyPath))
    try {
      writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch {
      // A concurrent app startup may have created the exact key first.
    }
  const stat = lstatSync(keyPath),
    key = readFileSync(keyPath);
  if (!stat.isFile() || stat.isSymbolicLink() || key.byteLength !== 32)
    throw new Error("Run-scoped attachment ownership key is invalid");
  ownershipKey = Buffer.from(key);
}

export interface WorkspaceExecutionRootSource {
  listWorkspaces(): Array<{ id: string }>;
  assertWorkspaceExecutionRoot(workspaceId: string): string;
}

export function managedWorkspaceExecutionRoots(
  source: WorkspaceExecutionRootSource,
): string[] {
  return source.listWorkspaces().flatMap((workspace) => {
    try {
      return [source.assertWorkspaceExecutionRoot(workspace.id)];
    } catch {
      return [];
    }
  });
}

export function markRunScopedAttachmentDirectory(directory: string): void {
  writeFileSync(
    path.join(directory, RUN_SCOPED_OWNERSHIP_MARKER),
    runScopedOwnershipContent(directory, "run-scoped-provider-attachment"),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

/** Removes only Waypoint-owned, run-scoped attachment directories from canonical execution roots. */
export function cleanupRunScopedAttachmentDirectories(
  roots: readonly string[],
): number {
  let removed = 0;
  for (const input of new Set(roots)) {
    if (!input || !path.isAbsolute(input) || !existsSync(input)) continue;
    let root: string;
    try {
      root = realpathSync.native(input);
    } catch {
      continue;
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !RUN_SCOPED_ATTACHMENT_DIRECTORY.test(entry.name)
      )
        continue;
      const candidate = path.join(root, entry.name);
      try {
        const stat = lstatSync(candidate);
        if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
        const resolved = realpathSync.native(candidate);
        if (path.dirname(resolved) !== root) continue;
        const marker = path.join(resolved, RUN_SCOPED_OWNERSHIP_MARKER),
          markerStat = lstatSync(marker);
        if (
          !markerStat.isFile() ||
          markerStat.isSymbolicLink() ||
          path.dirname(realpathSync.native(marker)) !== resolved ||
          readFileSync(marker, "utf8") !==
            runScopedOwnershipContent(
              resolved,
              "run-scoped-provider-attachment",
            )
        )
          continue;
        rmSync(resolved, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
        removed++;
      } catch {
        /* A locked Windows file is retried on the next startup; never widen the target. */
      }
    }
  }
  return removed;
}
