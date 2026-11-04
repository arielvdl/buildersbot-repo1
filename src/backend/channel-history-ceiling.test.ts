// @vitest-environment node
// The ceilings of the history in one packet: recent messages stay under 16 KB, older ones go to the summary.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary } from "@buildersbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { BuildersBotDatabase } from "./buildersbot-database";
import { ChannelHistory } from "./channel-history";
import { ChannelService } from "./channel-service";
import { MailboxStore } from "./mailbox-store";

const roots: string[] = [];
const databases: BuildersBotDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function agent(id: string): AgentSummary {
  return {
    id,
    name: id,
    title: id,
    description: "Works in the channel.",
    notifications: true,
    provider: "codex",
    model: "gpt-6-luna",
    reasoningEffort: "low",
    threadId: null,
    workspacePath: "/tmp",
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

describe("the history ceilings of a channel packet", () => {
  it("summarizes the older messages when the recent ones pass 16 KB, and keeps the summary under 6 KB", async () => {
    const root = await mkdtemp(join(tmpdir(), "channel-ceiling-"));
    roots.push(root);
    const database = new BuildersBotDatabase(root);
    databases.push(database);
    await Effect.runPromise(database.initialize());
    const mailbox = new MailboxStore(root, root, database);
    await Effect.runPromise(mailbox.initialize());
    const members = [agent("lead"), agent("helper")];
    const prompts: string[] = [];
    const generate = (_lead: AgentSummary, prompt: string) => {
      prompts.push(prompt);
      return Effect.succeed("Decisions so far: the work is split in two. Source message IDs kept.");
    };
    const service = new ChannelService(database, mailbox, {
      agents: () => members,
      generate,
      schedule: () => {},
      interrupt: () => Effect.void,
      busy: () => false,
      awaitDrain: () => Effect.void,
      changed: () => {},
      error: () => {},
    });
    const channelId = "channel-ceiling";
    const person = { id: "local", name: "You" };
    await Effect.runPromise(
      service.command(
        {
          type: "save",
          operationId: "save:create",
          channelId,
          update: false,
          draft: {
            name: "Ceiling",
            title: "",
            instructions: "",
            members: members.map((member) => ({ agentId: member.id })),
            leadAgentId: null,
          },
        },
        person,
      ),
    );
    // 30 messages of 1,500 characters: about 45 KB, over the 16 KB ceiling and under the old 60 KB one.
    for (let index = 0; index < 30; index += 1)
      await Effect.runPromise(
        service.command(
          {
            type: "send",
            operationId: `send:${index}`,
            channelId,
            text: `Message ${index}: ${"word ".repeat(300)}`,
            recipientAgentId: null,
            replyToMessageId: null,
            attachmentDraftIds: [],
          },
          person,
        ),
      );
    const task = service.store.tasks(channelId).at(-1);
    expect(task).toBeDefined();
    const lead = members[0];
    if (!task || !lead) return;
    const history = new ChannelHistory(service.store, generate, service.memories);
    const packet = await Effect.runPromise(history.prepare(task, lead, lead, null, []));
    expect(prompts.length).toBeGreaterThan(0);
    expect(packet.text).toContain("Shared history summary");
    const summary = service.store.summary(channelId, service.store.firstTopicId(channelId));
    expect(summary.text.length).toBeLessThanOrEqual(6_000);
    expect(summary.throughSequence).toBeGreaterThan(0);
    await Effect.runPromise(service.stop()).catch(() => {});
  });
});
