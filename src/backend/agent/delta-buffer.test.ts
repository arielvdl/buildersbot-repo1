// @vitest-environment node
import type { AgentEvent } from "@buildersbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildersBotDatabase } from "../buildersbot-database";
import type { ConversationRuntime } from "./conversation-runtime";
import { DeltaBuffer, flushDelayMs } from "./delta-buffer";

describe("flushDelayMs", () => {
  it("keeps 100 ms for one or two streaming messages", () => {
    expect(flushDelayMs(0)).toBe(100);
    expect(flushDelayMs(1)).toBe(100);
    expect(flushDelayMs(2)).toBe(100);
  });

  it("adds 100 ms for each two more messages, up to 500 ms", () => {
    expect(flushDelayMs(3)).toBe(200);
    expect(flushDelayMs(7)).toBe(400);
    expect(flushDelayMs(8)).toBe(400);
    expect(flushDelayMs(40)).toBe(500);
  });
});

describe("DeltaBuffer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const events: AgentEvent[] = [];
    const persist = vi.fn(() => 1);
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: a test double has only the members that the buffer reads.
    const conversation = { ensureSnapshot: () => ({ revision: 0 }) } as unknown as ConversationRuntime;
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: a test double has only the members that the buffer reads.
    const database = { persistStreamingMessage: persist } as unknown as BuildersBotDatabase;
    const buffer = new DeltaBuffer({
      conversation,
      database,
      hooks: { emit: (event) => events.push(event) },
    });
    const delta = (messageId: string, text = "a") => ({
      agentId: `agent-${messageId}`,
      externalThreadId: `ext-${messageId}`,
      publicThreadId: `thread-${messageId}`,
      turnId: `turn-${messageId}`,
      messageId,
      text,
      createdAt: "2026-11-04T00:00:00.000Z",
    });
    return { buffer, delta, persist, events };
  }

  it("flushes one streaming message after 100 ms", () => {
    const { buffer, delta, persist, events } = setup();
    buffer.buffer(delta("m1", "a"));
    buffer.buffer(delta("m1", "b"));
    vi.advanceTimersByTime(99);
    expect(persist).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "conversation-delta", delta: "ab" });
  });

  it("waits longer when many messages stream, and writes each one once", () => {
    const { buffer, delta, persist } = setup();
    for (let index = 0; index < 8; index += 1) buffer.buffer(delta(`m${index}`));
    // Each message found the earlier ones waiting: 100, 100, 100, 200, 200, 300, 300, 400 ms.
    vi.advanceTimersByTime(99);
    expect(persist).not.toHaveBeenCalled();
    vi.advanceTimersByTime(301);
    expect(persist).toHaveBeenCalledTimes(8);
  });

  it("still flushes a turn at once when it ends", () => {
    const { buffer, delta, persist } = setup();
    for (let index = 0; index < 8; index += 1) buffer.buffer(delta(`m${index}`));
    buffer.flushTurn("turn-m7");
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
