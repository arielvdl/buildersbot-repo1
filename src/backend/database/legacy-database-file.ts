// The database file of an installation made before the rename.
//
// Electron kept the profile under the old application name, so the database there is named
// `buildersbot.db`. The first open of a profile that has only the old file renames it, with the
// write-ahead log and the shared-memory file, instead of starting an empty database beside it.

import { copyFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";

export const LEGACY_DATABASE_FILE = "buildersbot.db";
export const DATABASE_FILE = "buildersbot.db";

export function migrateLegacyDatabase(userDataPath: string): void {
  const legacy = join(userDataPath, LEGACY_DATABASE_FILE);
  const current = join(userDataPath, DATABASE_FILE);
  if (!existsSync(legacy) || existsSync(current)) return;

  for (const suffix of ["", "-wal", "-shm"]) {
    const from = `${legacy}${suffix}`;
    if (!existsSync(from)) continue;
    try {
      renameSync(from, `${current}${suffix}`);
    } catch {
      copyFileSync(from, `${current}${suffix}`);
    }
  }
}
