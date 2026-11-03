// Smoke of the tables at the top of the feed, in the stories (the real components, the real model and
// the preview mock), in a headless Chrome. It checks that:
// - the busy feed draws at most 6 tables, 4 seats at a table and 16 agents, with a "+N" chip for the rest;
// - every agent that the window knows has its provider and model over the cube, and an agent of a joined
//   server has none;
// - a click on the name of a table filters the project, a click on a cube filters the agent, and a second
//   click clears both, with the bar of filters following;
// - a hidden window, tables off screen and `prefers-reduced-motion` stop every loop;
// - with nobody at work (an empty feed, and tables folded into a strip) no board, no animation, no timer
//   and no animation frame of the tables exist;
// - a hand-off at a table (`FeedItem.delegatedBy`) draws one dashed line and flies the cube once; 50
//   deltas that do not change the tables write nothing to their DOM and fly nothing; the line goes when
//   the run ends (A10);
// - the open tables cost at most 3 MB of JS heap over the folded strip, after a forced GC, and no
//   long task of 50 ms or more runs while they work.
// Memory over many enter and leave cycles is measured by the QA gate with a harness story that is not
// kept (a mounted story, changed from inside), because the story switch of Storybook leaks by itself.
// Pass the URL that `bun run storybook` reports; run Storybook with `BUILDERSBOT_STORYBOOK_SOLID_RELEASE=1`
// for memory numbers without the development checks of Solid:
//
//   bun scripts/feed-tables-smoke.ts --storybook=http://localhost:6006 [--browser-executable=<path>]
//
// Writes .buildersbot-build/feed-tables/smoke-report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Browser, type CDPSession, chromium, type Page } from "playwright-core";

declare global {
  interface Window {
    /** The writes to the tables and the cubes that flew, counted by `checkDelegation`. */
    __delegation?: { mutations: number; flights: number };
    __tablesProbe?: {
      timeouts: number;
      intervals: number;
      frames: number;
      live: Map<number, string>;
      liveFrames: Set<number>;
      long: [number, number][];
    };
  }
}

const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const storybook = argument("storybook");
const browserExecutable = argument("browser-executable");
if (!storybook) throw new Error("Pass --storybook=<url>.");

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/feed-tables");
const MB = 1024 * 1024;
const LIMITS = { tables: 6, seats: 4, agents: 16, heapMb: 3, longTaskMs: 50 };

interface Check {
  name: string;
  limit: string;
  measured: string;
  passed: boolean;
}
const report: { checks: Check[]; screenshots: string[]; pageErrors: string[]; passed: boolean } = {
  checks: [],
  screenshots: [],
  pageErrors: [],
  passed: false,
};
const check = (name: string, limit: string, measured: string, passed: boolean) =>
  report.checks.push({ name, limit, measured, passed });

// Counts the timers and animation frames that a file of the tables asks for, and the long tasks.
const PROBE = `(() => {
  if (window.__tablesProbe) return;
  Error.stackTraceLimit = 40;
  const pattern = /(\\/features\\/stage\\/|\\/FeedTables\\.tsx|\\/feed-tables-model\\.ts)/;
  const probe = { timeouts: 0, intervals: 0, frames: 0, live: new Map(), liveFrames: new Set(), long: [] };
  const fromTables = () => pattern.test(new Error().stack || "");
  const st = window.setTimeout.bind(window), ct = window.clearTimeout.bind(window);
  const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  window.setTimeout = (handler, delay, ...args) => {
    if (typeof handler !== "function" || !fromTables()) return st(handler, delay, ...args);
    probe.timeouts++;
    const id = st((...rest) => { probe.live.delete(id); handler(...rest); }, delay, ...args);
    probe.live.set(id, "timeout");
    return id;
  };
  window.clearTimeout = (id) => { probe.live.delete(id); ct(id); };
  window.setInterval = (handler, delay, ...args) => {
    const id = si(handler, delay, ...args);
    if (fromTables()) { probe.intervals++; probe.live.set(id, "interval"); }
    return id;
  };
  window.clearInterval = (id) => { probe.live.delete(id); ci(id); };
  window.requestAnimationFrame = (handler) => {
    if (!fromTables()) return raf(handler);
    probe.frames++;
    const id = raf((time) => { probe.liveFrames.delete(id); handler(time); });
    probe.liveFrames.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => { probe.liveFrames.delete(id); caf(id); };
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) probe.long.push([entry.startTime, entry.duration]); })
    .observe({ type: "longtask", buffered: true });
  window.__tablesProbe = probe;
})()`;

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const url = (story: string, extra = "") => `${storybook}/iframe.html?id=features-feed--${story}&viewMode=story${extra}`;

function readTables(page: Page) {
  return page.evaluate(() => {
    const boards = [...document.querySelectorAll(".agent-stage-board")];
    const animations = document.getAnimations().filter((animation) => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return target instanceof Element && target.closest(".feed-tables") !== null;
    });
    const loops = animations.filter(
      (animation) => animation.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY,
    );
    return {
      tables: document.querySelectorAll(".feed-table").length,
      boards: boards.length,
      pausedBoards: boards.filter((board) => board.hasAttribute("data-paused")).length,
      actors: document.querySelectorAll(".agent-stage-actors > li").length,
      perTable: [...document.querySelectorAll(".feed-table")].map(
        (table) => table.querySelectorAll(".agent-stage-actors > li").length,
      ),
      chips: [...document.querySelectorAll(".feed-tables-more, .feed-table-overflow")].map(
        (chip) => chip.textContent?.trim() ?? "",
      ),
      models: document.querySelectorAll(".agent-stage-model").length,
      strip: document.querySelector(".feed-tables-strip")?.textContent?.trim() ?? null,
      animations: animations.length,
      loops: loops.length,
      loopsRunning: loops.filter((animation) => animation.playState === "running").length,
      loopsPaused: loops.filter((animation) => animation.playState === "paused").length,
    };
  });
}

async function heap(session: CDPSession): Promise<number> {
  for (let pass = 0; pass < 3; pass += 1) {
    await session.send("HeapProfiler.collectGarbage");
    await pause(150);
  }
  const { metrics } = await session.send("Performance.getMetrics");
  return Number(((metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0) / MB).toFixed(3));
}

async function load(browser: Browser, story: string, settleMs: number, extra = "") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(PROBE);
  const page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  await session.send("HeapProfiler.enable");
  await page.goto(url(story, extra), { waitUntil: "load", timeout: 180_000 });
  await page.locator(".feed-tables").waitFor({ timeout: 120_000 });
  await pause(settleMs);
  return { context, page, session };
}

async function counters(page: Page) {
  return page.evaluate(() => ({
    timeouts: window.__tablesProbe?.timeouts ?? 0,
    intervals: window.__tablesProbe?.intervals ?? 0,
    frames: window.__tablesProbe?.frames ?? 0,
    liveTimers: window.__tablesProbe?.live.size ?? 0,
    liveFrames: window.__tablesProbe?.liveFrames.size ?? 0,
  }));
}

async function checkBusy(browser: Browser): Promise<void> {
  const { context, page, session } = await load(browser, "tables", 2_500);
  try {
    const busy = await readTables(page);
    check(
      "Budget: tables, seats and agents",
      `<= ${LIMITS.tables} tables, <= ${LIMITS.seats} per table, <= ${LIMITS.agents} agents, "+N" chips`,
      `${busy.tables} tables, ${busy.actors} agents, per table ${busy.perTable.join("/")}, chips ${JSON.stringify(busy.chips)}`,
      busy.tables <= LIMITS.tables &&
        busy.actors <= LIMITS.agents &&
        busy.perTable.every((count) => count <= LIMITS.seats) &&
        busy.chips.length > 0,
    );
    check(
      "Provider and model over a cube, none for an agent of a joined server",
      "chips on all agents but one",
      `${busy.models} chips for ${busy.actors} agents`,
      busy.actors > 1 && busy.models === busy.actors - 1,
    );
    check(
      "Loops while the tables are visible",
      "at least one loop running",
      `${busy.loopsRunning} of ${busy.loops}`,
      busy.loopsRunning > 0,
    );
    const shot = resolve(OUT, "smoke-tables.png");
    await page.screenshot({ path: shot });
    report.screenshots.push(shot);

    // Pause: hidden window, tables off screen, reduced motion.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await pause(700);
    const hidden = await readTables(page);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await pause(700);
    const visible = await readTables(page);
    await page.evaluate(() => {
      const tables = document.querySelector<HTMLElement>(".feed-tables");
      if (tables) tables.style.transform = "translateY(-4000px)";
    });
    await pause(900);
    const off = await readTables(page);
    await page.evaluate(() => {
      const tables = document.querySelector<HTMLElement>(".feed-tables");
      if (tables) tables.style.transform = "";
    });
    await pause(600);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await pause(900);
    const reduced = await readTables(page);
    check(
      "Hidden window pauses the tables",
      "0 loops running, all boards paused, running again when visible",
      `${hidden.loopsRunning} running, ${hidden.loopsPaused} paused of ${hidden.loops}; boards ${hidden.pausedBoards}/${hidden.boards}; visible again ${visible.loopsRunning}`,
      hidden.loops > 0 && hidden.loopsRunning === 0 && visible.loopsRunning > 0,
    );
    check(
      "Tables off screen are paused",
      "0 loops running",
      `${off.loopsRunning} running, ${off.loopsPaused} paused of ${off.loops}`,
      off.loops > 0 && off.loopsRunning === 0,
    );
    check("prefers-reduced-motion: no loops", "0 infinite animations", `${reduced.loops} loops`, reduced.loops === 0);
    await page.emulateMedia({ reducedMotion: null });

    // Filters: the name of a table, then a cube.
    const filters = await page.evaluate(async () => {
      const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
      const showing = () => document.querySelector(".feed-showing")?.textContent?.trim() ?? "";
      const name = document.querySelector<HTMLButtonElement>(".feed-table-name");
      const hit = document.querySelector<HTMLButtonElement>(".agent-stage-hit");
      const before = showing();
      name?.click();
      await wait(400);
      const afterName = { pressed: name?.getAttribute("aria-pressed"), showing: showing() };
      name?.click();
      await wait(400);
      const clearedName = { pressed: name?.getAttribute("aria-pressed"), showing: showing() };
      hit?.click();
      await wait(400);
      const afterCube = { pressed: hit?.getAttribute("aria-pressed"), showing: showing() };
      hit?.click();
      await wait(400);
      const clearedCube = {
        pressed: document.querySelector(".agent-stage-hit")?.getAttribute("aria-pressed"),
        showing: showing(),
      };
      return { before, afterName, clearedName, afterCube, clearedCube };
    });
    check(
      "A click on a table name filters the project, a second click clears it",
      "pressed true then false, fewer cards, then all again",
      JSON.stringify(filters),
      filters.afterName.pressed === "true" &&
        filters.afterName.showing !== filters.before &&
        filters.clearedName.pressed === "false" &&
        filters.clearedName.showing === filters.before,
    );
    check(
      "A click on a cube filters the agent, a second click clears it",
      "pressed true then false, fewer cards, then all again",
      JSON.stringify([filters.afterCube, filters.clearedCube]),
      filters.afterCube.pressed === "true" &&
        filters.afterCube.showing !== filters.before &&
        filters.clearedCube.pressed === "false" &&
        filters.clearedCube.showing === filters.before,
    );

    // Long tasks while the tables work, after the page is up.
    const from = await page.evaluate(() => performance.now());
    await pause(6_000);
    const long = await page.evaluate((start) => (window.__tablesProbe?.long ?? []).filter(([at]) => at > start), from);
    check(
      "Long tasks of 50 ms or more while the tables work (6 s)",
      "none",
      long.length ? JSON.stringify(long) : "none",
      long.every(([, duration]) => duration < LIMITS.longTaskMs),
    );
    await heap(session);
  } finally {
    await context.close();
  }
}

async function checkNobody(browser: Browser, story: string, label: string): Promise<void> {
  const { context, page } = await load(browser, story, 1_500);
  try {
    const before = await counters(page);
    await pause(6_000);
    const after = await counters(page);
    const reading = await readTables(page);
    const created = after.timeouts - before.timeouts + (after.intervals - before.intervals);
    check(
      `Nobody at work (${label}): boards, animations, timers, frames`,
      "0 boards, 0 animations, 0 live timers, 0 live frames, 0 new in 6 s",
      `${reading.boards} boards, ${reading.animations} animations, live ${after.liveTimers} timers ${after.liveFrames} frames, new ${created} timers ${after.frames - before.frames} frames`,
      reading.boards === 0 &&
        reading.animations === 0 &&
        after.liveTimers === 0 &&
        after.liveFrames === 0 &&
        created === 0 &&
        after.frames === before.frames,
    );
  } finally {
    await context.close();
  }
}

/** A10: the line and the flying cube of a hand-off, in the story with buttons that drive the cards. */
async function checkDelegation(browser: Browser): Promise<void> {
  const { context, page } = await load(browser, "tables-delegation", 1_500);
  const reading = () =>
    page.evaluate(() => ({
      links: document.querySelectorAll(".feed-tables .agent-stage-link").length,
      packets: document.querySelectorAll(".feed-tables .agent-stage-packet").length,
    }));
  try {
    const before = await reading();
    await page.evaluate(() => {
      const state = { mutations: 0, flights: 0 };
      window.__delegation = state;
      new MutationObserver((records) => {
        for (const record of records) {
          state.mutations += 1;
          for (const node of record.addedNodes)
            if (node instanceof Element && node.classList.contains("agent-stage-packet")) state.flights += 1;
        }
      }).observe(document.querySelector(".feed-tables") ?? document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    });
    const counts = () => page.evaluate(() => window.__delegation ?? { mutations: -1, flights: -1 });
    await page.getByRole("button", { name: "Hand off", exact: true }).click();
    await pause(1_200);
    const handed = await reading();
    const afterHandOff = await counts();
    const picture = resolve(OUT, "tables-delegation.png");
    await page.screenshot({ path: picture });
    report.screenshots.push(picture);
    await page.getByRole("button", { name: "Same 50 times", exact: true }).click();
    await pause(800);
    const afterSame = await counts();
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await pause(500);
    const finished = await reading();
    check(
      "A10 hand-off: one line, one flight; 50 deltas with no change write nothing; the line goes at the end",
      "0 lines before, 1 line and 1 flight after, 0 writes and 0 flights for 50 deltas, 0 lines after the end",
      `before ${before.links} lines; after ${handed.links} lines, ${afterHandOff.flights} flight; 50 deltas ${afterSame.mutations - afterHandOff.mutations} writes, ${afterSame.flights - afterHandOff.flights} flights; end ${finished.links} lines`,
      before.links === 0 &&
        handed.links === 1 &&
        afterHandOff.flights === 1 &&
        afterSame.mutations === afterHandOff.mutations &&
        afterSame.flights === afterHandOff.flights &&
        finished.links === 0,
    );
  } finally {
    await context.close();
  }
}

async function checkMemory(browser: Browser): Promise<void> {
  const open: number[] = [];
  const folded: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    const strip = await load(browser, "tables-folded", 2_500);
    folded.push(await heap(strip.session));
    await strip.context.close();
    const tables = await load(browser, "tables", 2_500);
    open.push(await heap(tables.session));
    await tables.context.close();
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[1] ?? 0;
  const cost = Number((median(open) - median(folded)).toFixed(3));
  check(
    "Open tables against the folded strip: JS heap after GC (median of 3 loads)",
    `<= ${LIMITS.heapMb} MB`,
    `folded ${folded.join(" / ")} MB, open ${open.join(" / ")} MB, cost ${cost} MB`,
    cost <= LIMITS.heapMb,
  );
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  browserExecutable ? { executablePath: resolve(browserExecutable), headless: true } : { headless: true },
);
const failures: string[] = [];
try {
  for (const step of [
    () => checkBusy(browser),
    () => checkNobody(browser, "empty", "empty feed"),
    () => checkNobody(browser, "tables-folded", "tables folded into the strip"),
    () => checkDelegation(browser),
    () => checkMemory(browser),
  ]) {
    try {
      await step();
    } catch (error) {
      failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
  }
} finally {
  await browser.close();
}
const failed = report.checks.filter((entry) => !entry.passed).map((entry) => entry.name);
report.passed = failed.length === 0 && failures.length === 0 && report.pageErrors.length === 0;
writeFileSync(resolve(OUT, "smoke-report.json"), `${JSON.stringify({ ...report, failed, failures }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ passed: report.passed, failed, failures }, null, 2)}\n`);
assert.ok(report.passed, "The feed tables smoke found failures.");
