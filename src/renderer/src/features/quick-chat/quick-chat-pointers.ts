import { z } from "zod";

/**
 * A conversation that the Quick chat started in an agent that a message called. That thread is a thread of
 * the called agent, so no list of the Quick chat agent has it; this small record on this device says which
 * threads came from the Quick chat.
 */
export interface QuickChatPointer {
  agentId: string;
  taskId: string;
}

/** Server id → pointers, newest first. */
type PointersByServer = Record<string, QuickChatPointer[]>;

const STORAGE_KEY = "buildersbot:quick-chat-pointers:v1";
/** As many as the Quick chat keeps open conversations. */
const MAX_POINTERS = 50;

type PointerStorage = Pick<Storage, "getItem" | "setItem">;

const id = z.string().trim().min(1).max(200);
const schema = z.record(id, z.array(z.object({ agentId: id, taskId: id }).nullable().catch(null)).catch([]));

function readAll(storage: PointerStorage): PointersByServer {
  try {
    const parsed = schema.safeParse(JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}"));
    if (!parsed.success) return {};
    return Object.fromEntries(
      Object.entries(parsed.data).map(([serverId, pointers]) => [
        serverId,
        pointers.filter((pointer): pointer is QuickChatPointer => pointer !== null),
      ]),
    );
  } catch {
    return {};
  }
}

function writeAll(all: PointersByServer, storage: PointerStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Blocked or full storage keeps the pointers for this window only.
  }
}

/** The pointers of one server, newest first. */
export function readQuickChatPointers(
  serverId: string,
  storage: PointerStorage = window.localStorage,
): QuickChatPointer[] {
  return readAll(storage)[serverId] ?? [];
}

/** Adds a pointer at the front. The oldest pointers past the limit go; their threads stay with their agents. */
export function addQuickChatPointer(
  serverId: string,
  pointer: QuickChatPointer,
  storage: PointerStorage = window.localStorage,
): QuickChatPointer[] {
  const all = readAll(storage);
  const next = [
    pointer,
    ...(all[serverId] ?? []).filter((other) => !(other.agentId === pointer.agentId && other.taskId === pointer.taskId)),
  ].slice(0, MAX_POINTERS);
  writeAll({ ...all, [serverId]: next }, storage);
  return next;
}

/** Removes the pointers that `keep` refuses, for example those of a thread that was deleted. */
export function pruneQuickChatPointers(
  serverId: string,
  keep: (pointer: QuickChatPointer) => boolean,
  storage: PointerStorage = window.localStorage,
): QuickChatPointer[] {
  const all = readAll(storage);
  const current = all[serverId] ?? [];
  const next = current.filter(keep);
  if (next.length !== current.length) writeAll({ ...all, [serverId]: next }, storage);
  return next;
}
