import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "./store.js";
import type { OpenRouterSettings } from "./openrouter-provider.js";

const settings: OpenRouterSettings = {
  enabled: false,
  liveRequestsEnabled: false,
  strategicModel: "moonshotai/kimi-k3",
  everydayModel: "deepseek/deepseek-v4-flash",
  attachmentModel: "qwen/qwen3.8-max",
  fallbackProvider: "codex",
  monthlyCapMicros: 5_000_000,
  ytdCapMicros: 25_000_000,
  perRequestCapMicros: 100_000,
  warningPercent: 80,
};

describe("OpenRouter model and thinking save", () => {
  it("persists hosted models and their workspace thinking preferences atomically", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-routing-save-")),
      store = new WorkspaceStore(path.join(root, "waypoint.sqlite")),
      workspace = store.createWorkspace("Routing", root);
    const saved = store.setOpenRouterRouting(workspace.id, settings, {
      openrouterStrategic: "high",
      openrouterEveryday: "low",
      openrouterAttachment: "medium",
    });
    expect(saved.settings).toEqual(settings);
    expect(saved.thinking).toMatchObject({
      openrouterStrategic: "high",
      openrouterEveryday: "low",
      openrouterAttachment: "medium",
    });
    expect(() =>
      store.setOpenRouterRouting(
        workspace.id,
        { ...settings, strategicModel: "z-ai/glm-5.2" },
        {
          openrouterStrategic: "invented" as "high",
          openrouterEveryday: "low",
          openrouterAttachment: "medium",
        },
      ),
    ).toThrow(/invalid/);
    expect(store.openRouterSettings()).toEqual(settings);
    store.close();
  });
});
