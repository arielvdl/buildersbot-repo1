// @vitest-environment node
// The idle policy of the lane budget: how many idle sessions stay open, and for how long, by free memory.
import { describe, expect, it } from "vitest";
import type { HostMemory, HostMemoryLevel } from "../host-memory";
import { LaneBudget } from "./lane-budget";

const MINUTE_MS = 60_000;

function budget(freeMb: number | null, level: HostMemoryLevel = "ok"): LaneBudget {
  const memory: HostMemory = {
    level: () => level,
    turnLimit: () => 64,
    reserveTurn: () => () => undefined,
    freeMb: () => freeMb,
    totalMb: () => 24_000,
    subscribe: () => () => undefined,
    hostedPlan: false,
    kind: "desktop",
  };
  return new LaneBudget({ memory, lowBelowPercent: 14, sessionMb: 300 });
}

describe("LaneBudget.idlePolicy", () => {
  it("keeps at most 4 idle sessions for 5 minutes when memory is plentiful", () => {
    expect(budget(20_000).idlePolicy()).toEqual({ idleLimit: 4, releaseAfterMs: 5 * MINUTE_MS });
  });

  it("keeps fewer sessions as the room shrinks", () => {
    // floor = 14% of 24000 + 600 = 3960 MB; free 5500 gives spare 5.
    expect(budget(5_500).idlePolicy()).toEqual({ idleLimit: 2, releaseAfterMs: 5 * MINUTE_MS });
  });

  it("closes sessions fast under pressure", () => {
    expect(budget(20_000, "low").idlePolicy()).toEqual({ idleLimit: 2, releaseAfterMs: 2 * MINUTE_MS });
    expect(budget(20_000, "critical").idlePolicy()).toEqual({ idleLimit: 0, releaseAfterMs: 2 * MINUTE_MS });
    expect(budget(3_000).idlePolicy()).toEqual({ idleLimit: 2, releaseAfterMs: 2 * MINUTE_MS });
  });

  it("gives no room for an extra tab when the level is low, even with free memory", () => {
    expect(budget(20_000).spareSessions()).toBeGreaterThan(0);
    expect(budget(20_000, "low").spareSessions()).toBe(0);
    expect(budget(20_000, "critical").hasRoom()).toBe(false);
  });

  it("gives no policy without a reading", () => {
    expect(budget(null).idlePolicy()).toBeNull();
  });
});
