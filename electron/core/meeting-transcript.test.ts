import { describe, expect, it } from "vitest";
import {
  createMeetingTranscriptDocument,
  formatMeetingTranscript,
  mergeMeetingSpeakerTurns,
  parseMeetingTranscriptDocument,
  validateMeetingSpeakerNames,
  validateMeetingSpeakerTurns,
} from "./meeting-transcript.js";

const turns = [
  { speakerId: "speaker-1", startMs: 1_250, endMs: 2_500, text: " Hello   there. " },
  { speakerId: "speaker-1", startMs: 3_000, endMs: 4_000, text: "How are you?" },
  { speakerId: "speaker-2", startMs: 4_100, endMs: 5_000, text: "Good." },
];

describe("meeting transcript contract", () => {
  it("validates, normalizes, merges, and formats anonymous speaker turns", () => {
    expect(validateMeetingSpeakerTurns(turns)[0].text).toBe("Hello there.");
    expect(mergeMeetingSpeakerTurns(turns)).toEqual([
      { speakerId: "speaker-1", startMs: 1_250, endMs: 4_000, text: "Hello there. How are you?" },
      { speakerId: "speaker-2", startMs: 4_100, endMs: 5_000, text: "Good." },
    ]);
    expect(formatMeetingTranscript(turns)).toBe(
      "[00:00:01] Speaker 1\nHello there. How are you?\n\n[00:00:04] Speaker 2\nGood.",
    );
  });

  it("applies user labels without changing timing or spoken text", () => {
    const document = createMeetingTranscriptDocument({
      engine: "sherpa-enhanced-local",
      generatedAt: "2026-08-07T12:00:00.000Z",
      turns,
      speakerNames: { "speaker-1": "Scott" },
    });
    expect(formatMeetingTranscript(document.turns, document.speakerNames)).toContain(
      "[00:00:01] Scott\nHello there. How are you?",
    );
    expect(document.turns[0]).toMatchObject({ startMs: 1_250, text: "Hello there. How are you?" });
    expect(parseMeetingTranscriptDocument(JSON.stringify(document))).toEqual(document);
  });

  it("rejects malformed timelines, identities, and orphaned labels", () => {
    expect(() =>
      validateMeetingSpeakerTurns([
        { speakerId: "Scott", startMs: 0, endMs: 1_000, text: "No" },
      ]),
    ).toThrow("meeting_transcript_speaker_invalid");
    expect(() =>
      validateMeetingSpeakerTurns([
        { speakerId: "speaker-1", startMs: 2_000, endMs: 1_000, text: "No" },
      ]),
    ).toThrow("meeting_transcript_timeline_invalid");
    expect(() =>
      validateMeetingSpeakerTurns([
        { speakerId: "speaker-1", startMs: 2_000, endMs: 3_000, text: "Later" },
        { speakerId: "speaker-2", startMs: 1_000, endMs: 2_500, text: "Earlier" },
      ]),
    ).toThrow("meeting_transcript_timeline_invalid");
    expect(() => validateMeetingSpeakerNames({ "speaker-3": "Orphan" }, turns)).toThrow(
      "meeting_speaker_name_orphaned",
    );
    expect(() => validateMeetingSpeakerNames({ "speaker-1": "Bad\nName" }, turns)).toThrow(
      "meeting_speaker_name_invalid",
    );
  });
});
