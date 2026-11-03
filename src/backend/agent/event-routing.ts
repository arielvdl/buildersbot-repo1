import type { AgentEvent } from "@buildersbot/contracts/ipc";

/** The events that say what a run does: its start, its steps and its end. */
function isRunActivity(event: AgentEvent): boolean {
  return event.type === "turn-started" || event.type === "turn-progress" || event.type === "turn-completed";
}

/**
 * Gives an agent event to the first taker that wants it (a channel, a messaging thread, a task thread).
 * The event then stays inside the service and never reaches `emit`, so the run of such a thread is
 * handed to `runActivity` as well: the feed reads the runs there. An event that no taker wants goes to `emit`.
 */
export function routeAgentEvent(
  event: AgentEvent,
  takers: ReadonlyArray<(event: AgentEvent) => boolean>,
  out: { emit(event: AgentEvent): void; runActivity(event: AgentEvent): void },
): void {
  for (const take of takers) {
    if (!take(event)) continue;
    if (isRunActivity(event)) out.runActivity(event);
    return;
  }
  out.emit(event);
}
