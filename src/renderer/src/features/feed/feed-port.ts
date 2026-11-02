import type { FeedDesktopApi } from "@buildersbot/contracts/ipc";

/** The bridge calls of the feed page. */
export type FeedPort = FeedDesktopApi;

/** Read on each call: tests and stories replace `window.buildersbot` per case. */
export function feedPort(): FeedPort {
  return window.buildersbot.feed;
}
