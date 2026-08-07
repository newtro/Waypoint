import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  meetingPlaybackRemuxArguments,
  removeSeekableMeetingPlayback,
  prepareSeekableMeetingPlayback,
} from "./meeting-playback-cache.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("meeting playback cache", () => {
  it("creates a seekable derivative without changing the original", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "waypoint-playback-"));
    roots.push(root);
    const source = path.join(root, "meeting.webm"),
      cacheRoot = path.join(root, "cache"),
      original = Buffer.from("original meeting bytes");
    writeFileSync(source, original);
    const run = vi.fn(async (_command: string, args: string[]) => {
      const output = args.at(-1)!;
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, Buffer.from("seekable derivative"));
    });
    const result = await prepareSeekableMeetingPlayback({
      sourcePath: source,
      sourceSha256: "a".repeat(64),
      mediaType: "audio/webm",
      cacheRoot,
      decoderCommand: "ffmpeg",
      run,
    });
    expect(readFileSync(source)).toEqual(original);
    expect(readFileSync(result.path).toString()).toBe("seekable derivative");
    expect(run).toHaveBeenCalledOnce();
    await prepareSeekableMeetingPlayback({
      sourcePath: source,
      sourceSha256: "a".repeat(64),
      mediaType: "audio/webm",
      cacheRoot,
      decoderCommand: "ffmpeg",
      run,
    });
    expect(run).toHaveBeenCalledOnce();
    removeSeekableMeetingPlayback(cacheRoot, "a".repeat(64));
    expect(() => readFileSync(result.path)).toThrow();
  });

  it("falls back to the original when no decoder is available", async () => {
    await expect(
      prepareSeekableMeetingPlayback({
        sourcePath: "meeting.webm",
        sourceSha256: "b".repeat(64),
        mediaType: "audio/webm",
        cacheRoot: "unused",
      }),
    ).resolves.toEqual({
      path: "meeting.webm",
      mediaType: "audio/webm",
      cached: false,
    });
    expect(meetingPlaybackRemuxArguments("a", "b")).toContain("copy");
  });
});
