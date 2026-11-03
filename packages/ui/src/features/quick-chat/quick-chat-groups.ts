import type { AgentProfile } from "@buildersbot/ui/data";
import type { ThreadStatus } from "@buildersbot/ui/features/conversation/threads/thread-types";

/** The owner of a conversation of the Quick chat: the Quick chat agent, or an agent that a message called. */
export interface QuickChatOwner {
  name: string;
  /** True for the Quick chat agent, which has no avatar of its own: its row shows the bolt. */
  quick: boolean;
  /** The agent that a message called, for its avatar. Absent for the Quick chat agent. */
  agent?: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl" | "title"> | undefined;
}

/**
 * One conversation in the Quick chat list. A conversation is a thread of one agent, so the key is the
 * agent and the thread together: a thread id alone is not enough once an agent that a message called
 * owns the conversation.
 */
export interface QuickChatRow {
  key: string;
  agentId: string;
  taskId: string;
  title: string;
  /** The message that started the conversation, as stored. Empty when unknown. */
  firstMessage: string;
  /** The last message that the person sent, as stored. Empty when unknown. */
  preview: string;
  /** When the conversation was created. Empty when unknown. */
  createdAt: string;
  updatedAt: string;
  status: ThreadStatus;
  owner: QuickChatOwner;
}

export function quickChatRowKey(agentId: string, taskId: string): string {
  return `${agentId}:${taskId}`;
}

export type QuickChatGroupId = "today" | "yesterday" | "week" | "older";

export interface QuickChatGroup<Item> {
  id: QuickChatGroupId;
  items: Item[];
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/** The group of a time: today, yesterday, the 2 to 7 days before that, or older. A time that does not read is older. */
export function quickChatGroupOf(updatedAt: string, now: Date): QuickChatGroupId {
  const time = new Date(updatedAt);
  if (Number.isNaN(time.getTime())) return "older";
  const age = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000);
  if (age <= 0) return "today";
  if (age === 1) return "yesterday";
  return age <= 7 ? "week" : "older";
}

/**
 * Splits items into the groups of the list, in the order of the list, and keeps each item's place in
 * its group. A group with no item is left out. The caller gives the items newest first.
 */
export function groupByDay<Item extends { updatedAt: string }>(
  items: readonly Item[],
  now: Date = new Date(),
): QuickChatGroup<Item>[] {
  const order: QuickChatGroupId[] = ["today", "yesterday", "week", "older"];
  const groups = new Map<QuickChatGroupId, Item[]>();
  for (const item of items) {
    const id = quickChatGroupOf(item.updatedAt, now);
    const group = groups.get(id);
    if (group) group.push(item);
    else groups.set(id, [item]);
  }
  return order.flatMap((id) => {
    const found = groups.get(id);
    return found ? [{ id, items: found }] : [];
  });
}

/** Lower case with no accent marks, so "reuniao" finds "Reunião". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The rows whose title, first message or last message holds the query. An empty query keeps every row. */
export function filterQuickChatRows(rows: readonly QuickChatRow[], query: string): QuickChatRow[] {
  const needle = fold(query.trim());
  if (!needle) return [...rows];
  return rows.filter((row) => fold(`${row.title}\n${row.firstMessage}\n${row.preview}`).includes(needle));
}

/** The views of the list: every conversation by day, those at work, the newest created, the newest finished. */
export type QuickChatFilter = "all" | "running" | "created" | "finished";

export const QUICK_CHAT_FILTERS: readonly QuickChatFilter[] = ["all", "running", "created", "finished"];

/** A conversation at work: the agent answers, waits for the person, or the message waits for a turn. */
export function quickChatRunning(row: Pick<QuickChatRow, "status">): boolean {
  const kind = row.status.kind;
  return kind === "working" || kind === "waiting" || kind === "queued";
}

function newestFirst(field: "createdAt" | "updatedAt") {
  return (left: QuickChatRow, right: QuickChatRow) => right[field].localeCompare(left[field]);
}

/**
 * The rows of one view, newest first by the field that the view is about. `all` keeps the rows as they
 * come, so the list can group them by day and by folder.
 */
export function applyQuickChatFilter(rows: readonly QuickChatRow[], filter: QuickChatFilter): QuickChatRow[] {
  switch (filter) {
    case "running":
      return rows.filter(quickChatRunning).sort(newestFirst("updatedAt"));
    case "created":
      return [...rows].sort(newestFirst("createdAt"));
    case "finished":
      return rows.filter((row) => !quickChatRunning(row)).sort(newestFirst("updatedAt"));
    default:
      return [...rows];
  }
}

/** A folder of the list. A conversation is in no folder or in one. */
export interface QuickChatFolder {
  id: string;
  name: string;
}

/** Row key → folder id. A row with no entry is in no folder. */
export type QuickChatFolderAssignments = Readonly<Record<string, string>>;

/**
 * Splits the rows into those of each folder, in the order of the folders, and those in no folder. A row
 * whose folder is gone is in no folder.
 */
export function splitByFolder<Item extends { key: string }>(
  items: readonly Item[],
  folders: readonly QuickChatFolder[],
  assignments: QuickChatFolderAssignments,
): { byFolder: Map<string, Item[]>; loose: Item[] } {
  const byFolder = new Map<string, Item[]>(folders.map((folder) => [folder.id, []]));
  const loose: Item[] = [];
  for (const item of items) {
    const list = byFolder.get(assignments[item.key] ?? "");
    if (list) list.push(item);
    else loose.push(item);
  }
  return { byFolder, loose };
}
