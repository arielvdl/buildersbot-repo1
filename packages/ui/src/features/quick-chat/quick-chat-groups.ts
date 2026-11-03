import type { ThreadStatus } from "@buildersbot/ui/features/conversation/threads/thread-types";

/** The owner of a conversation of the Quick chat: the Quick chat agent, or an agent that a message called. */
export interface QuickChatOwner {
  name: string;
  /** True for the Quick chat agent, which has no avatar of its own: its row shows the bolt. */
  quick: boolean;
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
