import type { QuickChatTag, QuickChatTagAssignments } from "@buildersbot/ui/features/quick-chat/quick-chat-groups";
import { z } from "zod";

/**
 * The tags of the Quick chat list. Like the folders, they are an order that the person keeps on this
 * device, so they live in local storage, per server: the threads themselves are not changed.
 */
export interface QuickChatTagState {
  tags: QuickChatTag[];
  /** Row key → tag id. */
  assignments: Record<string, string>;
}

const STORAGE_KEY = "buildersbot:quick-chat-tags:v1";
const MAX_TAGS = 30;
const MAX_QUICK_CHAT_TAG_NAME = 24;
const COLOR = /^#[0-9a-f]{6}$/i;

type TagStorage = Pick<Storage, "getItem" | "setItem">;

const text = z.string().trim().min(1).max(200);
const schema = z.record(
  text,
  z.object({
    tags: z.array(
      z
        .object({
          id: text,
          name: z.string().trim().min(1).max(MAX_QUICK_CHAT_TAG_NAME),
          color: z.string().regex(COLOR),
        })
        .nullable()
        .catch(null),
    ),
    assignments: z.record(text, text).catch({}),
  }),
);

const EMPTY: QuickChatTagState = { tags: [], assignments: {} };

function readAll(storage: TagStorage): Record<string, QuickChatTagState> {
  try {
    const parsed = schema.safeParse(JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}"));
    if (!parsed.success) return {};
    return Object.fromEntries(
      Object.entries(parsed.data).map(([serverId, state]) => [
        serverId,
        {
          tags: state.tags
            .filter((tag): tag is QuickChatTag => tag !== null)
            .map((tag) => ({ ...tag, color: tag.color.toLowerCase() })),
          assignments: state.assignments,
        },
      ]),
    );
  } catch {
    return {};
  }
}

function save(serverId: string, next: QuickChatTagState, storage: TagStorage): QuickChatTagState {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(storage), [serverId]: next }));
  } catch {
    // Blocked or full storage keeps the tags for this window only.
  }
  return next;
}

export function readQuickChatTags(serverId: string, storage: TagStorage = window.localStorage): QuickChatTagState {
  return readAll(storage)[serverId] ?? EMPTY;
}

function clean(name: string, color: string): { name: string; color: string } | null {
  const trimmed = name.trim().slice(0, MAX_QUICK_CHAT_TAG_NAME);
  return trimmed && COLOR.test(color) ? { name: trimmed, color: color.toLowerCase() } : null;
}

/**
 * Makes a tag and puts the row in it. A blank name, a color that is not `#rrggbb`, or a tag past the
 * limit changes nothing.
 */
export function addQuickChatTag(
  serverId: string,
  rowKey: string,
  name: string,
  color: string,
  storage: TagStorage = window.localStorage,
): QuickChatTagState {
  const current = readQuickChatTags(serverId, storage);
  const fields = clean(name, color);
  if (!fields || current.tags.length >= MAX_TAGS) return current;
  const tag: QuickChatTag = { id: crypto.randomUUID(), ...fields };
  return save(
    serverId,
    { tags: [...current.tags, tag], assignments: { ...current.assignments, [rowKey]: tag.id } },
    storage,
  );
}

/** Changes the name and color of a tag. Every row with the tag shows the change. */
export function editQuickChatTag(
  serverId: string,
  tagId: string,
  name: string,
  color: string,
  storage: TagStorage = window.localStorage,
): QuickChatTagState {
  const current = readQuickChatTags(serverId, storage);
  const fields = clean(name, color);
  if (!fields) return current;
  return save(
    serverId,
    { ...current, tags: current.tags.map((tag) => (tag.id === tagId ? { ...tag, ...fields } : tag)) },
    storage,
  );
}

/** Deletes a tag. Its conversations stay in the list, with no tag. */
export function removeQuickChatTag(
  serverId: string,
  tagId: string,
  storage: TagStorage = window.localStorage,
): QuickChatTagState {
  const current = readQuickChatTags(serverId, storage);
  return save(
    serverId,
    {
      tags: current.tags.filter((tag) => tag.id !== tagId),
      assignments: Object.fromEntries(Object.entries(current.assignments).filter(([, id]) => id !== tagId)),
    },
    storage,
  );
}

/** Gives a conversation a tag, or none when `tagId` is null. An unknown tag changes nothing. */
export function setQuickChatRowTag(
  serverId: string,
  rowKey: string,
  tagId: string | null,
  storage: TagStorage = window.localStorage,
): QuickChatTagState {
  const current = readQuickChatTags(serverId, storage);
  const assignments: QuickChatTagAssignments & Record<string, string> = { ...current.assignments };
  if (tagId === null) delete assignments[rowKey];
  else if (current.tags.some((tag) => tag.id === tagId)) assignments[rowKey] = tagId;
  else return current;
  return save(serverId, { ...current, assignments }, storage);
}
