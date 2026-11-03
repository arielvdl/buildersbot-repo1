/**
 * Spaces out the reads that a change event starts. A reply that streams publishes a change on each
 * chunk, and each read of the channel list runs on the main process, which answers nothing else
 * meanwhile. With many long channels a read takes 100 to 200 ms, so back-to-back reads kept the main
 * process busy and the window stopped answering. After a read, the next one waits three times as long
 * as the read took, between `MIN_GAP_MS` and `MAX_GAP_MS`: the main process spends at most about a
 * quarter of its time on this. Changes that come in the wait become one read.
 */
const MIN_GAP_MS = 150;
const MAX_GAP_MS = 2_000;
const BUSY_FACTOR = 3;

export interface ChangeThrottleClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

const REAL_CLOCK: ChangeThrottleClock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

export interface ChangeThrottle {
  /** Asks for a read. `page` is true when the open channel's page must be read too. */
  request(page: boolean): Promise<void>;
  dispose(): void;
}

export function createChangeThrottle(
  run: (page: boolean) => Promise<void>,
  clock: ChangeThrottleClock = REAL_CLOCK,
): ChangeThrottle {
  let lastEndedAt = Number.NEGATIVE_INFINITY;
  let lastDuration = 0;
  let timer: number | null = null;
  let waiting: { page: boolean; promise: Promise<void>; settle: () => void } | null = null;
  let disposed = false;

  function start(page: boolean): Promise<void> {
    const startedAt = clock.now();
    return run(page).finally(() => {
      lastEndedAt = clock.now();
      lastDuration = lastEndedAt - startedAt;
    });
  }

  function fire(): void {
    const next = waiting;
    timer = null;
    waiting = null;
    if (!next) return;
    void start(next.page).finally(next.settle);
  }

  return {
    request(page) {
      if (disposed) return Promise.resolve();
      if (waiting) {
        waiting.page ||= page;
        return waiting.promise;
      }
      const gap = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, lastDuration * BUSY_FACTOR));
      const wait = lastEndedAt + gap - clock.now();
      if (wait <= 0) return start(page);
      let settle = () => {};
      const promise = new Promise<void>((resolve) => {
        settle = resolve;
      });
      waiting = { page, promise, settle };
      timer = clock.setTimeout(fire, wait);
      return promise;
    },
    dispose() {
      disposed = true;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      waiting?.settle();
      waiting = null;
    },
  };
}
