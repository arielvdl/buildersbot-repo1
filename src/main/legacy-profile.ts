// The profile of an installation made before the rename, carried over once.
//
// Electron names the profile folder after the application, so the rename to `Builders Bot` moved it.
// The workspace state folder changed with it. Without this module an upgrade starts with an empty
// profile: no account, no agents, no chats. Everything here runs once, keeps the old folder in place
// until the new one is written, and is safe to run again. The database file moves on its own in
// `src/backend/database/legacy-database-file.ts`.

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import { migrateLegacyPreferenceFiles } from "../backend/database/legacy-preference-files";

export { migrateLegacyPreferenceFiles };

/** The application name before the rename. The profile folder and the keychain item use it. */
export const LEGACY_APP_NAME = "OpenBot";
const LEGACY_PROFILE_FOLDER = LEGACY_APP_NAME;
const CURRENT_PROFILE_FOLDER = "Builders Bot";

/** The workspace state folder before the rename. */
export const LEGACY_WORKSPACE_STATE = ".openbot";
export const WORKSPACE_STATE = ".buildersbot";

function isEmptyFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

/**
 * Move `~/Library/Application Support/BuildersBot` (and its siblings on Windows and Linux) to the name
 * of this build. A rename is atomic and keeps every inode; when the target already exists the
 * missing entries are copied instead, so a partially created profile does not win over the old one.
 */
export function migrateLegacyProfileFolder(): void {
  const current = app.getPath("userData");
  const legacy = join(dirname(current), LEGACY_PROFILE_FOLDER);
  if (current === legacy || !existsSync(legacy)) return;

  if (!existsSync(current) || isEmptyFolder(current)) {
    mkdirSync(dirname(current), { recursive: true });
    try {
      renameSync(legacy, current);
      return;
    } catch {
      cpSync(legacy, current, { recursive: true, force: false, errorOnExist: false });
      return;
    }
  }

  // Both exist: copy only what the new profile is missing.
  cpSync(legacy, current, { recursive: true, force: false, errorOnExist: false });
  migrateLegacyPreferenceFiles(current);
}

/** Whether a folder still carries the state folder of an installation made before the rename. */
export function hasLegacyWorkspaceState(workspace: string): boolean {
  return existsSync(join(workspace, LEGACY_WORKSPACE_STATE));
}

/** The workspace state folder, moved from the old name on first use. */
export function workspaceStatePath(workspace: string): string {
  const legacy = join(workspace, LEGACY_WORKSPACE_STATE);
  const current = join(workspace, WORKSPACE_STATE);
  if (existsSync(legacy) && !existsSync(current)) {
    try {
      renameSync(legacy, current);
    } catch {
      cpSync(legacy, current, { recursive: true, force: false, errorOnExist: false });
    }
  }
  return current;
}

/** A path inside the workspace state folder, after the one-time move. */
export function workspaceStateFile(workspace: string, ...parts: string[]): string {
  return join(workspaceStatePath(workspace), ...parts);
}

/** The current profile folder, for a log line or a diagnostic. */
export function profileFolder(): string {
  return app.getPath("userData");
}

export { CURRENT_PROFILE_FOLDER };
