import type {
  QuickChatFolder,
  QuickChatFolderAssignments,
} from "@buildersbot/ui/features/quick-chat/quick-chat-groups";
import { z } from "zod";

/**
 * The folders of the Quick chat list. They are an order that the person keeps on this device, so like
 * the pointers they live in local storage, per server: the threads themselves are not changed.
 */
export interface QuickChatFolderState {
  folders: QuickChatFolder[];
  /** Row key → folder id. */
  assignments: Record<string, string>;
}

const STORAGE_KEY = "buildersbot:quick-chat-folders:v1";
const MAX_FOLDERS = 50;
const MAX_NAME = 60;

type FolderStorage = Pick<Storage, "getItem" | "setItem">;

const text = z.string().trim().min(1).max(200);
const schema = z.record(
  text,
  z.object({
    folders: z.array(
      z
        .object({ id: text, name: z.string().trim().min(1).max(MAX_NAME) })
        .nullable()
        .catch(null),
    ),
    assignments: z.record(text, text).catch({}),
  }),
);

const EMPTY: QuickChatFolderState = { folders: [], assignments: {} };

function readAll(storage: FolderStorage): Record<string, QuickChatFolderState> {
  try {
    const parsed = schema.safeParse(JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}"));
    if (!parsed.success) return {};
    return Object.fromEntries(
      Object.entries(parsed.data).map(([serverId, state]) => [
        serverId,
        {
          folders: state.folders.filter((folder): folder is QuickChatFolder => folder !== null),
          assignments: state.assignments,
        },
      ]),
    );
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, QuickChatFolderState>, storage: FolderStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Blocked or full storage keeps the folders for this window only.
  }
}

export function readQuickChatFolders(
  serverId: string,
  storage: FolderStorage = window.localStorage,
): QuickChatFolderState {
  return readAll(storage)[serverId] ?? EMPTY;
}

function save(serverId: string, next: QuickChatFolderState, storage: FolderStorage): QuickChatFolderState {
  writeAll({ ...readAll(storage), [serverId]: next }, storage);
  return next;
}

/** Adds a folder at the end. A blank name, or one past the limit, changes nothing. */
export function addQuickChatFolder(
  serverId: string,
  name: string,
  storage: FolderStorage = window.localStorage,
): QuickChatFolderState {
  const current = readQuickChatFolders(serverId, storage);
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean || current.folders.length >= MAX_FOLDERS) return current;
  return save(
    serverId,
    { ...current, folders: [...current.folders, { id: crypto.randomUUID(), name: clean }] },
    storage,
  );
}

export function renameQuickChatFolder(
  serverId: string,
  folderId: string,
  name: string,
  storage: FolderStorage = window.localStorage,
): QuickChatFolderState {
  const current = readQuickChatFolders(serverId, storage);
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean) return current;
  return save(
    serverId,
    {
      ...current,
      folders: current.folders.map((folder) => (folder.id === folderId ? { ...folder, name: clean } : folder)),
    },
    storage,
  );
}

/** Removes a folder. Its conversations stay in the list, in no folder. */
export function removeQuickChatFolder(
  serverId: string,
  folderId: string,
  storage: FolderStorage = window.localStorage,
): QuickChatFolderState {
  const current = readQuickChatFolders(serverId, storage);
  return save(
    serverId,
    {
      folders: current.folders.filter((folder) => folder.id !== folderId),
      assignments: Object.fromEntries(Object.entries(current.assignments).filter(([, id]) => id !== folderId)),
    },
    storage,
  );
}

/** Puts a conversation in a folder, or in none when `folderId` is null. An unknown folder changes nothing. */
export function moveQuickChatRow(
  serverId: string,
  rowKey: string,
  folderId: string | null,
  storage: FolderStorage = window.localStorage,
): QuickChatFolderState {
  const current = readQuickChatFolders(serverId, storage);
  const assignments: QuickChatFolderAssignments & Record<string, string> = { ...current.assignments };
  if (folderId === null) delete assignments[rowKey];
  else if (current.folders.some((folder) => folder.id === folderId)) assignments[rowKey] = folderId;
  else return current;
  return save(serverId, { ...current, assignments }, storage);
}
