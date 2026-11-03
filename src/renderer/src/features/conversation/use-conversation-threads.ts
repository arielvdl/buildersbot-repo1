import type { AgentProfile } from "@buildersbot/ui/data";
import { useText } from "@buildersbot/ui/text";
import { createMemo } from "solid-js";
import { useNavigation } from "../../navigation";
import { useTurns } from "../../turns";
import { turnsPort } from "../../turns-port";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { type ConversationThreadsInput, conversationThreads } from "../agent-threads/conversation-threads";
import { useServers } from "../servers/servers-context";
import type { ConversationThreads } from "./conversation-types";

interface ThreadsOptions {
  /** Starts a new thread from its first message. See `ConversationThreadsInput.onSendDraft`. */
  onSendDraft?: ConversationThreadsInput["onSendDraft"];
}

/**
 * Builds the threads of any agent, for a page that lists the threads of more than one agent. Call the
 * result in a reactive scope: it reads the thread state. A host without side threads gives none, and the
 * agent then has only its own chat.
 */
export function useConversationThreadsOf() {
  const { t } = useText();
  const { activeServer } = useServers();
  const { approvals, pendingPrompts, respondToApprovalRequest, threadContextStates } = useTurns();
  const { openAgentMessage } = useNavigation();
  const agentTasks = useAgentTasks();
  const agentThreads = useAgentThreads();

  return (agent: AgentProfile | undefined, options: ThreadsOptions = {}): ConversationThreads | undefined => {
    if (!agent || !agentTasks.available()) return undefined;
    const server = activeServer();
    return conversationThreads({
      agent: { id: agent.id, updatedAt: agent.updatedAt ?? agent.time },
      tasks: agentTasks,
      tabs: agentThreads,
      approvals: approvals(),
      prompts: Object.values(pendingPrompts()).filter((event) => event?.type === "prompt"),
      takeovers: Object.values(pendingPrompts()).flatMap((event) =>
        event?.type === "browser-takeover-requested" ? [event.request] : [],
      ),
      newThreadTitle: t("conversation.threads.new"),
      onRespondApproval: (approval, decision, answer) =>
        respondToApprovalRequest(approval.agentId, approval.requestId, decision, answer),
      contextStates: threadContextStates,
      // Local only: the Team API has no route to compact a joined server's thread.
      onCompactContext:
        server?.kind === "local"
          ? (taskId: string) => turnsPort().agent.compactTaskContext({ agentId: agent.id, taskId }, server.id)
          : undefined,
      onOpenMainMessage: (messageId) => void openAgentMessage(agent.id, messageId),
      onSendDraft: options.onSendDraft,
    });
  };
}

/**
 * The threads of one agent, for the conversation. A host without side threads shows only the agent's own
 * chat. Read it in a reactive scope: it reads the thread state.
 */
export function useConversationThreads(agent: () => AgentProfile | undefined, options: ThreadsOptions = {}) {
  const build = useConversationThreadsOf();
  return createMemo((): ConversationThreads | undefined => build(agent(), options));
}
