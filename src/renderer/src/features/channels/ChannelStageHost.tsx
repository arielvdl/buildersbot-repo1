import { ChannelStage } from "@buildersbot/ui/features/channels/ChannelStage";
import { useText } from "@buildersbot/ui/text";
import { createEffect, createMemo, createSignal } from "solid-js";
import { useTurns } from "../../turns";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";
import { channelOwnsRequest, waitingChannelPrompt } from "./channel-conversation-rows";
import {
  assignStageSeats,
  channelStageModel,
  nextStageHolds,
  type StageHold,
  type StageModel,
} from "./channel-stage-model";
import { channelStageSettingsFor, updateChannelStage, withChannelStageFolded } from "./channel-stage-preference";
import { useChannels } from "./channels-context";

const EMPTY: StageModel = { actors: [], overflow: 0, request: null, links: [], deadline: null };

/**
 * The agent stage of the open channel. It owns one memo, the stage model, and one timer for the next
 * moment a hold ends or a step grows old. It reads the page, the agents and the turn signals that the
 * app already keeps, so it adds no subscription. Leaving the channel disposes the view and with it the
 * memo, the timer and the seats. Only this chunk imports the stage, so a channel with the stage off
 * never loads it.
 */
export function ChannelStageHost(props: {
  channelId: string;
  workingTurns: () => readonly string[];
  /** The reader scrolled up to older messages: the stage steps aside, even while agents work. */
  readerAway?: () => boolean;
}) {
  const channels = useChannels();
  const { agentList } = useAgents();
  const { turnStepLines, approvals, pendingPrompts } = useTurns();
  const { activeServerId } = useServers();
  const { t } = useText();
  const [tick, setTick] = createSignal(0);
  const seats = new Map<string, number>();
  let taskStates: ReturnType<typeof nextStageHolds>["states"] | null = null;
  let holds: ReadonlyMap<string, StageHold> = new Map();

  const page = () => {
    const current = channels.state.page;
    return current?.channel.id === props.channelId ? current : null;
  };
  const threads = () => channels.state.channels.find((channel) => channel.id === props.channelId)?.threads;
  const agents = createMemo(() => new Map(agentList().map((agent) => [agent.id, agent] as const)));

  /** The members that an approval, a question or a takeover of this channel waits on. */
  const waitingAgentIds = createMemo(() => {
    const current = page();
    const ids = new Set<string>();
    if (!current) return ids;
    const known = threads();
    for (const approval of approvals()) if (channelOwnsRequest(current, known, approval)) ids.add(approval.agentId);
    for (const event of Object.values(pendingPrompts())) {
      const request = event?.type === "prompt" ? event : event?.request;
      if (request && channelOwnsRequest(current, known, request)) ids.add(request.agentId);
    }
    const prompt = waitingChannelPrompt(current);
    if (prompt) ids.add(prompt.entry.author.id);
    return ids;
  });

  const model = createMemo((): StageModel => {
    tick();
    const current = page();
    if (!current) return EMPTY;
    const now = Date.now();
    const held = nextStageHolds(taskStates, current, holds, now);
    taskStates = held.states;
    holds = held.holds;
    return channelStageModel({
      page: current,
      agents: agents(),
      agentFallbackName: t("chat.activity.agentFallback"),
      workingTurns: props.workingTurns(),
      stepLines: turnStepLines(),
      waitingAgentIds: waitingAgentIds(),
      holds,
      now,
    });
  });

  // One timer for the stage: the next moment that no signal announces. None while no deadline stands.
  createEffect(
    () => model().deadline,
    (deadline) => {
      if (deadline === null) return;
      const timer = setTimeout(() => setTick((value) => value + 1), Math.max(0, deadline - Date.now()) + 20);
      return () => clearTimeout(timer);
    },
  );

  const actors = createMemo(() => {
    const current = model();
    assignStageSeats(seats, current.actors);
    return current.actors.map((actor) => ({ ...actor, seat: seats.get(actor.id) ?? 0 }));
  });
  const settings = () => channelStageSettingsFor(activeServerId(), props.channelId);
  const folded = () => settings().folded;
  // A memo: the stage plays its fold when this changes, not on each change of the model.
  const hidden = createMemo(
    () => !folded() && ((props.readerAway?.() ?? false) || (settings().collapse && model().actors.length === 0)),
  );
  const toggleFold = () =>
    updateChannelStage(activeServerId(), (preference) =>
      withChannelStageFolded(preference, props.channelId, !folded()),
    );

  return (
    <ChannelStage
      actors={actors()}
      overflow={model().overflow}
      request={model().request}
      links={model().links}
      folded={folded()}
      hidden={hidden()}
      onToggleFold={toggleFold}
    />
  );
}
