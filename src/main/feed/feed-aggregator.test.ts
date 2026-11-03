// @vitest-environment node

import type { AgentEvent, AgentRuntimeSnapshot } from "@buildersbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { FeedAggregator } from "./feed-aggregator";

const SERVER = "local";

function snapshot(activeTurns: AgentRuntimeSnapshot["activeTurns"]): AgentRuntimeSnapshot {
  return {
    agents: [],
    activeTurns,
    work: [],
    latestMessages: [],
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: [],
    pendingBrowserTakeovers: [],
    failedTurns: [],
  };
}

function aggregator() {
  return new FeedAggregator({ redact: (text) => text, now: () => Date.parse("2026-11-03T12:00:00Z") });
}

const started = (threadId: string, turnId: string): AgentEvent => ({
  type: "turn-started",
  agentId: "a1",
  threadId,
  turnId,
});

describe("FeedAggregator runtime snapshot", () => {
  it("keeps a run in a task thread open: the snapshot lists the chat turn only", () => {
    const feed = aggregator();
    feed.ingest(SERVER, started("chat", "t-chat"));
    feed.ingest(SERVER, started("task", "t-task"));
    // The snapshot lists the chat turn and, as the service builds it, never the task turn.
    feed.ingest(SERVER, {
      type: "runtime-snapshot",
      snapshot: snapshot([{ agentId: "a1", threadId: "chat", turnId: "t-chat" }]),
    });
    const states = Object.fromEntries(feed.items().items.map((card) => [card.threadId, card.state]));
    expect(states).toEqual({ chat: "working", task: "working" });
  });

  it("ends a chat run that the snapshot no longer lists", () => {
    const feed = aggregator();
    feed.ingest(SERVER, started("chat", "t-chat"));
    feed.ingest(SERVER, {
      type: "runtime-snapshot",
      snapshot: snapshot([{ agentId: "a1", threadId: "chat", turnId: "t-chat" }]),
    });
    // The turn ended and no `turn-completed` came.
    feed.ingest(SERVER, { type: "runtime-snapshot", snapshot: snapshot([]) });
    expect(feed.items().items.map((card) => card.state)).toEqual(["done"]);
  });

  it("keeps the steps of a task run that goes on after a snapshot", () => {
    const feed = aggregator();
    feed.ingest(SERVER, started("task", "t-task"));
    feed.ingest(SERVER, { type: "runtime-snapshot", snapshot: snapshot([]) });
    feed.ingest(SERVER, {
      type: "turn-progress",
      agentId: "a1",
      threadId: "task",
      turnId: "t-task",
      detail: "Reading the file",
    });
    const [card] = feed.items().items;
    expect(card?.state).toBe("working");
    expect(card?.lastStep?.text).toBe("Reading the file");
  });
});
