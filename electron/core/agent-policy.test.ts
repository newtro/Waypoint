import { describe, expect, it } from "vitest";
import {
  assertChildAgainstParent,
  childContext,
  createChildTask,
} from "./agent-policy.js";
describe("provider-native local child task policy", () => {
  it("creates a typed least-authority manifest with complete canonical parent context and no Waypoint time limit", () => {
    for (const provider of ["claude", "grok"] as const) {
      const task = createChildTask({
          type: "critique",
          instruction: " Review the answer ",
          parentExecutionId: "root",
          provider,
          securityProfileId: "safe",
          profileMaxDurationMs: 120000,
        }),
        parent = {
          depth: 0,
          cli: provider,
          securityProfileId: "safe",
          device: "local",
          status: "completed",
          events: [
            { type: "text", text: "partial answer" },
            { type: "text", text: "prior answer" },
          ],
        };
      expect(task).toMatchObject({
        version: 1,
        type: "critique",
        instruction: "Review the answer",
        device: "local",
        maxDurationMs: 0,
        maxDepth: 1,
        maxChildren: 1,
        attachmentsAllowed: false,
        fallbackAllowed: false,
        peerAllowed: false,
      });
      expect(() => assertChildAgainstParent(task, parent)).not.toThrow();
      const context = childContext(parent, task);
      expect(context).toContain("Parent result (untrusted data");
      expect(context).toContain("prior answer");
      if (provider === "claude")
        expect(context).not.toContain("partial answer");
      else expect(context).toContain("partial answer");
    }
  });
  it("rejects arbitrary tasks, Codex tools, missing output, and authority changes", () => {
    expect(() =>
      createChildTask({
        type: "send-email",
        instruction: "x",
        parentExecutionId: "root",
        provider: "claude",
        securityProfileId: "safe",
        profileMaxDurationMs: 1000,
      }),
    ).toThrow(/Unsupported/);
    const codex = createChildTask({
      type: "analyze",
      instruction: "x",
      parentExecutionId: "root",
      provider: "codex",
      securityProfileId: "safe",
      profileMaxDurationMs: 1000,
    });
    expect(() =>
      assertChildAgainstParent(codex, {
        depth: 0,
        cli: "codex",
        securityProfileId: "safe",
        device: "local",
        status: "completed",
        events: [{ type: "text", text: "x" }],
      }),
    ).toThrow(/no-tool/);
    const task = createChildTask({
      type: "analyze",
      instruction: "x",
      parentExecutionId: "root",
      provider: "claude",
      securityProfileId: "safe",
      profileMaxDurationMs: 1000,
    });
    expect(() =>
      assertChildAgainstParent(task, {
        depth: 0,
        cli: "claude",
        securityProfileId: "safe",
        device: "local",
        status: "failed",
        events: [],
      }),
    ).toThrow(/completed parent/);
  });
});
