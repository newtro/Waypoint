import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync("electron/main.ts", "utf8").replace(/\s+/g, " ");

describe("device fabric startup security", () => {
  it("rejects Linux basic_text and makes absent peer-host cleanup idempotent", () => {
    expect(main).toContain(
      'process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"',
    );
    expect(main).toMatch(
      /if \(existsSync\(peerHostRoot\)\).*rmSync\(path\.join\(peerHostRoot, workspaceId\).*syncDirectoryDurably\(peerHostRoot\)/,
    );
  });
});
