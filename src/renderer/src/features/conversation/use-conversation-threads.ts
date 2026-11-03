import type { AgentProfile } from "@buildersbot/ui/data";
import { useText } from "@buildersbot/ui/text";
import { createMemo } from "solid-js";
import { useNavigation } from "../../navigation";
import { useTurns } from "../../turns";
import { turnsPort } from "../../turns-port";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { conversationThreads } from "../agent-threads/conversation-threads";
import { useServers } from "../servers/servers-context";
import type { ConversationThreads } from "./conversation-types";

/**
 * The threads of one agent, for the conversation and for a page that lists them. A host without side
 * threads gives none, and the agent then has only its own chat. Read it in a reactive scope: it reads
 * the thread state.
 */
export function useConversationThreads(agent: () => AgentProfile | undefined) {
  const { t } = useText();
  const { activeServer } = useServers();
  const { approvals, pendingPrompts, respondToApprovalRequest, threadContextStates } = useTurns();
  const { openAgentMessage } = useNavigation();
  const agentTasks = useAgentTasks();
  const agentThreads = useAgentThreads();

  /** Local only: the Team API has no route to compact a joined server's thread. */
  const compactTaskContext = createMemo(() => {
    const current = agent();
    const server = activeServer();
    if (!current || server?.kind !== "local") return undefined;
    return (taskId: string) => turnsPort().agent.compactTaskContext({ agentId: current.id, taskId }, server.id);
  });

  return createMemo((): ConversationThreads | undefined => {
    const current = agent();
    if (!current || !agentTasks.available()) return undefined;
    return conversationThreads({
      agent: { id: current.id, updatedAt: current.updatedAt ?? current.time },
      tasks: agentTasks,
      tabs: agentThreads,
      approvals: approvals(),
      prompts: Object.values(pendingPrompts()).filter((event) => event?.type === "prompt"),
      takeovers: Object.values(pendingPrompts()).flatMap((event) =>
        event?.type === "browser-takeover-requested" ? [event.request] : [],
      ),
      newThreadTitle: t("conversation.threads.new"),
      onRespondApproval: (approval, decision, options) =>
        respondToApprovalRequest(approval.agentId, approval.requestId, decision, options),
      contextStates: threadContextStates,
      onCompactContext: compactTaskContext(),
      onOpenMainMessage: (messageId) => void openAgentMessage(current.id, messageId),
    });
  });
}
