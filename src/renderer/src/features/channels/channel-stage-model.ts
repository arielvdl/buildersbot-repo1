/*
 * The agent stage of a channel as data: who stands on it, what each one does, the request on the
 * table and the hand-offs between agents. Every function is a pure function of the channel page and
 * the signals the app already keeps, so the stage adds no subscription, no timer and no copy of the
 * messages. The page is read for its tasks and for the end of its messages only.
 */

import type { AgentProviderRef } from "@buildersbot/contracts/agent-providers";
import type { AvatarHue, ChannelPage, ChannelTask } from "@buildersbot/contracts/ipc";
import type { AgentProfile } from "@buildersbot/ui/data";
import { type StageActivity, stageActivityOfLine } from "@buildersbot/ui/features/stage/stage-activity";
import type { TurnStepLines } from "../conversation/turn-step-lines";
import { startingChannelTask } from "./channel-conversation-rows";

/** The seats round the table. More agents than this wait in a "+N" chip. */
const STAGE_SEATS = 8;
/** An agent that is active and has not reported a step for this long is thinking. */
const STAGE_THINK_AFTER_MS = 1500;
/** How long a finished, failed or delegating agent stays on the stage. */
const HOLD_MS = { done: 2800, failed: 3000, delegating: 2000 } as const;
/** The end of the messages that is read for streaming authors and the turn of each member. */
const MESSAGE_TAIL = 60;
const REQUEST_TITLE_LIMIT = 90;

type HeldActivity = keyof typeof HOLD_MS;

/** A state that lasts a short while after the task changed, so the reader sees it happen. */
export interface StageHold {
  activity: HeldActivity;
  until: number;
}

export interface StageActor {
  id: string;
  name: string;
  provider: AgentProviderRef | null;
  model: string | null;
  hue: AvatarHue | null;
  lead: boolean;
  activity: StageActivity;
  /** The host's English progress line, for the speech bubble. The view renders it with `sourceText`. */
  line: string | null;
  /** The agent that gets the work, while this one delegates. */
  delegatesTo: string | null;
}

interface StageRequest {
  title: string;
  parts: number;
  done: number;
}

interface StageLink {
  /** The task that the link is for, which is also its identity. */
  key: string;
  from: string;
  to: string;
}

export interface StageModel {
  actors: StageActor[];
  overflow: number;
  request: StageRequest | null;
  links: StageLink[];
  /** The time of the next change that no signal tells (a hold ends, a step grows old). Null: none. */
  deadline: number | null;
}

export interface StageInput {
  page: ChannelPage;
  agents: ReadonlyMap<string, AgentProfile>;
  agentFallbackName: string;
  /** The turn of each working member in this channel, newest first (`channelWorkingTurns`). */
  workingTurns: readonly string[];
  stepLines: TurnStepLines;
  /** The agents with an approval, a question or a takeover that this channel waits on. */
  waitingAgentIds: ReadonlySet<string>;
  holds: ReadonlyMap<string, StageHold>;
  now: number;
}

const ACTIVE_TASK_STATES = new Set<ChannelTask["state"]>(["queued", "running", "waiting"]);

const ACTIVITY_RANK: Readonly<Record<StageActivity, number>> = {
  waiting: 0,
  failed: 1,
  delegating: 2,
  editing: 3,
  running: 3,
  reading: 3,
  thinking: 3,
  done: 4,
};

function inTab(page: ChannelPage, task: ChannelTask): boolean {
  return !(task.topicId && page.topicId && task.topicId !== page.topicId);
}

/**
 * The holds after a page change. A task that went from active to `completed` or `failed`, and one
 * that is new under a task of another agent, hold their agent on the stage for a short while. The
 * first page, with no earlier state, holds nothing: a channel that opens is not a channel that works.
 */
export function nextStageHolds(
  previous: ReadonlyMap<string, ChannelTask["state"]> | null,
  page: ChannelPage,
  holds: ReadonlyMap<string, StageHold>,
  now: number,
): { states: Map<string, ChannelTask["state"]>; holds: Map<string, StageHold> } {
  const states = new Map<string, ChannelTask["state"]>();
  const next = new Map<string, StageHold>();
  for (const [agentId, hold] of holds) if (hold.until > now) next.set(agentId, hold);
  const byId = new Map(page.tasks.map((task) => [task.id, task] as const));
  for (const task of page.tasks) {
    states.set(task.id, task.state);
    if (!previous || !inTab(page, task)) continue;
    const before = previous.get(task.id);
    const owner = task.ownerAgentId;
    if (before === undefined) {
      const parent = task.parentTaskId ? byId.get(task.parentTaskId) : undefined;
      const parentOwner = parent?.ownerAgentId;
      if (parentOwner && owner && parentOwner !== owner && ACTIVE_TASK_STATES.has(task.state))
        next.set(parentOwner, { activity: "delegating", until: now + HOLD_MS.delegating });
    } else if (owner && ACTIVE_TASK_STATES.has(before)) {
      if (task.state === "completed") next.set(owner, { activity: "done", until: now + HOLD_MS.done });
      else if (task.state === "failed") next.set(owner, { activity: "failed", until: now + HOLD_MS.failed });
    }
  }
  return { states, holds: next };
}

/** The ids of the members that work now: a running task, a message that arrives, the lead that routes. */
function activeAgentIds(page: ChannelPage, inChannel: (id: string) => boolean): Set<string> {
  const ids = new Set<string>();
  for (const task of page.tasks)
    if ((task.state === "running" || startingChannelTask(task)) && task.ownerAgentId && inTab(page, task))
      ids.add(task.ownerAgentId);
  const start = Math.max(0, page.messages.length - MESSAGE_TAIL);
  for (let index = start; index < page.messages.length; index += 1) {
    const entry = page.messages[index];
    if (entry?.message.status === "streaming" && entry.author.kind !== "member") ids.add(entry.author.id);
  }
  const lead = page.channel.leadAgentId;
  if (lead && page.tasks.some((task) => !task.ownerAgentId && (task.state === "queued" || task.state === "waiting")))
    ids.add(lead);
  return new Set([...ids].filter(inChannel));
}

/** Which agent owns each working turn of this channel, from the end of the messages. */
function turnOwners(page: ChannelPage, turnIds: ReadonlySet<string>): Map<string, string> {
  const owners = new Map<string, string>();
  if (turnIds.size === 0) return owners;
  const start = Math.max(0, page.messages.length - MESSAGE_TAIL);
  for (let index = page.messages.length - 1; index >= start; index -= 1) {
    const entry = page.messages[index];
    const turnId = entry?.message.turnId;
    if (entry && turnId && turnIds.has(turnId) && entry.author.kind !== "member" && !owners.has(entry.author.id))
      owners.set(entry.author.id, turnId);
  }
  return owners;
}

function requestOf(page: ChannelPage, relevant: ReadonlySet<string>): StageRequest | null {
  let root: ChannelTask | undefined;
  for (const task of page.tasks) {
    if (!inTab(page, task)) continue;
    const involved =
      ACTIVE_TASK_STATES.has(task.state) || (task.ownerAgentId !== null && relevant.has(task.ownerAgentId));
    if (involved) root = page.tasks.find((candidate) => candidate.id === task.rootTaskId) ?? root;
  }
  if (!root) return null;
  const rootId = root.id;
  const parts = page.tasks.filter((task) => task.parentTaskId === rootId);
  const text = root.instruction.trim().split("\n")[0] ?? "";
  const title = text.length > REQUEST_TITLE_LIMIT ? `${text.slice(0, REQUEST_TITLE_LIMIT - 1)}…` : text;
  return {
    title,
    parts: Math.max(parts.length, 1),
    done:
      parts.length === 0
        ? root.state === "completed"
          ? 1
          : 0
        : parts.filter((task) => task.state === "completed").length,
  };
}

/** The stage of a page: at most `STAGE_SEATS` agents, the rest counted in `overflow`. */
export function channelStageModel(input: StageInput): StageModel {
  const { page, agents, holds, now } = input;
  const members = new Set(page.channel.members.map((member) => member.agentId));
  const inChannel = (id: string) => members.has(id) || id === page.channel.leadAgentId;
  const lead = page.channel.leadAgentId ?? null;
  const ids = activeAgentIds(page, inChannel);
  for (const id of input.waitingAgentIds) if (inChannel(id)) ids.add(id);
  for (const id of holds.keys()) if (inChannel(id)) ids.add(id);

  const owners = turnOwners(page, new Set(input.workingTurns));
  let deadline: number | null = null;
  const earlier = (time: number) => {
    if (time > now && (deadline === null || time < deadline)) deadline = time;
  };

  const linkTargets = new Map<string, string>();
  const byId = new Map(page.tasks.map((task) => [task.id, task] as const));
  const links: StageLink[] = [];
  for (const task of page.tasks) {
    const parentOwner = task.parentTaskId ? byId.get(task.parentTaskId)?.ownerAgentId : null;
    if (!parentOwner || !task.ownerAgentId || parentOwner === task.ownerAgentId) continue;
    if (!ACTIVE_TASK_STATES.has(task.state) || !inTab(page, task)) continue;
    links.push({ key: task.id, from: parentOwner, to: task.ownerAgentId });
    linkTargets.set(parentOwner, task.ownerAgentId);
  }

  const actors: StageActor[] = [];
  for (const id of ids) {
    const profile = agents.get(id);
    const turnId = owners.get(id);
    const lines = turnId ? input.stepLines[turnId] : undefined;
    const last = lines?.at(-1);
    const hold = holds.get(id);
    let activity: StageActivity = "thinking";
    if (input.waitingAgentIds.has(id)) activity = "waiting";
    else if (hold?.activity === "failed") activity = "failed";
    else if (hold?.activity === "done") activity = "done";
    else if (hold?.activity === "delegating") activity = "delegating";
    else if (last) {
      const age = now - last.at;
      if (age < STAGE_THINK_AFTER_MS) {
        activity = stageActivityOfLine(last.text, last.kind);
        earlier(last.at + STAGE_THINK_AFTER_MS);
      }
    }
    if (hold) earlier(hold.until);
    const delegatesTo = activity === "delegating" ? (linkTargets.get(id) ?? null) : null;
    actors.push({
      id,
      name: profile?.name ?? input.agentFallbackName,
      provider: profile?.provider ?? null,
      model: profile?.model ?? null,
      hue: profile?.avatarHue ?? null,
      lead: id === lead,
      activity,
      line: last && activity !== "waiting" && activity !== "done" && activity !== "failed" ? last.text : null,
      delegatesTo,
    });
  }
  actors.sort((a, b) => ACTIVITY_RANK[a.activity] - ACTIVITY_RANK[b.activity]);
  const shown = actors.slice(0, STAGE_SEATS);
  const shownIds = new Set(shown.map((actor) => actor.id));
  return {
    actors: shown,
    overflow: Math.max(0, actors.length - STAGE_SEATS),
    request: requestOf(page, ids),
    links: links.filter((link) => shownIds.has(link.from) && shownIds.has(link.to)),
    deadline,
  };
}

/**
 * The seat of each agent that stands on the stage. An agent keeps its seat while it stays, so the
 * others do not move when one leaves. The lead takes the seat at the back, and the others the first
 * free seat. `book` is the only state, and the stage drops it with the channel.
 */
export function assignStageSeats(book: Map<string, number>, actors: readonly StageActor[]): void {
  const present = new Set(actors.map((actor) => actor.id));
  for (const id of [...book.keys()]) if (!present.has(id)) book.delete(id);
  const used = new Set(book.values());
  const free = (from: number) => {
    for (let seat = from; seat < STAGE_SEATS; seat += 1) if (!used.has(seat)) return seat;
    return 0;
  };
  for (const actor of actors) {
    if (book.has(actor.id)) continue;
    const seat = actor.lead && !used.has(0) ? 0 : free(1);
    book.set(actor.id, seat);
    used.add(seat);
  }
}
