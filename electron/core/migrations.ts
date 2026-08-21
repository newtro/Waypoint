import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

export const CURRENT_SCHEMA_VERSION = 48;
export type Migration = {
  version: number;
  apply(database: DatabaseSync): void;
};

export function schemaVersion(database: DatabaseSync): number {
  const table = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_versions'",
    )
    .get();
  if (!table) return 0;
  return Number(
    (
      database
        .prepare("SELECT COALESCE(MAX(version),0) version FROM schema_versions")
        .get() as { version: number }
    ).version,
  );
}

export function assertSupportedSchema(database: DatabaseSync): number {
  const version = schemaVersion(database);
  if (version > CURRENT_SCHEMA_VERSION)
    throw new Error(
      `Waypoint data uses newer schema ${version}; this app supports through ${CURRENT_SCHEMA_VERSION}. No downgrade was attempted.`,
    );
  return version;
}

export function createMigrationSnapshot(
  database: DatabaseSync,
  databasePath: string,
  fromVersion: number,
): string | undefined {
  if (
    !fromVersion ||
    fromVersion >= CURRENT_SCHEMA_VERSION ||
    !existsSync(databasePath)
  )
    return undefined;
  const directory = path.join(
    path.dirname(databasePath),
    "migration-snapshots",
  );
  mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-"),
    snapshot = path.join(
      directory,
      `waypoint-v${fromVersion}-to-v${CURRENT_SCHEMA_VERSION}-${stamp}.sqlite`,
    );
  database.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`);
  writeFileSync(
    `${snapshot}.json`,
    JSON.stringify(
      {
        fromVersion,
        toVersion: CURRENT_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        source: path.basename(databasePath),
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  const snapshots = readdirSync(directory)
    .filter((name) => name.endsWith(".sqlite"))
    .sort();
  for (const old of snapshots.slice(0, -2)) {
    rmSync(path.join(directory, old), { force: true });
    rmSync(path.join(directory, `${old}.json`), { force: true });
  }
  return snapshot;
}

export function runMigrations(
  database: DatabaseSync,
  current: number,
  migrations: Migration[],
): void {
  for (const migration of migrations.sort(
    (left, right) => left.version - right.version,
  )) {
    if (migration.version <= current) continue;
    if (migration.version !== current + 1)
      throw new Error(
        `Missing migration from schema ${current} to ${migration.version}`,
      );
    database.exec("BEGIN IMMEDIATE");
    try {
      migration.apply(database);
      database
        .prepare("INSERT INTO schema_versions(version,applied_at) VALUES (?,?)")
        .run(migration.version, new Date().toISOString());
      database.exec("COMMIT");
      current = migration.version;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
