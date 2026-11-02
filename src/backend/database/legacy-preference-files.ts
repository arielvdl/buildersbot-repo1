// The preference and state files of an installation made before the rename.
//
// They live in the profile folder, so the profile move brings them over under the old names. The app
// then reads the new names. A file that exists under both names keeps the new one.

import { copyFileSync, existsSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

export const LEGACY_FILE_PREFIX = "openbot-";
export const FILE_PREFIX = "buildersbot-";

export function migrateLegacyPreferenceFiles(userDataPath: string): void {
  let names: string[];
  try {
    names = readdirSync(userDataPath);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(LEGACY_FILE_PREFIX)) continue;
    const target = `${FILE_PREFIX}${name.slice(LEGACY_FILE_PREFIX.length)}`;
    if (existsSync(join(userDataPath, target))) continue;
    try {
      renameSync(join(userDataPath, name), join(userDataPath, target));
    } catch {
      // A profile inherited from another user can refuse the rename. The copy is best effort: a
      // file that cannot be read must not stop the app from starting.
      try {
        copyFileSync(join(userDataPath, name), join(userDataPath, target));
      } catch {}
    }
  }
}
