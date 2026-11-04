import { stageGeometry } from "@buildersbot/ui/features/stage/stage-geometry";
import { describe, expect, it } from "vitest";

describe("stageGeometry for a feed table", () => {
  it("keeps the size of a small table when it may not grow", () => {
    const small = stageGeometry(600, 900, 280);
    expect(small.fit).toBe(1);
  });

  it("lets a small table grow with a large box", () => {
    const grown = stageGeometry(600, 700, 280, 1.8);
    expect(grown.fit).toBeGreaterThan(1);
    expect(grown.fit).toBeLessThanOrEqual(1.8);
  });

  it("stops the growth where the width no longer holds the seats at the sides", () => {
    const narrow = stageGeometry(300, 900, 280, 1.8);
    const wide = stageGeometry(600, 900, 280, 1.8);
    expect(narrow.fit).toBeLessThan(wide.fit);
    expect(narrow.fit).toBeCloseTo(300 / 240, 5);
  });

  it("does not shrink a table below the old floor", () => {
    expect(stageGeometry(120, 150, 280, 1.8).fit).toBe(0.82);
  });
});
