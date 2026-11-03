import type { AwaitingReplyItem } from "@buildersbot/ui/features/conversation/AwaitingReplies";
import { describe, expect, it } from "vitest";
import { type QuickChatStripProfile, quickChatStripModel } from "./quick-chat-agent-strip-model";

const profile = (id: string): QuickChatStripProfile => ({
  id,
  name: id.toUpperCase(),
  avatarSeed: id,
  avatarHue: null,
  avatarUrl: null,
  provider: "claude",
  model: "claude-sonnet-5-5",
});

const row = (id: string, agentId: string, state: AwaitingReplyItem["state"]) => ({
  id,
  agent: profile(agentId),
  name: agentId.toUpperCase(),
  state,
});

describe("quickChatStripModel", () => {
  it("shows one mark per agent, with the state that says the most", () => {
    const model = quickChatStripModel({
      rows: [row("m1:dev", "dev", "replied"), row("m2:dev", "dev", "working"), row("m2:rev", "rev", "asked")],
      self: profile("quick"),
      activeTurns: {},
      stepLines: {},
    });
    expect(model.agents.map((agent) => [agent.id, agent.state])).toEqual([
      ["dev", "working"],
      ["rev", "asked"],
    ]);
    expect(model.live).toBe(true);
  });

  it("reads the last progress line of the running turn of a working agent", () => {
    const model = quickChatStripModel({
      rows: [row("m1:dev", "dev", "working")],
      self: profile("quick"),
      activeTurns: { dev: "turn-1" },
      stepLines: { "turn-1": [{ id: "turn-1:0", text: "Editing ChannelStage.tsx", at: 1, kind: "write" }] },
    });
    expect(model.agents[0]?.line).toBe("Editing ChannelStage.tsx");
    expect(model.actors.find((actor) => actor.id === "dev")?.activity).toBe("editing");
  });

  it("seats the Quick chat agent at the head, delegating to the agents that still work", () => {
    const model = quickChatStripModel({
      rows: [row("m1:dev", "dev", "working"), row("m1:rev", "rev", "replied")],
      self: profile("quick"),
      activeTurns: {},
      stepLines: {},
    });
    const lead = model.actors.find((actor) => actor.seat === 0);
    expect(lead?.id).toBe("quick");
    expect(lead?.activity).toBe("delegating");
    expect(model.links).toEqual([{ key: "quick:dev", from: "quick", to: "dev" }]);
  });

  it("is not live once every agent has answered or failed", () => {
    const model = quickChatStripModel({
      rows: [row("m1:dev", "dev", "replied"), row("m1:rev", "rev", "failed")],
      self: profile("quick"),
      activeTurns: {},
      stepLines: {},
    });
    expect(model.live).toBe(false);
    expect(model.actors.find((actor) => actor.id === "quick")?.activity).toBe("done");
  });
});
