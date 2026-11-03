// The payloads of the quick chat endpoints, decoded in main before a handler sees them.

import {
  isQuickChatRuntime,
  type QuickChatRuntime,
  type SetQuickChatConversationRuntimeInput,
} from "@buildersbot/contracts/ipc";
import { isObject, requireString } from "./validation";

/** The model of a conversation, or an error for any other shape. Unknown keys are refused. */
export function parseQuickChatRuntime(value: unknown): QuickChatRuntime {
  if (!isQuickChatRuntime(value)) throw new Error("Invalid quick chat model.");
  return value;
}

export function parseSetQuickChatConversationRuntime(value: unknown): SetQuickChatConversationRuntimeInput {
  if (!isObject(value)) throw new Error("Invalid quick chat request.");
  return {
    agentId: requireString(value.agentId, "agentId"),
    taskId: requireString(value.taskId, "taskId"),
    runtime: parseQuickChatRuntime(value.runtime),
  };
}
