import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { cliExecutionEnvironment } from "../../spikes/cli-capabilities.js";
import { terminateCodexProcessTree } from "./codex-app-server.js";
import {
  isThinkingEffort,
  providerThinkingEfforts,
  type ThinkingEffort,
} from "../../src/model-thinking.js";

export type LocalProviderModel = {
  id: string;
  label: string;
  legacy?: boolean;
  thinking?: {
    supported: ThinkingEffort[];
    defaultEffort?: ThinkingEffort;
  };
};
export type LocalProviderModelCatalog = {
  provider: "codex" | "claude" | "grok";
  version?: string;
  source: "installed-cli";
  ready: boolean;
  models: LocalProviderModel[];
  reason: string;
};
type CliCapability = {
  name: "codex" | "claude" | "grok";
  available: boolean;
  compatible?: boolean;
  executable?: string;
  version?: string;
  error?: string;
  compatibilityError?: string;
};
type Runner = (
  file: string,
  args: string[],
  signal?: AbortSignal,
) => Promise<string>;
const activeInventories = new Map<
  ChildProcessWithoutNullStreams,
  Promise<void>
>();
const activeCatalogs = new Set<Promise<LocalProviderModelCatalog[]>>();
let inventoryShutdownStarted = false;
const run: Runner = (file, args, signal) =>
  new Promise((resolve, reject) => {
    if (inventoryShutdownStarted || signal?.aborted) {
      reject(new Error("CLI model inventory was canceled"));
      return;
    }
    const env = cliExecutionEnvironment(file);
    if (args[0] === "models" && (process.env.USERPROFILE ?? process.env.HOME)) {
      const home = process.env.USERPROFILE ?? process.env.HOME!;
      env.HOME = home;
      env.GROK_HOME = path.join(home, ".grok");
      env.GROK_DISABLE_AUTOUPDATER = "1";
    }
    const child = spawn(file, args, {
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();
    const finished = new Promise<void>((finish) => {
      child.once("error", () => finish());
      child.once("close", () => finish());
    });
    activeInventories.set(child, finished);
    const abort = () => {
      void terminateCodexProcessTree(child, process.platform);
    };
    signal?.addEventListener("abort", abort, { once: true });
    void finished.finally(() => {
      activeInventories.delete(child);
      signal?.removeEventListener("abort", abort);
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let output = "";
    child.stdout.on("data", (chunk: string) => (output += chunk));
    child.stderr.on("data", (chunk: string) => (output += chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              output.trim() ||
                `${path.basename(file)} model inventory exited with code ${code}`,
            ),
          ),
    );
  });

export async function shutdownInstalledCliModelCatalog(): Promise<void> {
  inventoryShutdownStarted = true;
  while (activeInventories.size || activeCatalogs.size) {
    const active = [...activeInventories.entries()];
    await Promise.allSettled(
      active.map(async ([child, finished]) => {
        await terminateCodexProcessTree(child, process.platform);
        await finished;
      }),
    );
    await Promise.allSettled([...activeCatalogs]);
  }
}

export function parseCodexModelCatalog(raw: string): LocalProviderModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as Record<string, unknown>).models)
      ? ((parsed as Record<string, unknown>).models as unknown[])
      : [];
  const seen = new Set<string>(),
    result: LocalProviderModel[] = [];
  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>,
      id = String(row.slug ?? row.id ?? ""),
      label = String(row.display_name ?? row.name ?? id),
      visibility = String(row.visibility ?? "list");
    if (
      visibility !== "list" ||
      !/^[A-Za-z0-9._:-]{1,100}$/.test(id) ||
      !label ||
      label.length > 120 ||
      seen.has(id)
    )
      continue;
    const rawEfforts = Array.isArray(row.supported_reasoning_levels)
        ? row.supported_reasoning_levels
        : Array.isArray(row.supportedReasoningLevels)
          ? row.supportedReasoningLevels
          : [],
      allowed = providerThinkingEfforts("codex", id),
      supported = rawEfforts
        .map((item) =>
          item && typeof item === "object"
            ? String(
                (item as Record<string, unknown>).effort ??
                  (item as Record<string, unknown>).reasoningEffort ??
                  "",
              )
            : "",
        )
        .filter(
          (item): item is ThinkingEffort =>
            isThinkingEffort(item) && allowed.includes(item),
        ),
      defaultEffort = String(
        row.default_reasoning_level ?? row.defaultReasoningLevel ?? "",
      );
    seen.add(id);
    result.push({
      id,
      label,
      ...(supported.length
        ? {
            thinking: {
              supported,
              ...((supported as string[]).includes(defaultEffort)
                ? { defaultEffort: defaultEffort as ThinkingEffort }
                : {}),
            },
          }
        : {}),
    });
    if (result.length >= 30) break;
  }
  return result;
}

export function parseGrokModelCatalog(raw: string): LocalProviderModel[] {
  if (!/^You are logged in with grok\.com\.$/m.test(raw.replace(/\r/g, "")))
    return [];
  const seen = new Set<string>(),
    models: LocalProviderModel[] = [];
  for (const match of raw.matchAll(/^\s*[-*]\s+(\S+)(?:\s+\(default\))?\s*$/gm)) {
    const id = match[1];
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      label: id.replace(/^grok-/i, "Grok ").replaceAll("-", " "),
      ...(id === "grok-4.6"
        ? { thinking: { supported: ["low", "medium", "high", "xhigh"], defaultEffort: "high" } as const }
        : id === "grok-4.5"
          ? { thinking: { supported: ["low", "medium", "high"], defaultEffort: "high" } as const }
          : {}),
    });
  }
  return models;
}

export const CURATED_CODEX_MODELS: LocalProviderModel[] = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol — flagship", thinking: { supported: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "low" } },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra — balanced", thinking: { supported: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "medium" } },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna — fast", thinking: { supported: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium" } },
  { id: "gpt-5.5", label: "GPT-5.5 — previous generation", thinking: { supported: ["low", "medium", "high", "xhigh"], defaultEffort: "medium" } },
];

export const CURATED_CLAUDE_MODELS: LocalProviderModel[] = [
  { id: "claude-fable-5", label: "Claude Fable 5 — most capable", thinking: { supported: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "high" } },
  { id: "claude-opus-5", label: "Claude Opus 5 — flagship", thinking: { supported: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "high" } },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced", thinking: { supported: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "high" } },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest" },
];

async function collectInstalledCliModelCatalog(
  capabilities: CliCapability[],
  runner: Runner,
  signal?: AbortSignal,
): Promise<LocalProviderModelCatalog[]> {
  const codex = capabilities.find((item) => item.name === "codex"),
    claude = capabilities.find((item) => item.name === "claude"),
    grok = capabilities.find((item) => item.name === "grok");
  let codexModels: LocalProviderModel[] = [],
    codexReason =
      "Current Codex models bundled with this Waypoint release; the installed CLI did not report its account-scoped catalog.";
  let grokModels: LocalProviderModel[] = [],
    grokReason =
      grok?.compatibilityError ||
      grok?.error ||
      (grok?.available
        ? "Grok Build is installed, but no signed-in grok.com model catalog was verified. Run `grok login`, then refresh."
        : "Grok Build is not installed in a standard location or PATH.");
  if (
    !signal?.aborted &&
    codex?.available &&
    codex.compatible !== false &&
    codex.executable
  )
    try {
      codexModels = parseCodexModelCatalog(
        await runner(codex.executable, ["debug", "models"], signal),
      );
      if (codexModels.length)
        codexReason =
          "Selectable models reported by this installed signed-in Codex CLI.";
    } catch {
      /* curated fallback remains */
    }
  if (!codexModels.length) codexModels = CURATED_CODEX_MODELS;
  if (
    !signal?.aborted &&
    grok?.available &&
    grok.compatible !== false &&
    grok.executable
  )
    try {
      grokModels = parseGrokModelCatalog(
        await runner(grok.executable, ["models"], signal),
      );
      if (grokModels.length)
        grokReason =
          "Selectable models reported by this installed signed-in Grok Build CLI.";
    } catch {
      /* truthful empty catalog remains */
    }
  return [
    {
      provider: "codex",
      version: codex?.version,
      source: "installed-cli",
      ready: Boolean(codex?.available && codex.compatible !== false),
      models: [
        { id: "", label: "Codex default (CLI selected)" },
        ...codexModels,
      ],
      reason: codexReason,
    },
    {
      provider: "claude",
      version: claude?.version,
      source: "installed-cli",
      ready: Boolean(claude?.available && claude.compatible !== false),
      models: [
        { id: "", label: "Claude default (CLI selected)" },
        ...CURATED_CLAUDE_MODELS,
      ],
      reason:
        "Current Claude models bundled with this Waypoint release; the default follows the signed-in Claude CLI configuration.",
    },
    {
      provider: "grok",
      version: grok?.version,
      source: "installed-cli",
      ready: grokModels.length > 0,
      models: [{ id: "", label: "Grok default (CLI selected)" }, ...grokModels],
      reason: grokReason,
    },
  ];
}

export function installedCliModelCatalog(
  capabilities: CliCapability[],
  runner: Runner = run,
  signal?: AbortSignal,
): Promise<LocalProviderModelCatalog[]> {
  const task = collectInstalledCliModelCatalog(capabilities, runner, signal);
  if (runner === run) {
    activeCatalogs.add(task);
    void task.then(
      () => activeCatalogs.delete(task),
      () => activeCatalogs.delete(task),
    );
  }
  return task;
}
