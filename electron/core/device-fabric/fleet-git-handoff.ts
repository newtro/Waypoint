import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { FleetHandoff } from "./fleet-remote-work-service.js";

const run = promisify(execFile);
const COMMIT = /^[a-f0-9]{40,64}$/;
const MAX_BYTES = 8 * 1024 * 1024;

async function git(
  root: string,
  args: string[],
  maxBuffer = 16 * 1024 * 1024,
  signal?: AbortSignal,
) {
  return run("git", ["-C", root, ...args], {
    windowsHide: true,
    timeout: 120_000,
    maxBuffer,
    encoding: "utf8",
    signal,
  });
}

export async function inspectGitRepository(root: string, signal?: AbortSignal) {
  const resolved = path.resolve(root),
    [top, head, branch, status] = await Promise.all([
      git(resolved, ["rev-parse", "--show-toplevel"], undefined, signal),
      git(resolved, ["rev-parse", "HEAD"], undefined, signal),
      git(resolved, ["branch", "--show-current"], undefined, signal),
      git(
        resolved,
        ["status", "--porcelain=v1", "--untracked-files=all"],
        undefined,
        signal,
      ),
    ]),
    topLevel = path.resolve(String(top.stdout).trim()),
    headCommit = String(head.stdout).trim();
  if (topLevel !== resolved || !COMMIT.test(headCommit))
    throw new Error("Fleet handoff requires the selected repository root");
  return {
    root: resolved,
    headCommit,
    branch: String(branch.stdout).trim() || "detached",
    dirty: Boolean(String(status.stdout).trim()),
    status: String(status.stdout).trim().split(/\r?\n/).filter(Boolean),
  };
}

export async function prepareFleetGitHandoff(
  root: string,
  scratchRoot: string,
): Promise<FleetHandoff> {
  const repository = await inspectGitRepository(root),
    repositoryName = path.basename(repository.root).slice(0, 120);
  mkdirSync(scratchRoot, { recursive: true, mode: 0o700 });
  if (!repository.dirty) {
    const bundlePath = path.join(scratchRoot, `handoff-${process.pid}.bundle`);
    try {
      await git(repository.root, ["bundle", "create", bundlePath, "HEAD"]);
      const bytes = readFileSync(bundlePath);
      if (bytes.length > MAX_BYTES)
        throw new Error("Git handoff bundle exceeds the 8 MiB LAN limit");
      return {
        kind: "git_bundle",
        repositoryName,
        baseCommit: repository.headCommit,
        headCommit: repository.headCommit,
        bytesBase64: bytes.toString("base64"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    } finally {
      rmSync(bundlePath, { force: true });
    }
  }
  const untracked = repository.status.filter((line) => line.startsWith("?? "));
  if (untracked.length)
    throw new Error(
      "Commit or stage untracked files before remote handoff so no local work is omitted",
    );
  const patch = Buffer.from(
    String((await git(repository.root, ["diff", "--binary", "HEAD"])).stdout),
  );
  if (!patch.length) throw new Error("Dirty repository produced no safe patch");
  if (patch.length > MAX_BYTES)
    throw new Error("Patch handoff exceeds the 8 MiB LAN limit");
  return {
    kind: "patch_bundle",
    repositoryName,
    baseCommit: repository.headCommit,
    bytesBase64: patch.toString("base64"),
    sha256: createHash("sha256").update(patch).digest("hex"),
  };
}

export async function materializeFleetWorktree(input: {
  orderId: string;
  authorizedRoot: string;
  managedRoot: string;
  handoff?: FleetHandoff;
  signal?: AbortSignal;
}): Promise<string> {
  const jobRoot = path.resolve(input.managedRoot, input.orderId),
    managedRoot = path.resolve(input.managedRoot);
  if (
    jobRoot === managedRoot ||
    !jobRoot.startsWith(`${managedRoot}${path.sep}`)
  )
    throw new Error("Fleet worktree path escaped its managed root");
  rmSync(jobRoot, { recursive: true, force: true });
  mkdirSync(jobRoot, { recursive: true, mode: 0o700 });
  const worktree = path.join(jobRoot, "worktree"),
    handoff = input.handoff;
  if (handoff?.kind === "git_bundle") {
    const bundle = Buffer.from(handoff.bytesBase64, "base64"),
      bundlePath = path.join(jobRoot, "source.bundle"),
      bare = path.join(jobRoot, "repository.git");
    writeFileSync(bundlePath, bundle, { flag: "wx", mode: 0o600 });
    await run("git", ["clone", "--bare", bundlePath, bare], {
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
      signal: input.signal,
    });
    await run(
      "git",
      ["--git-dir", bare, "worktree", "add", "--detach", worktree, handoff.headCommit],
      {
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        signal: input.signal,
      },
    );
    return worktree;
  }
  const repository = await inspectGitRepository(
      input.authorizedRoot,
      input.signal,
    ),
    base = handoff?.baseCommit ?? repository.headCommit;
  if (!COMMIT.test(base)) throw new Error("Fleet handoff base commit is invalid");
  await git(
    repository.root,
    ["cat-file", "-e", `${base}^{commit}`],
    undefined,
    input.signal,
  );
  await git(
    repository.root,
    ["worktree", "add", "--detach", worktree, base],
    undefined,
    input.signal,
  );
  if (handoff?.kind === "patch_bundle") {
    const patchPath = path.join(jobRoot, "changes.patch");
    writeFileSync(patchPath, Buffer.from(handoff.bytesBase64, "base64"), {
      flag: "wx",
      mode: 0o600,
    });
    await git(
      worktree,
      ["apply", "--binary", "--index", patchPath],
      undefined,
      input.signal,
    );
    await git(
      worktree,
      ["config", "user.email", "waypoint-handoff@local.invalid"],
      undefined,
      input.signal,
    );
    await git(
      worktree,
      ["config", "user.name", "Waypoint Handoff"],
      undefined,
      input.signal,
    );
    await git(
      worktree,
      ["commit", "-m", "Waypoint remote handoff baseline"],
      undefined,
      input.signal,
    );
  }
  return worktree;
}

export async function fleetWorktreeResult(
  worktree: string,
  baseCommit: string,
  signal?: AbortSignal,
) {
  if (!COMMIT.test(baseCommit))
    throw new Error("Fleet result base commit is invalid");
  await git(
    worktree,
    ["cat-file", "-e", `${baseCommit}^{commit}`],
    undefined,
    signal,
  );
  // The managed worktree is disposable. Staging here lets the returned patch
  // include staged, unstaged, committed, and newly-created non-ignored files.
  await git(worktree, ["add", "-A"], undefined, signal);
  const [diff, changedPaths] = await Promise.all([
    git(
      worktree,
      ["diff", "--cached", "--binary", baseCommit],
      MAX_BYTES + 1024,
      signal,
    ),
    git(
      worktree,
      ["diff", "--cached", "--name-status", baseCommit],
      undefined,
      signal,
    ),
  ]);
  const patch = Buffer.from(String(diff.stdout));
  if (patch.length > MAX_BYTES)
    throw new Error("Returned fleet patch exceeds the 8 MiB limit");
  return {
    dirty: Boolean(patch.length),
    status: String(changedPaths.stdout).trim().split(/\r?\n/).filter(Boolean),
    patchBase64: patch.toString("base64"),
    patchSha256: createHash("sha256").update(patch).digest("hex"),
  };
}

export async function applyFleetResultPatch(input: {
  repositoryRoot: string;
  scratchRoot: string;
  patchBase64: string;
  patchSha256: string;
  expectedBaseCommit: string;
}) {
  const repository = await inspectGitRepository(input.repositoryRoot),
    patch = Buffer.from(input.patchBase64, "base64");
  if (
    !COMMIT.test(input.expectedBaseCommit) ||
    repository.headCommit !== input.expectedBaseCommit
  )
    throw new Error(
      "Fleet result base commit no longer matches the selected repository",
    );
  if (
    patch.length > MAX_BYTES ||
    patch.toString("base64") !== input.patchBase64 ||
    createHash("sha256").update(patch).digest("hex") !== input.patchSha256
  )
    throw new Error("Fleet result patch integrity check failed");
  if (!patch.length) return { applied: false, reason: "clean" as const };
  mkdirSync(input.scratchRoot, { recursive: true, mode: 0o700 });
  const patchPath = path.join(
    input.scratchRoot,
    `result-${process.pid}-${Date.now()}.patch`,
  );
  try {
    writeFileSync(patchPath, patch, { flag: "wx", mode: 0o600 });
    await git(repository.root, ["apply", "--check", "--binary", patchPath]);
    await git(repository.root, ["apply", "--binary", patchPath]);
    return { applied: true, reason: "applied" as const };
  } finally {
    rmSync(patchPath, { force: true });
  }
}

export async function discardFleetWorktree(
  authorizedRoot: string,
  managedRoot: string,
  jobId: string,
): Promise<void> {
  const root = path.resolve(managedRoot),
    target = path.resolve(root, jobId);
  if (target === root || !target.startsWith(`${root}${path.sep}`))
    throw new Error("Fleet worktree discard escaped its managed root");
  const worktree = path.join(target, "worktree");
  if (existsSync(worktree))
    await git(path.resolve(authorizedRoot), [
      "worktree",
      "remove",
      "--force",
      worktree,
    ]).catch(() => undefined);
  rmSync(target, { recursive: true, force: true });
}
