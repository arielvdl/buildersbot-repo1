/**
 * What an agent does on a stage, and how a step of the host becomes one of those. The agent stage of a
 * channel and the tables of the feed use the same list, so a cube does the same in both.
 */

import type { TurnProgressKind } from "@buildersbot/contracts/ipc";

export type StageActivity =
  | "reading"
  | "thinking"
  | "editing"
  | "running"
  | "delegating"
  | "waiting"
  | "failed"
  | "done";

/** The activities of an agent that works now, as opposed to a wait, a failure or a finished run. */
export type LiveStageActivity = Exclude<StageActivity, "waiting" | "failed" | "done">;

const ACTIVITY_OF_KIND: Readonly<Record<Exclude<TurnProgressKind, "other">, LiveStageActivity>> = {
  read: "reading",
  search: "reading",
  check: "running",
  write: "editing",
  coordinate: "delegating",
};

/**
 * The activity that a host progress line stands for. A host that names the kind of the step decides
 * it. The kind `other`, and a host that predates the kind, fall back to the English text that the
 * host sends for each kind of tool step (`thread-items.ts`): its words are matched here, and text
 * that no word matches reads as thinking.
 */
export function stageActivityOfLine(line: string, kind?: TurnProgressKind): LiveStageActivity {
  if (kind && kind !== "other") return ACTIVITY_OF_KIND[kind];
  const text = line.toLowerCase();
  if (/coordinating|other agent/u.test(text)) return "delegating";
  if (/making the requested changes|reviewing the changes|editing|writing/u.test(text)) return "editing";
  if (/checking the work|verification|running|testing|building|browser|screen|window/u.test(text)) return "running";
  if (/gathering|searching|reading|reviewing the (information|sources)|looking/u.test(text)) return "reading";
  return "thinking";
}

/**
 * Which activity decides the sentence in the bubble of an agent that has no step line. A wait, a failure and a
 * finished run say their own sentence. Any other agent only has a pose that changes on a beat, so it keeps the one
 * sentence "thinking": a new sentence at each beat would type in again and again.
 */
export function stageSayActivity(activity: StageActivity): "thinking" | "waiting" | "failed" | "done" {
  return activity === "waiting" || activity === "failed" || activity === "done" ? activity : "thinking";
}
