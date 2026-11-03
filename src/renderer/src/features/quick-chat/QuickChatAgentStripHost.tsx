import type { AgentMessage } from "@buildersbot/ui/data";
import { QuickChatAgentStrip } from "@buildersbot/ui/features/quick-chat/QuickChatAgentStrip";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { agentAwaitingReplies } from "../../awaiting-replies";
import { useTurns } from "../../turns";
import type { ConversationProps } from "../conversation/conversation-types";
import { quickChatStripModel } from "./quick-chat-agent-strip-model";

/** How long the strip says that every agent is done before it goes. */
const FINISHED_MS = 4000;

/**
 * The strip of the agents that the open Quick chat conversation called. It shows while an agent has the
 * request, says so for a moment when the last one is done, and goes. It reads the conversation and the
 * turn signals that the app already keeps, so it adds no subscription.
 */
export function QuickChatAgentStripHost(props: { conversation: ConversationProps; messages: readonly AgentMessage[] }) {
  const { activeTurns, turnStepLines } = useTurns();
  const [open, setOpen] = createSignal(false);
  const [lingering, setLingering] = createSignal(false);

  const model = createMemo(() => {
    const conversation = props.conversation;
    const self = conversation.agent;
    const rows = agentAwaitingReplies({
      messages: props.messages,
      queue: conversation.queue?.agentId === self?.id ? conversation.queue : undefined,
      agents: conversation.agents,
      self,
      waits: conversation.agentWaits,
    });
    return quickChatStripModel({ rows, self, activeTurns: activeTurns(), stepLines: turnStepLines() });
  });

  // When the last agent is done, the strip stays a moment with the result, then goes up.
  createEffect(
    () => model().live,
    (live, wasLive) => {
      if (live) {
        setLingering(false);
        return;
      }
      if (!wasLive) return;
      setLingering(true);
      const timer = setTimeout(() => {
        setLingering(false);
        setOpen(false);
      }, FINISHED_MS);
      return () => clearTimeout(timer);
    },
  );

  return (
    <Show when={model().agents.length > 0 && (model().live || lingering())}>
      <QuickChatAgentStrip
        agents={model().agents}
        actors={model().actors}
        links={model().links}
        finished={!model().live}
        open={open()}
        onToggle={() => setOpen((value) => !value)}
      />
    </Show>
  );
}
