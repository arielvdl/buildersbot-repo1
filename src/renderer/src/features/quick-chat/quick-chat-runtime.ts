import { isKnownAgentProvider } from "@buildersbot/contracts/agent-providers";
import type { AgentSummary, AgentTask, QuickChatRuntime, UpdateAgentInput } from "@buildersbot/contracts/ipc";
import type { AgentProfile } from "@buildersbot/ui/data";
import { useText } from "@buildersbot/ui/text";
import { createMemo, createSignal } from "solid-js";
import { actionToast } from "../../action-toast";
import type { QuickChatPort } from "./quick-chat-port";

/** The fields of an agent update that change the model. Another field goes the usual way. */
const RUNTIME_FIELDS = ["provider", "model", "reasoningEffort", "fastMode", "providerAccountId"] as const;

export type QuickChatAgentUpdate = Omit<UpdateAgentInput, "agentId">;

export function touchesQuickChatRuntime(updates: QuickChatAgentUpdate): boolean {
  return RUNTIME_FIELDS.some((field) => field in updates);
}

/** The runtime that an agent profile holds. Absent when its provider is not one that a conversation can name. */
export function quickChatRuntimeOf(agent: AgentProfile): QuickChatRuntime | undefined {
  if (!isKnownAgentProvider(agent.provider)) return undefined;
  return {
    provider: agent.provider,
    model: agent.model,
    reasoningEffort: agent.reasoningEffort,
    ...(agent.fastMode === undefined ? {} : { fastMode: agent.fastMode }),
  };
}

function sameRuntime(left: QuickChatRuntime, right: QuickChatRuntime): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.reasoningEffort === right.reasoningEffort &&
    (left.fastMode ?? false) === (right.fastMode ?? false)
  );
}

/** The agent as the header shows it: with the model of the conversation in its place. */
export function withQuickChatRuntime(agent: AgentProfile, runtime: QuickChatRuntime): AgentProfile {
  return {
    ...agent,
    provider: runtime.provider,
    model: runtime.model,
    reasoningEffort: runtime.reasoningEffort ?? agent.reasoningEffort,
    fastMode: runtime.fastMode,
    pendingRuntime: undefined,
  };
}

export interface QuickChatRuntimeOptions {
  port: () => Pick<QuickChatPort, "setConversationRuntime">;
  /** The Quick chat agent. Its model is the default of a new conversation. */
  agent: () => AgentProfile | undefined;
  /** The open conversation of the Quick chat agent, null for a new one, undefined when another agent owns the page. */
  open: () => AgentTask | null | undefined;
  /** Keeps the agent that the answer carries. */
  adopt: (agent: AgentSummary) => void;
  /** Reads the list of conversations again, so the new model shows in it. */
  refreshTasks: (agentId: string) => void;
}

/**
 * The model of each Quick chat conversation. A conversation keeps its own model; a new one starts on the model
 * that the last conversation used, and an unsent choice is only a draft: nothing is saved until the first message.
 * The header reads a profile of the agent with the model of the open conversation in it, so it has no case of its own.
 */
export function createQuickChatRuntime(options: QuickChatRuntimeOptions) {
  const { t, errorMessage } = useText();
  /** A new conversation's choice, before its first message. */
  const [draft, setDraft] = createSignal<QuickChatRuntime | undefined>(undefined);
  /** The model last used by a conversation. It stands in for the agent's default until the agent is read again. */
  const [lastUsed, setLastUsed] = createSignal<QuickChatRuntime | undefined>(undefined);
  /** A choice that was sent and that the task list has not shown yet. */
  const [pending, setPending] = createSignal<{ taskId: string; runtime: QuickChatRuntime } | undefined>(undefined);

  /** The model that runs a conversation with no model of its own: the one of the agent. */
  const agentRuntime = createMemo<QuickChatRuntime | undefined>(() => {
    const agent = options.agent();
    return agent ? quickChatRuntimeOf(agent) : undefined;
  });
  /** Where a new conversation starts: the last model used, until the agent is read again. Never for a saved conversation. */
  const newConversationRuntime = () => lastUsed() ?? agentRuntime();

  /** The model of what the page shows now: the open conversation, or the draft. */
  const current = createMemo<QuickChatRuntime | undefined>(() => {
    const open = options.open();
    if (open === undefined) return undefined;
    if (open === null) return draft() ?? newConversationRuntime();
    const choice = pending();
    if (choice?.taskId === open.id && !(open.runtime && sameRuntime(open.runtime, choice.runtime)))
      return choice.runtime;
    return open.runtime ?? agentRuntime();
  });

  /** The agent for the header, or the agent itself while its model is not known. */
  const profile = (agent: AgentProfile | undefined): AgentProfile | undefined => {
    const runtime = current();
    return agent && runtime ? withQuickChatRuntime(agent, runtime) : agent;
  };

  /** What a new conversation sends with its first message. */
  const draftRuntime = (): QuickChatRuntime | undefined => (options.open() === null ? current() : undefined);

  /** The first message went in: its model is the one that the next conversation starts on. */
  function started(runtime: QuickChatRuntime | undefined): void {
    setDraft(undefined);
    if (runtime) setLastUsed(runtime);
  }

  /** The first message did not go in, so the picker shows the real model again. */
  function startFailed(): void {
    setDraft(undefined);
  }

  /** A new conversation opens: the choice of an earlier draft ends. */
  function resetDraft(): void {
    setDraft(undefined);
  }

  /**
   * Applies a change that the picker made. In a conversation it is saved, and the picker keeps the old model when
   * the save fails. In a new conversation it only changes the draft.
   */
  async function change(updates: QuickChatAgentUpdate): Promise<void> {
    const base = current();
    const open = options.open();
    const agent = options.agent();
    if (!base || open === undefined || !agent) return;
    const next: QuickChatRuntime = {
      provider:
        updates.provider !== undefined && isKnownAgentProvider(updates.provider) ? updates.provider : base.provider,
      model: updates.model ?? base.model,
      ...(updates.reasoningEffort === undefined
        ? base.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: base.reasoningEffort }
        : { reasoningEffort: updates.reasoningEffort }),
      ...(updates.fastMode === undefined
        ? base.fastMode === undefined
          ? {}
          : { fastMode: base.fastMode }
        : { fastMode: updates.fastMode }),
    };
    if (open === null) {
      setDraft(next);
      return;
    }
    const choice = { taskId: open.id, runtime: next };
    setPending(choice);
    try {
      const result = await options.port().setConversationRuntime({ agentId: agent.id, taskId: open.id, runtime: next });
      // The backend may normalize the effort, so what it saved is what the picker shows.
      if (pending() === choice) setPending({ taskId: open.id, runtime: result.task.runtime ?? next });
      setLastUsed(result.task.runtime ?? next);
      options.adopt(result.agent);
      options.refreshTasks(agent.id);
    } catch (error) {
      if (pending() === choice) setPending(undefined);
      actionToast.error(errorMessage(error, t("quick.model.changeFailed")));
    }
  }

  return { profile, draftRuntime, started, startFailed, resetDraft, change };
}
