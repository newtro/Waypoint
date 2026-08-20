import { spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { terminateCodexProcessTree } from "../../electron/core/codex-app-server.js";

type JsonObject = Record<string, unknown>;

const executable = "C:\\Users\\scott\\.grok\\bin\\grok.exe",
  realAuth = "C:\\Users\\scott\\.grok\\auth.json",
  isolatedHome = mkdtempSync(path.join(tmpdir(), "waypoint-grok-automate-home-")),
  isolatedRoot = mkdtempSync(path.join(tmpdir(), "waypoint-grok-automate-root-")),
  calls: JsonObject[] = [],
  mcpMessages: JsonObject[] = [],
  updates: unknown[] = [],
  stderr: string[] = [];
let child: ReturnType<typeof spawn> | undefined;

const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};

function mcpResponse(message: JsonObject): JsonObject {
  mcpMessages.push(message);
  const id = message.id ?? null,
    method = String(message.method ?? ""),
    params = object(message.params);
  console.error(`MCP ${method}`);
  if (method === "initialize")
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "waypoint", version: "1.0.0" },
        instructions:
          "The only available tool prepares a pending Waypoint automation proposal.",
      },
    };
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list")
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "automation_proposal",
            description:
              "Prepare a pending Waypoint automation proposal for explicit confirmation.",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              required: ["definition"],
              properties: { definition: { type: "object" } },
            },
          },
        ],
      },
    };
  if (method === "tools/call") {
    calls.push(params);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: "Pending Waypoint automation proposal proof-proposal was prepared. Nothing was provisioned or enabled.",
          },
        ],
        structuredContent: {
          proposalId: "proof-proposal",
          status: "pending_confirmation",
        },
      },
    };
  }
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Unsupported MCP method ${method}` },
  };
}

try {
  writeFileSync(
    path.join(isolatedHome, "config.toml"),
    'disabled_mcp_servers = ["codex-bridge", "unityMCP", "context7", "tasks"]\n[disabled_mcp_tools]\n__managed_gateway_connectors = ["tasks"]\n[cli]\nauto_update=false\n[models]\ndefault="grok-4.6"\n[compat.claude]\nmcps=false\nhooks=false\nskills=false\nagents=false\nrules=false\n[compat.cursor]\nmcps=false\nhooks=false\nskills=false\nagents=false\nrules=false\n',
    { encoding: "utf8", mode: 0o600 },
  );
  const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      HOMEDRIVE: path.parse(isolatedHome).root.slice(0, -1),
      HOMEPATH: isolatedHome.slice(path.parse(isolatedHome).root.length - 1),
      APPDATA: path.join(isolatedHome, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(isolatedHome, "AppData", "Local"),
      GROK_HOME: isolatedHome,
      GROK_AUTH_PATH: realAuth,
      GROK_DISABLE_AUTOUPDATER: "1",
      GROK_CURSOR_SKILLS_ENABLED: "false",
      GROK_CURSOR_RULES_ENABLED: "false",
      GROK_CURSOR_AGENTS_ENABLED: "false",
      GROK_CURSOR_MCPS_ENABLED: "false",
      GROK_CURSOR_HOOKS_ENABLED: "false",
      GROK_CLAUDE_SKILLS_ENABLED: "false",
      GROK_CLAUDE_RULES_ENABLED: "false",
      GROK_CLAUDE_AGENTS_ENABLED: "false",
      GROK_CLAUDE_MCPS_ENABLED: "false",
      GROK_CLAUDE_HOOKS_ENABLED: "false",
    };
  child = spawn(
      executable,
      ["--always-approve", "--disable-web-search", "--no-subagents", "--no-memory", "agent", "--no-leader", "stdio"],
      {
        cwd: isolatedRoot,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const parseSdkCall = (value: unknown) => {
      const params = object(value),
        message = object(params.message);
      if (
        params.serverId !== "waypoint-automation" ||
        message.jsonrpc !== "2.0" ||
        typeof message.method !== "string"
      )
        throw new Error("Invalid Grok reverse MCP request");
      return { serverId: String(params.serverId), message };
    },
    app = acp
      .client({ name: "waypoint-automation-proof" })
      .onRequest(
        acp.methods.client.session.requestPermission,
        ({ params }) => {
          const input = object(params.toolCall.rawInput);
          if (
            params.toolCall.name === "search_tool" ||
            (params.toolCall.name === "use_tool" &&
              input.tool_name === "waypoint__automation_proposal")
          ) {
            const allow = params.options.find(
              (candidate) => candidate.kind === "allow_once",
            );
            if (allow)
              return {
                outcome: { outcome: "selected", optionId: allow.optionId },
              };
          }
          return { outcome: { outcome: "cancelled" } };
        },
      )
      .onRequest(
        "_x.ai/mcp/sdk_call",
        parseSdkCall,
        ({ params }) => mcpResponse(params.message),
      )
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        updates.push(params.update);
        const update = object(params.update);
        if (
          update.sessionUpdate === "agent_message_chunk" ||
          update.sessionUpdate === "tool_call" ||
          update.sessionUpdate === "tool_call_update" ||
          update.sessionUpdate === "available_commands_update"
        )
          console.error(`UPDATE ${JSON.stringify(update).slice(0, 2_000)}`);
      }),
    result = await app.connectWith(
      acp.ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
      async (ctx) => {
        const initialized = await ctx.request(acp.methods.agent.initialize, {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientInfo: { name: "waypoint", version: "0.0.9" },
            clientCapabilities: {},
          }),
          profile = {
            name: "waypoint-automate",
            description:
              "Approval-gated Waypoint automation proposal planning only.",
            permissionMode: "bypassPermissions",
            toolConfig: {
              tools: [
                {
                  id: "GrokBuild:search_tool",
                  params: null,
                  name_override: null,
                  params_name_overrides: null,
                  description_override: null,
                  behavior_version: null,
                  kind: null,
                },
                {
                  id: "GrokBuild:use_tool",
                  params: null,
                  name_override: null,
                  params_name_overrides: null,
                  description_override: null,
                  behavior_version: null,
                  kind: null,
                },
              ],
            },
            injectDefaultTools: false,
            discoverSkills: false,
            inheritSkills: false,
            agentsMd: false,
            skills: [],
            tools: [],
            disallowedTools: [],
            mcpServers: [],
            mcpInheritance: "none",
            hooks: {},
            userMessageTemplate: "default",
            initialPrompt:
              "This session has one permitted integration capability. You may use search_tool only to retrieve the schema for waypoint__automation_proposal. Then invoke use_tool with tool_name exactly waypoint__automation_proposal and tool_input exactly {definition: <the complete definition object>}. Any other use_tool target is denied. A successful call creates only a pending Waypoint confirmation card.",
          },
          session = await ctx.request(acp.methods.agent.session.new, {
            cwd: isolatedRoot,
            mcpServers: [],
            _meta: {
              agentProfile: profile,
              "x.ai/mcp/servers": [
                { name: "waypoint", serverId: "waypoint-automation" },
              ],
            },
          }),
          prompt = await ctx.request(acp.methods.agent.session.prompt, {
            sessionId: session.sessionId,
            prompt: [
              {
                type: "text",
                text: "Prepare a pending Azure DevOps pull-request automation. You must call waypoint__automation_proposal once with a definition whose title is Grok proof, then state that nothing was provisioned.",
              },
            ],
          });
        return { initialized, session, prompt };
      },
    );
  await terminateCodexProcessTree(child, process.platform);
  console.log(
    JSON.stringify({
      ok: result.prompt.stopReason === "end_turn" && calls.length === 1,
      sdk: object(result.initialized._meta)["x.ai/mcp/sdk"],
      sessionId: result.session.sessionId,
      stopReason: result.prompt.stopReason,
      calls,
      mcpMessages,
      updates,
      stderr: stderr.join("").slice(-4_000),
    }),
  );
} finally {
  if (child && child.exitCode === null)
    await terminateCodexProcessTree(child, process.platform).catch(() => undefined);
  for (const candidate of [isolatedHome, isolatedRoot]) {
    try {
      rmSync(candidate, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    } catch (error) {
      console.error(
        `cleanup warning for ${candidate}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
