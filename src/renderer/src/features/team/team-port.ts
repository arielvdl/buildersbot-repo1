import type { BuildersBotDesktopApi } from "@buildersbot/contracts/ipc";

/**
 * What team presence reaches in main: who is online, and whether this member is typing.
 */
export interface TeamPort {
  servers: Pick<BuildersBotDesktopApi["servers"], "onPresence" | "setTyping">;
}

/** Read on each call: tests and stories replace `window.buildersbot` per case. */
export function teamPort(): TeamPort {
  return window.buildersbot;
}
