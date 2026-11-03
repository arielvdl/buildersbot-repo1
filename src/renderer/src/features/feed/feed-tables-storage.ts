import { createSignal } from "solid-js";

/**
 * Whether the reader folded the tables at the top of the feed into a strip, kept on this computer. The
 * value is read once when the feed opens and written when it changes: a few bytes, no timer. Without a
 * saved choice, a low window opens folded, so the cards keep most of the page.
 */
const STORAGE_KEY = "buildersbot:feed-tables:v1";
const LOW_WINDOW = "(max-height: 800px)";

function read(): boolean {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "folded") return true;
    if (saved === "open") return false;
  } catch {
    // Fall through to the default.
  }
  return window.matchMedia?.(LOW_WINDOW).matches === true;
}

/** Call it in a component. */
export function createFeedTablesFold() {
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
