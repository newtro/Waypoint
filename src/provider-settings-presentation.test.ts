import { describe, expect, it } from "vitest";
import {
  formatProviderMicros,
  providerCapabilityPresentation,
} from "./provider-settings-presentation.js";

describe("provider settings presentation", () => {
  it("turns internal capability states into truthful user-facing status", () => {
    expect(providerCapabilityPresentation("ready_unverified", "verified")).toEqual({
      title: "Hosted route ready",
      health: "Last authorized request verified",
      tone: "ready",
    });
    expect(providerCapabilityPresentation("cap_reached", "not_checked")).toEqual({
      title: "Spending cap reached",
      health: "No background health check",
      tone: "warning",
    });
    expect(providerCapabilityPresentation("no_key", "not_configured").tone).toBe(
      "quiet",
    );
  });

  it("formats bounded provider receipt totals", () => {
    expect(formatProviderMicros(0)).toBe("$0.00");
    expect(formatProviderMicros(1_234_567)).toBe("$1.23");
    expect(formatProviderMicros(101, 4)).toBe("$0.0001");
    expect(formatProviderMicros(-1)).toBe("$0.00");
  });
});
