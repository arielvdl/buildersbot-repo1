/**
 * The tables of the feed as data: one table for each project that has an agent at work, with the
 * agents that sit at it. DOM-free. It reads the cards and nothing else, and it keeps no state of a
 * card: a run that has ended shows for a short while because its own `endedAt` says so, so a feed that
 * opens on old work celebrates nothing, and no map of the cards is needed. The page asks for the next
 * model at the `deadline` that this one returns, with one timer.
 */

import type { AgentProviderRef } from "@buildersbot/contracts/agent-providers";
import type { AvatarHue, FeedItem } from "@buildersbot/contracts/ipc";
import { type StageActivity, stageActivityOfLine } from "../stage/stage-activity";
import { feedAgentKey, feedProjectKey } from "./feed-view";

/** The most tables drawn. The rest are counted in a chip. */
export const FEED_TABLE_LIMIT = 6;
/** The seats of a table. The rest are counted in a chip. */
export const FEED_TABLE_SEATS = 4;
/** The most agents drawn over all the tables. */
export const FEED_ACTOR_LIMIT = 16;
/** How long a run that has ended stays at its table. */
export const FEED_DONE_HOLD_MS = 2800;
export const FEED_FAILED_HOLD_MS = 3000;

/** What an agent of the feed looks like: its face on a card, and its provider and model above its cube. */
export interface FeedAgentProfile {
  /** A key of `feedAgentKey`. */
  key: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarUrl: string | null;
  /** Absent for an agent of another server, which the window does not know. */
  provider?: AgentProviderRef | null | undefined;
  model?: string | null | undefined;
}

export interface FeedTableActor {
  /** The key of the agent, `feedAgentKey`. */
  id: string;
  name: string;
  hue: AvatarHue | null;
  provider: AgentProviderRef | null;
  model: string | null;
  activity: StageActivity;
}

/** A hand-off at a table: `from` gave the run of card `key` to `to`. Both are `feedAgentKey`. */
export interface FeedTableLink {
  /** The id of the card, so the cube flies once for each card. */
  key: string;
  from: string;
  to: string;
}

export interface FeedTable {
  /** `feedProjectKey` of the project. */
  key: string;
  /** The name of the project. Null: the agents of no section. */
  name: string | null;
  actors: FeedTableActor[];
  /** The hand-offs between two agents that sit at this table, while the agent that got the work works. */
  links: FeedTableLink[];
  /** The agents that handed work over at this table. They take the seat at the back. */
  leads: string[];
  /** The agents that have no seat. */
  overflow: number;
  /** The title of the newest card that works or waits for the person. */
  now: string | null;
  working: number;
  needsYou: number;
}

export interface FeedTablesModel {
  tables: FeedTable[];
  /** The projects that have an agent at work and no table. */
  overflowTables: number;
  /** When the model changes with no card changing: a run leaves. Epoch milliseconds. Null: never. */
  deadline: number | null;
}

export const EMPTY_FEED_TABLES: FeedTablesModel = { tables: [], overflowTables: 0, deadline: null };

/** The more urgent an activity, the lower its rank. */
const RANK: Readonly<Record<StageActivity, number>> = {
  waiting: 0,
  failed: 1,
  delegating: 2,
  editing: 3,
  running: 3,
  reading: 3,
  thinking: 3,
  done: 4,
};

interface Candidate {
  actor: FeedTableActor;
  updatedAt: string;
}

interface Accumulator {
  name: string | null;
  actors: Map<string, Candidate>;
  links: FeedTableLink[];
  now: { title: string; updatedAt: string } | null;
  working: number;
  needsYou: number;
  rank: number;
  newest: string;
}

/**
 * The activity of a card now, or null when the card has no seat: a queued, stopped or old run. The
 * time is read only for a run that has ended, so the sweep of thousands of cards stays a state check.
 */
function activityOf(item: FeedItem, now: number): { activity: StageActivity; until: number | null } | null {
  switch (item.state) {
    case "needs-you":
      return { activity: "waiting", until: null };
    case "working":
      return {
        activity: item.lastStep ? stageActivityOfLine(item.lastStep.text, item.lastStep.tool) : "thinking",
        until: null,
      };
    case "done":
    case "failed": {
      if (!item.endedAt) return null;
      const until = Date.parse(item.endedAt) + (item.state === "done" ? FEED_DONE_HOLD_MS : FEED_FAILED_HOLD_MS);
      return until > now ? { activity: item.state, until } : null;
    }
    default:
      return null;
  }
}

/** The tables for `items`. `profiles` holds the agents that the window knows, by `feedAgentKey`. */
export function feedTablesModel(
  items: readonly FeedItem[],
  profiles: ReadonlyMap<string, FeedAgentProfile>,
  now: number,
): FeedTablesModel {
  const projects = new Map<string, Accumulator>();
  let deadline: number | null = null;

  for (const item of items) {
    const seen = activityOf(item, now);
    if (!seen) continue;
    if (seen.until !== null && (deadline === null || seen.until < deadline)) deadline = seen.until;

    const projectKey = feedProjectKey(item);
    let table = projects.get(projectKey);
    if (!table) {
      table = {
        name: item.projectName,
        actors: new Map(),
        links: [],
        now: null,
        working: 0,
        needsYou: 0,
        rank: Number.POSITIVE_INFINITY,
        newest: "",
      };
      projects.set(projectKey, table);
    }
    const live = item.state === "working" || item.state === "needs-you";
    if (item.state === "working") table.working += 1;
    if (item.state === "needs-you") table.needsYou += 1;
    if (live && (!table.now || item.updatedAt > table.now.updatedAt))
      table.now = { title: item.title, updatedAt: item.updatedAt };
    if (item.updatedAt > table.newest) table.newest = item.updatedAt;

    // One seat for an agent, in its most urgent state; a tie goes to the newest card.
    const agentKey = feedAgentKey(item);
    // A run that another agent handed over, while it works: a line from that agent, if it sits here too.
    if (item.delegatedBy && item.state === "working" && item.delegatedBy !== item.agentId)
      table.links.push({
        key: item.id,
        from: feedAgentKey({ serverId: item.serverId, agentId: item.delegatedBy }),
        to: agentKey,
      });
    const known = table.actors.get(agentKey);
    if (known) {
      const same = RANK[seen.activity] === RANK[known.actor.activity];
      const better = RANK[seen.activity] < RANK[known.actor.activity] || (same && item.updatedAt > known.updatedAt);
      if (!better) continue;
    }
    const profile = profiles.get(agentKey);
    table.actors.set(agentKey, {
      updatedAt: item.updatedAt,
      actor: {
        id: agentKey,
        name: item.agentName,
        hue: profile?.avatarHue ?? null,
        provider: profile?.provider ?? null,
        model: profile?.model ?? null,
        activity: seen.activity,
      },
    });
  }

  const ordered = [...projects.entries()]
    .map(([key, table]) => {
      const actors = [...table.actors.values()]
        .sort((a, b) => RANK[a.actor.activity] - RANK[b.actor.activity] || a.actor.name.localeCompare(b.actor.name))
        .map((candidate) => candidate.actor);
      return { key, table, actors, rank: actors.length ? RANK[actors[0]?.activity ?? "done"] : 9 };
    })
    .sort(
      (a, b) => a.rank - b.rank || (a.table.newest < b.table.newest ? 1 : a.table.newest > b.table.newest ? -1 : 0),
    );

  const tables: FeedTable[] = [];
  let seats = FEED_ACTOR_LIMIT;
  for (const entry of ordered.slice(0, FEED_TABLE_LIMIT)) {
    const room = Math.min(FEED_TABLE_SEATS, seats);
    const shown = entry.actors.slice(0, room);
    seats -= shown.length;
    const seated = new Set(shown.map((actor) => actor.id));
    // One line for each pair, the newest card first; a line needs both agents at the table.
    const pairs = new Set<string>();
    const links: FeedTableLink[] = [];
    for (const link of entry.table.links) {
      const pair = `${link.from}|${link.to}`;
      if (!seated.has(link.from) || !seated.has(link.to) || pairs.has(pair)) continue;
      pairs.add(pair);
      links.push(link);
    }
    tables.push({
      key: entry.key,
      name: entry.table.name,
      actors: shown,
      links,
      leads: [...new Set(links.map((link) => link.from))],
      overflow: entry.actors.length - shown.length,
      now: entry.table.now?.title ?? null,
      working: entry.table.working,
      needsYou: entry.table.needsYou,
    });
  }
  return { tables, overflowTables: Math.max(0, ordered.length - FEED_TABLE_LIMIT), deadline };
}

function sameActor(a: FeedTableActor, b: FeedTableActor): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.activity === b.activity &&
    a.hue === b.hue &&
    a.provider === b.provider &&
    a.model === b.model
  );
}

/**
 * Whether two models draw the same. A delta changes some card of the feed most of the time, and
 * almost never what the tables show, so the page compares before it writes to the DOM.
 */
export function sameFeedTables(a: FeedTablesModel, b: FeedTablesModel): boolean {
  if (a.overflowTables !== b.overflowTables || a.deadline !== b.deadline || a.tables.length !== b.tables.length)
    return false;
  return a.tables.every((table, index) => {
    const other = b.tables[index];
    return (
      other !== undefined &&
      table.key === other.key &&
      table.name === other.name &&
      table.now === other.now &&
      table.working === other.working &&
      table.needsYou === other.needsYou &&
      table.overflow === other.overflow &&
      table.links.length === other.links.length &&
      table.links.every((link, at) => {
        const peer = other.links[at];
        return peer !== undefined && link.key === peer.key && link.from === peer.from && link.to === peer.to;
      }) &&
      table.actors.length === other.actors.length &&
      table.actors.every((actor, at) => {
        const peer = other.actors[at];
        return peer !== undefined && sameActor(actor, peer);
      })
    );
  });
}

/**
 * The seat of each agent at its table, kept while the agent stays, so the others do not move when one
 * leaves. An agent that handed work over takes the seat at the back (0) when it is free; at a table
 * with such an agent the others start at the next seat. `book` is keyed by table and agent, holds at most `FEED_ACTOR_LIMIT` entries, and the page
 * drops it with the feed.
 */
export function assignTableSeats(book: Map<string, number>, tables: readonly FeedTable[]): void {
  const present = new Set<string>();
  for (const table of tables) for (const actor of table.actors) present.add(`${table.key}|${actor.id}`);
  for (const key of [...book.keys()]) if (!present.has(key)) book.delete(key);
  for (const table of tables) {
    const used = new Set<number>();
    for (const actor of table.actors) {
      const seat = book.get(`${table.key}|${actor.id}`);
      if (seat !== undefined) used.add(seat);
    }
    const leads = new Set(table.leads);
    const ordered = [...table.actors].sort((a, b) => Number(leads.has(b.id)) - Number(leads.has(a.id)));
    for (const actor of ordered) {
      const key = `${table.key}|${actor.id}`;
      if (book.has(key)) continue;
      let seat = leads.size > 0 && !leads.has(actor.id) ? 1 : 0;
      while (used.has(seat) && seat < FEED_TABLE_SEATS - 1) seat += 1;
      if (used.has(seat)) seat = [0, 1, 2, 3].find((free) => !used.has(free)) ?? seat;
      book.set(key, seat);
      used.add(seat);
    }
  }
}
