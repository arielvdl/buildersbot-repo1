// Checks the memory reading of the Mac that holds new agent turns (`src/main/mac-memory.ts`) with the
// agent queue clause that uses it (`src/backend/agent/memory-hold.ts`).
//
// On 1 November 2026 macOS showed its low-memory panel ("Your system has run out of application
// memory") while Builders Bot and its agents held about 17 GB. The reading said "ok" the whole time:
// `memory_pressure` gave 39 to 44% "free", with 7 to 9 GB of swap and a kernel pressure level of warn.
// The free percentage counts memory that macOS can still compress, so it stays high on a full Mac.
//
// Checks:
//   1. On macOS, the real reading has the kernel level that `sysctl` gives.
//   2. The samples of 1 November: warn with 8.7 GB of swap holds new turns and tells the held agent.
//   3. A critical kernel level closes the idle provider threads one time.
//   4. A normal kernel level again lets the held agents start.
//   5. Warn with less swap than a full Mac (6.9 GB) holds nothing, and the old rules still apply.
//   6. Each level change reaches the log callback.
//   7. The free memory in MB (`freeMb`, `totalMb`): none before a sample; the percent of the total
//      after one; each start reserves a session until the next sample; a release gives it back once;
//      a release that comes after a new sample gives nothing back; the level and the turn limit do
//      not change with the reservations; `LOW_BELOW` is the threshold of the level `low`.
//   8. The memory budget of the tabs (`LaneBudget`) on that reading: the floor is `LOW_BELOW` of the
//      total plus two sessions; the spare sessions fall with each claim and come back at the next
//      sample, which wakes a refused tab once; no reading gives no budget; the idle policy follows the
//      table of the spec (warm sessions and idle time by room, `low` and `critical`).
// No provider, account or network is used. `bun scripts/mac-memory-pressure-e2e.ts`. It writes
// .buildersbot-build/mac-memory-pressure-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { LaneBudget } from "../src/backend/agent/lane-budget";
import { MemoryHold } from "../src/backend/agent/memory-hold";
import type { HostMemoryLevel } from "../src/backend/host-memory";
import { LANE_SESSION_MB } from "../src/backend/host-memory";
import type { IdlePolicy } from "../src/backend/idle-thread-pool";
import { LOW_BELOW, MacMemory, type MacMemorySample, parseKernelPressure, readMacMemory } from "../src/main/mac-memory";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".buildersbot-build", "mac-memory-pressure-e2e");

interface Report {
  passed: boolean;
  realSample?: MacMemorySample | null;
  realKernelText?: string;
  steps: { sample: MacMemorySample; level: HostMemoryLevel; mayDrain: boolean }[];
  levelChanges: { level: HostMemoryLevel; sample: MacMemorySample }[];
  released: number;
  scheduledAll: number;
  told: string[];
  freeMb?: { sample50: number; withTwoStarts: number; afterNewSample: number };
  idlePolicies?: { [name: string]: IdlePolicy | null };
  error?: string;
}

const report: Report = { passed: false, steps: [], levelChanges: [], released: 0, scheduledAll: 0, told: [] };

/** Resolves when `check` is true. Each hook call checks again. */
function waiter(): { until: (check: () => boolean) => Promise<void>; poke: () => void } {
  const waiting = new Set<{ check: () => boolean; done: () => void }>();
  return {
    until: (check) =>
      check()
        ? Promise.resolve()
        : new Promise<void>((done) => {
            waiting.add({ check, done });
          }),
    poke: () => {
      for (const entry of [...waiting])
        if (entry.check()) {
          waiting.delete(entry);
          entry.done();
        }
    },
  };
}

try {
  await mkdir(OUT, { recursive: true });

  if (process.platform === "darwin") {
    // 1. The real commands. The kernel level can change between the two reads, so a second pair
    //    settles a difference.
    let matched = false;
    for (let attempt = 0; attempt < 3 && !matched; attempt += 1) {
      const sample = await readMacMemory();
      const text = execFileSync("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], {
        encoding: "utf8",
      });
      report.realSample = sample;
      report.realKernelText = text.trim();
      assert.ok(sample, "macOS gives a memory sample");
      matched = sample.kernelPressure === parseKernelPressure(text);
    }
    assert.ok(matched, "the reading has the kernel level of sysctl");
    assert.notEqual(report.realSample?.kernelPressure ?? null, null, "this macOS gives a kernel level");
  }

  // 2-6. The samples of 1 November, through the real reading and the real queue clause.
  let next: MacMemorySample = { freePercent: 44, swapUsedMb: 8718, kernelPressure: "normal" };
  const wake = waiter();
  const memory = new MacMemory({
    read: () => Promise.resolve(next),
    onError: (message) => {
      throw new Error(message);
    },
    onLevelChange: (level, sample) => report.levelChanges.push({ level, sample: { ...sample } }),
  });
  const hold = new MemoryHold({
    memory,
    hooks: {
      scheduleAll: () => {
        report.scheduledAll += 1;
        wake.poke();
      },
      retryWaiting: () => wake.poke(),
      releaseIdleThreads: () =>
        Effect.sync(() => {
          report.released += 1;
          wake.poke();
        }),
      emitError: (code, _error, agentId) => {
        report.told.push(`${code}:${agentId ?? ""}`);
      },
    },
  });
  hold.start();

  async function step(sample: MacMemorySample): Promise<void> {
    next = sample;
    await memory.sample();
    report.steps.push({ sample, level: memory.level(), mayDrain: hold.mayDrain("agent-a") });
  }

  await step({ freePercent: 44, swapUsedMb: 8718, kernelPressure: "normal" });
  assert.equal(memory.level(), "ok", "a normal kernel level with 44% free is ok");

  await step({ freePercent: 44, swapUsedMb: 9400, kernelPressure: "warn" });
  assert.equal(memory.level(), "low", "warn with the swap of a full Mac is low");
  assert.equal(hold.mayDrain("agent-a"), false, "a new turn waits while the memory is low");
  hold.held("agent-a");
  hold.held("agent-a");
  assert.deepEqual(report.told, ["host_memory_low:agent-a"], "the held agent is told one time");

  await step({ freePercent: 41, swapUsedMb: 9800, kernelPressure: "critical" });
  assert.equal(memory.level(), "critical", "a critical kernel level is critical");
  await wake.until(() => report.released === 1);

  await step({ freePercent: 44, swapUsedMb: 9800, kernelPressure: "normal" });
  assert.equal(memory.level(), "ok", "a normal kernel level ends the hold, also with a swap high-water mark");
  assert.equal(hold.mayDrain("agent-a"), true, "a new turn starts again");
  await wake.until(() => report.scheduledAll === 1);

  await step({ freePercent: 39, swapUsedMb: 6917, kernelPressure: "warn" });
  assert.equal(memory.level(), "ok", "warn with less swap than a full Mac holds nothing");

  await step({ freePercent: 12, swapUsedMb: 0, kernelPressure: null });
  assert.equal(memory.level(), "low", "with no kernel level, the free percentage still holds");

  assert.deepEqual(
    report.levelChanges.map((change) => change.level),
    ["low", "critical", "ok", "low"],
    "each level change reaches the log callback",
  );
  assert.equal(report.released, 1, "the idle threads close one time");
  await Effect.runPromise(hold.dispose());
  memory.stop();

  // 7. The free memory in MB.
  const sampleOf = (freePercent: number, kernelPressure: MacMemorySample["kernelPressure"] = "normal") => ({
    freePercent,
    swapUsedMb: 0,
    kernelPressure,
  });
  let reading: MacMemorySample = sampleOf(50);
  const sized = new MacMemory({
    read: () => Promise.resolve(reading),
    onError: (message) => {
      throw new Error(message);
    },
    totalMb: 10_000,
  });
  assert.equal(sized.freeMb(), null, "no free memory before the first sample");
  assert.equal(sized.totalMb(), 10_000);
  await sized.sample();
  assert.equal(sized.freeMb(), 5_000, "the free percent of the total");
  const releaseOne = sized.reserveTurn();
  const releaseTwo = sized.reserveTurn();
  assert.equal(sized.freeMb(), 5_000 - 2 * LANE_SESSION_MB, "each start reserves one session");
  releaseOne();
  releaseOne();
  assert.equal(sized.freeMb(), 5_000 - LANE_SESSION_MB, "a release gives the session back once");
  assert.equal(sized.level(), "ok", "the reservations do not change the level");
  assert.equal(sized.turnLimit(), 64, "or the turn limit");
  reading = sampleOf(40);
  await sized.sample();
  assert.equal(sized.freeMb(), 4_000, "a new sample reads the real memory again and drops the reservations");
  releaseTwo();
  assert.equal(sized.freeMb(), 4_000, "a release after a new sample gives nothing back");
  assert.equal(LOW_BELOW, 14);
  for (const [percent, level] of [
    [LOW_BELOW - 1, "low"],
    [LOW_BELOW + 30, "ok"],
  ] as const) {
    reading = sampleOf(percent);
    const probe = new MacMemory({ read: () => Promise.resolve(reading), onError: () => {}, totalMb: 10_000 });
    await probe.sample();
    assert.equal(probe.level(), level, `${percent}% free is ${level}`);
  }
  report.freeMb = { sample50: 5_000, withTwoStarts: 5_000 - 2 * LANE_SESSION_MB, afterNewSample: 4_000 };

  // 8. The memory budget of the tabs, on a simulated 24 GB.
  const total = 24_000;
  const floorMb = Math.round((total * LOW_BELOW) / 100) + 2 * LANE_SESSION_MB;
  const policies: { [name: string]: IdlePolicy | null } = {};
  async function budgetAt(sample: MacMemorySample) {
    reading = sample;
    const budgetMemory = new MacMemory({ read: () => Promise.resolve(reading), onError: () => {}, totalMb: total });
    await budgetMemory.sample();
    return { budgetMemory, budget: new LaneBudget({ memory: budgetMemory, lowBelowPercent: LOW_BELOW }) };
  }
  {
    const { budgetMemory, budget } = await budgetAt(sampleOf(30));
    assert.equal(budget.floorMb(), floorMb, "the floor is LOW_BELOW of the total plus two sessions");
    const spare = Math.floor((7_200 - floorMb) / LANE_SESSION_MB);
    assert.equal(budget.spareSessions(), spare);
    assert.equal(budget.hasRoom(), true);
    budget.claim();
    assert.equal(budget.spareSessions(), spare - 1, "a claim takes one session from the spare");
    // Claims until no room is left, then a sample that brings room wakes the refused tab once.
    for (let claim = 1; claim < spare; claim += 1) budget.claim();
    assert.equal(budget.spareSessions(), 0);
    assert.equal(budget.hasRoom(), false, "no room left: the extra tab waits");
    let woken = 0;
    budget.start(() => {
      woken += 1;
    });
    reading = sampleOf(30);
    await budgetMemory.sample();
    assert.equal(woken, 1, "a sample with room wakes the refused tab");
    assert.equal(budget.spareSessions(), spare, "the claims end at the next sample");
    await budgetMemory.sample();
    assert.equal(woken, 1, "and wakes it once");
    budget.dispose();
  }
  {
    const none = new LaneBudget({ memory: null, lowBelowPercent: LOW_BELOW });
    assert.equal(none.spareSessions(), null, "no reading: no budget");
    assert.equal(none.hasRoom(), true, "so the fixed limit decides");
    assert.equal(none.idlePolicy(), null, "and the client keeps its fixed idle values");
  }
  for (const [name, sample, warm, minutes] of [
    ["ok-comfort", sampleOf(60), 8, 10],
    ["ok-some-room", sampleOf(30), 5, 5],
    ["ok-no-room", sampleOf(17), 2, 2],
    ["low", sampleOf(12), 2, 2],
    ["critical", sampleOf(6), 0, 2],
  ] as const) {
    const { budget } = await budgetAt(sample);
    const policy = budget.idlePolicy();
    policies[name] = policy;
    assert.deepEqual(policy, { idleLimit: warm, releaseAfterMs: minutes * 60_000 }, `idle policy at ${name}`);
  }
  report.idlePolicies = policies;
  report.passed = true;
} catch (cause) {
  report.error = cause instanceof Error ? cause.message : String(cause);
} finally {
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${report.passed ? "PASS" : "FAIL"}${report.error ? `: ${report.error}` : ""}: report in ${join(OUT, "report.json")}\n`,
  );
  if (!report.passed) process.exitCode = 1;
}
