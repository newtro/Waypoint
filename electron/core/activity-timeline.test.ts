import { describe, expect, it } from "vitest";
import { activityFamily, safeActivityDetails } from "./activity-timeline.js";

describe("activity timeline privacy contract", () => {
  it("normalizes current and reserved event families", () => {
    expect(activityFamily("ai")).toBe("execution");
    expect(activityFamily("knowledge")).toBe("content");
    expect(activityFamily("rules")).toBe("rules");
    expect(activityFamily("meeting")).toBe("meeting");
    expect(activityFamily("automation")).toBe("automation");
  });

  it("keeps only content-minimized display metadata", () => {
    expect(
      safeActivityDetails(
        JSON.stringify({
          cli: "codex",
          model: "gpt",
          device: "local",
          version: 1,
          localPath: "/secret",
          prompt: "private",
          sourceMessageId: "id",
        }),
      ),
    ).toEqual({ cli: "codex", device: "local", version: 1 });
    expect(
      safeActivityDetails(JSON.stringify({ cli: "grok", device: "local" })),
    ).toEqual({ cli: "grok", device: "local" });
    expect(
      safeActivityDetails(
        JSON.stringify({
          status: "sk-proj-secretcredential",
          phase: "secretcredential",
          type: "secretcredential",
          extractor: "secretcredential",
          model: "secretcredential",
          cli: "malicious",
          created: Infinity,
        }),
      ),
    ).toEqual({});
    expect(safeActivityDetails("{broken")).toEqual({});
  });
});
