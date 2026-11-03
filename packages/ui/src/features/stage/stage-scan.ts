/**
 * Whose scan the table shows, and which way it goes. Pure: the board picks the agent, and the table draws the laser in
 * the color of that agent, from its seat across the table.
 */

import { SEATS } from "./stage-geometry";

/** The agent that the scan follows, as the table needs it. */
export interface ScanFocus {
  id: string;
  /** Any CSS color: the accent of the agent. */
  color: string;
  seat: number;
}

interface ScanCandidate {
  id: string;
  color: string;
  seat: number;
  activity: string;
}

const LIVE = new Set(["reading", "thinking", "editing", "running", "delegating"]);

/**
 * The agent that does the work now. The lead (seat 0) has it while it works itself. When the lead delegates, or waits,
 * the work is the other agents', and the lowest seat that works has it. With only a delegating lead left, the lead keeps it.
 */
export function pickScanFocus(actors: readonly ScanCandidate[]): ScanFocus | null {
  const live = actors.filter((actor) => LIVE.has(actor.activity)).sort((a, b) => a.seat - b.seat);
  const doing = live.filter((actor) => actor.activity !== "delegating");
  const chosen = doing[0] ?? live[0];
  return chosen ? { id: chosen.id, color: chosen.color, seat: chosen.seat } : null;
}

/** A direction on the table, in the units of its drawing: `u` runs down-right, `v` down-left. Length 1. */
export interface ScanDirection {
  u: number;
  v: number;
}

/**
 * The laser starts at the seat of the agent and crosses the table to the opposite side. The seat is a direction on the
 * screen, in half-width and half-height units; the table is drawn with `x = (u - v) * half` and `y = (u + v) * top`, so
 * `u = (y + x) / 2` and `v = (y - x) / 2` for the way across. The lead, at the back, gives back to front.
 */
export function scanDirection(seat: number): ScanDirection {
  const [sx, sy] = SEATS[seat] ?? SEATS[0] ?? [0, -1];
  const u = (-sy - sx) / 2;
  const v = (-sy + sx) / 2;
  const length = Math.hypot(u, v) || 1;
  return { u: u / length, v: v / length };
}

/**
 * How far along the direction a point of the table is, from 0 (where the laser starts) to 1 (where it ends). The point
 * is `u`, `v` in 0 to 1.
 */
export function scanDepth(direction: ScanDirection, u: number, v: number): number {
  const low = Math.min(0, direction.u) + Math.min(0, direction.v);
  const high = Math.max(0, direction.u) + Math.max(0, direction.v);
  return (u * direction.u + v * direction.v - low) / (high - low);
}

/** The length of the laser's way across the table, in table units (the table is 1 by 1). */
export function scanSpan(direction: ScanDirection): number {
  return Math.max(0, direction.u) + Math.max(0, direction.v) - (Math.min(0, direction.u) + Math.min(0, direction.v));
}
