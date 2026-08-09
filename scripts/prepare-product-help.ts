import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertProductHelpFreshness,
  compileProductHelpSource,
  loadProductHelp,
} from "../electron/core/product-help.js";

function gitLines(root: string, args: string[]): string[] {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function changedPaths(root: string): string[] {
  if (!existsSync(path.join(root, ".git"))) return [];
  const working = [
    ...gitLines(root, ["diff", "--name-only", "HEAD"]),
    ...gitLines(root, ["ls-files", "--others", "--exclude-standard"]),
  ];
  return [
    ...new Set(
      working.length
        ? working
        : gitLines(root, [
            "diff-tree",
            "--no-commit-id",
            "--name-only",
            "-r",
            "HEAD",
          ]),
    ),
  ];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  source = path.join(root, "product-help"),
  target = path.join(root, "vendor", "product-help"),
  compiled = compileProductHelpSource(source),
  verifyOnly = process.argv.includes("--verify");

assertProductHelpFreshness(
  changedPaths(root),
  compiled.manifest.documents.map((document) =>
    path.posix.join("product-help", document.file),
  ),
);

if (verifyOnly) {
  const loaded = loadProductHelp(target);
  if (
    JSON.stringify({
      ...loaded,
      documents: loaded.documents.map((document) => ({
        id: document.id,
        title: document.title,
        summary: document.summary,
        keywords: document.keywords,
        file: document.file,
        bytes: document.bytes,
        sha256: document.sha256,
      })),
    }) !== JSON.stringify(compiled.manifest)
  )
    throw new Error("Prepared Waypoint Help manifest is stale");
  for (const file of compiled.files)
    if (readFileSync(path.join(target, file.file), "utf8") !== file.content)
      throw new Error(`Prepared Waypoint Help page is stale: ${file.file}`);
} else {
  const temporary = `${target}.partial-${process.pid}`;
  rmSync(temporary, { recursive: true, force: true });
  mkdirSync(temporary, { recursive: true, mode: 0o755 });
  for (const file of compiled.files)
    writeFileSync(path.join(temporary, file.file), file.content, { mode: 0o644 });
  writeFileSync(
    path.join(temporary, "manifest.json"),
    `${JSON.stringify(compiled.manifest, null, 2)}\n`,
    { mode: 0o644 },
  );
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  renameSync(temporary, target);
}

loadProductHelp(target);
process.stdout.write(
  `${verifyOnly ? "Verified" : "Prepared"} Waypoint Help ${compiled.manifest.helpVersion} with ${compiled.manifest.documents.length} pages\n`,
);
