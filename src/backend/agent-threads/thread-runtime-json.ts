import { isQuickChatRuntime, type QuickChatRuntime } from "@buildersbot/contracts/ipc";
import { isDynamicRecord, isString } from "@buildersbot/contracts/runtime-values";

/** The stored form of the model of a conversation (`projection_agent_threads.runtime_json`). `v` lets a later build change the shape without a migration. */
export function encodeThreadRuntime(runtime: QuickChatRuntime): string {
  return JSON.stringify({
    v: 1,
    provider: runtime.provider,
    model: runtime.model,
    ...(runtime.reasoningEffort === undefined ? {} : { reasoningEffort: runtime.reasoningEffort }),
    ...(runtime.fastMode === undefined ? {} : { fastMode: runtime.fastMode }),
  });
}

/** A value that is not text, is not valid JSON, or has another version or shape reads as null, so no row stops a read. */
export function decodeThreadRuntime(stored: unknown): QuickChatRuntime | null {
  if (!isString(stored)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!isDynamicRecord(parsed) || parsed.v !== 1) return null;
  const { v: _version, ...runtime } = parsed;
  return isQuickChatRuntime(runtime) ? runtime : null;
}
