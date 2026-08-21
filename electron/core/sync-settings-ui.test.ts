import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/main.tsx", "utf8").replace(/\s+/g, " "),
  transport = readFileSync(
    "electron/core/sync/peer-host-transport.ts",
    "utf8",
  );

describe("device invitation settings flow", () => {
  it("starts a stopped desktop host before a bounded invitation request", () => {
    expect(source).toMatch(
      /desktopSyncStatus\(target\.id\).*current\.transportMode === "desktop-host".*!current\.peerHost\?\.running.*startDesktopSyncHost\(target\.id\).*createSyncInvitation\(target\.id\)/,
    );
    expect(source).toContain("Start host & invite");
    expect(source).toContain('disabled={inviteBusy}');
    expect(source).toContain("scopeCurrent = () => attachmentContextRef.current.workspaceId === target.id");
    expect(source).toContain("if (!scopeCurrent() && startedHost) await window.waypoint.stopDesktopSyncHost(target.id)");
    expect(transport).toContain("allowPartialTrustChain: true");
  });

  it("keeps the one-use token visible when clipboard access is denied", () => {
    expect(source).toContain('className="sync-invitation"');
    expect(source).toContain('aria-label="One-use enrollment token"');
    expect(source).toContain("Copy it from the visible invitation card");
    expect(source).toContain("Clipboard access was denied");
  });
});
