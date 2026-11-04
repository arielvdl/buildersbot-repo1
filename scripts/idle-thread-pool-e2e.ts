// Checks the pool of idle provider threads (`IdleThreadPool`) with the limits that follow the memory
// (`idleLimit()` and `releaseAfterMs()` as functions). It runs the real pool with fake threads and short
// times, and waits for states. No provider, account or network is used.
//   1. With `idleLimit()` = 6, six idle threads stay open.
//   2. When `idleLimit()` falls to 2 and one more thread goes idle, the longest idle threads close and
//      keep a snapshot; the 2 newest stay open.
//   3. A thread in a turn, and one whose turn is starting, never closes, even with a limit of 0.
//   4. `releaseAfterMs()` as a function: a thread armed after the change closes at the new time; a
//      thread that goes idle again is armed with the new time; a timer that already runs keeps its time.
//   5. Three calls of `wake` for a closed thread open it once.
//   7. A thread that cannot be released (a background task) is not closed by the short idle time of the memory
//      policy: it stays open past 3 times that time, closes at the fixed cap for a provider that stops
//      reporting, and closes at the normal time once it can be released. `releaseIdle` (critical memory) leaves it.
//   6. `LaneBudget.idlePolicy` on a 24 GB Mac with 55% to 80% free (the installed app of 2026-11-03): the
//      old policy kept 8 idle sessions for 10 minutes; `lean` keeps 3. Low memory and critical are the
//      same with and without `lean`.
// `bun scripts/idle-thread-pool-e2e.ts`. Writes .buildersbot-build/idle-thread-pool-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Scope } from "effect";
import { LaneBudget } from "../src/backend/agent/lane-budget";
import type { HostMemory } from "../src/backend/host-memory";
import { FORCE_RELEASE_AFTER_MS, type IdleThread, IdleThreadPool } from "../src/backend/idle-thread-pool";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/idle-thread-pool-e2e");

interface FakeThread extends IdleThread {
  name: string;
}

const report: { passed: boolean; error?: string } = { passed: false };
type Fact = string | number | boolean | null | Fact[];
const facts: { [key: string]: Fact } = {};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

async function waitFor(label: string, read: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!read()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await sleep(10);
  }
}

/** A pool over fake threads, with the limits that a test changes. */
function makePool(limits: { idleLimit: () => number; releaseAfterMs: () => number }) {
  const scope = Scope.makeUnsafe();
  const closed: string[] = [];
  const reopened: string[] = [];
  const pool: IdleThreadPool<FakeThread, string> = new IdleThreadPool<FakeThread, string>({
    releaseAfterMs: limits.releaseAfterMs,
    idleLimit: limits.idleLimit,
    scope: () => scope,
    canRelease: () => true,
    snapshot: (thread) => thread.name,
    dispose: (thread) =>
      Effect.sync(() => {
        closed.push(thread.name);
      }),
    reopen: (threadId, name) =>
      Effect.promise(async () => {
        reopened.push(threadId);
        await sleep(30);
        pool.add({ id: threadId, name, activeTurn: null, idleRelease: null, idleSince: 0 });
      }),
  });
  const thread = (name: string): FakeThread => ({ id: name, name, activeTurn: null, idleRelease: null, idleSince: 0 });
  /** Opens a thread and marks it idle, a few ms after the one before, so the order of idling is clear. */
  const idleThread = async (name: string): Promise<FakeThread> => {
    const one = thread(name);
    pool.add(one);
    await sleep(5);
    await run(pool.markIdle(one));
    return one;
  };
  return { pool, closed, reopened, thread, idleThread, scope };
}

try {
  // 1 and 2. The limit that follows the memory.
  {
    let limit = 6;
    const { pool, closed, idleThread } = makePool({ idleLimit: () => limit, releaseAfterMs: () => 60_000 });
    for (const name of ["t1", "t2", "t3", "t4", "t5", "t6"]) await idleThread(name);
    facts.openWithLimit6 = [...pool.ids()];
    assert.deepEqual(facts.openWithLimit6, ["t1", "t2", "t3", "t4", "t5", "t6"], "six idle threads stay open");
    assert.deepEqual(closed, [], "nothing closed with a limit of 6");
    limit = 2;
    await idleThread("t7");
    facts.openWithLimit2 = [...pool.ids()];
    facts.closedByLimit = [...closed];
    assert.deepEqual(facts.openWithLimit2, ["t6", "t7"], "the 2 newest idle threads stay open");
    assert.deepEqual([...closed].sort(), ["t1", "t2", "t3", "t4", "t5"], "the 5 longest idle threads closed");
    assert.ok(
      ["t1", "t2", "t3", "t4", "t5"].every((name) => pool.isReleased(name)),
      "a closed thread keeps its snapshot, so it opens again",
    );
  }

  // 3. A thread in a turn never closes.
  {
    const { pool, closed, thread, idleThread } = makePool({ idleLimit: () => 0, releaseAfterMs: () => 40 });
    const inTurn = thread("in-turn");
    pool.add(inTurn);
    inTurn.activeTurn = {};
    pool.holdForTurn(inTurn);
    const starting = thread("starting");
    pool.add(starting);
    const startGate = Promise.withResolvers<void>();
    const starts = run(pool.startTurn("starting", () => Effect.promise(() => startGate.promise)));
    await idleThread("idle-a");
    await idleThread("idle-b");
    await sleep(200);
    facts.closedWithLimit0 = [...closed];
    assert.ok(!closed.includes("in-turn"), "a thread in a turn is never closed");
    assert.ok(!closed.includes("starting"), "a thread whose turn is starting is never closed");
    assert.ok(pool.has("in-turn") && pool.has("starting"));
    startGate.resolve();
    await starts;
  }

  // 4. `releaseAfterMs()` as a function.
  {
    let after = 600;
    const { pool, closed, idleThread } = makePool({ idleLimit: () => 8, releaseAfterMs: () => after });
    await idleThread("slow");
    after = 60;
    await idleThread("fast");
    await waitFor("the thread armed with the new time closes", () => closed.includes("fast"), 1_000);
    facts.slowOpenAfterNewTime = pool.has("slow");
    assert.equal(pool.has("slow"), true, "a timer that already runs keeps its time");
    // A thread that goes idle again is armed with the new time.
    const again = pool.get("slow");
    assert.ok(again);
    again.activeTurn = {};
    pool.holdForTurn(again);
    again.activeTurn = null;
    await run(pool.markIdle(again));
    const started = Date.now();
    await waitFor("the thread idle again closes at the new time", () => closed.includes("slow"), 400);
    facts.closedAgainAfterMs = Date.now() - started;
    assert.ok(Date.now() - started < 400, "closed well before the old 600 ms");
  }

  // 5. Three calls of `wake` open the thread once.
  {
    const { pool, reopened, idleThread } = makePool({ idleLimit: () => 0, releaseAfterMs: () => 60_000 });
    await idleThread("a");
    await idleThread("b");
    assert.equal(pool.isReleased("a"), true, "the older thread closed with a limit of 0... and keeps its snapshot");
    await Promise.all([run(pool.wake("a")), run(pool.wake("a")), run(pool.wake("a"))]);
    facts.reopens = [...reopened];
    assert.deepEqual(reopened, ["a"], "three calls of wake open the thread once");
    assert.equal(pool.has("a"), true);
  }
  // 6. The warm sessions of the memory policy.
  {
    const totalMb = 24 * 1024;
    const policyAt = (freePercent: number, level: "ok" | "low" | "critical") => {
      const memory: HostMemory = {
        level: () => level,
        turnLimit: () => 64,
        reserveTurn: () => () => {},
        freeMb: () => Math.round((totalMb * freePercent) / 100),
        totalMb: () => totalMb,
        subscribe: () => () => {},
        hostedPlan: false,
        kind: "desktop",
      };
      const budget = new LaneBudget({ memory, lowBelowPercent: 14 });
      return { old: budget.idlePolicy(), lean: budget.idlePolicy(true) };
    };
    for (const free of [55, 70, 80]) {
      const { old, lean } = policyAt(free, "ok");
      facts[`policyFree${free}`] = JSON.stringify({ old, lean });
      assert.equal(old?.idleLimit, 8, `the old policy keeps 8 idle sessions at ${free}% free`);
      assert.equal(lean?.idleLimit, 3, `lean keeps 3 idle sessions at ${free}% free`);
      assert.equal(lean?.releaseAfterMs, old?.releaseAfterMs, "the idle time is the same");
    }
    const lowSame = policyAt(10, "low");
    assert.deepEqual(lowSame.lean, lowSame.old, "low memory is the same with and without lean");
    const criticalSame = policyAt(5, "critical");
    assert.deepEqual(criticalSame.lean, { idleLimit: 0, releaseAfterMs: 2 * 60_000 });
    assert.deepEqual(criticalSame.old, criticalSame.lean, "critical memory is the same with and without lean");
  }
  // 7. A thread with a background task, the short idle time of the memory policy and the fixed cap.
  {
    assert.equal(FORCE_RELEASE_AFTER_MS, 60 * 60_000, "the fixed cap is one hour");
    const makeBusyPool = (force?: number) => {
      const scope = Scope.makeUnsafe();
      const closed: string[] = [];
      const state = { releasable: false };
      const pool: IdleThreadPool<FakeThread, string> = new IdleThreadPool<FakeThread, string>({
        // The policy of memory at low: a short idle time. The retry is short too, so the test does not wait a minute.
        releaseAfterMs: () => 100,
        retryUnreleasableMs: 20,
        ...(force === undefined ? {} : { forceReleaseAfterMs: force }),
        idleLimit: () => 8,
        scope: () => scope,
        canRelease: () => state.releasable,
        snapshot: (thread) => thread.name,
        dispose: (thread) =>
          Effect.sync(() => {
            closed.push(thread.name);
          }),
        reopen: () => Effect.void,
      });
      const thread: FakeThread = { id: "task", name: "task", activeTurn: null, idleRelease: null, idleSince: 0 };
      return { pool, closed, state, thread };
    };
    // (a) With no cap of its own, the session stays past 3 times the idle time (300 ms; the old cap).
    {
      const { pool, closed, thread } = makeBusyPool();
      pool.add(thread);
      await run(pool.markIdle(thread));
      await sleep(450);
      facts.busyClosedAfter450Ms = [...closed];
      assert.equal(closed.length, 0, "a thread with a background task stays open past 3 times the idle time");
      // `releaseIdle` (critical memory) leaves it too.
      await run(pool.releaseIdle());
      assert.equal(closed.length, 0, "releaseIdle leaves a thread that cannot be released");
      assert.equal(pool.has("task"), true);
    }
    // (b) A provider that stops reporting: the fixed cap takes the thread (here 500 ms, injected).
    {
      const { pool, closed, thread } = makeBusyPool(500);
      pool.add(thread);
      await run(pool.markIdle(thread));
      await sleep(300);
      assert.equal(closed.length, 0, "not before the cap");
      const taskClosed = () => closed.includes("task");
      await waitFor("the fixed cap closes the thread", taskClosed, 2_000);
    }
    // (c) The task ends: the thread closes at the normal time.
    {
      const { pool, closed, state, thread } = makeBusyPool();
      pool.add(thread);
      await run(pool.markIdle(thread));
      await sleep(250);
      assert.equal(closed.length, 0);
      state.releasable = true;
      const released = Date.now();
      const taskClosed = () => closed.includes("task");
      await waitFor("the thread closes once the task ended", taskClosed, 1_000);
      facts.closedAfterTaskEndedMs = Date.now() - released;
      assert.ok(Date.now() - released < 500, "within the retry and the normal idle time");
    }
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  const out = { ...report, facts };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
