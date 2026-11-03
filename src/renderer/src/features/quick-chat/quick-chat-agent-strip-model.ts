import type { AgentProfile } from "@buildersbot/ui/data";
import type { AwaitingReplyItem, AwaitingReplyState } from "@buildersbot/ui/features/conversation/AwaitingReplies";
import type { QuickChatStripAgent } from "@buildersbot/ui/features/quick-chat/QuickChatAgentStrip";
import type { StageActorData } from "@buildersbot/ui/features/stage/StageActor";
import type { StageLinkData } from "@buildersbot/ui/features/stage/StageLinks";
import { type StageActivity, stageActivityOfLine } from "@buildersbot/ui/features/stage/stage-activity";
import type { TurnStepLines } from "../conversation/turn-step-lines";

/** The seats round the table: the Quick chat agent at the back, the agents that it called after it. */
const MAX_CALLED = 7;

/** The fields of a profile that the strip reads. */
export type QuickChatStripProfile = Pick<
  AgentProfile,
  "id" | "name" | "avatarSeed" | "avatarHue" | "avatarUrl" | "provider" | "model"
>;
type StripRow = Omit<AwaitingReplyItem, "agent"> & { agent?: QuickChatStripProfile | undefined };

export interface QuickChatStripInput {
  /** The rows of the waiting block of the open conversation: the agents it asked and where each answer is. */
  rows: readonly StripRow[];
  /** The Quick chat agent, which sits at the head of the table. */
  self: QuickChatStripProfile | undefined;
  /** The running turn of each agent, by agent id. */
  activeTurns: Readonly<Record<string, string | null>>;
  stepLines: TurnStepLines;
}

export interface QuickChatStripModel {
  agents: QuickChatStripAgent[];
  actors: StageActorData[];
  links: StageLinkData[];
  /** Some agent still has the request. */
  live: boolean;
}

/** A state that says more wins when one agent has several rows: working, then asked, failed, replied. */
const RANK: Record<AwaitingReplyState, number> = { working: 3, asked: 2, failed: 1, replied: 0 };

/**
 * The strip of a Quick chat conversation, from data the app already has: the rows of the waiting block,
 * and the last progress line of each agent's running turn. One agent asked twice is one mark.
 */
export function quickChatStripModel(input: QuickChatStripInput): QuickChatStripModel {
  const byAgent = new Map<string, StripRow>();
  for (const row of input.rows) {
    const key = row.agent?.id ?? `name:${row.name}`;
    const known = byAgent.get(key);
    if (!known || RANK[row.state] > RANK[known.state]) byAgent.set(key, row);
  }

  const agents: QuickChatStripAgent[] = [];
  const actors: StageActorData[] = [];
  const links: StageLinkData[] = [];
  let seat = 1;
  for (const [key, row] of byAgent) {
    const profile = row.agent;
    const turnId = profile ? input.activeTurns[profile.id] : null;
    const last = row.state === "working" && turnId ? input.stepLines[turnId]?.at(-1) : undefined;
    agents.push({
      id: key,
      name: row.name,
      avatar: profile
        ? { avatarSeed: profile.avatarSeed, avatarHue: profile.avatarHue, avatarUrl: profile.avatarUrl }
        : undefined,
      state: row.state,
      line: last?.text ?? null,
    });
    if (seat > MAX_CALLED) continue;
    actors.push({
      id: key,
      name: row.name,
      provider: profile?.provider ?? null,
      model: profile?.model ?? null,
      hue: profile?.avatarHue ?? null,
      activity: activityOf(row, last),
      line: last?.text ?? null,
      delegatesTo: null,
      seat,
    });
    seat += 1;
  }

  const live = agents.some((agent) => agent.state === "asked" || agent.state === "working");
  const self = input.self;
  if (self && actors.length > 0) {
    const working = actors.find((actor) => actor.activity !== "done" && actor.activity !== "failed");
    actors.unshift({
      id: self.id,
      name: self.name,
      provider: self.provider,
      model: self.model,
      hue: self.avatarHue,
      activity: live ? "delegating" : "done",
      line: null,
      delegatesTo: live ? (working?.id ?? null) : null,
      seat: 0,
    });
    for (const actor of actors)
      if (actor.id !== self.id && actor.activity !== "done" && actor.activity !== "failed")
        links.push({ key: `${self.id}:${actor.id}`, from: self.id, to: actor.id });
  }
  return { agents, actors, links, live };
}

function activityOf(row: StripRow, last: TurnStepLines[string][number] | undefined): StageActivity {
  if (row.wait) return "waiting";
  if (row.state === "replied") return "done";
  if (row.state === "failed") return "failed";
  if (row.state === "asked") return "thinking";
  return last ? stageActivityOfLine(last.text, last.kind) : "thinking";
}
