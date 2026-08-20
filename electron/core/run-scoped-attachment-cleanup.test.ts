import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupRunScopedAttachmentDirectories,
  initializeRunScopedAttachmentOwnership,
  managedWorkspaceExecutionRoots,
  markRunScopedAttachmentDirectory,
} from "./run-scoped-attachment-cleanup.js";

describe("run-scoped attachment cleanup", () => {
  it("initializes and reopens the private ownership key for a missing user-data directory", () => {
    const parent = mkdtempSync(
        path.join(tmpdir(), "waypoint-run-ownership-key-"),
      ),
      storage = path.join(parent, "new-user-data");
    expect(existsSync(storage)).toBe(false);
    expect(() => initializeRunScopedAttachmentOwnership(storage)).not.toThrow();
    expect(
      existsSync(path.join(storage, "run-scoped-attachment-ownership.key")),
    ).toBe(true);
    expect(() => initializeRunScopedAttachmentOwnership(storage)).not.toThrow();
  });
  it("removes only exact Waypoint run directories inside selected roots", () => {
    const root = mkdtempSync(
        path.join(tmpdir(), "waypoint-run-attachment-cleanup-"),
      ),
      stale = path.join(
        root,
        ".waypoint-cli-attachments-12345678-1234-4234-9234-123456789abc",
      ),
      images = path.join(root, ".waypoint-cli-images-aB123Z"),
      foreign = path.join(root, ".waypoint-cli-images-user01"),
      preserved = path.join(root, ".waypoint-cli-attachments-user-files");
    mkdirSync(stale);
    markRunScopedAttachmentDirectory(stale);
    writeFileSync(path.join(stale, "0.pdf"), "%PDF-");
    mkdirSync(images);
    markRunScopedAttachmentDirectory(images);
    writeFileSync(path.join(images, "0.png"), "pixels");
    mkdirSync(foreign);
    writeFileSync(
      path.join(foreign, ".waypoint-owned.json"),
      JSON.stringify({
        owner: "waypoint",
        purpose: "run-scoped-provider-attachment",
        version: 2,
        signature: "0".repeat(64),
      }),
    );
    writeFileSync(path.join(foreign, "0.png"), "user pixels");
    mkdirSync(preserved);
    writeFileSync(path.join(preserved, "notes.txt"), "keep");
    expect(cleanupRunScopedAttachmentDirectories([root, root])).toBe(2);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(images)).toBe(false);
    expect(existsSync(foreign)).toBe(true);
    expect(existsSync(preserved)).toBe(true);
  });
  it("derives roots for managed workspaces that do not store an explicit executionRoot field", () => {
    const assertWorkspaceExecutionRoot = (id: string) => {
      if (id === "two") throw new Error("identity changed");
      return `D:\\managed\\${id}`;
    };
    expect(
      managedWorkspaceExecutionRoots({
        listWorkspaces: () => [{ id: "one" }, { id: "two" }],
        assertWorkspaceExecutionRoot,
      }),
    ).toEqual(["D:\\managed\\one"]);
  });
});
