import type { CentralAuthUser } from "@buildersbot/contracts/ipc";
import { Button, Skeleton, toast, Zap } from "@buildersbot/ui";
import { MAIN_THREAD_ID, type ThreadItem } from "@buildersbot/ui/features/conversation/threads/thread-types";
import { QuickChatList } from "@buildersbot/ui/features/quick-chat/QuickChatList";
import { type QuickChatRow, quickChatRowKey } from "@buildersbot/ui/features/quick-chat/quick-chat-groups";
import { useText } from "@buildersbot/ui/text";
import { createEffect, createMemo, Match, onCleanup, onSettled, Show, Switch } from "solid-js";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { useConversationThreads } from "../conversation/use-conversation-threads";
import { WorkspaceConversation } from "../conversation/WorkspaceConversation";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { quickChatPort } from "./quick-chat-port";
import { createQuickChat } from "./quick-chat-state";

/** The message box of the open conversation. A new conversation has the focus, so the person types at once. */
function focusComposer(root: HTMLElement | undefined): void {
  root?.querySelector<HTMLElement>('.composer-editor-surface[role="textbox"]')?.focus();
}

/**
 * The Quick chat page in the middle pane: the list of conversations, and the chat of one agent that
 * the page opens on its first call. Each conversation is a thread of that agent. A new conversation
 * has no message yet: its first message starts it, and until then nothing is saved.
 */
export function QuickChatPage(props: { account: () => CentralAuthUser }) {
  const { t, sourceText } = useText();
  const tasks = useAgentTasks();
  const tabs = useAgentThreads();
  const { activeServer } = useServers();
  const { openServerSettings } = useServerSettings();
  const quick = createQuickChat({
    port: quickChatPort,
    tasks,
    tabs,
    agentName: () => t("quick.list.title"),
    noProviderMessage: () => sourceText("error.provider.noneReady"),
    onModelChanged: () => toast(t("quick.notice.modelChanged")),
  });
  const threads = useConversationThreads(quick.agent);
  let chat: HTMLDivElement | undefined;

  onSettled(() => void quick.open());
  onCleanup(quick.close);

  const agentId = () => quick.agent()?.id;
  const owner = () => ({ name: t("quick.owner.name"), quick: true });
  const row = (item: ThreadItem): QuickChatRow => ({
    key: quickChatRowKey(agentId() ?? "", item.id),
    agentId: agentId() ?? "",
    taskId: item.id,
    title: item.title,
    firstMessage: item.firstMessage,
    preview: item.preview,
    updatedAt: item.updatedAt,
    status: item.status,
    owner: owner(),
  });
  const rows = createMemo(() => (threads()?.header.threads ?? []).map(row));
  const archived = createMemo(() => (threads()?.header.archived ?? []).map(row));
  const open = () => threads()?.open;
  const selectedKey = () => {
    const item = open();
    return item ? quickChatRowKey(agentId() ?? "", item.id) : null;
  };

  // The Quick chat has no chat of its own for the agent, so a closed or deleted conversation opens a
  // new one, and the page never shows an empty pane.
  createEffect(
    () => ({ id: agentId(), active: threads()?.header.activeId, ready: quick.phase() === "ready" }),
    ({ id, active, ready }) => {
      if (ready && id && active === MAIN_THREAD_ID) tabs.startNew(id);
    },
  );
  // A conversation that is left stops using memory: it reads its messages again when it opens.
  createEffect(
    () => open()?.id,
    (next, previous) => {
      if (previous && previous !== next) tasks.forgetConversation(previous);
    },
  );
  // Each conversation that opens has the focus in its message box.
  createEffect(
    () => ({ key: selectedKey(), ready: quick.phase() === "ready" }),
    ({ ready }) => {
      if (ready) requestAnimationFrame(() => focusComposer(chat));
    },
  );

  const subject = {
    agent: quick.agent,
    updateAgent: quick.updateAgent,
    quickChat: {
      title: (
        <span class="quick-header-title">
          <Zap class="quick-header-bolt" aria-hidden="true" />
          <h1>{t("quick.list.title")}</h1>
          <span class="quick-header-sub">{open()?.title ?? t("quick.header.new")}</span>
        </span>
      ),
    },
  };

  return (
    <section class="quick-page" aria-label={t("quick.page.label")}>
      <Switch>
        <Match when={quick.phase() === "no-provider"}>
          <div class="quick-page-state">
            <Zap class="quick-page-bolt" aria-hidden="true" />
            <h2 class="quick-page-title">{t("quick.signIn.title")}</h2>
            <Button
              type="button"
              onClick={(event) => {
                const server = activeServer();
                if (server) openServerSettings(server.id, event.currentTarget, "providers");
              }}
            >
              {t("quick.signIn.action")}
            </Button>
          </div>
        </Match>
        <Match when={quick.phase() === "failed"}>
          <div class="quick-page-state">
            <Zap class="quick-page-bolt" aria-hidden="true" />
            <h2 class="quick-page-title">{t("quick.error.title")}</h2>
            <Button type="button" onClick={() => void quick.open()}>
              {t("quick.error.retry")}
            </Button>
          </div>
        </Match>
        <Match when={true}>
          <QuickChatList
            rows={rows()}
            archived={archived()}
            selectedKey={selectedKey()}
            loading={quick.phase() === "loading"}
            onSelect={(item) => tabs.open(item.agentId, item.taskId)}
            onNew={() => {
              const id = agentId();
              if (id) tabs.startNew(id);
            }}
            onArchive={(item) => void tabs.archive(item.agentId, item.taskId)}
            onRestore={(item) => void tabs.restore(item.agentId, item.taskId)}
            onDelete={tasks.editable() ? (item) => void tabs.remove(item.agentId, item.taskId) : undefined}
          />
          <div class="quick-page-chat" ref={(element: HTMLDivElement) => (chat = element)}>
            {/* A new conversation has no message to show, so the page says what it is for. */}
            <Show when={quick.phase() === "ready" && open() === null}>
              <div class="quick-page-welcome" aria-hidden="true">
                <Zap class="quick-page-bolt" />
                <h2 class="quick-page-title">{t("quick.empty.title")}</h2>
              </div>
            </Show>
            <Show
              when={quick.phase() === "ready"}
              fallback={<Skeleton class="quick-page-skeleton" role="status" aria-label={t("quick.page.loading")} />}
            >
              <WorkspaceConversation account={props.account} subject={subject} />
            </Show>
          </div>
        </Match>
      </Switch>
    </section>
  );
}
