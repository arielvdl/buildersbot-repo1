// @vitest-environment node
// A message to an agent that exists but is not a member says what to do, so a caller does not retry.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary } from "@buildersbot/contracts/ipc";
import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { BuildersBotDatabase } from "./buildersbot-database";
import { ChannelService } from "./channel-service";
import { MailboxStore } from "./mailbox-store";

const roots: string[] = [];
const databases: BuildersBotDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const agent = (id: string): AgentSummary => ({
  id,
  name: id,
  title: id,
  description: "Works.",
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
});

describe("a recipient that is not a member", () => {
  it("names the agent and says that a person must add it; an unknown agent keeps the generic text", async () => {
    const root = await mkdtemp(join(tmpdir(), "channel-not-member-"));
    roots.push(root);
    const database = new BuildersBotDatabase(root);
    databases.push(database);
    await Effect.runPromise(database.initialize());
    const mailbox = new MailboxStore(root, root, database);
    await Effect.runPromise(mailbox.initialize());
    const agents = [agent("lead"), agent("outsider")];
    const service = new ChannelService(database, mailbox, {
      agents: () => agents,
      generate: () => Effect.succeed("{}"),
      schedule: () => {},
      interrupt: () => Effect.void,
      busy: () => false,
      awaitDrain: () => Effect.void,
      changed: () => {},
      error: () => {},
    });
    const person = { id: "local", name: "You" };
    const channelId = "channel-not-member";
    await Effect.runPromise(
      service.command(
        {
          type: "save",
          operationId: "save:create",
          channelId,
          update: false,
          draft: { name: "Team", title: "", instructions: "", members: [{ agentId: "lead" }], leadAgentId: null },
        },
        person,
      ),
    );
    const send = async (recipientAgentId: string, operationId: string) => {
      const exit = await Effect.runPromiseExit(
        service.command(
          {
            type: "send",
            operationId,
            channelId,
            text: "Hello",
            recipientAgentId,
            replyToMessageId: null,
            attachmentDraftIds: [],
          },
          person,
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      return Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "";
    };
    expect(await send("outsider", "send:1")).toContain("outsider exists but is not a member of this channel");
    expect(await send("ghost", "send:2")).toContain("Select an available member of this channel.");
    await Effect.runPromise(service.stop()).catch(() => {});
  });
});
