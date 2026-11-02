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
// `bun scripts/idle-thread-pool-e2e.ts`. Writes .buildersbot-build/idle-thread-pool-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Scope } from "effect";
import { type IdleThread, IdleThreadPool } from "../src/backend/idle-thread-pool";

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
