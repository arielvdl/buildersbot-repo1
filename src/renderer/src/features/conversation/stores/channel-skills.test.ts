import { describe, expect, it } from "vitest";
import { channelSkillAgentIds } from "./channel-skills";

const ana = { id: "a1" };
const bia = { id: "b2" };

describe("channelSkillAgentIds", () => {
  it("takes the agents that the draft tags, once each", () => {
    expect(channelSkillAgentIds("@[Ana](agent:a1) @[Bia](agent:b2) use @[Ana](agent:a1)", [ana, bia])).toEqual([
      "a1",
      "b2",
    ]);
  });

  it("ignores a tag of an agent that is not in the channel", () => {
    expect(channelSkillAgentIds("@[Zed](agent:z9) olá", [ana, bia])).toEqual([]);
  });

  it("uses the only agent of a channel when nobody is tagged", () => {
    expect(channelSkillAgentIds("olá", [ana])).toEqual(["a1"]);
  });

  it("offers no agent in a channel of several when nobody is tagged", () => {
    expect(channelSkillAgentIds("olá", [ana, bia])).toEqual([]);
  });
});
