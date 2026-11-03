import { describe, expect, it } from "vitest";
import { withChannelStageFolded } from "./channel-stage-preference";

describe("withChannelStageFolded", () => {
  it("folds one channel and leaves the others alone", () => {
    const folded = withChannelStageFolded(undefined, "a", true);
    expect(folded.folded).toEqual({ a: true });
    expect(withChannelStageFolded(folded, "b", true).folded).toEqual({ a: true, b: true });
  });

  it("unfolding drops the entry", () => {
    const folded = withChannelStageFolded(withChannelStageFolded(undefined, "a", true), "b", true);
    expect(withChannelStageFolded(folded, "a", false).folded).toEqual({ b: true });
  });
});
