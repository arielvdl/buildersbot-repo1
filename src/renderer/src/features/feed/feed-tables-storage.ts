import { createSignal } from "solid-js";

/**
 * Whether the reader folded the tables at the top of the feed into a strip, kept on this computer.
 * The value is read once when the feed opens and written when it changes: a few bytes, no timer.
 */
const STORAGE_KEY = "buildersbot:feed-tables:v1";

function read(storage: Pick<Storage, "getItem"> = window.localStorage): boolean {
  try {
    return storage.getItem(STORAGE_KEY) === "folded";
  } catch {
    return false;
  }
}

/** Call it in a component. */
export function createFeedTablesFold() {
  const [folded, setFolded] = createSignal(read());
  return {
    folded,
    setFolded: (next: boolean) => {
      setFolded(next);
      try {
        if (next) window.localStorage.setItem(STORAGE_KEY, "folded");
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // A display preference must not block the feed.
      }
    },
  };
}
