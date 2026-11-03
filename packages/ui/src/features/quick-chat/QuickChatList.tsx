import {
  Archive,
  ArchiveRestore,
  Button,
  buttonVariants,
  Check,
  ChevronRight,
  ContextMenu,
  Dialog,
  DropdownMenu,
  Ellipsis,
  Field,
  Folder,
  FolderInput,
  FolderPlus,
  IconButton,
  Input,
  MessageCirclePlus,
  Pencil,
  Plus,
  Search,
  Skeleton,
  SlidersHorizontal,
  Tag,
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
import { SIDEBAR_SECTION_COLOR_PRESETS } from "../sidebar/section-color";
import { QuickChatArchivedDialog } from "./QuickChatArchivedDialog";
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
  type QuickChatTag,
  type QuickChatTagAssignments,
  splitByFolder,
} from "./quick-chat-groups";
import { createRowSwipe, SWIPE_REVEAL } from "./quick-chat-swipe";

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
  /** Restores many archived conversations, without opening them. */
  onRestoreMany: (rows: readonly QuickChatRow[]) => Promise<void>;
  /** Deletes many archived conversations. Missing where the host cannot delete a thread. */
  onDeleteMany?: ((rows: readonly QuickChatRow[]) => Promise<void>) | undefined;
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
  /** The tags, in order. Missing where the host keeps no tags: the menu then has no tag item. */
  tags?: readonly QuickChatTag[] | undefined;
  /** Row key → tag id. */
  tagAssignments?: QuickChatTagAssignments | undefined;
  /** Makes a tag and gives it to the row. */
  onCreateTag?: ((row: QuickChatRow, name: string, color: string) => void) | undefined;
  onEditTag?: ((tag: QuickChatTag, name: string, color: string) => void) | undefined;
  onDeleteTag?: ((tag: QuickChatTag) => void) | undefined;
  /** Gives a row a tag, or none when the tag id is null. */
  onSetTag?: ((row: QuickChatRow, tagId: string | null) => void) | undefined;
}

const MAX_TAG_NAME = 24;

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

/** The tag of a row, when it has one that still exists. */
function tagOf(
  tags: readonly QuickChatTag[] | undefined,
  assignments: QuickChatTagAssignments | undefined,
  rowKey: string,
): QuickChatTag | undefined {
  const id = assignments?.[rowKey];
  return id === undefined ? undefined : tags?.find((tag) => tag.id === id);
}

/** What the tag dialog works on: a new tag for a row, or a tag that exists. */
type TagDialogTarget = { kind: "create"; row: QuickChatRow } | { kind: "edit"; tag: QuickChatTag };

/** The second line of a row: the tag, then who answers, then the last message of the person. */
function RowPreview(props: { row: QuickChatRow; tag: QuickChatTag | undefined }) {
  const line = () => chatPreviewLine(props.row.preview || props.row.firstMessage);
  return (
    <Show when={line() || props.tag}>
      <span class="quick-list-preview">
        <Show when={props.tag}>
          {(tag) => (
            <span class="quick-list-tag" style={{ "--quick-tag-color": tag().color }} title={tag().name}>
              {tag().name}
            </span>
          )}
        </Show>
        <Show when={props.row.owner.agent} fallback={<Zap class="quick-list-owner-mark" aria-hidden="true" />}>
          {(agent) => <AgentAvatar class="quick-list-owner-mark" agent={agent()} animated={false} />}
        </Show>
        {/* The bolt says "quick" by itself. Only an agent that a message called shows its name. */}
        <Show when={!props.row.owner.quick} fallback={<span class="sr-only">{props.row.owner.name}</span>}>
          <span class="quick-list-owner">{props.row.owner.name}</span>
        </Show>{" "}
        {line()}
      </span>
    </Show>
  );
}

/** The part of the menu that Kobalte's dropdown and context menus share. */
type MenuApi = Pick<
  typeof DropdownMenu,
  "Item" | "Portal" | "RadioGroup" | "RadioItem" | "Separator" | "Sub" | "SubContent" | "SubTrigger"
>;

type ItemProps = Omit<QuickChatListProps, "archived" | "rows"> & {
  row: QuickChatRow;
  isArchived?: boolean;
  onTagDialog: (target: TagDialogTarget) => void;
};

const NO_TAG = "none";

/** The tag choices of one row: the tags, "new tag", "edit tag" and "remove tag". */
function TagItems(props: ItemProps & { Menu: MenuApi }) {
  const { t } = useText();
  const current = () => tagOf(props.tags, props.tagAssignments, props.row.key);
  return (
    <>
      <props.Menu.RadioGroup
        value={current()?.id ?? NO_TAG}
        onChange={(value: string) => props.onSetTag?.(props.row, value === NO_TAG ? null : value)}
      >
        <For each={props.tags ?? []}>
          {(tag) => (
            <props.Menu.RadioItem value={tag.id} aria-label={tag.name}>
              <span class="quick-tag-swatch" style={{ background: tag.color }} aria-hidden="true" />
              <span class="quick-tag-menu-name">{tag.name}</span>
              <Show when={current()?.id === tag.id}>
                <Check class="quick-tag-check size-4" aria-hidden="true" />
              </Show>
            </props.Menu.RadioItem>
          )}
        </For>
      </props.Menu.RadioGroup>
      <Show when={(props.tags?.length ?? 0) > 0}>
        <props.Menu.Separator />
      </Show>
      <props.Menu.Item onSelectAfterClose={() => props.onTagDialog({ kind: "create", row: props.row })}>
        <Plus class="agent-context-icon size-4" aria-hidden="true" />
        <span>{t("quick.tag.new")}</span>
      </props.Menu.Item>
      <Show when={current()}>
        {(tag) => (
          <>
            <props.Menu.Item onSelectAfterClose={() => props.onTagDialog({ kind: "edit", tag: tag() })}>
              <Pencil class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("quick.tag.edit")}</span>
            </props.Menu.Item>
            <props.Menu.Item onSelectAfterClose={() => props.onSetTag?.(props.row, null)}>
              <X class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("quick.tag.remove")}</span>
            </props.Menu.Item>
          </>
        )}
      </Show>
    </>
  );
}

/** The actions of a row. The "⋯" button and the right click open the same list. */
function RowMenuItems(props: ItemProps & { Menu: MenuApi }) {
  const { t } = useText();
  const currentFolder = () => props.assignments?.[props.row.key];
  return (
    <>
      <Show
        when={props.isArchived}
        fallback={
          <props.Menu.Item onSelectAfterClose={() => props.onArchive(props.row)}>
            <Archive class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("conversation.threads.archive")}</span>
          </props.Menu.Item>
        }
      >
        <props.Menu.Item onSelectAfterClose={() => props.onRestore(props.row)}>
          <ArchiveRestore class="agent-context-icon size-4" aria-hidden="true" />
          <span>{t("conversation.threads.restore")}</span>
        </props.Menu.Item>
      </Show>
      <Show when={props.onSetTag && !props.isArchived}>
        <props.Menu.Sub>
          <props.Menu.SubTrigger>
            <Tag class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("quick.tag.menu")}</span>
            <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
          </props.Menu.SubTrigger>
          <props.Menu.Portal>
            <props.Menu.SubContent
              class="ui-action-menu agent-context-menu agent-context-submenu"
              aria-label={t("quick.tag.menu")}
            >
              <TagItems {...props} />
            </props.Menu.SubContent>
          </props.Menu.Portal>
        </props.Menu.Sub>
      </Show>
      <Show when={props.onMove && !props.isArchived && (props.folders?.length ?? 0) > 0}>
        <For each={(props.folders ?? []).filter((folder) => folder.id !== currentFolder())}>
          {(folder) => (
            <props.Menu.Item onSelectAfterClose={() => props.onMove?.(props.row, folder.id)}>
              <FolderInput class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("quick.folder.moveTo", { name: folder.name })}</span>
            </props.Menu.Item>
          )}
        </For>
        <Show when={currentFolder()}>
          <props.Menu.Item onSelectAfterClose={() => props.onMove?.(props.row, null)}>
            <X class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("quick.folder.remove")}</span>
          </props.Menu.Item>
        </Show>
      </Show>
      <Show when={props.onDelete}>
        {(onDelete) => (
          <props.Menu.Item onSelectAfterClose={() => onDelete()(props.row)}>
            <Trash2 class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("common.delete")}</span>
          </props.Menu.Item>
        )}
      </Show>
    </>
  );
}

/**
 * One conversation: the row that opens it, the menu of its actions ("⋯" or right click), and two
 * buttons (tag, archive) that a swipe to the left shows under the row.
 */
function QuickChatItem(props: ItemProps) {
  const { t, format } = useText();
  const swipe = createRowSwipe();
  const selected = () => (props.row.key === props.selectedKey ? "true" : undefined);
  const tag = () => tagOf(props.tags, props.tagAssignments, props.row.key);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag and drop is a mouse shortcut; the row menu moves rows with the keyboard.
    <div
      class="quick-list-item"
      ref={swipe.ref}
      data-archived={props.isArchived ? "" : undefined}
      data-swipe-open={swipe.open() ? "" : undefined}
      style={{ "--quick-swipe-reveal": `${SWIPE_REVEAL}px` }}
      draggable={props.onMove && !props.isArchived ? "true" : undefined}
      onDragStart={(event) => {
        if (swipe.swiping()) {
          event.preventDefault();
          return;
        }
        event.dataTransfer?.setData(DRAG_TYPE, props.row.key);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      }}
    >
      {/* Under the row, out of the tab order until the swipe shows them: the row menu is the keyboard route. */}
      <div
        class="quick-list-swipe-actions"
        data-dragging={swipe.dragging() ? "" : undefined}
        style={{ opacity: String(Math.min(1, Math.max(0, -swipe.offset() / SWIPE_REVEAL))) }}
        inert={swipe.open() ? undefined : true}
      >
        <Show when={props.onSetTag && !props.isArchived}>
          <DropdownMenu.Root placement="bottom-end" gutter={4}>
            <DropdownMenu.Trigger
              class={buttonVariants({ variant: "ghost", class: "quick-list-swipe-button" })}
              aria-label={t("quick.tag.menu")}
            >
              <Tag aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="agent-context-menu">
                <TagItems {...props} Menu={DropdownMenu} />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </Show>
        <Button
          variant="ghost"
          type="button"
          class="quick-list-swipe-button"
          aria-label={t(props.isArchived ? "conversation.threads.restore" : "conversation.threads.archive")}
          onClick={() => (props.isArchived ? props.onRestore(props.row) : props.onArchive(props.row))}
        >
          <Show when={props.isArchived} fallback={<Archive aria-hidden="true" />}>
            <ArchiveRestore aria-hidden="true" />
          </Show>
        </Button>
      </div>
      <ContextMenu.Root modal={false}>
        <ContextMenu.Trigger
          as="div"
          class="quick-list-slide"
          data-dragging={swipe.dragging() ? "" : undefined}
          style={{ transform: `translateX(${swipe.offset()}px)` }}
          onPointerDown={swipe.onPointerDown}
          onPointerMove={swipe.onPointerMove}
          onPointerUp={swipe.onPointerEnd}
          onPointerCancel={swipe.onPointerEnd}
          onWheel={swipe.onWheel}
        >
          <Button
            variant="ghost"
            type="button"
            class="quick-list-row"
            aria-current={selected()}
            onClick={() => (swipe.open() ? swipe.close() : props.onSelect(props.row))}
          >
            <span class="quick-list-line">
              <ThreadTitle class="quick-list-title" title={props.row.title} />
              <Show when={props.row.status.kind === "queued"} fallback={<ThreadStatusMark status={props.row.status} />}>
                <span class="quick-list-queued">{t("quick.list.queued")}</span>
              </Show>
              <span class="quick-list-time">{sidebarMessageTime(props.row.updatedAt, format)}</span>
            </span>
            <RowPreview row={props.row} tag={tag()} />
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
                <RowMenuItems {...props} Menu={DropdownMenu} />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content class="agent-context-menu">
            <RowMenuItems {...props} Menu={ContextMenu} />
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </div>
  );
}

/** The name and the color of a tag: a new tag for a row, or a change to a tag that exists. */
function TagDialog(props: {
  target: TagDialogTarget | null;
  onClose: () => void;
  onCreate?: ((row: QuickChatRow, name: string, color: string) => void) | undefined;
  onEdit?: ((tag: QuickChatTag, name: string, color: string) => void) | undefined;
  onDelete?: ((tag: QuickChatTag) => void) | undefined;
}) {
  let input: HTMLInputElement | undefined;
  return (
    <Dialog.Root
      open={props.target !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="ui-confirm-dialog-overlay">
          <Dialog.Content
            as="section"
            class="ui-dialog-content quick-tag-dialog"
            onOpenAutoFocus={(event: Event) => {
              event.preventDefault();
              input?.focus();
              input?.select();
            }}
          >
            {/* Keyed by target: each open starts from the saved tag. */}
            <Show when={props.target} keyed>
              {(target) => (
                <TagForm
                  target={target}
                  setInput={(element) => {
                    input = element;
                  }}
                  onClose={props.onClose}
                  onCreate={props.onCreate}
                  onEdit={props.onEdit}
                  onDelete={props.onDelete}
                />
              )}
            </Show>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TagForm(props: {
  target: TagDialogTarget;
  setInput: (element: HTMLInputElement) => void;
  onClose: () => void;
  onCreate?: ((row: QuickChatRow, name: string, color: string) => void) | undefined;
  onEdit?: ((tag: QuickChatTag, name: string, color: string) => void) | undefined;
  onDelete?: ((tag: QuickChatTag) => void) | undefined;
}) {
  const { t } = useText();
  const target = props.target;
  const edited = target.kind === "edit" ? target.tag : undefined;
  const [name, setName] = createSignal(edited?.name ?? "");
  const [color, setColor] = createSignal(edited?.color ?? SIDEBAR_SECTION_COLOR_PRESETS[6]?.color ?? "#3b82f6");
  const save = () => {
    const clean = name().trim();
    if (!clean) return;
    if (target.kind === "edit") props.onEdit?.(target.tag, clean, color());
    else props.onCreate?.(target.row, clean, color());
    props.onClose();
  };
  return (
    <form
      class="quick-tag-form"
      novalidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <header class="quick-tag-header">
        <Dialog.Title as="h2" class="quick-tag-title">
          {t(edited ? "quick.tag.dialog.edit" : "quick.tag.dialog.new")}
        </Dialog.Title>
        <IconButton label={t("common.close")} variant="ghost" onClick={props.onClose}>
          <X />
        </IconButton>
      </header>
      <Field label={t("quick.tag.name")}>
        <Input
          ref={props.setInput}
          value={name()}
          maxlength={MAX_TAG_NAME}
          autocomplete="off"
          onValueChange={setName}
        />
      </Field>
      <fieldset class="quick-tag-colors" aria-label={t("quick.tag.color")}>
        <For each={SIDEBAR_SECTION_COLOR_PRESETS}>
          {(preset) => (
            <Button
              type="button"
              variant="ghost"
              class="quick-tag-color"
              aria-pressed={color() === preset.color ? "true" : "false"}
              aria-label={t(preset.label)}
              title={t(preset.label)}
              style={{ background: preset.color }}
              onClick={() => setColor(preset.color)}
            >
              <Show when={color() === preset.color}>
                <Check aria-hidden="true" />
              </Show>
            </Button>
          )}
        </For>
      </fieldset>
      <footer class="quick-tag-footer">
        <Show when={edited}>
          {(tag) => (
            <Button
              type="button"
              variant="ghost"
              class="quick-tag-delete"
              onClick={() => {
                props.onDelete?.(tag());
                props.onClose();
              }}
            >
              {t("quick.tag.delete")}
            </Button>
          )}
        </Show>
        <Button type="button" variant="ghost" onClick={props.onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={name().trim() === ""}>
          {t(edited ? "common.save" : "common.create")}
        </Button>
      </footer>
    </form>
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
  // The day of "now" is read when the rows change, so no timer runs while the list is idle.
  const searching = () => query().trim() !== "";
  const [filter, setFilter] = createSignal<QuickChatFilter>("all");
  const [creating, setCreating] = createSignal(false);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [closed, setClosed] = createSignal<ReadonlySet<string>>(new Set());
  const [dropOver, setDropOver] = createSignal<string | null>(null);
  const [tagDialog, setTagDialog] = createSignal<TagDialogTarget | null>(null);
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
      <div class="quick-list-searchbar">
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
        <DropdownMenu.Root placement="bottom-end" gutter={4}>
          <DropdownMenu.Trigger
            class={buttonVariants({ variant: "ghost", size: "icon-sm", class: "quick-list-filter-menu" })}
            data-active={filter() === "all" ? undefined : ""}
            aria-label={t("quick.list.filter.label")}
            title={t("quick.list.filter.label")}
          >
            <SlidersHorizontal aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="agent-context-menu">
              <DropdownMenu.RadioGroup
                value={filter()}
                onChange={(value: string) => setFilter(QUICK_CHAT_FILTERS.find((id) => id === value) ?? "all")}
              >
                <For each={QUICK_CHAT_FILTERS}>
                  {(id) => (
                    <DropdownMenu.RadioItem value={id}>
                      <span>{t(FILTER_TEXT[id])}</span>
                      <Show when={filter() === id}>
                        <Check class="quick-tag-check size-4" aria-hidden="true" />
                      </Show>
                    </DropdownMenu.RadioItem>
                  )}
                </For>
              </DropdownMenu.RadioGroup>
              <Show when={foldersEnabled()}>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  onSelectAfterClose={() => {
                    setFilter("all");
                    setCreating(true);
                  }}
                >
                  <FolderPlus class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("quick.folder.new")}</span>
                </DropdownMenu.Item>
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <Show when={filter() !== "all"}>
        <div class="quick-list-active-filter">
          <span class="quick-list-filter-chip">
            {t(FILTER_TEXT[filter()])}
            <IconButton
              label={t("quick.list.filter.clear")}
              variant="ghost"
              size="icon-xs"
              class="quick-list-filter-chip-clear"
              onClick={() => setFilter("all")}
            >
              <X aria-hidden="true" />
            </IconButton>
          </span>
        </div>
      </Show>
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
                              aria-label={t("quick.folder.actions", { name: folder.name })}
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
                          {(row) => <QuickChatItem {...props} row={row()} onTagDialog={setTagDialog} />}
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
                      {(row) => <QuickChatItem {...props} row={row()} onTagDialog={setTagDialog} />}
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
                {(row) => <QuickChatItem {...props} row={row()} onTagDialog={setTagDialog} />}
              </For>
            </section>
          </Show>
          <Show
            when={props.archived.length === 0 && (filter() === "all" ? rows().length === 0 : filtered().length === 0)}
          >
            <p class="quick-list-empty">{t(searching() ? "quick.list.noResults" : "quick.list.empty")}</p>
          </Show>
          <Show when={props.archived.length > 0}>
            <section class="quick-list-group">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class="quick-list-archived-toggle"
                aria-haspopup="dialog"
                onClick={() => setArchivedOpen(true)}
              >
                <Archive class="quick-list-chevron" aria-hidden="true" />
                {t("quick.list.archived")}
                <span class="quick-list-count">{props.archived.length}</span>
              </Button>
            </section>
          </Show>
        </Show>
      </div>
      <TagDialog
        target={tagDialog()}
        onClose={() => setTagDialog(null)}
        onCreate={props.onCreateTag}
        onEdit={props.onEditTag}
        onDelete={props.onDeleteTag}
      />
      <QuickChatArchivedDialog
        open={archivedOpen()}
        onClose={() => setArchivedOpen(false)}
        rows={props.archived}
        selectedKey={props.selectedKey}
        onSelect={(row) => {
          setArchivedOpen(false);
          props.onSelect(row);
        }}
        onRestoreMany={props.onRestoreMany}
        onDeleteMany={props.onDeleteMany}
      />
    </nav>
  );
}
