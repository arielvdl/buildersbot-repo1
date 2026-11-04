// @vitest-environment node
// A streaming reply flushes ten times a second for each agent. A channel capture is one write and one
// `channels-changed`, so the channel follows a streaming thread at most four times a second (F-20).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary, ConversationSnapshot } from "@buildersbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildersBotDatabase } from "./buildersbot-database";
import { ChannelService } from "./channel-service";
import { MailboxStore } from "./mailbox-store";

const roots: string[] = [];
const databases: BuildersBotDatabase[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const member: AgentSummary = {
  id: "writer",
  name: "writer",
  title: "writer",
  description: "Works in a channel.",
  notifications: true,
  provider: "codex",
  model: "gpt-6-luna",
  reasoningEffort: "low",
  threadId: null,
  workspacePath: "/tmp",
  preview: "",
  updatedAt: null,
  avatarSeed: "writer",
  avatarHue: null,
  avatarUrl: null,
};

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "channel-delta-"));
  roots.push(root);
  const database = new BuildersBotDatabase(root);
  databases.push(database);
  await Effect.runPromise(database.initialize());
  const mailbox = new MailboxStore(root, root, database);
  await Effect.runPromise(mailbox.initialize());
  const reads = vi.fn();
  let threadId = "";
  const service = new ChannelService(database, mailbox, {
    agents: () => [member],
    generate: () => Effect.succeed("{}"),
    schedule: () => {},
    interrupt: () => Effect.void,
    busy: () => false,
    usageLimited: () => false,
    awaitDrain: () => Effect.void,
    changed: () => {},
    error: () => {},
    loadedSnapshot: (id): ConversationSnapshot | undefined => {
      reads(id);
      return { agentId: member.id, threadId: id, messages: [], activeTurnId: "turn-1", revision: 0 };
    },
  });
  await Effect.runPromise(
    service.command(
      {
        type: "save",
        operationId: "save:one",
        channelId: "channel-one",
        update: false,
        draft: { name: "one", title: "", instructions: "", members: [{ agentId: member.id }], leadAgentId: null },
      },
      { id: "local", name: "You" },
    ),
  );
  threadId = service.store.context("channel-one", "buildersbot-topic-channel-one", member.id).threadId;
  const delta = () =>
    service.event({
      type: "conversation-delta",
      agentId: member.id,
      threadId,
      turnId: "turn-1",
      messageId: "message-1",
      delta: "x",
      createdAt: "2026-11-04T00:00:00.000Z",
      revision: 1,
    });
  return { service, reads, delta, threadId: () => threadId };
}

describe("channel capture of streaming text", () => {
  it("captures the first delta at once and the rest once for each 250 ms", async () => {
    const { reads, delta } = await harness();
    vi.useFakeTimers();
    expect(delta()).toBe(true);
    expect(reads).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 9; index += 1) {
      vi.advanceTimersByTime(25);
      delta();
    }
    // 225 ms in: the later deltas wait for the end of the window.
    expect(reads).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(25);
    expect(reads).toHaveBeenCalledTimes(2);
    // No new delta: the next window ends with no capture and no new window.
    vi.advanceTimersByTime(1_000);
    expect(reads).toHaveBeenCalledTimes(2);
    delta();
    expect(reads).toHaveBeenCalledTimes(3);
  });

  it("captures the waiting text when the turn completes", async () => {
    const { service, reads, delta, threadId } = await harness();
    vi.useFakeTimers();
    delta();
    delta();
    expect(reads).toHaveBeenCalledTimes(1);
    service.event({
      type: "turn-completed",
      agentId: member.id,
      threadId: threadId(),
      turnId: "turn-1",
      status: "completed",
    });
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it("captures nothing for a thread that is not a channel's", async () => {
    const { service, reads } = await harness();
    const taken = service.event({
      type: "conversation-delta",
      agentId: member.id,
      threadId: "not-a-channel",
      turnId: "turn-1",
      messageId: "message-1",
      delta: "x",
      createdAt: "2026-11-04T00:00:00.000Z",
      revision: 1,
    });
    expect(taken).toBe(false);
    expect(reads).not.toHaveBeenCalled();
  });
});
