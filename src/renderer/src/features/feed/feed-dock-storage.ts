import { createSignal } from "solid-js";

/**
 * Whether the reader folded the list under the tables of the feed into a bar, kept on this computer. The
 * value is read once when the feed opens and written when it changes: a few bytes, no timer. Without a
 * saved choice, the list is open.
 */
const STORAGE_KEY = "buildersbot:feed-dock:v1";

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "folded";
  } catch {
    return false;
  }
}

/** Call it in a component. */
export function createFeedDockFold() {
  const [folded, setFolded] = createSignal(read());
  return {
    folded,
    setFolded: (next: boolean) => {
      setFolded(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "folded" : "open");
      } catch {
        // A display preference must not block the feed.
      }
    },
  };
}
