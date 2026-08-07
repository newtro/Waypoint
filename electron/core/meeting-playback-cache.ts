import { execFile } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

export function meetingPlaybackRemuxArguments(
  sourcePath: string,
  outputPath: string,
): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-i",
    sourcePath,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-c:a",
    "copy",
    "-map_metadata",
    "-1",
    "-f",
    "webm",
    "-y",
    outputPath,
  ];
}

export function meetingPlaybackCachePath(
  cacheRoot: string,
  sourceSha256: string,
): string {
  if (!/^[a-f0-9]{64}$/i.test(sourceSha256))
    throw new Error("Meeting audio digest is invalid");
  return path.join(cacheRoot, `${sourceSha256.toLowerCase()}.webm`);
}

export function removeSeekableMeetingPlayback(
  cacheRoot: string,
  sourceSha256: string,
): void {
  rmSync(meetingPlaybackCachePath(cacheRoot, sourceSha256), { force: true });
}

export async function prepareSeekableMeetingPlayback(input: {
  sourcePath: string;
  sourceSha256: string;
  mediaType: string;
  cacheRoot: string;
  decoderCommand?: string;
  run?: (command: string, args: string[]) => Promise<void>;
}): Promise<{ path: string; mediaType: string; cached: boolean }> {
  if (input.mediaType !== "audio/webm" || !input.decoderCommand)
    return { path: input.sourcePath, mediaType: input.mediaType, cached: false };
  mkdirSync(input.cacheRoot, { recursive: true, mode: 0o700 });
  const target = meetingPlaybackCachePath(input.cacheRoot, input.sourceSha256),
    existing = () => {
      try {
        const metadata = lstatSync(target);
        return metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0;
      } catch {
        return false;
      }
    };
  if (existing()) return { path: target, mediaType: input.mediaType, cached: true };

  const temporary = `${target}.${randomUUID()}.partial`;
  try {
    const run =
      input.run ??
      (async (command: string, args: string[]) => {
        await execFileAsync(command, args, {
          timeout: 10 * 60_000,
          maxBuffer: 128 * 1024,
          windowsHide: true,
        });
      });
    await run(
      input.decoderCommand,
      meetingPlaybackRemuxArguments(input.sourcePath, temporary),
    );
    const metadata = lstatSync(temporary);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1)
      throw new Error("Meeting playback cache is invalid");
    try {
      renameSync(temporary, target);
    } catch (error) {
      if (!existing()) throw error;
    }
    if (statSync(target).size < 1)
      throw new Error("Meeting playback cache is empty");
    return { path: target, mediaType: input.mediaType, cached: true };
  } finally {
    rmSync(temporary, { force: true });
  }
}
