import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd(),
  source = (name: string) =>
    readFileSync(path.join(root, name), "utf8").replace(/\r\n/g, "\n");

describe("model-directed configuration integration", () => {
  it("advertises one bounded proposal tool on every direct provider chat", () => {
    const main = source("electron/main.ts"),
      codex = source("electron/core/codex-app-server.ts"),
      claude = source("electron/core/claude-agent-sdk.ts"),
      grok = source("electron/core/grok-agent-acp.ts"),
      openRouter = source("electron/core/openrouter-tool-gateway.ts");
    expect(main).toContain("const onAutomationProposal = !parentExecutionId");
    expect(main).toContain("if (!parentExecutionId)");
    expect(main).toContain("prompt = withAutomationProposalTool({");
    expect(codex).toContain("dynamicTools: request.onAutomationProposal");
    expect(claude).toContain(
      "mcpServers: waypointMcp ? { waypoint: waypointMcp } : undefined",
    );
    expect(grok).toContain(
      'const root = path.resolve(request.workspaceRoot),\n      automationToolEnabled = Boolean(request.onAutomationProposal)',
    );
    expect(openRouter).toContain("automationProposalTool,");
  });

  it("does not expose a composer mode or silently reduce normal provider authority", () => {
    const renderer = source("src/main.tsx"),
      preload = source("electron/preload.ts"),
      codex = source("electron/core/codex-app-server.ts"),
      claude = source("electron/core/claude-agent-sdk.ts"),
      grok = source("electron/core/grok-agent-acp.ts");
    for (const content of [renderer, preload, codex, claude, grok])
      expect(content).not.toContain("automationPlanning");
    expect(renderer).not.toContain("automation-mode-toggle");
    expect(renderer).toContain("model-selected configuration tools ready");
  });

  it("defers authenticated provider discovery until after explicit approval", () => {
    const main = source("electron/main.ts"),
      prepareStart = main.indexOf("async function prepareAutomationProposal"),
      prepareEnd = main.indexOf("\nlet syncVault", prepareStart),
      preparation = main.slice(prepareStart, prepareEnd),
      approvalStart = main.indexOf('"waypoint:automation-proposal-decide"'),
      approval = main.slice(approvalStart);
    expect(preparation).not.toContain("discoverConnectorTarget");
    expect(preparation).not.toContain("local_cli.run");
    expect(approval).toContain("await provisionConnector({");
  });
});
