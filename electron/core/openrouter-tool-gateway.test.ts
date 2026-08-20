import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  openRouterToolApprovalKind,
  openRouterToolNeedsApproval,
  openRouterToolRequest,
  openRouterTools,
} from "./openrouter-tool-gateway.js";
import { validatePolicy } from "./tool-gateway.js";

const TEST_ROOT = path.resolve(process.cwd());

const profile = (
  name: string,
  filesystem: "read-only" | "workspace-write",
  network: "disabled" | "provider-only" | "enabled",
  tools: string[],
) => ({
  id: name,
  name,
  roots: [TEST_ROOT],
  filesystem,
  network,
  tools,
  approval: "on-write" as const,
  maxDurationMs: 120000,
  maxConcurrency: 1,
  peerEligible: false,
  secretNames: [],
});
describe("OpenRouter Tool Gateway contract", () => {
  it("exposes only repository reads to Chat and full bounded capabilities only to Full agent", () => {
    expect(
      openRouterTools(
        profile("Chat", "read-only", "provider-only", ["provider-native"]),
      ).map((item) => item.function.name),
    ).toEqual([
      "workspace_list_files",
      "workspace_read_file",
      "workspace_search",
      "waypoint_automation_proposal",
    ]);
    expect(
      openRouterTools(
        profile("Full", "workspace-write", "enabled", [
          "terminal",
          "local-cli",
          "web",
          "browser",
          "waypoint",
        ]),
      ).map((item) => item.function.name),
    ).toEqual(
      expect.arrayContaining([
        "workspace_write_file",
        "terminal_run",
        "local_cli_run",
        "web_search",
        "web_fetch",
        "agent_browser_run",
        "waypoint_command",
        "waypoint_automation_proposal",
      ]),
    );
  });
  it("maps model calls to typed gateway requests and classifies approvals", () => {
    const request = openRouterToolRequest("w1", "c1", {
      id: "call",
      name: "workspace_write_file",
      arguments: { path: "a.txt", content: "hello" },
    });
    expect(request).toMatchObject({
      workspaceId: "w1",
      origin: "ai",
      tool: "workspace.write_file",
      arguments: { path: "a.txt", content: "hello", contextChatId: "c1" },
    });
    expect(openRouterToolNeedsApproval(request)).toBe(true);
    expect(openRouterToolApprovalKind(request)).toBe("file_change");
    expect(
      openRouterToolNeedsApproval(
        openRouterToolRequest("w1", "c1", {
          id: "read",
          name: "workspace_read_file",
          arguments: { path: "a.txt" },
        }),
      ),
    ).toBe(false);
  });
  it("rejects model-invented tools", () =>
    expect(() =>
      openRouterToolRequest("w1", "c1", {
        id: "bad",
        name: "host_shell",
        arguments: {},
      }),
    ).toThrow("provider_tool_unavailable"));
  it("rejects a known tool omitted by the selected profile contract", () => {
    const chatTools = new Set(
      openRouterTools(
        profile("Chat · read only", "read-only", "provider-only", [
          "provider-native",
        ]),
      ).map((item) => item.function.name),
    );
    expect(() =>
      openRouterToolRequest(
        "w1",
        "c1",
        {
          id: "bypass",
          name: "workspace_write_file",
          arguments: { path: "bypass.txt", content: "no" },
        },
        chatTools,
      ),
    ).toThrow("provider_tool_unavailable");
  });
  it("advertises only local CLIs the Tool Gateway can execute", () => {
    const localCli = openRouterTools(
      profile("Full", "workspace-write", "enabled", ["local-cli"]),
    ).find((item) => item.function.name === "local_cli_run");
    expect(
      (
        localCli?.function.parameters.properties as Record<
          string,
          { enum?: string[] }
        >
      ).cli.enum,
    ).toEqual(["git", "gh", "az"]);
  });
  it("accepts every built-in profile and rejects an invented authority profile", () => {
    for (const item of [
      profile("Chat · read only", "read-only", "provider-only", [
        "provider-native",
      ]),
      profile("Developer · approve changes", "workspace-write", "disabled", [
        "files",
      ]),
      profile("Full agent · network enabled", "workspace-write", "enabled", [
        "terminal",
      ]),
    ])
      expect(() =>
        validatePolicy({
          ...item,
          profileName: item.name,
          denyPatterns: [],
          stopped: false,
          suppressCommit: false,
          suppressPush: false,
        }),
      ).not.toThrow();
    expect(() =>
      validatePolicy({
        ...profile("Invented", "workspace-write", "enabled", ["terminal"]),
        profileName: "Invented",
        denyPatterns: [],
        stopped: false,
        suppressCommit: false,
        suppressPush: false,
      }),
    ).toThrow("tool_profile_unavailable");
  });
});
