// @vitest-environment node
// What the lead of a channel is told about the channel memory, by how many messages a person wrote.
import { describe, expect, it } from "vitest";
import { memoryCueFor } from "./channel-history";

describe("channel memory cue", () => {
  it("announces the memory on the first message of a person", () => {
    expect(memoryCueFor(1)).toContain("first message");
  });

  it("asks for a save on every fourth message, and says nothing in between", () => {
    expect([0, 2, 3, 5, 6, 7, 9].map(memoryCueFor)).toEqual(Array(7).fill(null));
    expect(memoryCueFor(4)).toContain("channel_remember");
    expect(memoryCueFor(8)).toContain("8 messages");
  });
});
