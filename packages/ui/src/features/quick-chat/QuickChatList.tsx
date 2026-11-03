import {
  Archive,
  ArchiveRestore,
  Button,
  buttonVariants,
  ChevronRight,
  DropdownMenu,
  Ellipsis,
  Folder,
  FolderInput,
  FolderPlus,
  Input,
  MessageCirclePlus,
  Pencil,
  Search,
  Skeleton,
  Trash2,
  X,
  Zap,
} from "@buildersbot/ui";
import { AgentAvatar } from "@buildersbot/ui/features/agents/AgentAvatar";
import { chatPreviewLine } from "@buildersbot/ui/features/conversation/threads/thread-preview-text";
import { sidebarMessageTime } from "@buildersbot/ui/features/sidebar/sidebar-filtering";
import { useText } from "@buildersbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import { ThreadStatusMark } from "../conversation/threads/ThreadStatusMark";
import { ThreadTitle } from "../conversation/threads/ThreadTitle";
import {
  applyQuickChatFilter,
  filterQuickChatRows,
  groupByDay,
  QUICK_CHAT_FILTERS,
  type QuickChatFilter,
  type QuickChatFolder,
  type QuickChatFolderAssignments,
  type QuickChatGroupId,
  type QuickChatRow,
  splitByFolder,
} from "./quick-chat-groups";

/** What the drag of a row carries: the key of the row. */
const DRAG_TYPE = "application/x-buildersbot-quick-row";

export interface QuickChatListProps {
  /** The conversations that are not archived, newest first. */
  rows: readonly QuickChatRow[];
  /** The archived conversations, newest first. */
  archived: readonly QuickChatRow[];
  /** The key of the open conversation. Null while a new conversation is open. */
  selectedKey: string | null;
  /** The list of conversations is not read yet. */
  loading: boolean;
  onSelect: (row: QuickChatRow) => void;
  onNew: () => void;
  onArchive: (row: QuickChatRow) => void;
  onRestore: (row: QuickChatRow) => void;
  /** Missing where the host cannot delete a thread: the item then does not show. */
  onDelete?: ((row: QuickChatRow) => void) | undefined;
  /** The folders, in order. Missing where the host keeps no folders: the list then shows none. */
  folders?: readonly QuickChatFolder[] | undefined;
  /** Row key → folder id. */
  assignments?: QuickChatFolderAssignments | undefined;
  onCreateFolder?: ((name: string) => void) | undefined;
  onRenameFolder?: ((folder: QuickChatFolder, name: string) => void) | undefined;
  onDeleteFolder?: ((folder: QuickChatFolder) => void) | undefined;
  /** Puts a row in a folder, or in none when the folder is null. */
  onMove?: ((row: QuickChatRow, folderId: string | null) => void) | undefined;
}

const FILTER_TEXT = {
  all: "quick.list.filter.all",
  running: "quick.list.filter.running",
  created: "quick.list.filter.created",
  finished: "quick.list.filter.finished",
} as const satisfies Record<QuickChatFilter, string>;

const GROUP_TEXT = {
  today: "quick.list.group.today",
  yesterday: "quick.list.group.yesterday",
  week: "quick.list.group.week",
  older: "quick.list.group.older",
} as const satisfies Record<QuickChatGroupId, string>;

/** The second line of a row: who answers, then the last message of the person. */
function RowPreview(props: { row: QuickChatRow }) {
  const line = () => chatPreviewLine(props.row.preview || props.row.firstMessage);
  return (
    <Show when={line()}>
      {(text) => (
        <span class="quick-list-preview">
          <Show when={props.row.owner.agent} fallback={<Zap class="quick-list-owner-mark" aria-hidden="true" />}>
            {(agent) => <AgentAvatar class="quick-list-owner-mark" agent={agent()} animated={false} />}
          </Show>
          <span class="quick-list-owner">{props.row.owner.name}</span> {text()}
        </span>
      )}
    </Show>
  );
}

/** One conversation: the row that opens it, and the menu of its actions. */
function QuickChatItem(
  props: Omit<QuickChatListProps, "archived" | "rows"> & { row: QuickChatRow; isArchived?: boolean },
) {
  const currentFolder = () => props.assignments?.[props.row.key];
  const { t, format } = useText();
  const selected = () => (props.row.key === props.selectedKey ? "true" : undefined);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag and drop is a mouse shortcut; the row menu moves rows with the keyboard.
    <div
      class="quick-list-item"
      data-archived={props.isArchived ? "" : undefined}
      draggable={props.onMove && !props.isArchived ? "true" : undefined}
      onDragStart={(event) => {
        event.dataTransfer?.setData(DRAG_TYPE, props.row.key);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      }}
    >
      <Button
        variant="ghost"
        type="button"
        class="quick-list-row"
        aria-current={selected()}
        onClick={() => props.onSelect(props.row)}
      >
        <span class="quick-list-line">
          <ThreadTitle class="quick-list-title" title={props.row.title} />
          <Show when={props.row.status.kind === "queued"} fallback={<ThreadStatusMark status={props.row.status} />}>
            <span class="quick-list-queued">{t("quick.list.queued")}</span>
          </Show>
          <span class="quick-list-time">{sidebarMessageTime(props.row.updatedAt, format)}</span>
        </span>
        <RowPreview row={props.row} />
      </Button>
      <DropdownMenu.Root placement="bottom-end" gutter={4}>
        <DropdownMenu.Trigger
          class={buttonVariants({ variant: "ghost", size: "icon-sm", class: "quick-list-actions" })}
          aria-label={t("quick.list.rowActions", { title: props.row.title })}
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="agent-context-menu">
            <Show
              when={props.isArchived}
              fallback={
                <DropdownMenu.Item onSelectAfterClose={() => props.onArchive(props.row)}>
                  <Archive class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("conversation.threads.archive")}</span>
                </DropdownMenu.Item>
              }
            >
              <DropdownMenu.Item onSelectAfterClose={() => props.onRestore(props.row)}>
                <ArchiveRestore class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("conversation.threads.restore")}</span>
              </DropdownMenu.Item>
            </Show>
            <Show when={props.onMove && !props.isArchived && (props.folders?.length ?? 0) > 0}>
              <For each={(props.folders ?? []).filter((folder) => folder.id !== currentFolder())}>
                {(folder) => (
                  <DropdownMenu.Item onSelectAfterClose={() => props.onMove?.(props.row, folder.id)}>
                    <FolderInput class="agent-context-icon size-4" aria-hidden="true" />
                    <span>{t("quick.folder.moveTo", { name: folder.name })}</span>
                  </DropdownMenu.Item>
                )}
              </For>
              <Show when={currentFolder()}>
                <DropdownMenu.Item onSelectAfterClose={() => props.onMove?.(props.row, null)}>
                  <X class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("quick.folder.remove")}</span>
                </DropdownMenu.Item>
              </Show>
            </Show>
            <Show when={props.onDelete}>
              {(onDelete) => (
                <DropdownMenu.Item onSelectAfterClose={() => onDelete()(props.row)}>
                  <Trash2 class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("common.delete")}</span>
                </DropdownMenu.Item>
              )}
            </Show>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

/** A one-line field for a folder name: Enter keeps it, Escape or leaving the field drops it. */
function FolderNameInput(props: { initial?: string; onDone: (name: string | null) => void }) {
  const { t } = useText();
  let done = false;
  const finish = (name: string | null) => {
    if (done) return;
    done = true;
    props.onDone(name);
  };
  return (
    <div class="quick-folder-edit">
      <Folder class="quick-folder-icon" aria-hidden="true" />
      <Input
        size="sm"
        maxlength={60}
        value={props.initial ?? ""}
        placeholder={t("quick.folder.namePlaceholder")}
        aria-label={t("quick.folder.namePlaceholder")}
        ref={(element: HTMLInputElement) => queueMicrotask(() => element.focus())}
        onKeyDown={(event) => {
          if (event.key === "Enter") finish(event.currentTarget.value.trim() || null);
          if (event.key === "Escape") finish(null);
        }}
        onBlur={(event) => finish(event.currentTarget.value.trim() || null)}
      />
    </div>
  );
}

/** A drop target for rows: it lights while a row is over it, and gives the key of the row that drops. */
function DropZone(props: {
  id: string;
  over: string | null;
  setOver: (id: string | null) => void;
  onDropRow: (rowKey: string) => void;
  class?: string;
  children: JSX.Element;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag and drop is a mouse shortcut; the row menu moves rows with the keyboard.
    <div
      class={props.class}
      data-drop-over={props.over === props.id ? "" : undefined}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        props.setOver(props.id);
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node && event.currentTarget.contains(next))) props.setOver(null);
      }}
      onDrop={(event) => {
        const key = event.dataTransfer?.getData(DRAG_TYPE);
        props.setOver(null);
        if (!key) return;
        event.preventDefault();
        props.onDropRow(key);
      }}
    >
      {props.children}
    </div>
  );
}

/**
 * The conversations of the Quick chat: the search, the groups by day, and the archived ones. It holds
 * no thread state: the page gives the rows and takes the actions.
 */
export function QuickChatList(props: QuickChatListProps) {
  const { t } = useText();
  const [query, setQuery] = createSignal("");
  const [archivedOpen, setArchivedOpen] = createSignal(false);
  const rows = createMemo(() => filterQuickChatRows(props.rows, query()));
  const archived = createMemo(() => filterQuickChatRows(props.archived, query()));
  // The day of "now" is read when the rows change, so no timer runs while the list is idle.
  const searching = () => query().trim() !== "";
  const [filter, setFilter] = createSignal<QuickChatFilter>("all");
  const [creating, setCreating] = createSignal(false);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [closed, setClosed] = createSignal<ReadonlySet<string>>(new Set());
  const [dropOver, setDropOver] = createSignal<string | null>(null);
  const folders = () => props.folders ?? [];
  const foldersEnabled = () => props.onCreateFolder !== undefined;
  const filtered = createMemo(() => applyQuickChatFilter(filter() === "all" ? [] : rows(), filter()));
  const split = createMemo(() => splitByFolder(rows(), folders(), props.assignments ?? {}));
  const looseGroups = createMemo(() => groupByDay(split().loose, new Date()));
  const rowByKey = (key: string) => props.rows.find((row) => row.key === key);
  const toggleFolder = (id: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const dropOn = (folderId: string | null) => (key: string) => {
    const row = rowByKey(key);
    if (row) props.onMove?.(row, folderId);
  };
  return (
    <nav class="quick-list" aria-label={t("quick.list.label")}>
      <header class="quick-list-header">
        <Zap class="quick-list-bolt" aria-hidden="true" />
        <h2 class="quick-list-heading">{t("quick.list.title")}</h2>
        <Button variant="secondary" size="sm" type="button" class="quick-list-new" onClick={props.onNew}>
          <MessageCirclePlus aria-hidden="true" />
          {t("quick.list.new")}
        </Button>
      </header>
      <div class="quick-list-search">
        <Search class="quick-list-search-icon" aria-hidden="true" />
        <Input
          type="search"
          size="sm"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("quick.list.search")}
          aria-label={t("quick.list.search")}
        />
      </div>
      <div class="quick-list-tools">
        <fieldset class="quick-list-filters" aria-label={t("quick.list.filter.label")}>
          <For each={QUICK_CHAT_FILTERS}>
            {(id) => (
              <Button
                variant={filter() === id ? "secondary" : "ghost"}
                size="sm"
                type="button"
                class="quick-list-filter"
                aria-pressed={filter() === id ? "true" : "false"}
                onClick={() => setFilter(id)}
              >
                {t(FILTER_TEXT[id])}
              </Button>
            )}
          </For>
        </fieldset>
        <Show when={foldersEnabled()}>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            class="quick-list-folder-add"
            aria-label={t("quick.folder.new")}
            title={t("quick.folder.new")}
            onClick={() => setCreating(true)}
          >
            <FolderPlus aria-hidden="true" />
          </Button>
        </Show>
      </div>
      <div class="quick-list-scroll">
        <Show
          when={!props.loading}
          fallback={
            <div class="quick-list-loading" role="status" aria-label={t("quick.list.loading")}>
              <For each={[0, 1, 2, 3]}>{() => <Skeleton class="quick-list-skeleton" />}</For>
            </div>
          }
        >
          <Show when={filter() === "all"}>
            <Show when={creating()}>
              <FolderNameInput
                onDone={(name) => {
                  setCreating(false);
                  if (name) props.onCreateFolder?.(name);
                }}
              />
            </Show>
            <For each={folders()} keyed={(folder) => folder.id}>
              {(folder) => {
                const items = () => split().byFolder.get(folder().id) ?? [];
                const open = () => !closed().has(folder().id) || searching();
                return (
                  <Show when={!searching() || items().length > 0}>
                    <section class="quick-list-group quick-folder" aria-label={folder().name}>
                      <DropZone
                        id={folder().id}
                        over={dropOver()}
                        setOver={setDropOver}
                        onDropRow={dropOn(folder().id)}
                        class="quick-folder-head"
                      >
                        <Show
                          when={renaming() !== folder().id}
                          fallback={
                            <FolderNameInput
                              initial={folder().name}
                              onDone={(name) => {
                                setRenaming(null);
                                if (name && name !== folder().name) props.onRenameFolder?.(folder(), name);
                              }}
                            />
                          }
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            class="quick-list-archived-toggle quick-folder-toggle"
                            aria-expanded={open() ? "true" : "false"}
                            onClick={() => toggleFolder(folder().id)}
                          >
                            <ChevronRight
                              class="quick-list-chevron"
                              data-open={open() ? "" : undefined}
                              aria-hidden="true"
                            />
                            <Folder class="quick-folder-icon" aria-hidden="true" />
                            <span class="quick-folder-name">{folder().name}</span>
                            <span class="quick-list-count">{items().length}</span>
                          </Button>
                          <DropdownMenu.Root placement="bottom-end" gutter={4}>
                            <DropdownMenu.Trigger
                              class={buttonVariants({
                                variant: "ghost",
                                size: "icon-sm",
                                class: "quick-folder-actions",
                              })}
                              aria-label={t("quick.folder.actions", { name: folder().name })}
                            >
                              <Ellipsis aria-hidden="true" />
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content class="agent-context-menu">
                                <DropdownMenu.Item onSelectAfterClose={() => setRenaming(folder().id)}>
                                  <Pencil class="agent-context-icon size-4" aria-hidden="true" />
                                  <span>{t("common.rename")}</span>
                                </DropdownMenu.Item>
                                <DropdownMenu.Item onSelectAfterClose={() => props.onDeleteFolder?.(folder())}>
                                  <Trash2 class="agent-context-icon size-4" aria-hidden="true" />
                                  <span>{t("quick.folder.delete")}</span>
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        </Show>
                      </DropZone>
                      <Show when={open()}>
                        <For each={items()} keyed={(row) => row.key}>
                          {(row) => <QuickChatItem {...props} row={row()} />}
                        </For>
                        <Show when={items().length === 0}>
                          <p class="quick-folder-empty">{t("quick.folder.empty")}</p>
                        </Show>
                      </Show>
                    </section>
                  </Show>
                );
              }}
            </For>
            <DropZone
              id="loose"
              over={dropOver()}
              setOver={setDropOver}
              onDropRow={dropOn(null)}
              class="quick-list-loose"
            >
              <For each={looseGroups()} keyed={(group) => group.id}>
                {(group) => (
                  <section class="quick-list-group" aria-label={t(GROUP_TEXT[group().id])}>
                    <h3 class="quick-list-group-title">{t(GROUP_TEXT[group().id])}</h3>
                    <For each={group().items} keyed={(row) => row.key}>
                      {(row) => <QuickChatItem {...props} row={row()} />}
                    </For>
                  </section>
                )}
              </For>
            </DropZone>
          </Show>
          <Show when={filter() !== "all"}>
            <section class="quick-list-group" aria-label={t(FILTER_TEXT[filter()])}>
              <h3 class="quick-list-group-title">{t(FILTER_TEXT[filter()])}</h3>
              <For each={filtered()} keyed={(row) => row.key}>
                {(row) => <QuickChatItem {...props} row={row()} />}
              </For>
            </section>
          </Show>
          <Show when={archived().length === 0 && (filter() === "all" ? rows().length === 0 : filtered().length === 0)}>
            <p class="quick-list-empty">{t(searching() ? "quick.list.noResults" : "quick.list.empty")}</p>
          </Show>
          <Show when={archived().length > 0}>
            <section class="quick-list-group">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class="quick-list-archived-toggle"
                aria-expanded={archivedOpen() ? "true" : "false"}
                onClick={() => setArchivedOpen((open) => !open)}
              >
                <ChevronRight
                  class="quick-list-chevron"
                  data-open={archivedOpen() ? "" : undefined}
                  aria-hidden="true"
                />
                {t("quick.list.archived")}
                <span class="quick-list-count">{archived().length}</span>
              </Button>
              <Show when={archivedOpen()}>
                <For each={archived()} keyed={(row) => row.key}>
                  {(row) => <QuickChatItem {...props} row={row()} isArchived />}
                </For>
              </Show>
            </section>
          </Show>
        </Show>
      </div>
    </nav>
  );
}
