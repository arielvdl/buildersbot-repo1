import { z } from "zod";
import type { QuickChatPointer } from "./quick-chat-pointers";

/** Server id → the conversation that was open when the person left the Quick chat. */
const STORAGE_KEY = "buildersbot:quick-chat-last:v1";

type LastStorage = Pick<Storage, "getItem" | "setItem">;

const id = z.string().trim().min(1).max(200);
const schema = z.record(id, z.object({ agentId: id, taskId: id }).nullable().catch(null)).catch({});

function readAll(storage: LastStorage): Record<string, QuickChatPointer | null> {
  try {
    const parsed = schema.safeParse(JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}"));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** The conversation that was open last on this server, or null when it was a new one. */
export function readLastQuickChat(
  serverId: string,
  storage: LastStorage = window.localStorage,
): QuickChatPointer | null {
  return readAll(storage)[serverId] ?? null;
}

/** Keeps the open conversation. A new conversation with no message is null: the next visit opens a new one. */
export function writeLastQuickChat(
  serverId: string,
  last: QuickChatPointer | null,
  storage: LastStorage = window.localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(storage), [serverId]: last }));
  } catch {
    // Blocked or full storage means the next visit opens a new conversation.
  }
}
