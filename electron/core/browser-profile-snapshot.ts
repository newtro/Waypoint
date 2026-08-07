import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

const EXCLUDED = /(?:^|\/)(?:Cache|Code Cache|GPUCache|Crashpad|DawnCache|ShaderCache)(?:\/|$)/;

export function snapshotBrowserProfile(input: {
  source: string;
  target: string;
  browserId: string;
  profileId: string;
  localStatePath?: string;
  maxBytes?: number;
  maxFiles?: number;
  now?: () => Date;
}) {
  const maxBytes = input.maxBytes ?? 4 * 1024 * 1024 * 1024,
    maxFiles = input.maxFiles ?? 200_000,
    root = path.dirname(input.target),
    staging = path.join(root, `.${path.basename(input.target)}-${randomUUID()}.partial`),
    previous = `${input.target}.previous`,
    hash = createHash("sha256");
  let bytes = 0,
    files = 0;
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name),
        relative = path.relative(input.source, candidate);
      if (EXCLUDED.test(relative)) continue;
      if (entry.isSymbolicLink())
        throw new Error("Browser profile contains an unsupported symbolic link");
      if (entry.isDirectory()) scan(candidate);
      else if (entry.isFile()) {
        const details = lstatSync(candidate);
        bytes += details.size;
        files++;
        hash.update(`${relative}\0${details.size}\0${details.mtimeMs}\n`);
        if (bytes > maxBytes || files > maxFiles)
          throw new Error("Browser profile snapshot exceeds its bounded size or file limit");
      } else throw new Error("Browser profile contains an unsupported filesystem entry");
    }
  };
  scan(input.source);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    cpSync(input.source, path.join(staging, "Default"), {
      recursive: true,
      errorOnExist: true,
      filter: (candidate) => !EXCLUDED.test(path.relative(input.source, candidate)),
    });
    if (input.localStatePath && existsSync(input.localStatePath))
      cpSync(input.localStatePath, path.join(staging, "Local State"), {
        errorOnExist: true,
      });
    const sourceManifestSha256 = hash.digest("hex");
    writeFileSync(
      path.join(staging, ".waypoint-profile.json"),
      JSON.stringify({
        version: 1,
        browserId: input.browserId,
        profileId: input.profileId,
        bytes,
        files,
        importedAt: (input.now?.() ?? new Date()).toISOString(),
        sourceManifestSha256,
      }),
      { mode: 0o600 },
    );
    rmSync(previous, { recursive: true, force: true });
    if (existsSync(input.target)) renameSync(input.target, previous);
    try {
      renameSync(staging, input.target);
      rmSync(previous, { recursive: true, force: true });
    } catch (error) {
      if (existsSync(previous)) renameSync(previous, input.target);
      throw error;
    }
    return { bytes, files, sourceManifestSha256 };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
