import { describe, expect, it } from "vitest";
import { stageActivityOfLine } from "../channels/channel-stage-model";
import { appendTurnStepLine } from "./turn-step-lines";

describe("the kind of a progress line", () => {
  it("stays only on the last line of the turn", () => {
    let lines = appendTurnStepLine({}, "t1", "Gathering the relevant information…", 1, "read");
    lines = appendTurnStepLine(lines, "t1", "Making the requested changes…", 2, "write");
    expect(lines.t1?.map((line) => line.kind)).toEqual([undefined, "write"]);
  });

  it("is left out for a host that sends none", () => {
    const lines = appendTurnStepLine({}, "t1", "Checking the work…", 1);
    expect(lines.t1?.[0]).not.toHaveProperty("kind");
  });
});

describe("the stage activity of a line", () => {
  it("follows the kind when the host sends one", () => {
    expect(stageActivityOfLine("Anything at all", "write")).toBe("editing");
    expect(stageActivityOfLine("Anything at all", "check")).toBe("running");
    expect(stageActivityOfLine("Anything at all", "search")).toBe("reading");
    expect(stageActivityOfLine("Anything at all", "read")).toBe("reading");
    expect(stageActivityOfLine("Anything at all", "coordinate")).toBe("delegating");
  });

  it("falls back to the text for `other` and for a host without a kind", () => {
    expect(stageActivityOfLine("Making the requested changes…", "other")).toBe("editing");
    expect(stageActivityOfLine("Checking the work…")).toBe("running");
    expect(stageActivityOfLine("Working through the next tool-assisted step…")).toBe("thinking");
  });

  it("lets a kind win over words in the text", () => {
    expect(stageActivityOfLine("Checking the work…", "coordinate")).toBe("delegating");
  });
});
