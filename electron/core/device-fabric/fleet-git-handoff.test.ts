import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFleetResultPatch,
  fleetWorktreeResult,
  materializeFleetWorktree,
  prepareFleetGitHandoff,
} from "./fleet-git-handoff.js";

function repository() {
  const root = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-git-"));
  execFileSync("git", ["init", root], { windowsHide: true });
  execFileSync("git", ["-C", root, "config", "user.email", "qa@example.test"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Waypoint QA"]);
  writeFileSync(path.join(root, "README.md"), "base\n");
  execFileSync("git", ["-C", root, "add", "README.md"]);
  execFileSync("git", ["-C", root, "commit", "-m", "base"], {
    windowsHide: true,
  });
  return root;
}

describe("fleet Git handoff", () => {
  it("materializes a clean commit bundle into an isolated managed worktree", async () => {
    const source = repository(),
      scratch = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-scratch-")),
      managed = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-managed-")),
      handoff = await prepareFleetGitHandoff(source, scratch),
      worktree = await materializeFleetWorktree({
        orderId: "remote_job_bundle_0001",
        authorizedRoot: source,
        managedRoot: managed,
        handoff,
      });
    expect(handoff.kind).toBe("git_bundle");
    expect(worktree.startsWith(path.resolve(managed))).toBe(true);
    expect(
      readFileSync(path.join(worktree, "README.md"), "utf8").replaceAll("\r\n", "\n"),
    ).toBe("base\n");
  });

  it("applies tracked dirty changes only inside a detached target worktree", async () => {
    const source = repository(),
      targetParent = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-target-")),
      target = path.join(targetParent, "repo"),
      scratch = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-patch-")),
      managed = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-managed-"));
    execFileSync("git", ["clone", source, target], { windowsHide: true });
    writeFileSync(path.join(source, "README.md"), "changed\n");
    const handoff = await prepareFleetGitHandoff(source, scratch),
      worktree = await materializeFleetWorktree({
        orderId: "remote_job_patch_00001",
        authorizedRoot: target,
        managedRoot: managed,
        handoff,
      });
    expect(handoff.kind).toBe("patch_bundle");
    expect(
      readFileSync(path.join(worktree, "README.md"), "utf8").replaceAll("\r\n", "\n"),
    ).toBe("changed\n");
    expect(
      readFileSync(path.join(target, "README.md"), "utf8").replaceAll("\r\n", "\n"),
    ).toBe("base\n");
    const baseCommit = execFileSync(
      "git",
      ["-C", worktree, "rev-parse", "HEAD"],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    writeFileSync(path.join(worktree, "README.md"), "agent result\n");
    writeFileSync(path.join(worktree, "NEW.txt"), "new artifact\n");
    execFileSync("git", ["-C", worktree, "add", "README.md"], {
      windowsHide: true,
    });
    execFileSync("git", ["-C", worktree, "commit", "-m", "agent commit"], {
      windowsHide: true,
    });
    const result = await fleetWorktreeResult(worktree, baseCommit);
    expect(result.status).toContain("A\tNEW.txt");
    expect(result.status).toContain("M\tREADME.md");
    await expect(
      applyFleetResultPatch({
        repositoryRoot: source,
        scratchRoot: scratch,
        patchBase64: result.patchBase64,
        patchSha256: result.patchSha256,
        expectedBaseCommit: handoff.baseCommit!,
      }),
    ).resolves.toEqual({ applied: true, reason: "applied" });
    expect(
      readFileSync(path.join(source, "README.md"), "utf8").replaceAll("\r\n", "\n"),
    ).toBe("agent result\n");
    expect(
      readFileSync(path.join(source, "NEW.txt"), "utf8").replaceAll(
        "\r\n",
        "\n",
      ),
    ).toBe("new artifact\n");
  });

  it("rejects a returned patch after the controller repository base changes", async () => {
    const source = repository(),
      scratch = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-result-base-")),
      handoff = await prepareFleetGitHandoff(source, scratch);
    writeFileSync(path.join(source, "README.md"), "new head\n");
    execFileSync("git", ["-C", source, "commit", "-am", "move base"], {
      windowsHide: true,
    });
    await expect(
      applyFleetResultPatch({
        repositoryRoot: source,
        scratchRoot: scratch,
        patchBase64: "",
        patchSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        expectedBaseCommit: handoff.baseCommit!,
      }),
    ).rejects.toThrow(/base commit/);
  });

  it("aborts target Git setup when the remote-work lease is canceled", async () => {
    const source = repository(),
      managed = mkdtempSync(path.join(tmpdir(), "waypoint-fleet-abort-")),
      controller = new AbortController();
    controller.abort();
    await expect(
      materializeFleetWorktree({
        orderId: "remote_job_aborted_0001",
        authorizedRoot: source,
        managedRoot: managed,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
  });
});
