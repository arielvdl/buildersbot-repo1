import { describe, expect, it } from "vitest";
import { bulkSelectionState, pruneSelection, selectableMemberIds, toggleAllSelection } from "./channel-bulk-select";

describe("bulk selection of channel members", () => {
  it("never offers the lead", () => {
    expect(selectableMemberIds(["a", "lead", "b"], "lead")).toEqual(["a", "b"]);
    expect(selectableMemberIds(["a", "b"], null)).toEqual(["a", "b"]);
  });

  it("reports none, some and all against the members that can be marked", () => {
    const selectable = ["a", "b"];
    expect(bulkSelectionState(new Set(), selectable)).toBe("none");
    expect(bulkSelectionState(new Set(["a"]), selectable)).toBe("some");
    expect(bulkSelectionState(new Set(["a", "b"]), selectable)).toBe("all");
    expect(bulkSelectionState(new Set(), [])).toBe("none");
  });

  it("marks everyone on Select all, and clears when everyone is marked", () => {
    expect([...toggleAllSelection(new Set(["a"]), ["a", "b"])].sort()).toEqual(["a", "b"]);
    expect(toggleAllSelection(new Set(["a", "b"]), ["a", "b"]).size).toBe(0);
  });

  it("drops members who left or became the lead", () => {
    expect([...pruneSelection(new Set(["a", "gone", "lead"]), ["a", "b"])]).toEqual(["a"]);
  });
});
