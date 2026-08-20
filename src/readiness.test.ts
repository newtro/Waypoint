import { describe, expect, it } from "vitest";
import { onboardingReadiness } from "./readiness.js";

describe("guided onboarding readiness", () => {
  it("reports independent CLI readiness and honest local-only sync", () => {
    const items = onboardingReadiness(
      [
        { name: "codex", available: true, version: "1.2.3", compatible: true },
        { name: "claude", available: false },
        { name: "grok", available: true, version: "1.0.3", compatible: true },
      ],
      {
        state: "local_only",
        pending: 0,
        conflicts: 0,
        conflictVariants: 0,
        tombstones: 0,
        localOnlyAttachments: 0,
        enrollmentAvailable: false,
        connectionConfigured: false,
      },
    );
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "codex", status: "ready" }),
        expect.objectContaining({ id: "claude", status: "attention" }),
        expect.objectContaining({ id: "grok", status: "ready" }),
        expect.objectContaining({
          id: "sync",
          status: "optional",
          summary: expect.stringContaining("explicit action"),
        }),
      ]),
    );
  });
  it("never presents pending-key setup as a completed connection", () => {
    const items = onboardingReadiness([], {
      state: "device_pending_keys",
      pending: 2,
      conflicts: 0,
      conflictVariants: 0,
      tombstones: 0,
      localOnlyAttachments: 0,
      enrollmentAvailable: false,
      connectionConfigured: false,
    });
    expect(items.find((item) => item.id === "sync")).toMatchObject({
      status: "optional",
      summary: expect.stringContaining("incomplete"),
    });
  });
});
