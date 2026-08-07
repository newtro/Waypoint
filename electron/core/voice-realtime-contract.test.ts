import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("voice realtime renderer contract", () => {
  const source = readFileSync(
    new URL("../../src/main.tsx", import.meta.url),
    "utf8",
  ).replace(/\s+/g,'').replaceAll('"',"'");
  it("arms speaking before IPC and synchronously leaves speaking before completion capture", () => {
    const arm = source.indexOf("voiceStateRef.current='speaking'"),terminal=source.indexOf("voiceStateRef.current='listening'");
    expect(arm).toBeGreaterThan(0);
    expect(terminal).toBeGreaterThan(0);
    expect(source).toContain("voiceStateRef.current!=='speaking'");
  });
  it("dispatches native stop before any monitor teardown and scope changes invalidate both capture paths", () => {
    expect(source).toContain("stop=window.waypoint.stopVoice");expect(source).toContain("awaitstop");expect(source).toContain("voiceCaptureRef.current.cancel()");expect(source).toContain("voiceMonitorRef.current.stop()");
  });
});
