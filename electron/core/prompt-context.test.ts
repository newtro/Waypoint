import { describe, expect, it } from "vitest";
import {
  currentDateTimeContext,
  withCurrentDateTime,
} from "./prompt-context.js";

describe("prompt date-time context", () => {
  it("stamps the current local date, time, and timezone", () => {
    const context = currentDateTimeContext(new Date("2026-08-07T15:30:00"));
    expect(context).toContain("[Context] Current local date and time:");
    expect(context).toContain("August 7, 2026");
    expect(context).toContain(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    );
  });
  it("prepends the context ahead of the user prompt", () => {
    const composed = withCurrentDateTime(
      "What day is it?",
      new Date("2026-08-07T15:30:00"),
    );
    expect(composed.endsWith("\n\nWhat day is it?")).toBe(true);
    expect(composed.startsWith("[Context] Current local date and time:")).toBe(
      true,
    );
  });
});
