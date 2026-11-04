// @vitest-environment node
import type { AgentSummary } from "@buildersbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import type { AgentClient } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { ContextCompaction } from "./context-compaction";
import type { ProviderPort } from "./provider-runtime";

/** A stand-in with only the members that the budget path calls. */
function stub<T>(members: Partial<T>): T {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: a test double has only the members that this path calls.
  return members as T;
}

const AGENT = stub<AgentSummary>({ id: "agent-1", provider: "codex" });

function setup() {
  const store = stub<AgentStore>({ list: () => [AGENT] });
  const providers = stub<ProviderPort>({
    clientForAgent: () => stub<AgentClient>({ contextCompaction: "events" }),
    isReady: () => true,
  });
  return new ContextCompaction({
    store,
    providers,
    emitError: () => {},
    scheduleDrain: () => {},
    rotateSession: () => {
      throw new Error("not used");
    },
    rotatesSession: () => false,
    isStopping: () => false,
  });
}

function usage(used: number, window: number) {
  return { tokenUsage: { last: { totalTokens: used }, modelContextWindow: window } };
}

describe("when a thread compacts", () => {
  it("compacts at the budget on a window of 1M, not at 800,000 tokens", () => {
    const compaction = setup();
    compaction.updateBudget("thread-1", usage(499_999, 1_000_000));
    expect(compaction.reserve("agent-1", "thread-1")).toBe(false);
    compaction.updateBudget("thread-1", usage(500_000, 1_000_000));
    expect(compaction.reserve("agent-1", "thread-1")).toBe(true);
  });

  it("keeps 80% of a smaller window", () => {
    const compaction = setup();
    compaction.updateBudget("thread-1", usage(159_999, 200_000));
    expect(compaction.reserve("agent-1", "thread-1")).toBe(false);
    compaction.updateBudget("thread-1", usage(160_000, 200_000));
    expect(compaction.reserve("agent-1", "thread-1")).toBe(true);
  });
});
