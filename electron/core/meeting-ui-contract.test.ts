import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("packaged meeting consent and capture contract", () => {
  const ui = readFileSync(
      new URL("../../src/main.tsx", import.meta.url),
      "utf8",
    ).replace(/\s+/g,''),
    main = readFileSync(new URL("../main.ts", import.meta.url), "utf8").replace(/\s+/g,'').replaceAll('"',"'"),
    builder = readFileSync(
      new URL("../../electron-builder.yml", import.meta.url),
      "utf8",
    );
  it("keeps recording and stop globally visible and resets consent", () => {
    expect(ui).toMatch(/recording-global[\s\S]*Stop/);
    expect(ui).toMatch(/setMeetingConsent\(false\)/);
    expect(ui).toContain("recorder.onerror=()=>voidstopMeeting(\"capture_failed\")");
  });
  it("binds finalization to the origin workspace and prevents switching during capture", () => {
    expect(ui).toMatch(/meetingWorkspaceIdRef\.current=workspace\.id/);
    expect(ui).toMatch(/finalizeMeeting\(originWorkspaceId,meetingId/);
    expect(ui).toContain("value={workspace.id}");
    expect(ui).toContain("disabled={Boolean(recordingMeetingId)}");
  });
  it("declares microphone purpose and permits only trusted audio requests", () => {
    expect(builder).toContain("NSMicrophoneUsageDescription");
    expect(main).toMatch(
      /permission==='media'.*mediaTypes\.length===1.*mediaTypes\[0\]==='audio'/,
    );
  });
});
