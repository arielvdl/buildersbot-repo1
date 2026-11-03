import {
  Archive,
  ArchiveRestore,
  Button,
  buttonVariants,
  ChevronRight,
  DropdownMenu,
  Ellipsis,
  Input,
  MessageCirclePlus,
  Search,
  Skeleton,
  Trash2,
  Zap,
} from "@buildersbot/ui";
import { chatPreviewLine } from "@buildersbot/ui/features/conversation/threads/thread-preview-text";
import { sidebarMessageTime } from "@buildersbot/ui/features/sidebar/sidebar-filtering";
import { useText } from "@buildersbot/ui/text";
import { createMemo, createSignal, For, Show } from "solid-js";
import { ThreadStatusMark } from "../conversation/threads/ThreadStatusMark";
import { ThreadTitle } from "../conversation/threads/ThreadTitle";
import { filterQuickChatRows, groupByDay, type QuickChatGroupId, type QuickChatRow } from "./quick-chat-groups";

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
}

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
  const { t, format } = useText();
  const selected = () => (props.row.key === props.selectedKey ? "true" : undefined);
  return (
    <div class="quick-list-item" data-archived={props.isArchived ? "" : undefined}>
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
  const groups = createMemo(() => groupByDay(rows(), new Date()));
  const searching = () => query().trim() !== "";
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
      <div class="quick-list-scroll">
        <Show
          when={!props.loading}
          fallback={
            <div class="quick-list-loading" role="status" aria-label={t("quick.list.loading")}>
              <For each={[0, 1, 2, 3]}>{() => <Skeleton class="quick-list-skeleton" />}</For>
            </div>
          }
        >
          <For each={groups()} keyed={(group) => group.id}>
            {(group) => (
              <section class="quick-list-group" aria-label={t(GROUP_TEXT[group().id])}>
                <h3 class="quick-list-group-title">{t(GROUP_TEXT[group().id])}</h3>
                <For each={group().items} keyed={(row) => row.key}>
                  {(row) => <QuickChatItem {...props} row={row()} />}
                </For>
              </section>
            )}
          </For>
          <Show when={groups().length === 0 && archived().length === 0}>
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
