import type { ChannelPage, ChannelTask } from "@buildersbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { channelStageModel } from "./channel-stage-model";

function task(id: string, owner: string | null, parent: string | null, state: ChannelTask["state"]): ChannelTask {
  return {
    id,
    channelId: "channel-1",
    parentTaskId: parent,
    rootTaskId: parent ?? id,
    ownerAgentId: owner,
    requestMessageId: "message-1",
    instruction: "Do it",
    attachmentDraftIds: [],
    expectedResult: "Result",
    sourceMessageIds: [],
    dependencies: [],
    resources: [],
    state,
    revision: 0,
    assignmentCount: 0,
    error: null,
  };
}

function page(tasks: ChannelTask[]): ChannelPage {
  return {
    channel: {
      id: "channel-1",
      name: "Channel",
      title: "",
      instructions: "",
      members: [{ agentId: "lead" }, { agentId: "qa" }, { agentId: "front" }],
      leadAgentId: "lead",
      archived: false,
      revision: 0,
      createdAt: "2026-11-03T00:00:00.000Z",
    },
    topicId: "topic-1",
    messages: [],
    tasks,
    olderCursor: null,
    throughSequence: 0,
  };
}

function modelOf(tasks: ChannelTask[]) {
  return channelStageModel({
    page: page(tasks),
    agents: new Map(),
    agentFallbackName: "Agent",
    workingTurns: [],
    stepLines: {},
    waitingAgentIds: new Set(),
    holds: new Map(),
    now: 1000,
  });
}

describe("channel stage hand-offs", () => {
  it("keeps the lead and the links while the lead waits for the tasks it gave", () => {
    const model = modelOf([
      task("root", "lead", null, "waiting"),
      task("a", "qa", "root", "running"),
      task("b", "front", "root", "running"),
    ]);
    expect(model.actors.map((actor) => actor.id).sort()).toEqual(["front", "lead", "qa"]);
    expect(model.links.map((link) => [link.from, link.to])).toEqual([
      ["lead", "qa"],
      ["lead", "front"],
    ]);
    const lead = model.actors.find((actor) => actor.id === "lead");
    expect(lead?.activity).toBe("delegating");
    expect(lead?.delegatesTo).not.toBeNull();
  });

  it("does not change the activity of a lead that still works", () => {
    const model = modelOf([task("root", "lead", null, "running"), task("a", "qa", "root", "running")]);
    expect(model.links).toHaveLength(1);
    expect(model.actors.find((actor) => actor.id === "lead")?.activity).not.toBe("delegating");
  });

  it("drops the lead and the link when the given tasks are done", () => {
    const model = modelOf([task("root", "lead", null, "waiting"), task("a", "qa", "root", "completed")]);
    expect(model.links).toEqual([]);
    expect(model.actors.map((actor) => actor.id)).not.toContain("lead");
  });

  it("does not add an agent that left the channel", () => {
    const outside = task("root", "gone", null, "waiting");
    const model = modelOf([outside, task("a", "qa", "root", "running")]);
    expect(model.links).toEqual([]);
    expect(model.actors.map((actor) => actor.id)).toEqual(["qa"]);
  });
});
