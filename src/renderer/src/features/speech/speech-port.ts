import type { BuildersBotDesktopApi } from "@buildersbot/contracts/ipc";

/**
 * What spoken replies reach in main: the speech model and settings, the synthesis, the finished
 * answer, the recording a voice turn keeps with its message, and the user's own voice server.
 */
export interface SpeechPort {
  voice: Pick<
    BuildersBotDesktopApi["voice"],
    | "getSpeechSettings"
    | "getSpeechModelStatus"
    | "downloadSpeechModel"
    | "onSpeechModelStatus"
    | "speak"
    | "warmSpeech"
    | "keepRecording"
    | "getServer"
    | "onServerSettings"
  >;
  agent: Pick<BuildersBotDesktopApi["agent"], "readConversationPage" | "discardDraftAttachment">;
}

/** Read on each call: tests and stories replace `window.buildersbot` per case. */
export function speechPort(): SpeechPort {
  return window.buildersbot;
}
