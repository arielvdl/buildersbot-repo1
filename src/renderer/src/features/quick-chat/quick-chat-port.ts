import type { BuildersBotDesktopApi } from "@buildersbot/contracts/ipc";

/** What the Quick chat page reaches in main: the call that opens the Quick chat agent. */
export interface QuickChatPort {
  ensure: BuildersBotDesktopApi["quickChat"]["ensure"];
  updateAgent: BuildersBotDesktopApi["agent"]["updateAgent"];
}

/** Read on each call: tests and stories replace `window.buildersbot` per case. */
export function quickChatPort(): QuickChatPort {
  const { quickChat, agent } = window.buildersbot;
  return { ensure: () => quickChat.ensure(), updateAgent: (input) => agent.updateAgent(input) };
}
