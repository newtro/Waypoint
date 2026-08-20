import path from "node:path";
import { ToolGateway, type ToolResult } from "../../electron/core/tool-gateway.js";

const workspaceRoot = path.resolve("D:/Repos/Waypoint"),
  completed: ToolResult[] = [],
  gateway = new ToolGateway({
    domain: async () => ({ value: {}, summary: "unused" }),
    progress: () => undefined,
    complete: (value) => completed.push(value),
  }),
  started = await gateway.execute(
    {
      version: 1,
      workspaceId: "live-az-tool-gateway",
      origin: "ui",
      tool: "local_cli.run",
      arguments: {
        cli: "az",
        cwd: ".",
        args: [
          "devops",
          "project",
          "show",
          "--organization",
          "https://dev.azure.com/clientsystems",
          "--project",
          "scv2",
          "--output",
          "json",
          "--only-show-errors",
        ],
      },
    },
    {
      profileName: "Bypass permissions · no prompts",
      roots: [workspaceRoot],
      denyPatterns: [],
      stopped: false,
      secretNames: [],
      maxDurationMs: 120_000,
      maxConcurrency: 1,
      suppressCommit: false,
      suppressPush: false,
    },
  ),
  result = started.result ?? (await gateway.waitForCompletion(started.runId, 120_000));

if (result.receipt.status !== "completed")
  throw new Error(`${result.receipt.code ?? result.receipt.status}: ${result.receipt.summary}`);
const value = JSON.parse(result.output ?? "{}") as Record<string, unknown>;
if (
  typeof value.id !== "string" ||
  String(value.name).toLocaleLowerCase() !== "scv2"
)
  throw new Error("Azure DevOps project discovery returned unexpected identity data");
console.log(
  JSON.stringify({
    status: result.receipt.status,
    tool: result.receipt.tool,
    projectId: value.id,
    projectName: value.name,
    completedReceipts: completed.length,
  }),
);
