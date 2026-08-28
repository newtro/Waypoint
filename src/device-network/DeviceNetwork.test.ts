import { describe, expect, it } from "vitest";
import { isDevicePeerBusy } from "./peer-busy.js";

describe("isDevicePeerBusy", () => {
  it("keeps an idle unpaired peer actionable", () => {
    expect(
      isDevicePeerBusy(undefined, {
        deviceId: "peer-a",
        pairing: undefined,
      }),
    ).toBe(false);
  });

  it("matches either the peer or its active pairing session", () => {
    const peer = {
      deviceId: "peer-a",
      pairing: { sessionId: "session-a" },
    };
    expect(isDevicePeerBusy("peer-a", peer)).toBe(true);
    expect(isDevicePeerBusy("session-a", peer)).toBe(true);
    expect(isDevicePeerBusy("other", peer)).toBe(false);
  });
});
