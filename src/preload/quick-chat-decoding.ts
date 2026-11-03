// The answers of the quick chat endpoints, as main sends them.

import {
  isQuickChatConversationRuntimeResult,
  isQuickChatEnsureResult,
  type QuickChatConversationRuntimeResult,
  type QuickChatEnsureResult,
} from "@buildersbot/contracts/ipc";

export function decodeQuickChatEnsure(value: unknown): QuickChatEnsureResult {
  if (!isQuickChatEnsureResult(value)) throw new Error("Invalid quick chat response.");
  return value;
}

export function decodeQuickChatConversationRuntime(value: unknown): QuickChatConversationRuntimeResult {
  if (!isQuickChatConversationRuntimeResult(value)) throw new Error("Invalid quick chat response.");
  return value;
}
