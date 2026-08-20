import type { SanitizedSyncStatus } from "../electron/core/types.js";

type Capability = {
  name: "codex" | "claude" | "grok";
  available: boolean;
  version?: string;
  compatible?: boolean;
  compatibilityError?: string;
};
export type ReadinessItem = {
  id: "storage" | "codex" | "claude" | "grok" | "sync";
  status: "ready" | "attention" | "optional";
  summary: string;
};

export function onboardingReadiness(
  capabilities: Capability[],
  sync: SanitizedSyncStatus,
): ReadinessItem[] {
  const cli = (name: "codex" | "claude" | "grok"): ReadinessItem => {
    const value = capabilities.find((item) => item.name === name),
      label =
        name === "codex"
          ? "Codex"
          : name === "claude"
            ? "Claude Code"
            : "Grok Build";
    return value?.available && value.compatible !== false
      ? {
          id: name,
          status: "ready",
          summary: `${label} ${value.version ?? "installed"} is available.`,
        }
      : {
          id: name,
          status: "attention",
          summary:
            value?.compatibilityError ??
            `${label} is unavailable. Waypoint remains useful without it.`,
        };
  };
  return [
    {
      id: "storage",
      status: "ready",
      summary: "Workspace content is stored locally on this device.",
    },
    cli("codex"),
    cli("claude"),
    cli("grok"),
    {
      id: "sync",
      status: "optional",
      summary:
        sync.state === "local_only"
          ? "Sync is local-only. Native node setup and device enrollment require your explicit action."
          : "Sync setup is incomplete; no connection was made during onboarding.",
    },
  ];
}
