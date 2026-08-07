import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { meetingSegmentArguments, transcribeMeetingFile } from "./meeting-transcription-runner.js";

describe("meeting transcription runner", () => {
  it("uses bounded fixed decoder arguments", () => {
    const args = meetingSegmentArguments("meeting.webm", "%05d.wav");
    expect(args).toContain("-nostdin");
    expect(args).toContain("16000");
    expect(args).toContain("120");
    expect(args.at(-1)).toBe("%05d.wav");
  });

  it("transcribes ordered temporary segments and removes them", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "waypoint-meeting-runner-")),
      progress = vi.fn(),
      transcribe = vi.fn(async (bytes: Uint8Array) => ({ text: `part-${bytes[44]}` }));
    const result = await transcribeMeetingFile({
      audioPath: path.join(root, "meeting.webm"),
      decoderCommand: "ffmpeg",
      temporaryRoot: root,
      signal: new AbortController().signal,
      onProgress: progress,
      transcribe,
      decode: async (_command, _input, pattern) => {
        const first = Buffer.alloc(48);
        first[44] = 1;
        const second = Buffer.alloc(48);
        second[44] = 2;
        writeFileSync(pattern.replace("%05d", "00001"), second);
        writeFileSync(pattern.replace("%05d", "00000"), first);
      },
    });
    expect(result).toEqual({ parts: ["part-1", "part-2"], segments: 2 });
    expect(progress).toHaveBeenLastCalledWith({
      phase: "transcribing",
      completed: 2,
      total: 2,
    });
  });
});
