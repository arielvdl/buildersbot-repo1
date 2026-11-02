// The first start of one installation of Builders Bot.
//
// The account session and the Cultura Builder provider sign-in live in the app data folder. A copy of
// that folder -- a computer prepared before it is handed over, a restored backup, a test profile --
// therefore arrives signed in, and the person never sees the Cultura Builder sign-in. The marker of
// this module lives beside the folder, keyed by its path, so it is not part of the copy: a start with
// no marker is a new installation, and the sign-in of the previous one is removed before it loads.
//
// A folder outside the app data root, such as the temporary one of a `--user-data-dir` run, keeps its
// marker inside itself: nothing else names it, and a run with a new temporary folder is new anyway.

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const MARKER_VERSION = 1;
const MARKER_PREFIX = ".buildersbot-installation-";

export interface InstallationOptions {
  /** The root that the app data folder is in, from `app.getPath("appData")`. */
  appDataPath: string;
  /** The app data folder itself, from `app.getPath("userData")`. */
  userDataPath: string;
  /**
   * Files that belong to the previous installation and must not survive a new one. They are removed
   * before the services that read them are built.
   */
  previousInstallationFiles: readonly string[];
  now?: () => number;
  newId?: () => string;
}

export interface InstallationStart {
  /** True for the first start of this installation, after the previous sign-in was removed. */
  fresh: boolean;
  /** Set when the marker could not be written. The start then keeps the previous behaviour. */
  error?: unknown;
}

/** Whether `userDataPath` is inside `appDataPath`, so the marker can sit beside it. */
function isInside(appDataPath: string, userDataPath: string): boolean {
  const path = relative(resolve(appDataPath), resolve(userDataPath));
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

/**
 * Where the marker of this installation is. The name carries a hash of the folder path, so several
 * profiles on one computer, such as a development one and the release one, each have their own.
 */
export function installationMarkerPath(appDataPath: string, userDataPath: string): string {
  if (!isInside(appDataPath, userDataPath)) return join(resolve(userDataPath), `${MARKER_PREFIX}started.json`);
  const key = createHash("sha256").update(resolve(userDataPath)).digest("hex").slice(0, 16);
  return join(resolve(appDataPath), `${MARKER_PREFIX}${key}.json`);
}

/**
 * Marks this installation as started and reports whether it is new. The marker is written with `wx`,
 * so a second start of the same installation finds it and keeps everything.
 *
 * A marker that cannot be written is reported and not fatal: the start then behaves as it did before
 * this module existed, and the person stays signed in.
 */
export function beginInstallation(options: InstallationOptions): InstallationStart {
  const marker = installationMarkerPath(options.appDataPath, options.userDataPath);
  try {
    mkdirSync(resolve(options.appDataPath), { recursive: true });
    writeFileSync(
      marker,
      JSON.stringify({
        version: MARKER_VERSION,
        id: (options.newId ?? randomUUID)(),
        startedAt: (options.now ?? Date.now)(),
      }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (isExistingFileError(error)) return { fresh: false };
    return { fresh: false, error };
  }
  for (const file of options.previousInstallationFiles) rmSync(file, { force: true });
  return { fresh: true };
}

function isExistingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
