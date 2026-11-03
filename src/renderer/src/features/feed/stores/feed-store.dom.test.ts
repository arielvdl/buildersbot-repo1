import { FEED_CONTRACT_VERSION, type FeedDelta, type FeedSnapshot } from "@buildersbot/contracts/ipc";
import { createRoot, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFeedItem } from "../../../preview/mock-feed";
import type { FeedPort } from "../feed-port";
import { createFeedStore } from "./feed-store";

/**
 * The feed page watches for as long as it is open. A window that the system calls hidden must not stop
 * it: nothing may bring it back, and the cards then stand still while a person looks at them.
 */

function snapshot(cursor: number): FeedSnapshot {
  return { v: FEED_CONTRACT_VERSION, cursor, items: [], truncated: false };
}

function installPort() {
  const cursor = 0;
  let onDelta: ((delta: FeedDelta) => void) | undefined;
  const getSnapshot = vi.fn(async (): Promise<FeedSnapshot> => snapshot(cursor));
  const setWatching = vi.fn(async (_input: { watching: boolean }): Promise<void> => undefined);
  const port: FeedPort = {
    getSnapshot,
    setWatching,
    onDelta: (listener) => {
      onDelta = listener;
      return () => {
        onDelta = undefined;
      };
    },
    act: vi.fn(),
  };
  return { port, getSnapshot, setWatching, send: (delta: FeedDelta) => onDelta?.(delta) };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

const settle = async () => {
  flush();
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => setVisibility("visible"));

describe("feed store watching", () => {
  it("keeps watching when the window is called hidden, and asks again when it shows", async () => {
    const feed = installPort();
    const { setWatching, getSnapshot } = feed;
    const dispose = createRoot((dispose) => {
      createFeedStore(
        () => feed.port,
        () => "error",
      );
      return dispose;
    });
    await settle();
    expect(setWatching).toHaveBeenCalledTimes(1);
    expect(setWatching).toHaveBeenLastCalledWith({ watching: true });
    expect(getSnapshot).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    await settle();
    expect(setWatching).not.toHaveBeenCalledWith({ watching: false });

    setVisibility("visible");
    await settle();
    expect(setWatching).toHaveBeenLastCalledWith({ watching: true });
    expect(getSnapshot).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(getSnapshot).toHaveBeenCalledTimes(3);

    dispose();
    await settle();
    expect(setWatching).toHaveBeenLastCalledWith({ watching: false });
  });

  it("applies a delta that arrives while the window is hidden", async () => {
    const feed = installPort();
    const item = mockFeedItem(0, 1);
    let store: ReturnType<typeof createFeedStore> | undefined;
    const dispose = createRoot((dispose) => {
      store = createFeedStore(
        () => feed.port,
        () => "error",
      );
      return dispose;
    });
    await settle();
    setVisibility("hidden");
    feed.send({ v: FEED_CONTRACT_VERSION, cursor: 1, upserts: [item], removes: [] });
    await settle();
    expect(store?.items().map((card) => card.id)).toEqual([item.id]);
    dispose();
  });
});
