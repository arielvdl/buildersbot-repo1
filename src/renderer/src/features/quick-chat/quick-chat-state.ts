import type { ClientAgentSummary, UpdateAgentInput } from "@buildersbot/contracts/ipc";
import type { AgentProfile } from "@buildersbot/ui/data";
import { createSignal, createStore } from "solid-js";
import { toAgentProfile } from "../../app-message-projection";
import { createStoredProfile, updateStored } from "../../app-stored-values";
import { createScopeGuard } from "../../scope-lifetime";
import type { AgentTasks } from "../agent-tasks/agent-tasks-state";
import type { AgentThreadTabsState } from "../agent-threads/agent-thread-tabs";
import { setQuickChatAgentId } from "./quick-chat-agent";
import type { QuickChatPort } from "./quick-chat-port";

/** The page has not asked yet, waits for the agent, has it, or cannot have it. */
export type QuickChatPhase = "loading" | "ready" | "no-provider" | "failed";

/** A person who opened the Quick chat before sees a notice when its model changes by itself. */
const SEEN_KEY = "buildersbot.quickChat.seen";

export interface QuickChatOptions {
  port: () => QuickChatPort;
  tasks: AgentTasks;
  tabs: AgentThreadTabsState;
  /** The source text of the answer when no provider can run. */
  noProviderMessage: () => string;
  /** The name of the agent in the language of the person. The agent keeps its source name in the host. */
  agentName: () => string;
  /** Tells the person that the model of the Quick chat changed by itself. */
  onModelChanged: () => void;
}

function wasSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Blocked storage only means a later notice may show once more.
  }
}

/**
 * The state of the Quick chat page: its agent and its phase. Make it in the page, so a closed page
 * holds nothing. The agent is in no roster, so the page reads it from `ensure` and from the answer of
 * each update, never from the agents context.
 */
export function createQuickChat(options: QuickChatOptions) {
  const { tasks, tabs } = options;
  const scopeIsCurrent = createScopeGuard();
  const [state, setState] = createStore<{ phase: QuickChatPhase }>({ phase: "loading" });
  const [agent, setAgent] = createSignal<AgentProfile | undefined>(undefined);
  /** Counts the calls to `open`, so an answer that arrives after a newer call changes nothing. */
  let generation = 0;

  function keep(summary: ClientAgentSummary): AgentProfile {
    const next = { ...toAgentProfile(summary), name: options.agentName() };
    const current = agent();
    if (current && current.id === next.id) {
      updateStored(current, next);
      return current;
    }
    const stored = createStoredProfile(next);
    setAgent(stored);
    return stored;
  }

  /** Makes sure the agent exists, reads its threads, and opens a new conversation. */
  async function open(): Promise<void> {
    const own = ++generation;
    setState((draft) => {
      draft.phase = "loading";
    });
    try {
      const result = await options.port().ensure();
      if (!scopeIsCurrent() || own !== generation) return;
      const profile = keep(result.agent);
      setQuickChatAgentId(profile.id);
      // The list is read before the first message, so the new conversation shows at its top.
      await tasks.loadTasks(profile.id);
      if (!scopeIsCurrent() || own !== generation) return;
      tabs.startNew(profile.id);
      if (result.changed && wasSeen()) options.onModelChanged();
      markSeen();
      setState((draft) => {
        draft.phase = "ready";
      });
    } catch (error) {
      if (!scopeIsCurrent() || own !== generation) return;
      const noProvider = error instanceof Error && error.message === options.noProviderMessage();
      setState((draft) => {
        draft.phase = noProvider ? "no-provider" : "failed";
      });
    }
  }

  /**
   * Saves a change of the agent, such as its model, and keeps the answer. It does not go through the
   * agents context: that one adds an agent to the roster.
   */
  async function updateAgent(agentId: string, updates: Omit<UpdateAgentInput, "agentId">): Promise<void> {
    const stored = await options.port().updateAgent({ agentId, ...updates });
    if (scopeIsCurrent()) keep(stored);
  }

  /**
   * Reads the agent again, with no new conversation. The agent is in no roster and no event names it, so
   * a change that the host makes by itself, such as a queued model that applies before the next turn,
   * shows only here. An answer that arrives after the page closed, or for another agent, changes nothing.
   */
  async function refresh(): Promise<void> {
    const id = agent()?.id;
    if (!id) return;
    try {
      const result = await options.port().ensure();
      if (scopeIsCurrent() && result.agent.id === id) keep(result.agent);
    } catch {
      // The page keeps what it has; the next change reads again.
    }
  }

  /** The page is closing: the thread state stops reading the agent. */
  function close(): void {
    generation += 1;
    setQuickChatAgentId(undefined);
  }

  return { phase: () => state.phase, agent, open, updateAgent, refresh, close };
}
