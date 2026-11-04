// @vitest-environment node
// An automatic channel memory that no turn updated for 45 days expires; a manual one is fixed.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary } from "@buildersbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { BuildersBotDatabase } from "./buildersbot-database";
import { ChannelHistory } from "./channel-history";
import { CHANNEL_MEMORY_EXPIRY_DAYS, CHANNEL_MEMORY_FOLD_AT } from "./channel-memory-store";
import { ChannelService } from "./channel-service";
import { MailboxStore } from "./mailbox-store";

const roots: string[] = [];
const databases: BuildersBotDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const lead: AgentSummary = {
  id: "lead",
  name: "lead",
  title: "lead",
  description: "Works in the channel.",
  notifications: true,
  provider: "codex",
  model: "gpt-6-luna",
  reasoningEffort: "low",
  threadId: null,
  workspacePath: "/tmp",
  preview: "",
  updatedAt: null,
  avatarSeed: "lead",
  avatarHue: null,
  avatarUrl: null,
};

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "channel-memory-aging-"));
  roots.push(root);
  const database = new BuildersBotDatabase(root);
  databases.push(database);
  await Effect.runPromise(database.initialize());
  const mailbox = new MailboxStore(root, root, database);
  await Effect.runPromise(mailbox.initialize());
  const service = new ChannelService(database, mailbox, {
    agents: () => [lead],
    generate: () => Effect.succeed("{}"),
    schedule: () => {},
    interrupt: () => Effect.void,
    busy: () => false,
    awaitDrain: () => Effect.void,
    changed: () => {},
    error: () => {},
  });
  const channelId = "channel-aging";
  await Effect.runPromise(
    service.command(
      {
        type: "save",
        operationId: "save:create",
        channelId,
        update: false,
        draft: { name: "Aging", title: "", instructions: "", members: [{ agentId: "lead" }], leadAgentId: null },
      },
      { id: "local", name: "You" },
    ),
  );
  const age = (memoryId: string, days: number) =>
    database.connection
      .prepare("UPDATE projection_channel_memories SET updated_at = ? WHERE memory_id = ?")
      .run(new Date(Date.now() - days * 86_400_000).toISOString(), memoryId);
  return { service, channelId, age };
}

describe("channel memory aging", () => {
  it("expires an old automatic memory and keeps a recent one and a manual one", async () => {
    const { service, channelId, age } = await harness();
    const old = service.memories.saveFromTool(channelId, "Old decision", "turn-1", "cmd-1");
    const recent = service.memories.saveFromTool(channelId, "Recent decision", "turn-2", "cmd-2");
    const fixed = service.memories.createManual(channelId, "Owner rule");
    age(old.id, CHANNEL_MEMORY_EXPIRY_DAYS + 1);
    age(recent.id, CHANNEL_MEMORY_EXPIRY_DAYS - 1);
    age(fixed.id, 400);
    expect(service.memories.expireStale(channelId)).toBe(1);
    expect(
      service.memories
        .list(channelId)
        .map((memory) => memory.text)
        .sort(),
    ).toEqual(["Owner rule", "Recent decision"]);
    expect(service.memories.expireStale(channelId)).toBe(0);
    await Effect.runPromise(service.stop()).catch(() => {});
  });

  it("asks for a fold in the packet from 28 of 32 memories, and not before", async () => {
    const { service, channelId } = await harness();
    await Effect.runPromise(
      service.command(
        {
          type: "send",
          operationId: "send:1",
          channelId,
          text: "Hello",
          recipientAgentId: null,
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        { id: "local", name: "You" },
      ),
    );
    const task = service.store.tasks(channelId).at(-1);
    if (!task) throw new Error("no task");
    const history = new ChannelHistory(service.store, () => Effect.succeed("{}"), service.memories);
    const packet = () => Effect.runPromise(history.prepare(task, lead, lead, null, []));
    for (let index = 0; index < CHANNEL_MEMORY_FOLD_AT - 1; index += 1)
      service.memories.createManual(channelId, `Fact number ${index}`);
    expect((await packet()).text).not.toContain("fold related ones");
    service.memories.createManual(channelId, "Fact number last");
    expect((await packet()).text).toContain(`holds ${CHANNEL_MEMORY_FOLD_AT} of 32`);
    await Effect.runPromise(service.stop()).catch(() => {});
  });
});
