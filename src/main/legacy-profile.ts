/**
 * Carries the profile of an installation made under the previous product name into the current one.
 *
 * The folder name follows the application name, so the rename alone leaves the old profile behind:
 * agents, servers, conversations, preferences and the database would look empty after an upgrade.
 * The folder is copied once, on the first launch that finds no profile of its own, and the old
 * folder is left untouched so a rollback still finds it.
 *
 * The files that the operating-system key store encrypted are copied too, but the key chain item is
 * named after the application, so they do not open under the new name. Each reader treats the
 * undecryptable value as absent: the user signs in again and re-enters the provider keys, while
 * everything that is plain on disk arrives whole.
 */
import { cpSync, existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/** The folder the application used before the rename, directly under the application-data folder. */
const LEGACY_FOLDER = "OpenBot";

/** Files that describe one run, and a lock that would point at the old directory. */
const EPHEMERAL = new Set(["SingletonLock", "SingletonCookie", "SingletonSocket", "logs"]);

type CarryOverReason = "no-legacy-profile" | "profile-exists" | "carried" | "failed";

export interface CarryOverResult {
  carried: boolean;
  reason: CarryOverReason;
  from: string;
  to: string;
}

/** Where the previous name kept its profile, given the application-data folder of this computer. */
export function legacyProfilePath(appDataPath: string): string {
  return join(appDataPath, LEGACY_FOLDER);
}

/**
 * Copies `from` to `to` unless a profile already exists there. Never throws: a failed copy leaves
 * the application starting on an empty profile, which is what it would have done without this.
 */
export function carryOverLegacyProfile(from: string, to: string): CarryOverResult {
  if (existsSync(to)) return { carried: false, reason: "profile-exists", from, to };
  if (!existsSync(from)) return { carried: false, reason: "no-legacy-profile", from, to };
  try {
    cpSync(from, to, { recursive: true, filter: (source) => !EPHEMERAL.has(basename(source)) });
    const marker = { carriedFrom: from, carriedAt: new Date().toISOString() };
    writeFileSync(join(to, "legacy-profile.json"), `${JSON.stringify(marker, null, 2)}\n`);
    return { carried: true, reason: "carried", from, to };
  } catch {
    return { carried: false, reason: "failed", from, to };
  }
}
