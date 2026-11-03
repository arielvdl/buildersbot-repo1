import type { AgentSummary, QuickChatRuntime } from "@buildersbot/contracts/ipc";
import { Effect } from "effect";
import type { ProviderSession } from "../database/provider-sessions";

/**
 * The agent as one conversation runs it. Only the quick chat agent keeps a model for each conversation
 * (`projection_agent_threads.runtime_json`); every other agent, and a conversation with no model of its
 * own, runs as the agent record says, so this returns the same object for them.
 *
 * The account stays only with the provider of the agent: a conversation on another provider has none
 * (the spec's D4), which is the provider's own sign-in.
 */
export function effectiveRuntime(agent: AgentSummary, runtime: QuickChatRuntime | null | undefined): AgentSummary {
  if (agent.quickChat !== true || !runtime) return agent;
  const { providerAccountId, fastMode: _fastMode, ...rest } = agent;
  return {
    ...rest,
    provider: runtime.provider,
    model: runtime.model,
    reasoningEffort: runtime.reasoningEffort ?? agent.reasoningEffort,
    ...(runtime.fastMode === undefined ? {} : { fastMode: runtime.fastMode }),
    ...(runtime.provider === agent.provider && providerAccountId ? { providerAccountId } : {}),
  };
}

/** What `ThreadRuntimes` reads: the model of a conversation, by its task id or its thread id. */
export interface ThreadRuntimeSource {
  /** The model of a task of the agent, or null. */
  runtimeOfTask(taskId: string): QuickChatRuntime | null;
  /** The model of the side thread with this public thread id, or null (also for any other thread). */
  runtimeOfThread(threadId: string): QuickChatRuntime | null;
  /** The models of every open conversation of the agent. */
  runtimesOf(agentId: string): readonly QuickChatRuntime[];
  /** The public thread of an open task, or null. */
  threadIdOfTask(taskId: string): string | null;
  /** The provider and model of the active provider session of a thread, or null when it has none. */
  activeSessionOf(threadId: string): { provider: AgentSummary["provider"]; model: string } | null;
}

/**
 * The one place that answers "on what does this conversation run". A reader of `agent.provider`,
 * `agent.model` or `agent.reasoningEffort` in the path of a turn of a side thread asks here, or shows
 * that the record of the agent is the right answer (see the audit in the quick chat spec, 4.2).
 */
export class ThreadRuntimes {
  readonly #source: ThreadRuntimeSource;

  constructor(source: ThreadRuntimeSource) {
    this.#source = source;
  }

  /** The agent as the lane of this task runs it. `taskId` null is the agent's own chat: the agent itself. */
  forTask(agent: AgentSummary, taskId: string | null): AgentSummary {
    if (agent.quickChat !== true || taskId === null) return agent;
    return effectiveRuntime(agent, this.#source.runtimeOfTask(taskId));
  }

  /** The agent as the conversation on this public thread runs it. */
  forThread(agent: AgentSummary, publicThreadId: string | null | undefined): AgentSummary {
    if (agent.quickChat !== true || !publicThreadId) return agent;
    return effectiveRuntime(agent, this.#source.runtimeOfThread(publicThreadId));
  }

  /**
   * The agent as the provider session that is open on this thread runs it. A turn that runs, a stop, a steer,
   * a compaction and a restart talk to that session, and the model of the conversation can have moved on
   * since the turn began: the change takes effect with the next turn, so the live session decides until then.
   * Without a session it is the model of the conversation (`forThread`).
   */
  runningAs(agent: AgentSummary, publicThreadId: string | null | undefined): AgentSummary {
    const view = this.forThread(agent, publicThreadId);
    if (agent.quickChat !== true || !publicThreadId) return view;
    const session = this.#source.activeSessionOf(publicThreadId);
    if (!session || (session.provider === view.provider && session.model === view.model)) return view;
    const { providerAccountId, ...rest } = view;
    return {
      ...rest,
      provider: session.provider,
      model: session.model,
      ...(session.provider === agent.provider && providerAccountId ? { providerAccountId } : {}),
    };
  }

  /** The models that some open conversation of the agent runs on. Empty for any other agent. */
  runtimesOf(agent: Pick<AgentSummary, "id" | "quickChat">): readonly QuickChatRuntime[] {
    return agent.quickChat === true ? this.#source.runtimesOf(agent.id) : [];
  }

  threadIdOfTask(taskId: string): string | null {
    return this.#source.threadIdOfTask(taskId);
  }
}

/** What `reconcileThreadRuntime` needs from the rest of the backend. */
export interface ThreadReconcileDependencies {
  runtimes: ThreadRuntimes;
  /** Open sessions of the thread, and the writes that retire or update them. */
  database: {
    listProviderSessions(threadId: string): ProviderSession[];
    updateProviderSessionConfig(sessionId: string, threadId: string, model: string, effort: string): void;
  };
  threads: {
    readWorkSteps(session: ProviderSession): Effect.Effect<string | null, never>;
    saveWorkSteps(session: ProviderSession, captured: string): Effect.Effect<void, never>;
    /** Ends every session of the thread, closing it in its client, and keeps the thread. */
    retireThreadSessions(threadId: string): Effect.Effect<void, never>;
  };
}

/**
 * Makes the provider sessions of one conversation match its model, for this conversation only. It is
 * what an update of the agent does for the agent's own chat and its tasks, run for one thread.
 *
 * - The session is of another provider: the work steps of the session are read while its client still
 *   holds it, the session is retired, and the steps are saved once it is. The next turn opens a session
 *   of the new provider with the history handoff. Retiring is required: without it, a way back to the
 *   first provider would resume a session that did not see the turns of the other one.
 * - The session is of the same provider: only its model and effort are updated. The turn itself
 *   carries both, so the session continues.
 * - No active session: nothing to do; the next turn opens one on the new provider.
 *
 * Nothing changes when the conversation has no model of its own. Calling it again changes nothing.
 */
export const reconcileThreadRuntime = Effect.fn("ThreadRuntime.reconcile")(function* (
  deps: ThreadReconcileDependencies,
  agent: AgentSummary,
  taskId: string,
) {
  if (agent.quickChat !== true) return;
  const threadId = deps.runtimes.threadIdOfTask(taskId);
  if (!threadId) return;
  const effective = deps.runtimes.forTask(agent, taskId);
  if (effective === agent) return;
  const active = deps.database.listProviderSessions(threadId).filter((session) => session.state === "active");
  const foreign = active.filter((session) => session.provider !== effective.provider);
  if (foreign.length > 0) {
    const captures: Array<readonly [ProviderSession, string]> = [];
    for (const session of foreign) {
      const steps = yield* deps.threads.readWorkSteps(session);
      if (steps !== null) captures.push([session, steps]);
    }
    yield* deps.threads.retireThreadSessions(threadId);
    for (const [session, steps] of captures) yield* deps.threads.saveWorkSteps(session, steps);
    return;
  }
  for (const session of active) {
    if (session.model !== effective.model || session.effort !== effective.reasoningEffort)
      deps.database.updateProviderSessionConfig(
        session.id,
        session.threadId,
        effective.model,
        effective.reasoningEffort,
      );
  }
});
