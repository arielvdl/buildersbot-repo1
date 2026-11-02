import type { BuildersBotDesktopApi } from "@buildersbot/contracts/ipc";

/** What the Voice tab reaches in main: the dictation models and the dictation settings. */
export interface VoicePort {
  voice: BuildersBotDesktopApi["voice"];
}

/** Read on each call: tests and stories replace `window.buildersbot` per case. */
export function voicePort(): VoicePort {
  return window.buildersbot;
}
