/**
 * The chats that the user picked in the list with ⌘/Ctrl-click or Shift-click, to act on them
 * together. The picks are the ids of agents and channels in the sections, never markers. A pick whose
 * row left the list (a filter, a move, a delete) drops out by itself, so the selection cannot name a
 * row that is not on screen.
 */

import { createMemo, createSignal } from "solid-js";

/** What a click on a row does to the selection. `none` is a plain click: the row opens as it always did. */
export type SidebarSelectionClick = "toggle" | "range" | "none";

function sidebarSelectionClickKind(event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey">): SidebarSelectionClick {
  if (event.shiftKey) return "range";
  return event.metaKey || event.ctrlKey ? "toggle" : "none";
}

/** The ids from `from` to `to` in the order of the list, both included. Empty when one is not in the list. */
function sidebarSelectionRange(order: readonly string[], from: string, to: string): string[] {
  const start = order.indexOf(from);
  const end = order.indexOf(to);
  if (start < 0 || end < 0) return [];
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

export function createSidebarSelectionStore(deps: { visibleChatIds: () => string[] }) {
  const [picked, setPicked] = createSignal<ReadonlySet<string>>(new Set());
  let anchor: string | null = null;
  const visibleSet = createMemo(() => new Set(deps.visibleChatIds()));
  /** The picked ids that the list still shows, in the order of the list. */
  const ids = createMemo(() => deps.visibleChatIds().filter((id) => picked().has(id)));
  const count = () => ids().length;
  const has = (id: string): boolean => picked().has(id) && visibleSet().has(id);

  function clear(): void {
    anchor = null;
    if (picked().size > 0) setPicked(new Set<string>());
  }

  function toggle(id: string): void {
    if (!visibleSet().has(id)) return;
    const next = new Set(ids());
    if (!next.delete(id)) next.add(id);
    anchor = id;
    setPicked(next);
  }

  /** Picks every row between the last pick and this one. Without a last pick it picks this row. */
  function extendTo(id: string): void {
    if (!visibleSet().has(id)) return;
    if (anchor === null || !visibleSet().has(anchor)) {
      toggle(id);
      return;
    }
    setPicked(new Set(sidebarSelectionRange(deps.visibleChatIds(), anchor, id)));
  }

  /**
   * A click on a row. A ⌘/Ctrl or Shift click changes the selection and returns true, so the row does
   * not open. A plain click ends the selection and returns false, so the row opens as usual.
   */
  function click(event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey">, id: string): boolean {
    const kind = sidebarSelectionClickKind(event);
    if (kind === "none") {
      clear();
      return false;
    }
    if (kind === "range") extendTo(id);
    else toggle(id);
    return true;
  }

  return { clear, click, count, has, ids };
}

export type SidebarSelection = ReturnType<typeof createSidebarSelectionStore>;
