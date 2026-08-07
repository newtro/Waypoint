import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_SEGMENTS = 60;
const MAX_SEGMENT_BYTES = 8 * 1024 * 1024;

export type MeetingTranscriptionProgress = {
  phase: "preparing" | "transcribing";
  completed: number;
  total?: number;
};

export type MeetingMediaDecoderCapability = {
  available: boolean;
  command?: string;
  reason: string;
};

function decoderCandidates(platform = process.platform): string[] {
  const candidates = ["ffmpeg"];
  if (platform === "darwin") candidates.push("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg");
  if (platform === "linux") candidates.push("/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg");
  return [...new Set(candidates)];
}

export async function probeMeetingMediaDecoder(
  candidates = decoderCandidates(),
): Promise<MeetingMediaDecoderCapability> {
  for (const command of candidates) {
    try {
      const result = await execFileAsync(command, ["-version"], {
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 128 * 1024,
        windowsHide: true,
      });
      if (/^ffmpeg version\s/im.test(String(result.stdout))) {
        return {
          available: true,
          command,
          reason: "Local FFmpeg media decoding is ready.",
        };
      }
    } catch {
      // Continue through fixed, platform-appropriate discovery candidates.
    }
  }
  return {
    available: false,
    reason:
      "Local transcription needs an installed FFmpeg executable to decode meeting recordings. No cloud fallback will be used.",
  };
}

export function meetingSegmentArguments(inputPath: string, outputPattern: string): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    "-f",
    "segment",
    "-segment_time",
    "120",
    "-reset_timestamps",
    "1",
    "-segment_format",
    "wav",
    "-y",
    outputPattern,
  ];
}

type Decoder = (
  command: string,
  inputPath: string,
  outputPattern: string,
  signal: AbortSignal,
) => Promise<void>;

export function decodeMeetingSegments(
  command: string,
  inputPath: string,
  outputPattern: string,
  signal: AbortSignal,
  spawnProcess: typeof spawn = spawn,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("meeting_transcription_canceled"));
      return;
    }
    const child = spawnProcess(command, meetingSegmentArguments(inputPath, outputPattern), {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      }),
      errors: Buffer[] = [];
    let settled = false,
      errorBytes = 0;
    const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", cancel);
        if (error) reject(error);
        else resolve();
      },
      cancel = () => {
        if (!child.killed) child.kill("SIGTERM");
        finish(new Error("meeting_transcription_canceled"));
      };
    signal.addEventListener("abort", cancel, { once: true });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorBytes >= 64 * 1024) return;
      const bounded = chunk.subarray(0, 64 * 1024 - errorBytes);
      errors.push(bounded);
      errorBytes += bounded.length;
    });
    child.once("error", () => finish(new Error("meeting_media_decoder_failed")));
    child.once("exit", (code) => {
      if (signal.aborted) return finish(new Error("meeting_transcription_canceled"));
      if (code === 0) return finish();
      const detail = Buffer.concat(errors).toString("utf8").trim().slice(0, 500);
      finish(new Error(detail ? `meeting_audio_decode_failed: ${detail}` : "meeting_audio_decode_failed"));
    });
  });
}

export async function transcribeMeetingFile(input: {
  audioPath: string;
  decoderCommand: string;
  temporaryRoot: string;
  signal: AbortSignal;
  transcribe: (audio: Uint8Array, signal: AbortSignal) => Promise<{ text: string }>;
  onProgress?: (progress: MeetingTranscriptionProgress) => void;
  decode?: Decoder;
}): Promise<{ parts: string[]; segments: number }> {
  mkdirSync(input.temporaryRoot, { recursive: true, mode: 0o700 });
  const temporaryDirectory = mkdtempSync(path.join(input.temporaryRoot, "meeting-transcription-")),
    outputPattern = path.join(temporaryDirectory, "%05d.wav"),
    decode = input.decode ?? decodeMeetingSegments;
  try {
    input.onProgress?.({ phase: "preparing", completed: 0 });
    await decode(
      input.decoderCommand,
      input.audioPath,
      outputPattern,
      input.signal,
    );
    if (input.signal.aborted) throw new Error("meeting_transcription_canceled");
    const segments = readdirSync(temporaryDirectory)
      .filter((file) => /^\d{5}\.wav$/.test(file))
      .sort();
    if (!segments.length || segments.length > MAX_SEGMENTS)
      throw new Error("meeting_audio_duration_invalid");
    input.onProgress?.({ phase: "transcribing", completed: 0, total: segments.length });
    const parts: string[] = [];
    for (let index = 0; index < segments.length; index++) {
      if (input.signal.aborted) throw new Error("meeting_transcription_canceled");
      const segmentPath = path.join(temporaryDirectory, segments[index]);
      if (statSync(segmentPath).size > MAX_SEGMENT_BYTES)
        throw new Error("meeting_audio_segment_invalid");
      const bytes = readFileSync(segmentPath);
      try {
        const result = await input.transcribe(bytes, input.signal),
          text = result.text.trim();
        if (!text) throw new Error("meeting_transcript_invalid");
        parts.push(text);
      } finally {
        bytes.fill(0);
        rmSync(segmentPath, { force: true });
      }
      input.onProgress?.({
        phase: "transcribing",
        completed: index + 1,
        total: segments.length,
      });
    }
    return { parts, segments: segments.length };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
