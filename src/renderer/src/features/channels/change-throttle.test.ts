import { describe, expect, it } from "vitest";
import { type ChangeThrottleClock, createChangeThrottle } from "./change-throttle";

function fakeClock() {
  let now = 1_000_000;
  const timers: { id: number; at: number; callback: () => void }[] = [];
  let nextId = 1;
  const clock: ChangeThrottleClock = {
    now: () => now,
    setTimeout: (callback, ms) => {
      const timer = { id: nextId++, at: now + ms, callback };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout: (handle) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index !== -1) timers.splice(index, 1);
    },
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      for (const timer of timers.filter((candidate) => candidate.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
    },
    pending: () => timers.length,
  };
}

/** A read that takes `ms` of the fake clock, and records the page flag of each start. */
function reader(time: ReturnType<typeof fakeClock>, ms: number) {
  const starts: boolean[] = [];
  return {
    starts,
    run: async (page: boolean) => {
      starts.push(page);
      time.advance(ms);
    },
  };
}

describe("createChangeThrottle", () => {
  it("starts the first read at once", async () => {
    const time = fakeClock();
    const read = reader(time, 10);
    const throttle = createChangeThrottle(read.run, time.clock);
    await throttle.request(true);
    expect(read.starts).toEqual([true]);
  });

  it("makes the changes that come in the wait one read, with the page if any asked for it", async () => {
    const time = fakeClock();
    const read = reader(time, 10);
    const throttle = createChangeThrottle(read.run, time.clock);
    await throttle.request(false);
    const first = throttle.request(false);
    const second = throttle.request(true);
    expect(read.starts).toEqual([false]);
    expect(time.pending()).toBe(1);
    time.advance(150);
    await Promise.all([first, second]);
    expect(read.starts).toEqual([false, true]);
  });

  it("waits three times as long as a slow read took", async () => {
    const time = fakeClock();
    const read = reader(time, 200);
    const throttle = createChangeThrottle(read.run, time.clock);
    await throttle.request(false);
    void throttle.request(false);
    time.advance(599);
    expect(read.starts).toHaveLength(1);
    time.advance(1);
    expect(read.starts).toHaveLength(2);
  });

  it("never waits more than two seconds", async () => {
    const time = fakeClock();
    const read = reader(time, 5_000);
    const throttle = createChangeThrottle(read.run, time.clock);
    await throttle.request(false);
    void throttle.request(false);
    time.advance(1_999);
    expect(read.starts).toHaveLength(1);
    time.advance(1);
    expect(read.starts).toHaveLength(2);
  });

  it("starts at once when the last read ended long ago", async () => {
    const time = fakeClock();
    const read = reader(time, 10);
    const throttle = createChangeThrottle(read.run, time.clock);
    await throttle.request(false);
    time.advance(10_000);
    await throttle.request(false);
    expect(read.starts).toHaveLength(2);
  });

  it("starts nothing after dispose and settles a waiting request", async () => {
    const time = fakeClock();
    const read = reader(time, 10);
    const throttle = createChangeThrottle(read.run, time.clock);
    await throttle.request(false);
    const waiting = throttle.request(true);
    throttle.dispose();
    await waiting;
    time.advance(5_000);
    await throttle.request(true);
    expect(read.starts).toEqual([false]);
  });
});
