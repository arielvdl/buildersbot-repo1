import type { ChannelPage, ChannelTask } from "@buildersbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { channelWorkers, startingChannelTask } from "./channel-conversation-rows";
import { channelStageModel, idleStagePose } from "./channel-stage-model";

const READY: ChannelTask = {
  id: "task-1",
  channelId: "channel-1",
  parentTaskId: null,
  rootTaskId: "task-1",
  ownerAgentId: "agent-1",
  requestMessageId: "message-1",
  instruction: "Do it",
  attachmentDraftIds: [],
  expectedResult: "Result",
  sourceMessageIds: [],
  dependencies: [],
  resources: [],
  state: "queued",
  revision: 0,
  assignmentCount: 0,
  error: null,
};

function pageOf(task: ChannelTask): ChannelPage {
  return {
    channel: {
      id: "channel-1",
      name: "Channel",
      title: "",
      instructions: "",
      members: [{ agentId: "agent-1" }],
      leadAgentId: "agent-1",
      archived: false,
      revision: 0,
      createdAt: "2026-11-03T00:00:00.000Z",
    },
    topicId: "topic-1",
    messages: [],
    tasks: [task],
    olderCursor: null,
    throughSequence: 0,
  };
}

const workers = (task: ChannelTask) => channelWorkers(pageOf(task), [], "Agent", new Set()).map((item) => item.id);

describe("a channel task that has not started its turn", () => {
  it("shows its owner as working, so the channel is not silent while the provider starts", () => {
    expect(startingChannelTask(READY)).toBe(true);
    expect(workers(READY)).toEqual(["agent-1"]);
  });

  it("puts that owner on the stage", () => {
    const model = channelStageModel({
      page: pageOf(READY),
      agents: new Map(),
      agentFallbackName: "Agent",
      workingTurns: [],
      stepLines: {},
      waitingAgentIds: new Set(),
      holds: new Map(),
      now: 0,
    });
    expect(model.actors.map((actor) => actor.id)).toEqual(["agent-1"]);
  });

  it("leaves out a task that waits for a reason the reader already sees", () => {
    const task: ChannelTask = { ...READY, wait: { reason: "tab" } };
    expect(startingChannelTask(task)).toBe(false);
    expect(workers(task)).toEqual([]);
  });

  it("leaves out a task whose start the app tries again, which has its own line", () => {
    const task: ChannelTask = { ...READY, startRetry: { phase: "retrying", attempt: 1, max: 3, nextAt: null } };
    expect(startingChannelTask(task)).toBe(false);
    expect(workers(task)).toEqual([]);
  });
});

describe("an agent on the stage that has reported no step", () => {
  const poseAt = (now: number) =>
    channelStageModel({
      page: pageOf(READY),
      agents: new Map(),
      agentFallbackName: "Agent",
      workingTurns: [],
      stepLines: {},
      waitingAgentIds: new Set(),
      holds: new Map(),
      now,
    });

  it("changes its pose on a beat and asks for the next tick at the end of the beat", () => {
    const first = poseAt(0);
    const later = poseAt(2400);
    expect(first.actors[0]?.activity).not.toBe(later.actors[0]?.activity);
    expect(first.deadline).toBe(2400);
    expect(later.deadline).toBe(4800);
  });

  it("starts on a different pose for each agent, so the stage does not move in step", () => {
    const poses = new Set(["agent-a", "agent-b", "agent-c", "agent-d"].map((id) => idleStagePose(id, 0).activity));
    expect(poses.size).toBeGreaterThan(1);
  });
});

describe("the request on the stage table", () => {
  const titleOf = (instruction: string) =>
    channelStageModel({
      page: pageOf({ ...READY, instruction }),
      agents: new Map(),
      agentFallbackName: "Agent",
      workingTurns: [],
      stepLines: {},
      waitingAgentIds: new Set(),
      holds: new Map(),
      now: 0,
    }).request?.title;

  it("names the request by its words when an image comes first", () => {
    expect(titleOf("@[image.png](attachment:03c6c97e-1)\n\nRefazer o topo dos filtros")).toBe(
      "Refazer o topo dos filtros",
    );
    expect(titleOf("@[image.png](attachment:03c6c97e-1) Refazer o topo")).toBe("Refazer o topo");
  });

  it("shows the file names when the request has only files", () => {
    expect(titleOf("@[image.png](attachment:03c6c97e-1)")).toBe("image.png");
  });
});
