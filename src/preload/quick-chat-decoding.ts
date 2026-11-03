// The answer of `quickChat.ensure`, as main sends it.

import { isQuickChatEnsureResult, type QuickChatEnsureResult } from "@buildersbot/contracts/ipc";

export function decodeQuickChatEnsure(value: unknown): QuickChatEnsureResult {
  if (!isQuickChatEnsureResult(value)) throw new Error("Invalid quick chat response.");
  return value;
}
