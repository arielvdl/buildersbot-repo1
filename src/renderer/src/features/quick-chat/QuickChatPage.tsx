import type { CentralAuthUser, UpdateAgentInput } from "@buildersbot/contracts/ipc";
import { Button, Skeleton, toast, Zap } from "@buildersbot/ui";
import type { AgentProfile } from "@buildersbot/ui/data";
import { MAIN_THREAD_ID, type ThreadItem } from "@buildersbot/ui/features/conversation/threads/thread-types";
import { QuickChatList } from "@buildersbot/ui/features/quick-chat/QuickChatList";
import {
  type QuickChatOwner,
  type QuickChatRow,
  quickChatRowKey,
} from "@buildersbot/ui/features/quick-chat/quick-chat-groups";
import { useText } from "@buildersbot/ui/text";
import { createEffect, createMemo, createSignal, Match, onCleanup, onSettled, Show, Switch, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { useAgents } from "../agents/agents-context";
import { useConversationThreadsOf } from "../conversation/use-conversation-threads";
import { WorkspaceConversation } from "../conversation/WorkspaceConversation";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { calledAgent } from "./quick-chat-address";
import {
  addQuickChatPointer,
  pruneQuickChatPointers,
  type QuickChatPointer,
  readQuickChatPointers,
} from "./quick-chat-pointers";
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
  const { activeServer, activeServerId } = useServers();
  const { openServerSettings } = useServerSettings();
  const quick = createQuickChat({
    port: quickChatPort,
    tasks,
    tabs,
    agentName: () => t("quick.list.title"),
    noProviderMessage: () => sourceText("error.provider.noneReady"),
    onModelChanged: () => toast(t("quick.notice.modelChanged")),
  });
  const { agentList, agentListSettled, agentStatus, userHiddenAgentIds, updateAgent: updateRosterAgent } = useAgents();
  const buildThreads = useConversationThreadsOf();
  let chat: HTMLDivElement | undefined;

  onSettled(() => void quick.open());
  // Right after the app starts, no provider has read its model list yet, so the first open can find none.
  // A new provider status asks again; the phase is read untracked, so the retry starts no loop.
  createEffect(
    () => agentStatus(),
    () => {
      if (untrack(quick.phase) === "no-provider") void quick.open();
    },
  );
  // The first key in the message box starts the provider, so it is ready when the person sends. It is asked
  // once for each time the page opens, with no wait, and a failure changes nothing: the first send starts it.
  let warmed = false;
  const warmOnFirstKey = (event: KeyboardEvent) => {
    if (warmed || !(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "textbox") return;
    warmed = true;
    void Promise.resolve(quickChatPort().warm()).catch(() => undefined);
  };
  onCleanup(quick.close);

  const agentId = () => quick.agent()?.id;
  /** The agents that a message can call: the ones that the person sees. The Quick chat agent is in no list. */
  const mentionable = () => agentList().filter((agent) => !userHiddenAgentIds().has(agent.id));

  /** The conversation of an agent that a message called, when one is open. Absent: the Quick chat agent's. */
  const [called, setCalled] = createSignal<QuickChatPointer | null>(null);
  const [pointers, setPointers] = createSignal<QuickChatPointer[]>(readQuickChatPointers(activeServerId()));
  /** The agent that owns the open conversation. */
  const owner = createMemo(() => {
    const open = called();
    return open ? agentList().find((agent) => agent.id === open.agentId) : quick.agent();
  });

  /** A message that opens with an @ tag starts its conversation in that agent. Any other message starts it here. */
  async function sendDraft(text: string, files: string[]): Promise<boolean> {
    const id = agentId();
    if (!id) return false;
    const call = calledAgent(text);
    if (!call) return tabs.sendDraft(id, text, files);
    const agent = mentionable().find((candidate) => candidate.id === call.agentId);
    if (!agent) {
      actionToast.error(t("quick.error.agentGone"));
      return false;
    }
    if (!call.text) return false;
    // The list of that agent has to be read for the new thread to show in it.
    if (!tasks.snapshot(agent.id)) await tasks.loadTasks(agent.id);
    const started = await tabs.startIn(agent.id, call.text, files);
    if (!started) return false;
    const pointer = { agentId: agent.id, taskId: started.id };
    setPointers(addQuickChatPointer(activeServerId(), pointer));
    tabs.open(agent.id, started.id);
    setCalled(pointer);
    return true;
  }

  const quickOwner: QuickChatOwner = { name: t("quick.owner.name"), quick: true };
  const rowsOf = (agent: AgentProfile, items: readonly ThreadItem[], keep: (id: string) => boolean): QuickChatRow[] =>
    items
      .filter((item) => keep(item.id))
      .map((item) => ({
        key: quickChatRowKey(agent.id, item.id),
        agentId: agent.id,
        taskId: item.id,
        title: item.title,
        firstMessage: item.firstMessage,
        preview: item.preview,
        updatedAt: item.updatedAt,
        status: item.status,
        owner: agent.id === agentId() ? quickOwner : { name: agent.name, quick: false, agent },
      }));
  /** The Quick chat's own conversations, and the ones that it started in other agents, newest first. */
  const lists = createMemo(() => {
    const own = quick.agent();
    const rows: QuickChatRow[] = [];
    const archived: QuickChatRow[] = [];
    if (own) {
      const threads = buildThreads(own);
      rows.push(...rowsOf(own, threads?.header.threads ?? [], () => true));
      archived.push(...rowsOf(own, threads?.header.archived ?? [], () => true));
    }
    const byAgent = new Map<string, Set<string>>();
    for (const pointer of pointers())
      byAgent.set(pointer.agentId, (byAgent.get(pointer.agentId) ?? new Set()).add(pointer.taskId));
    for (const [id, taskIds] of byAgent) {
      const agent = agentList().find((candidate) => candidate.id === id);
      const threads = agent ? buildThreads(agent) : undefined;
      if (!agent || !threads) continue;
      rows.push(...rowsOf(agent, threads.header.threads, (task) => taskIds.has(task)));
      archived.push(...rowsOf(agent, threads.header.archived, (task) => taskIds.has(task)));
    }
    const newest = (left: QuickChatRow, right: QuickChatRow) => right.updatedAt.localeCompare(left.updatedAt);
    return { rows: rows.sort(newest), archived: archived.sort(newest) };
  });
  const ownerThreads = createMemo(() => buildThreads(owner()));
  const open = () => ownerThreads()?.open;
  const selectedKey = () => {
    const item = open();
    const id = owner()?.id;
    return item && id ? quickChatRowKey(id, item.id) : null;
  };

  // The Quick chat has no chat of its own for an agent, so a closed or deleted conversation, or one of an
  // agent that is gone, opens a new conversation, and the page never shows an empty pane.
  createEffect(
    () => ({
      id: agentId(),
      ready: quick.phase() === "ready",
      gone: called() !== null && owner() === undefined,
      active: ownerThreads()?.header.activeId,
    }),
    ({ id, ready, gone, active }) => {
      if (!ready || !id) return;
      if (gone || active === MAIN_THREAD_ID) {
        setCalled(null);
        tabs.startNew(id);
      }
    },
  );
  // A conversation that is left stops using memory: it reads its messages again when it opens.
  createEffect(
    () => open()?.id,
    (next, previous) => {
      if (previous && previous !== next) tasks.forgetConversation(previous);
    },
  );
  // The lists of the agents that a message called are read once the page is ready, so their rows show.
  createEffect(
    () => quick.phase() === "ready",
    (ready) => {
      if (!ready) return;
      for (const id of new Set(untrack(pointers).map((pointer) => pointer.agentId))) void tasks.loadTasks(id);
    },
  );
  // A pointer of an agent that is gone, or of a thread that its agent no longer lists, is dropped.
  createEffect(
    () =>
      pointers().filter((pointer) => {
        const snapshot = tasks.snapshot(pointer.agentId);
        const missing = agentListSettled() && !agentList().some((agent) => agent.id === pointer.agentId);
        return missing || (snapshot !== undefined && !snapshot.tasks.some((task) => task.id === pointer.taskId));
      }),
    (stale) => {
      if (stale.length === 0) return;
      const drop = new Set(stale.map((pointer) => quickChatRowKey(pointer.agentId, pointer.taskId)));
      setPointers(
        pruneQuickChatPointers(
          activeServerId(),
          (pointer) => !drop.has(quickChatRowKey(pointer.agentId, pointer.taskId)),
        ),
      );
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
    agent: owner,
    // The Quick chat agent is in no roster, so its changes go through the page. Another agent's go the usual way.
    updateAgent: (id: string, updates: Omit<UpdateAgentInput, "agentId">) =>
      id === agentId() ? quick.updateAgent(id, updates) : updateRosterAgent(id, updates),
    sendDraft,
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
            rows={lists().rows}
            archived={lists().archived}
            selectedKey={selectedKey()}
            loading={quick.phase() === "loading"}
            onSelect={(item) => {
              setCalled(item.agentId === agentId() ? null : { agentId: item.agentId, taskId: item.taskId });
              tabs.open(item.agentId, item.taskId);
            }}
            onNew={() => {
              const id = agentId();
              if (!id) return;
              setCalled(null);
              tabs.startNew(id);
            }}
            onArchive={(item) => void tabs.archive(item.agentId, item.taskId)}
            onRestore={(item) => void tabs.restore(item.agentId, item.taskId)}
            onDelete={tasks.editable() ? (item) => void tabs.remove(item.agentId, item.taskId) : undefined}
          />
          <div
            class="quick-page-chat"
            ref={(element: HTMLDivElement) => {
              chat = element;
              element.addEventListener("keydown", warmOnFirstKey);
            }}
          >
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
