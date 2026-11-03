// @vitest-environment node

import type { AgentEvent } from "@buildersbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { routeAgentEvent } from "./event-routing";

const base = { agentId: "a1", threadId: "channel-thread", turnId: "t1" };
const started: AgentEvent = { type: "turn-started", ...base };
const progress: AgentEvent = { type: "turn-progress", ...base, detail: "Reading" };
const completed: AgentEvent = { type: "turn-completed", ...base, status: "completed" };
const queue: AgentEvent = { type: "agents-changed", agents: [] };

function route(event: AgentEvent, takers: Array<(event: AgentEvent) => boolean>) {
  const out: { emitted: AgentEvent[]; activity: AgentEvent[] } = { emitted: [], activity: [] };
  routeAgentEvent(event, takers, {
    emit: (one) => out.emitted.push(one),
    runActivity: (one) => out.activity.push(one),
  });
  return out;
}

describe("routeAgentEvent", () => {
  it("hands the run events of a thread that a taker took to the feed, not to the listeners", () => {
    for (const event of [started, progress, completed]) {
      expect(route(event, [() => false, () => true])).toEqual({ emitted: [], activity: [event] });
    }
  });

  it("does not hand the same event twice: a chat event goes to the listeners only", () => {
    expect(route(started, [() => false, () => false])).toEqual({ emitted: [started], activity: [] });
  });

  it("keeps an event that is not a run event out of the feed tap", () => {
    expect(route(queue, [() => true])).toEqual({ emitted: [], activity: [] });
  });

  it("asks the takers in order and stops at the first", () => {
    const asked: string[] = [];
    route(started, [
      () => {
        asked.push("channels");
        return true;
      },
      () => {
        asked.push("messaging");
        return true;
      },
    ]);
    expect(asked).toEqual(["channels"]);
  });
});
