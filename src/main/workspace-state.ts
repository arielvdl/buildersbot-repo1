import { join } from "node:path";

/** The workspace state folder, inside the workspace's folder. */
export const WORKSPACE_STATE = ".buildersbot";

/** The state folder of a workspace. Its users create it on first write. */
export function workspaceStatePath(workspace: string): string {
  return join(workspace, WORKSPACE_STATE);
}
