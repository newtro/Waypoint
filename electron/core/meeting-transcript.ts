const MAX_MEETING_MS = 2 * 60 * 60 * 1_000;
const MAX_TURNS = 20_000;
const MAX_TURN_TEXT = 20_000;
const MAX_TRANSCRIPT_TEXT = 500_000;

export type MeetingSpeakerTurn = {
  speakerId: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type MeetingTranscriptDocument = {
  schemaVersion: 1;
  engine: string;
  generatedAt: string;
  turns: MeetingSpeakerTurn[];
  speakerNames: Record<string, string>;
};

function canonicalSpeakerId(value: unknown): string {
  if (typeof value !== "string" || !/^speaker-[1-9]\d{0,2}$/.test(value))
    throw new Error("meeting_transcript_speaker_invalid");
  return value;
}

function boundedMillisecond(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > MAX_MEETING_MS)
    throw new Error("meeting_transcript_timestamp_invalid");
  return Number(value);
}

function spokenText(value: unknown): string {
  if (typeof value !== "string") throw new Error("meeting_transcript_text_invalid");
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_TURN_TEXT)
    throw new Error("meeting_transcript_text_invalid");
  return text;
}

export function validateMeetingSpeakerTurns(value: unknown): MeetingSpeakerTurn[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_TURNS)
    throw new Error("meeting_transcript_turns_invalid");
  const turns: MeetingSpeakerTurn[] = [];
  let previousStart = -1;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error("meeting_transcript_turn_invalid");
    const raw = candidate as Record<string, unknown>,
      startMs = boundedMillisecond(raw.startMs),
      endMs = boundedMillisecond(raw.endMs);
    if (endMs <= startMs || startMs < previousStart)
      throw new Error("meeting_transcript_timeline_invalid");
    previousStart = startMs;
    turns.push({
      speakerId: canonicalSpeakerId(raw.speakerId),
      startMs,
      endMs,
      text: spokenText(raw.text),
    });
  }
  if (turns.reduce((total, turn) => total + turn.text.length, 0) > MAX_TRANSCRIPT_TEXT)
    throw new Error("meeting_transcript_size_invalid");
  return turns;
}

export function mergeMeetingSpeakerTurns(
  value: unknown,
  maximumGapMs = 1_500,
): MeetingSpeakerTurn[] {
  if (!Number.isInteger(maximumGapMs) || maximumGapMs < 0 || maximumGapMs > 10_000)
    throw new Error("meeting_transcript_gap_invalid");
  const turns = validateMeetingSpeakerTurns(value),
    merged: MeetingSpeakerTurn[] = [];
  for (const turn of turns) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.speakerId === turn.speakerId &&
      turn.startMs >= previous.endMs &&
      turn.startMs - previous.endMs <= maximumGapMs &&
      previous.text.length + turn.text.length + 1 <= MAX_TURN_TEXT
    ) {
      previous.endMs = turn.endMs;
      previous.text = `${previous.text} ${turn.text}`;
    } else merged.push({ ...turn });
  }
  return merged;
}

export function validateMeetingSpeakerNames(
  value: unknown,
  turns: MeetingSpeakerTurn[],
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("meeting_speaker_names_invalid");
  const speakers = new Set(turns.map((turn) => turn.speakerId)),
    result: Record<string, string> = {};
  for (const [id, candidate] of Object.entries(value as Record<string, unknown>)) {
    canonicalSpeakerId(id);
    if (!speakers.has(id)) throw new Error("meeting_speaker_name_orphaned");
    if (typeof candidate !== "string" || /[\r\n[\]]/.test(candidate))
      throw new Error("meeting_speaker_name_invalid");
    const name = candidate.replace(/\s+/g, " ").trim();
    if (!name || name.length > 80)
      throw new Error("meeting_speaker_name_invalid");
    result[id] = name;
  }
  return result;
}

export function defaultMeetingSpeakerName(speakerId: string): string {
  const id = canonicalSpeakerId(speakerId);
  return `Speaker ${id.slice("speaker-".length)}`;
}

export function meetingTimestamp(milliseconds: number): string {
  const totalSeconds = Math.floor(boundedMillisecond(milliseconds) / 1_000),
    hours = Math.floor(totalSeconds / 3_600),
    minutes = Math.floor((totalSeconds % 3_600) / 60),
    seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatMeetingTranscript(
  turnsValue: unknown,
  speakerNamesValue: unknown = {},
): string {
  const turns = mergeMeetingSpeakerTurns(turnsValue),
    names = validateMeetingSpeakerNames(speakerNamesValue, turns),
    text = turns
      .map(
        (turn) =>
          `[${meetingTimestamp(turn.startMs)}] ${names[turn.speakerId] ?? defaultMeetingSpeakerName(turn.speakerId)}\n${turn.text}`,
      )
      .join("\n\n");
  if (text.length > MAX_TRANSCRIPT_TEXT) throw new Error("meeting_transcript_size_invalid");
  return text;
}

export function createMeetingTranscriptDocument(input: {
  engine: string;
  generatedAt?: string;
  turns: unknown;
  speakerNames?: unknown;
}): MeetingTranscriptDocument {
  const engine = input.engine.trim();
  if (!/^[a-z0-9][a-z0-9_.-]{1,79}$/i.test(engine))
    throw new Error("meeting_transcript_engine_invalid");
  const turns = mergeMeetingSpeakerTurns(input.turns),
    generatedAt = input.generatedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt)))
    throw new Error("meeting_transcript_generated_at_invalid");
  return {
    schemaVersion: 1,
    engine,
    generatedAt,
    turns,
    speakerNames: validateMeetingSpeakerNames(input.speakerNames ?? {}, turns),
  };
}

export function parseMeetingTranscriptDocument(value: string): MeetingTranscriptDocument {
  if (typeof value !== "string" || value.length > 2_000_000)
    throw new Error("meeting_transcript_document_invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("meeting_transcript_document_invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("meeting_transcript_document_invalid");
  const candidate = parsed as Record<string, unknown>;
  if (candidate.schemaVersion !== 1)
    throw new Error("meeting_transcript_schema_unsupported");
  return createMeetingTranscriptDocument({
    engine: String(candidate.engine ?? ""),
    generatedAt: String(candidate.generatedAt ?? ""),
    turns: candidate.turns,
    speakerNames: candidate.speakerNames,
  });
}
