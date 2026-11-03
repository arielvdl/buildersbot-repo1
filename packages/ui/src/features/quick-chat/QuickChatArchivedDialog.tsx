import {
  ArchiveRestore,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  IconButton,
  Input,
  Search,
  Trash2,
  X,
  Zap,
} from "@buildersbot/ui";
import { AgentAvatar } from "@buildersbot/ui/features/agents/AgentAvatar";
import { chatPreviewLine } from "@buildersbot/ui/features/conversation/threads/thread-preview-text";
import { sidebarMessageTime } from "@buildersbot/ui/features/sidebar/sidebar-filtering";
import { useText } from "@buildersbot/ui/text";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { ThreadTitle } from "../conversation/threads/ThreadTitle";
import { filterQuickChatRows, type QuickChatRow } from "./quick-chat-groups";

/** How many rows the dialog draws at once. The list grows by one page each time that "Show more" is used. */
const PAGE_SIZE = 40;

export interface QuickChatArchivedDialogProps {
  open: boolean;
  onClose: () => void;
  /** The archived conversations, newest first. */
  rows: readonly QuickChatRow[];
  /** The key of the open conversation. */
  selectedKey: string | null;
  /** Opens one conversation and closes the dialog. */
  onSelect: (row: QuickChatRow) => void;
  /** Restores each row. The promise settles when the last row is done. */
  onRestoreMany: (rows: readonly QuickChatRow[]) => Promise<void>;
  /** Missing where the host cannot delete a thread: the delete buttons then do not show. */
  onDeleteMany?: ((rows: readonly QuickChatRow[]) => Promise<void>) | undefined;
}

/** The second line of a row: who answered, then the last message of the person. */
function ArchivedPreview(props: { row: QuickChatRow }) {
  const line = () => chatPreviewLine(props.row.preview || props.row.firstMessage);
  return (
    <Show when={line()}>
      {(text) => (
        <span class="quick-archived-preview">
          <Show when={props.row.owner.agent} fallback={<Zap class="quick-list-owner-mark" aria-hidden="true" />}>
            {(agent) => <AgentAvatar class="quick-list-owner-mark" agent={agent()} animated={false} />}
          </Show>
          <span class="quick-list-owner">{props.row.owner.name}</span> {text()}
        </span>
      )}
    </Show>
  );
}

/**
 * The archived conversations of the Quick chat in a dialog: search, a page of rows at a time, and one
 * selection for restore and delete in bulk. The list of the page does not draw archived rows, so a long
 * archive does not slow it down.
 */
export function QuickChatArchivedDialog(props: QuickChatArchivedDialogProps) {
  const { t, format } = useText();
  const allId = createUniqueId();
  const [query, setQuery] = createSignal("");
  const [shown, setShown] = createSignal(PAGE_SIZE);
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set<string>());
  /** The rows that the open confirmation would delete. It keeps them, so the count stays while the delete runs. */
  const [toDelete, setToDelete] = createSignal<readonly QuickChatRow[]>([]);
  const [busy, setBusy] = createSignal(false);
  const found = createMemo(() => filterQuickChatRows(props.rows, query()));
  const visible = createMemo(() => found().slice(0, shown()));
  /** Only rows that still exist count: a restored or deleted row leaves the selection by itself. */
  const chosen = createMemo(() => found().filter((row) => selected().has(row.key)));
  const allChosen = () => found().length > 0 && chosen().length === found().length;
  const someChosen = () => chosen().length > 0;

  const toggle = (key: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const toggleAll = (on: boolean) => setSelected(on ? new Set(found().map((row) => row.key)) : new Set<string>());
  const search = (value: string) => {
    setQuery(value);
    setShown(PAGE_SIZE);
    setSelected(new Set<string>());
  };
  const reset = () => {
    setQuery("");
    setShown(PAGE_SIZE);
    setSelected(new Set<string>());
    setToDelete([]);
  };
  async function run(action: (rows: readonly QuickChatRow[]) => Promise<void>, rows: readonly QuickChatRow[]) {
    if (busy() || rows.length === 0) return;
    setBusy(true);
    try {
      await action(rows);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog.Root
        open={props.open}
        onOpenChange={(open) => {
          if (open) return;
          reset();
          props.onClose();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay>
            <Dialog.Content as="section" class="quick-archived-dialog">
              <header class="quick-archived-header">
                <Dialog.Title as="h2" class="quick-archived-title">
                  {t("quick.list.archived")}
                  <span class="quick-list-count">{props.rows.length}</span>
                </Dialog.Title>
                <IconButton label={t("common.close")} variant="ghost" onClick={props.onClose}>
                  <X />
                </IconButton>
              </header>
              <div class="quick-list-search">
                <Search class="quick-list-search-icon" aria-hidden="true" />
                <Input
                  type="search"
                  size="sm"
                  value={query()}
                  onInput={(event) => search(event.currentTarget.value)}
                  placeholder={t("quick.list.search")}
                  aria-label={t("quick.list.search")}
                />
              </div>
              <div class="quick-archived-toolbar">
                <label class="quick-archived-all" for={allId}>
                  <Checkbox
                    id={allId}
                    checked={allChosen()}
                    disabled={found().length === 0 || busy()}
                    aria-label={t("quick.archived.selectAll")}
                    onChange={(event) => toggleAll(event.currentTarget.checked)}
                  />
                  <span>
                    {someChosen()
                      ? t("quick.archived.selected", { count: chosen().length })
                      : t("quick.archived.selectAll")}
                  </span>
                </label>
                <Show when={someChosen()}>
                  <div class="quick-archived-bulk">
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={busy()}
                      onClick={() => void run(props.onRestoreMany, chosen())}
                    >
                      <ArchiveRestore aria-hidden="true" />
                      {t("conversation.threads.restore")}
                    </Button>
                    <Show when={props.onDeleteMany}>
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        class="quick-archived-delete"
                        disabled={busy()}
                        onClick={() => setToDelete(chosen())}
                      >
                        <Trash2 aria-hidden="true" />
                        {t("common.delete")}
                      </Button>
                    </Show>
                  </div>
                </Show>
              </div>
              <div class="quick-archived-scroll">
                <Show
                  when={found().length > 0}
                  fallback={
                    <p class="quick-list-empty">
                      {t(query().trim() === "" ? "quick.archived.empty" : "quick.list.noResults")}
                    </p>
                  }
                >
                  <ul class="quick-archived-list">
                    <For each={visible()} keyed={(row) => row.key}>
                      {(row) => (
                        <li class="quick-archived-row" data-selected={selected().has(row().key) ? "" : undefined}>
                          <Checkbox
                            checked={selected().has(row().key)}
                            disabled={busy()}
                            aria-label={t("quick.archived.select", { title: row().title })}
                            onChange={(event) => toggle(row().key, event.currentTarget.checked)}
                          />
                          <Button
                            variant="ghost"
                            type="button"
                            class="quick-archived-open"
                            aria-current={row().key === props.selectedKey ? "true" : undefined}
                            onClick={() => props.onSelect(row())}
                          >
                            <span class="quick-list-line">
                              <ThreadTitle class="quick-list-title" title={row().title} />
                              <span class="quick-archived-time">{sidebarMessageTime(row().updatedAt, format)}</span>
                            </span>
                            <ArchivedPreview row={row()} />
                          </Button>
                          <IconButton
                            label={t("conversation.threads.restore")}
                            variant="ghost"
                            disabled={busy()}
                            onClick={() => void run(props.onRestoreMany, [row()])}
                          >
                            <ArchiveRestore />
                          </IconButton>
                        </li>
                      )}
                    </For>
                  </ul>
                  <footer class="quick-archived-more">
                    <span class="quick-list-count" role="status">
                      {t("quick.archived.showing", { shown: visible().length, total: found().length })}
                    </span>
                    <Show when={visible().length < found().length}>
                      <Button variant="ghost" size="sm" type="button" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                        {t("quick.archived.more")}
                      </Button>
                    </Show>
                  </footer>
                </Show>
              </div>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmDialog
        open={toDelete().length > 0}
        onCancel={() => setToDelete([])}
        title={t("quick.archived.deleteTitle", { count: toDelete().length })}
        description={t("quick.archived.deleteDescription")}
        confirmLabel={t("common.delete")}
        pendingLabel={t("quick.archived.deleting")}
        onConfirm={async () => {
          const { onDeleteMany } = props;
          if (onDeleteMany) await run(onDeleteMany, toDelete());
          setToDelete([]);
        }}
      />
    </>
  );
}
