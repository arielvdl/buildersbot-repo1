/**
 * Bulk selection of channel members. The lead is never part of it: the channel always needs one,
 * so the lead can be neither removed nor re-modelled together with the others.
 */

/** The members that a bulk action may reach: every member except the lead. */
export function selectableMemberIds(memberIds: readonly string[], leadAgentId: string | null): string[] {
  return memberIds.filter((id) => id !== leadAgentId);
}

export type BulkSelectionState = "none" | "some" | "all";

/** What the Select all box shows: empty, partly marked or fully marked. */
export function bulkSelectionState(selected: ReadonlySet<string>, selectable: readonly string[]): BulkSelectionState {
  const count = selectable.filter((id) => selected.has(id)).length;
  if (count === 0) return "none";
  return count === selectable.length ? "all" : "some";
}

/** Select all marks everyone who can be marked; with everyone marked it clears instead. */
export function toggleAllSelection(selected: ReadonlySet<string>, selectable: readonly string[]): Set<string> {
  return bulkSelectionState(selected, selectable) === "all" ? new Set() : new Set(selectable);
}

/** Drops what can no longer be marked, such as a member who left or who has just become the lead. */
export function pruneSelection(selected: ReadonlySet<string>, selectable: readonly string[]): Set<string> {
  const allowed = new Set(selectable);
  return new Set([...selected].filter((id) => allowed.has(id)));
}
