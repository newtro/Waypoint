import type {
  OpenRouterToolDefinition,
  OpenRouterToolCall,
} from "./openrouter-provider.js";
import type { WorkspaceStore } from "./store.js";
import type { ToolRequest } from "./tool-gateway.js";
import { automationProposalInputSchema } from "./automation-ai-tool.js";

type SecurityProfile = ReturnType<
  WorkspaceStore["listSecurityProfiles"]
>[number];

export const OPENROUTER_AUTOMATION_PROPOSAL_TOOL =
  "waypoint_automation_proposal";
const automationProposalTool: OpenRouterToolDefinition = {
  type: "function",
  function: {
    name: OPENROUTER_AUTOMATION_PROPOSAL_TOOL,
    description:
      "Validate an exact Waypoint webhook automation definition and prepare one pending confirmation transaction. This never provisions or enables the automation.",
    parameters: automationProposalInputSchema(),
  },
};

const definitions: Record<
  ToolRequest["tool"],
  OpenRouterToolDefinition["function"]
> = {
  "workspace.list_files": {
    name: "workspace_list_files",
    description: "List files and directories inside the selected repository.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      additionalProperties: false,
    },
  },
  "workspace.read_file": {
    name: "workspace_read_file",
    description: "Read a UTF-8 file inside the selected repository.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  "workspace.search": {
    name: "workspace_search",
    description: "Search text inside the selected repository.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  "workspace.write_file": {
    name: "workspace_write_file",
    description:
      "Write a UTF-8 file inside the selected repository. Requires user approval.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  "terminal.run": {
    name: "terminal_run",
    description:
      "Run one local process inside the selected repository. Requires user approval.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        timeoutMs: { type: "integer" },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  "local_cli.run": {
    name: "local_cli_run",
    description:
      "Run an installed supported CLI inside the selected repository. Requires user approval.",
    parameters: {
      type: "object",
      properties: {
        cli: { type: "string", enum: ["git", "gh", "az"] },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        timeoutMs: { type: "integer" },
      },
      required: ["cli", "args"],
      additionalProperties: false,
    },
  },
  "web.search": {
    name: "web_search",
    description:
      "Search the public web through Waypoint controlled web tools. Requires enabled network authority and user approval.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  "web.fetch": {
    name: "web_fetch",
    description:
      "Fetch one public URL through Waypoint controlled web tools. Requires enabled network authority and user approval.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  "agent_browser.run": {
    name: "agent_browser_run",
    description:
      "Use the controlled local browser. Requires enabled browser authority and user approval.",
    parameters: {
      type: "object",
      properties: { action: { type: "object" } },
      required: ["action"],
      additionalProperties: false,
    },
  },
  "waypoint.command": {
    name: "waypoint_command",
    description:
      "Run a bounded Waypoint domain command. Mutating commands require user approval.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" }, input: { type: "object" } },
      required: ["command"],
      additionalProperties: false,
    },
  },
};
const byName = new Map(
  Object.entries(definitions).map(([tool, value]) => [
    value.name,
    tool as ToolRequest["tool"],
  ]),
);
export function openRouterTools(
  profile: SecurityProfile,
): OpenRouterToolDefinition[] {
  const allowed = new Set<ToolRequest["tool"]>([
    "workspace.list_files",
    "workspace.read_file",
    "workspace.search",
  ]);
  if (profile.filesystem === "workspace-write") {
    allowed.add("workspace.write_file");
    if (profile.tools.includes("terminal")) allowed.add("terminal.run");
    if (profile.tools.includes("local-cli")) allowed.add("local_cli.run");
  }
  if (profile.network === "enabled" && profile.tools.includes("web")) {
    allowed.add("web.search");
    allowed.add("web.fetch");
  }
  if (profile.network === "enabled" && profile.tools.includes("browser"))
    allowed.add("agent_browser.run");
  if (profile.tools.includes("waypoint")) allowed.add("waypoint.command");
  return [
    ...[...allowed].map((tool) => ({
      type: "function" as const,
      function: definitions[tool],
    })),
    automationProposalTool,
  ];
}
export function openRouterToolRequest(
  workspaceId: string,
  chatId: string,
  call: OpenRouterToolCall,
  allowedNames?: ReadonlySet<string>,
): ToolRequest {
  const tool = byName.get(call.name);
  if (!tool || (allowedNames && !allowedNames.has(call.name)))
    throw new Error("provider_tool_unavailable");
  return {
    version: 1,
    workspaceId,
    origin: "ai",
    tool,
    arguments: { ...call.arguments, contextChatId: chatId },
  };
}
export function openRouterToolNeedsApproval(request: ToolRequest): boolean {
  return ![
    "workspace.list_files",
    "workspace.read_file",
    "workspace.search",
  ].includes(request.tool);
}
export function openRouterToolApprovalKind(
  request: ToolRequest,
): "command" | "file_change" | "network" | "tool" {
  if (request.tool === "workspace.write_file") return "file_change";
  if (request.tool === "terminal.run" || request.tool === "local_cli.run")
    return "command";
  if (
    request.tool === "web.search" ||
    request.tool === "web.fetch" ||
    request.tool === "agent_browser.run"
  )
    return "network";
  return "tool";
}
