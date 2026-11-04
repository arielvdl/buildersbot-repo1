import { describe, expect, it } from "vitest";
import type { HostMemory, HostMemoryLevel } from "../host-memory";
import type { OptimizationPort } from "../optimizations";
import { MemoryHold, type MemoryHoldHooks } from "./memory-hold";

const hooks: MemoryHoldHooks = {
  scheduleAll: () => {},
  retryWaiting: () => {},
  releaseIdleThreads: () => {
    throw new Error("unused");
  },
  emitError: () => {},
};

function memory(kind: "server" | "desktop", level: HostMemoryLevel): HostMemory {
  return {
    level: () => level,
    turnLimit: () => 2,
    reserveTurn: () => () => {},
    subscribe: () => () => {},
    hostedPlan: false,
    kind,
  };
}

const switches = (on: boolean): OptimizationPort => ({
  optimizationEnabled: (id) => on && id === "disable-memory-limit",
  onOptimizationChange: () => () => {},
});

describe("MemoryHold with disable-memory-limit", () => {
  it("holds a low desktop by default", () => {
    const hold = new MemoryHold({ memory: memory("desktop", "low"), hooks, optimizations: switches(false) });
    expect(hold.mayDrain("a")).toBe(false);
    expect(hold.turnLimit()).toBe(2);
  });

  it("lets a low desktop run with no turn limit once the person turns the limit off", () => {
    const hold = new MemoryHold({ memory: memory("desktop", "critical"), hooks, optimizations: switches(true) });
    expect(hold.mayDrain("a")).toBe(true);
    expect(hold.turnLimit()).toBeNull();
  });

  it("never lifts the hold of a server", () => {
    const hold = new MemoryHold({ memory: memory("server", "low"), hooks, optimizations: switches(true) });
    expect(hold.mayDrain("a")).toBe(false);
    expect(hold.turnLimit()).toBe(2);
  });
});
