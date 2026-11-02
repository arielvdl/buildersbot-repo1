// Gate of the agent stage of a channel (`channel-stage`). It measures memory and processing of the
// renderer in this worktree's running dev app, through CDP, and checks the choices of the owner. Start
// the app with `bun run dev` (never `--shared`), then run
// `bun scripts/channel-stage-e2e.ts --allow-mutations`. It needs signed-in Claude agents: it makes
// four extra agents and one channel of eight members, runs real short turns, and deletes all of them
// at the end. It also opens the seeded channel "Launch room" for the read-only checks.
//
// `--target=base` runs only the read-only part (flag off, idle) on a checkout without the feature, to
// give the same numbers for the "flag off against the base" limit. Run it in a worktree of the base
// commit, and put its report next to this one.
//
// What it measures (limits in LIMITS):
// - flag off against the base: JS heap after GC, and no stage module requested over the network;
// - flag on, 8 agents at work, against flag off in the same live state (off, on, off, on);
// - 5 cycles of agents entering and leaving, and of leaving and opening the channel: heap, nodes;
// - nobody at work: animations, timers and animation frames of the stage, CPU against flag off;
// - long tasks of 50 ms or more while the stage runs and when it mounts;
// - hidden window, stage off screen, reduced motion: animations of the stage;
// - the choices of the owner: the 5 items of the task.
// Writes .buildersbot-build/channel-stage/e2e-report.json (or e2e-report-base.json) and screenshots.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClientAgentSummary } from "@buildersbot/contracts/ipc";
import { translateFor } from "@buildersbot/i18n";
import type { CDPSession, Locator, Page } from "playwright-core";
import { z } from "zod";
import { argument, ChannelClient, connectChannelE2e, SHORT_PROMPT } from "./channel-e2e-support";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

interface StageProbe {
  timeouts: number;
  intervals: number;
  frames: number;
  live: Map<number, string>;
  liveFrames: Set<number>;
  long: [number, number][];
}

declare global {
  interface Window {
    __stageProbe?: StageProbe;
  }
}

const preferenceSchema = z.record(
  z.string(),
  z.object({ all: z.boolean(), channels: z.record(z.string(), z.boolean()) }),
);
const baseSchema = z.object({
  flagOffIdleHeapMedianMb: z.number(),
  domSignature: z.string(),
});

const TARGET = argument("target") === "base" ? "base" : "branch";
const OUT = resolve(import.meta.dirname, "../.buildersbot-build/channel-stage");
const REPORT = resolve(OUT, TARGET === "base" ? "e2e-report-base.json" : "e2e-report.json");
mkdirSync(OUT, { recursive: true });

const MB = 1024 * 1024;
const WORKERS = 8;
const LONG_TASK_MS = 50;
const RESEARCH_PROMPT =
  "Write a numbered list of 700 short facts about rivers, one per line, no blank lines. Do not use tools.";

const LIMITS = {
  flagOffVsBaseHeapMb: 0.5,
  flagOnCostHeapMb: 3,
  leakHeapMb: 1,
  idleCpuGapPoints: 0.5,
  longTaskMs: LONG_TASK_MS,
};

type Memory = {
  label: string;
  heapMb: number;
  nodes: number;
  /** Nodes outside the message list, which grows with each new message. */
  nodesOutsideTimeline: number;
  stageNodes: number;
  listeners: number;
  running: number;
};

interface Check {
  name: string;
  limit: string;
  measured: string;
  passed: boolean;
}

interface Report {
  target: "base" | "branch";
  startedAt: string;
  checks: Check[];
  owner: Record<string, { ok: boolean; note: string }>;
  memory: Memory[];
  stageRequests: Record<string, string[]>;
  longTasks: Record<string, { count: number; maxMs: number }>;
  cpu: Record<string, number[]>;
  stage: Record<string, Json>;
  flagOffIdleHeapMedianMb?: number;
  domSignature?: string;
  scriptError?: string;
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
  failed: string[];
}

const report: Report = {
  target: TARGET,
  startedAt: new Date().toISOString(),
  checks: [],
  owner: {},
  memory: [],
  stageRequests: {},
  longTasks: {},
  cpu: {},
  stage: {},
  pageErrors: [],
  screenshots: [],
  passed: false,
  failed: [],
};

const session = await connectChannelE2e("channel-stage-e2e");
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const client = new ChannelClient(page);
const cdp: CDPSession = await page.context().newCDPSession(page);
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const stamp = Date.now().toString(36);
const channelName = `Stage QA ${stamp}`;
const created: { agents: string[] } = { agents: [] };
let english = translateFor("en");

// ----- Page probe: timers, animation frames and long tasks, with the file that asked for them. -----
const PROBE = `(() => {
  if (window.__stageProbe) return;
  Error.stackTraceLimit = 40;
  const stagePattern = /(ChannelStage\\w*\\.tsx|channel-stage-\\w+\\.ts)/;
  const probe = { timeouts: 0, intervals: 0, frames: 0, live: new Map(), liveFrames: new Set(), long: [], all: { timeouts: 0, intervals: 0, frames: 0 } };
  const fromStage = () => stagePattern.test(new Error().stack || "");
  const setTimeoutOriginal = window.setTimeout.bind(window);
  const clearTimeoutOriginal = window.clearTimeout.bind(window);
  const setIntervalOriginal = window.setInterval.bind(window);
  const clearIntervalOriginal = window.clearInterval.bind(window);
  const frameOriginal = window.requestAnimationFrame.bind(window);
  const cancelFrameOriginal = window.cancelAnimationFrame.bind(window);
  window.setTimeout = (handler, delay, ...args) => {
    probe.all.timeouts++;
    if (typeof handler !== "function" || !fromStage()) return setTimeoutOriginal(handler, delay, ...args);
    probe.timeouts++;
    const id = setTimeoutOriginal((...rest) => { probe.live.delete(id); handler(...rest); }, delay, ...args);
    probe.live.set(id, "timeout");
    return id;
  };
  window.clearTimeout = (id) => { probe.live.delete(id); clearTimeoutOriginal(id); };
  window.setInterval = (handler, delay, ...args) => {
    probe.all.intervals++;
    const id = setIntervalOriginal(handler, delay, ...args);
    if (fromStage()) { probe.intervals++; probe.live.set(id, "interval"); }
    return id;
  };
  window.clearInterval = (id) => { probe.live.delete(id); clearIntervalOriginal(id); };
  window.requestAnimationFrame = (handler) => {
    probe.all.frames++;
    if (!fromStage()) return frameOriginal(handler);
    probe.frames++;
    const id = frameOriginal((time) => { probe.liveFrames.delete(id); handler(time); });
    probe.liveFrames.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => { probe.liveFrames.delete(id); cancelFrameOriginal(id); };
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) probe.long.push([entry.startTime, entry.duration]); })
    .observe({ type: "longtask" });
  window.__stageProbe = probe;
})()`;

async function probeCounters() {
  return page.evaluate(() => {
    const probe = window.__stageProbe;
    return {
      timeouts: probe?.timeouts ?? 0,
      intervals: probe?.intervals ?? 0,
      frames: probe?.frames ?? 0,
      liveTimers: probe?.live.size ?? 0,
      liveFrames: probe?.liveFrames.size ?? 0,
    };
  });
}

async function longTasksBetween(label: string, fromMs: number, toMs: number) {
  const entries = await page.evaluate(
    ([from, to]) => (window.__stageProbe?.long ?? []).filter(([start]) => start >= (from ?? 0) && start <= (to ?? 0)),
    [fromMs, toMs] as const,
  );
  const result = { count: entries.length, maxMs: Math.round(Math.max(0, ...entries.map(([, duration]) => duration))) };
  report.longTasks[label] = result;
  return result;
}

const pageNow = () => page.evaluate(() => performance.now());

// ----- Memory and CPU through CDP. -----
async function metrics(): Promise<Record<string, number>> {
  const { metrics: list } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(list.map((metric) => [metric.name, metric.value]));
}

async function runningTasks(channelId: string): Promise<number> {
  const current = await client.read(channelId);
  return current.tasks.filter((task) => task.state === "running").length;
}

async function sampleMemory(label: string, channelId: string | null): Promise<Memory> {
  for (let pass = 0; pass < 3; pass += 1) {
    await cdp.send("HeapProfiler.collectGarbage");
    await sleep(150);
  }
  const reading = await metrics();
  const dom = await page.evaluate(() => ({
    timeline: document.querySelector(".conversation-scroll")?.querySelectorAll("*").length ?? 0,
    stage: document.querySelector(".channel-stage-frame")?.querySelectorAll("*").length ?? 0,
  }));
  const nodes = reading.Nodes ?? 0;
  const memory: Memory = {
    label,
    heapMb: Number(((reading.JSHeapUsedSize ?? 0) / MB).toFixed(3)),
    nodes,
    nodesOutsideTimeline: nodes - dom.timeline,
    stageNodes: dom.stage,
    listeners: reading.JSEventListeners ?? 0,
    running: channelId ? await runningTasks(channelId) : 0,
  };
  report.memory.push(memory);
  return memory;
}

/** CPU of the renderer over a window, as a percentage of one core. */
async function cpuWindow(label: string, ms: number): Promise<number> {
  const before = await metrics();
  await sleep(ms);
  const after = await metrics();
  const busy = (after.TaskDuration ?? 0) - (before.TaskDuration ?? 0);
  const elapsed = (after.Timestamp ?? 0) - (before.Timestamp ?? 0);
  const percent = Number(((busy / Math.max(elapsed, 0.001)) * 100).toFixed(3));
  report.cpu[label] = [...(report.cpu[label] ?? []), percent];
  return percent;
}

function check(name: string, limit: string, measured: string, passed: boolean): void {
  report.checks.push({ name, limit, measured, passed });
}

async function shot(label: string, target: Locator | Page = page): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await target.screenshot({ path });
  report.screenshots.push(path);
}

async function waitUntil<T>(label: string, read: () => Promise<T>, ready: (value: T) => boolean, ms = 60_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}. Last value: ${JSON.stringify(value)}`);
    await sleep(300);
  }
}

// ----- Stage readings. -----
const stageReading = () =>
  page.evaluate(() => {
    const frame = document.querySelector(".channel-stage-frame");
    const board = document.querySelector(".channel-stage-board");
    const actors = [...document.querySelectorAll<HTMLElement>(".channel-stage-actor")];
    const animations = document.getAnimations().filter((animation) => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return target instanceof Element && target.closest(".channel-stage") !== null;
    });
    const infinite = animations.filter(
      (animation) => animation.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY,
    );
    return {
      mounted: frame !== null,
      collapsed: document.querySelector(".channel-stage[data-collapsed]") !== null,
      board: board !== null,
      paused: board?.hasAttribute("data-paused") ?? false,
      actors: actors.length,
      activities: actors.map((actor) => actor.dataset.activity ?? ""),
      animations: animations.length,
      running: animations.filter((animation) => animation.playState === "running").length,
      infinite: infinite.length,
      infiniteRunning: infinite.filter((animation) => animation.playState === "running").length,
      infinitePaused: infinite.filter((animation) => animation.playState === "paused").length,
    };
  });

async function openChannel(name: string): Promise<void> {
  const row = page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[,.]`) })
    .first();
  await row.click({ timeout: 30_000 });
  await page.getByRole("heading", { level: 1, name, exact: true }).waitFor({ timeout: 30_000 });
}

async function domSignature(): Promise<string> {
  return page.evaluate(() => {
    const panel = document.querySelector("main.conversation-panel");
    if (!panel) return "";
    const lines: string[] = [];
    const walk = (element: Element, depth: number) => {
      if (depth > 6) return;
      const classes = [...element.classList].sort().join(".");
      lines.push(`${" ".repeat(depth)}${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`);
      // The messages differ by profile and time; the structure around them must not.
      if (element.classList.contains("virtual-chat-list")) return;
      for (const child of element.children) walk(child, depth + 1);
    };
    walk(panel, 0);
    return lines.join("\n");
  });
}

// ----- The flag, through its popover. -----
const flagButton = () => page.getByRole("button", { name: english("channel.stage.flag.label"), exact: true });

async function openFlag(): Promise<Locator> {
  await flagButton().click();
  const panel = page.locator(".section-rail-stage-settings");
  await panel.waitFor({ timeout: 10_000 });
  return panel;
}

async function closeFlag(): Promise<void> {
  await page.keyboard.press("Escape");
  await page.locator(".section-rail-stage-settings").waitFor({ state: "detached", timeout: 10_000 });
}

async function setFlag(options: { enabled: boolean; scope: "channel" | "all" }): Promise<void> {
  const panel = await openFlag();
  const scopeName =
    options.scope === "channel" ? english("channel.stage.flag.scopeChannel") : english("channel.stage.flag.scopeAll");
  await panel.getByRole("radio", { name: scopeName }).click();
  const toggle = panel.getByRole("switch", { name: english("channel.stage.flag.enable") });
  const now = await toggle.isChecked();
  if (now !== options.enabled) await toggle.click();
  await closeFlag();
}

const stagePreference = () => page.evaluate(() => window.localStorage.getItem("buildersbot:channel-stage:v1"));

const stageModule = (url: string) =>
  /\/(ChannelStageHost\.tsx|ChannelStage\.tsx|channel-stage-model\.ts|channel-stage\.css)(\?|$)/.test(url);
const requestedStageModules = (urls: readonly string[]) => [
  ...new Set(urls.filter(stageModule).map((url) => new URL(url).pathname.split("/").pop() ?? url)),
];

try {
  // ----- Fresh renderer: flag off, no stage module yet. -----
  const requests: string[] = [];
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (event) => requests.push(event.request.url));
  await page.addInitScript(PROBE);
  await page.evaluate(() => window.localStorage.removeItem("buildersbot:channel-stage:v1"));
  await page.reload();
  await page.getByRole("navigation", { name: /./ }).first().waitFor({ timeout: 60_000 });
  const lang = await page.evaluate(() => document.documentElement.lang);
  english = translateFor(lang === "pt" ? "pt" : "en");
  report.stage.language = lang;
  await sleep(4_000);

  // ----- Flag off, seeded channel, idle: the figures to compare with the base. -----
  await openChannel("Launch room");
  await sleep(3_000);
  report.domSignature = await domSignature();
  const offIdle = [await sampleMemory("flag-off idle Launch room 1", null)];
  offIdle.push(await sampleMemory("flag-off idle Launch room 2", null));
  offIdle.push(await sampleMemory("flag-off idle Launch room 3", null));
  report.stageRequests.flagOffIdle = requestedStageModules(requests);
  report.stage.flagOffFramePresent = (await stageReading()).mounted;
  await shot("e2e-flag-off-launch-room", page.locator("main.conversation-panel"));
  const heapOff = [...offIdle.map((sample) => sample.heapMb)].sort((a, b) => a - b)[1] ?? 0;
  report.flagOffIdleHeapMedianMb = heapOff;

  if (TARGET === "base") {
    check(
      "Base: no stage module requested",
      "none",
      requestedStageModules(requests).join(", ") || "none",
      requestedStageModules(requests).length === 0,
    );
    finish();
  }

  // ----- Flag off checks that need the branch. -----
  const offModules = requestedStageModules(requests);
  check(
    "Flag off: stage chunk not loaded",
    "no stage module in the network log",
    offModules.join(", ") || "none requested",
    offModules.length === 0,
  );
  report.owner["3"] = {
    ok: offModules.length === 0 && !(await stageReading()).mounted,
    note: "Flag off: no stage frame in the DOM and no stage module requested. Compare the DOM signature with the base report.",
  };

  // ----- Eight agents and a channel. -----
  const known = await client.agents();
  const agents: ClientAgentSummary[] = [];
  const claude = known.find((agent) => agent.provider === "claude");
  assert.ok(claude?.model, "The dev profile needs a Claude agent to copy its model.");
  for (const seeded of known.filter((agent) => agent.provider === "claude").slice(0, 4)) agents.push(seeded);
  for (let index = agents.length; index < WORKERS; index += 1) {
    const agent = await page.evaluate((input) => window.buildersbot.agent.createAgent(input), {
      name: `Stage QA ${stamp} ${index}`,
      description: "Works for the stage check.",
      avatarSeed: `stage-qa-${stamp}-${index}`,
      avatarHue: null,
      initialMessage: SHORT_PROMPT,
      provider: "claude" as const,
      model: claude.model,
    });
    created.agents.push(agent.id);
    agents.push(agent);
  }
  for (const agent of agents)
    await waitUntil(
      `the queue of ${agent.name} to be idle`,
      () => client.queue(agent.id),
      (snapshot) =>
        snapshot.deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
      120_000,
    );
  const lead = agents[0];
  assert.ok(lead);
  const channel = await client.create(
    channelName,
    agents.map((agent) => agent.id),
    lead.id,
  );
  await waitUntil(
    "the channel row",
    async () => (await client.list()).some((entry) => entry.id === channel.id),
    Boolean,
  );
  await openChannel(channelName);
  await sleep(1_500);

  async function startRound(prompt: string, targets = agents): Promise<void> {
    for (const agent of targets) await client.send(channel.id, `${prompt} (${agent.name})`, agent.id);
    await waitUntil(
      `${targets.length} running tasks`,
      () => runningTasks(channel.id),
      (count) => count >= targets.length,
      90_000,
    );
  }

  // ----- Flag off, eight agents at work. -----
  await startRound(RESEARCH_PROMPT);
  await sleep(5_000);
  let from = await pageNow();
  const offActiveCpu = await cpuWindow("flag-off 8 active", 8_000);
  await longTasksBetween("flag-off 8 active", from, await pageNow());
  const offA1 = await sampleMemory("A1 flag off, 8 active", channel.id);

  // ----- The popover: three options, this channel first. -----
  const panel = await openFlag();
  const popover = {
    enable: await panel.getByRole("switch", { name: english("channel.stage.flag.enable") }).count(),
    collapse: await panel.getByRole("switch", { name: english("channel.stage.flag.collapse") }).count(),
    scopeChannel: await panel.getByRole("radio", { name: english("channel.stage.flag.scopeChannel") }).count(),
    scopeAll: await panel.getByRole("radio", { name: english("channel.stage.flag.scopeAll") }).count(),
  };
  await shot("e2e-flag-popover");
  await closeFlag();
  const railButtons = await page.evaluate((flagLabel) => {
    const buttons = [...document.querySelectorAll<HTMLElement>("nav[aria-label] button, aside button")];
    const flag = buttons.find((button) => button.getAttribute("aria-label") === flagLabel);
    if (!flag) return { found: false, lowestInColumn: false, rightOfPages: false };
    const flagBox = flag.getBoundingClientRect();
    const sameColumn = buttons.filter((button) => {
      const box = button.getBoundingClientRect();
      return box.width > 0 && Math.abs(box.left - flagBox.left) < 8 && box.top < window.innerHeight;
    });
    const lowest = Math.max(...sameColumn.map((button) => button.getBoundingClientRect().bottom));
    const pages = document.querySelector("nav[aria-label]")?.getBoundingClientRect();
    return {
      found: true,
      lowestInColumn: flagBox.bottom >= lowest - 1,
      rightOfPages: (pages?.right ?? 0) < flagBox.left,
    };
  }, english("channel.stage.flag.label"));
  report.owner["5"] = {
    ok:
      popover.enable === 1 &&
      popover.collapse === 1 &&
      popover.scopeChannel === 1 &&
      popover.scopeAll === 1 &&
      railButtons.found &&
      railButtons.lowestInColumn,
    note: `Popover options ${JSON.stringify(popover)}; flag button ${JSON.stringify(railButtons)}.`,
  };

  // ----- Flag on for this channel, with the mount measured. -----
  from = await pageNow();
  await setFlag({ enabled: true, scope: "channel" });
  const preferenceChannel = await stagePreference();
  await waitUntil("stage actors", stageReading, (reading) => reading.actors >= WORKERS, 60_000);
  await sleep(2_500);
  const mountEnd = await pageNow();
  await longTasksBetween("mount (chunk load and first draw)", from, mountEnd);
  const onModules = requestedStageModules(requests);
  report.stageRequests.flagOn = onModules;
  const firstLook = await stageReading();
  report.stage.firstLook = firstLook;
  check(
    "Flag on: stage chunk loads on demand",
    "4 stage modules after the flag turns on",
    onModules.join(", "),
    onModules.length === 4,
  );
  const scoped = Object.values(preferenceSchema.catch({}).parse(JSON.parse(preferenceChannel ?? "{}")))[0];
  report.stage.preferenceThisChannel = scoped ?? null;
  const channelScopeOk = scoped?.all === false && scoped.channels[channel.id] === true;

  from = await pageNow();
  const onActiveCpu = await cpuWindow("flag-on 8 active", 8_000);
  await longTasksBetween("flag-on 8 active", from, await pageNow());
  const onB1 = await sampleMemory("B1 flag on, 8 active", channel.id);

  const seen = new Set<string>();
  const richLook = await page.evaluate(() => {
    const actors = [...document.querySelectorAll<HTMLElement>(".channel-stage-actor")];
    return actors.map((actor) => {
      const box = actor.getBoundingClientRect();
      const model = actor.querySelector(".channel-stage-model");
      return {
        name: actor.getAttribute("aria-label") ?? "",
        activity: actor.dataset.activity ?? "",
        y: Math.round(box.top),
        modelText: model?.textContent?.trim() ?? "",
        logo: model?.querySelector("svg, img") !== null,
      };
    });
  });
  for (const actor of richLook) seen.add(actor.activity ?? "");
  report.stage.actors = richLook;
  await shot("e2e-stage-on-8-agents");
  await shot("e2e-stage-board", page.locator(".channel-stage-frame"));
  const board = await page.evaluate(() => ({
    table: document.querySelector(".channel-stage-table") !== null,
    request: document.querySelector(".channel-stage-request") !== null,
    requestBars: document.querySelectorAll(".channel-stage-request-bars i").length,
    leaderOnTop: (() => {
      const lead = document.querySelector(".channel-stage-actor");
      const ys = [...document.querySelectorAll(".channel-stage-actor")].map(
        (actor) => actor.getBoundingClientRect().top,
      );
      return { first: lead?.getBoundingClientRect().top ?? 0, min: Math.min(...ys) };
    })(),
    streamWidth: Math.round(document.querySelector(".conversation-scroll")?.getBoundingClientRect().width ?? 0),
    panelWidth: Math.round(document.querySelector("main.conversation-panel")?.getBoundingClientRect().width ?? 0),
    scrollLists: document.querySelectorAll(".conversation-scroll").length,
    gradient: (() => {
      const frameNode = document.querySelector(".channel-stage-frame");
      return frameNode ? getComputedStyle(frameNode, "::after").backgroundImage : "";
    })(),
    stageHeight: Math.round(document.querySelector(".channel-stage")?.getBoundingClientRect().height ?? 0),
    viewportHeight: window.innerHeight,
  }));
  report.stage.board = board;
  const leader = richLook.find((actor) => actor.name?.startsWith(`${lead.name},`));
  const leaderAtBack = leader !== undefined && leader.y === Math.min(...richLook.map((actor) => actor.y));
  report.owner["1"] = {
    ok: board.table && board.request && richLook.length === WORKERS && leaderAtBack,
    note: `Table ${board.table}, request card ${board.request} (${board.requestBars} bars), ${richLook.length} fixed seats, lead at the back ${leaderAtBack}. Behaviours seen live: ${[...seen].join(", ")}. Delegation cube, celebrate and exit are checked below and in the screenshots.`,
  };
  report.owner["2"] = {
    ok:
      board.scrollLists === 1 &&
      board.streamWidth >= board.panelWidth - 24 &&
      board.gradient.includes("linear-gradient"),
    note: `One message list, ${board.streamWidth}px of ${board.panelWidth}px, gradient ${board.gradient.slice(0, 60)}.`,
  };
  report.owner["4"] = {
    ok: richLook.length > 0 && richLook.every((actor) => actor.logo && actor.modelText.length > 0),
    note: `Provider logo and model on ${richLook.filter((actor) => actor.logo && actor.modelText).length} of ${richLook.length} agents (text: ${[...new Set(richLook.map((actor) => actor.modelText))].join(", ")}).`,
  };

  // ----- Pause: hidden window, off screen; and reduced motion. -----
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(600);
  const hidden = await stageReading();
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(600);
  const visibleAgain = await stageReading();
  await page.evaluate(() => {
    const frameNode = document.querySelector<HTMLElement>(".channel-stage-frame");
    if (frameNode) frameNode.style.transform = "translateY(-4000px)";
  });
  await sleep(800);
  const offScreen = await stageReading();
  await page.evaluate(() => {
    const frameNode = document.querySelector<HTMLElement>(".channel-stage-frame");
    if (frameNode) frameNode.style.transform = "";
  });
  await sleep(600);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(800);
  const reduced = await stageReading();
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });
  await sleep(500);
  report.stage.pause = { hidden, visibleAgain, offScreen, reduced };
  check(
    "Hidden window: stage loops paused",
    "0 loops running, all paused",
    `${hidden.infiniteRunning} running, ${hidden.infinitePaused} paused of ${hidden.infinite}`,
    hidden.infinite > 0 && hidden.infiniteRunning === 0,
  );
  check(
    "Stage off screen: stage loops paused",
    "0 loops running, all paused",
    `${offScreen.infiniteRunning} running, ${offScreen.infinitePaused} paused of ${offScreen.infinite}`,
    offScreen.infinite > 0 && offScreen.infiniteRunning === 0,
  );
  check(
    "Visible again: loops run",
    "loops running again",
    `${visibleAgain.infiniteRunning} of ${visibleAgain.infinite}`,
    visibleAgain.infiniteRunning > 0,
  );
  check(
    "prefers-reduced-motion: no loops",
    "0 infinite animations in the stage",
    `${reduced.infinite} infinite, ${reduced.animations} animations in total`,
    reduced.infinite === 0,
  );

  // ----- Off, on, off, on in the same live state. -----
  await setFlag({ enabled: false, scope: "channel" });
  await sleep(2_500);
  const offA2 = await sampleMemory("A2 flag off again, 8 active", channel.id);
  const afterOff = await stageReading();
  report.stage.afterOff = afterOff;
  await setFlag({ enabled: true, scope: "all" });
  await waitUntil("stage back", stageReading, (reading) => reading.mounted, 30_000);
  await sleep(3_000);
  const onB2 = await sampleMemory("B2 flag on again (all channels), 8 active", channel.id);
  const allScope = Object.values(preferenceSchema.catch({}).parse(JSON.parse((await stagePreference()) ?? "{}")))[0];
  report.stage.preferenceAll = allScope ?? null;
  const allScopeOk = allScope?.all === true && Object.keys(allScope.channels).length === 0;
  const sameState = [offA1, onB1, offA2, onB2].every((sample) => sample.running >= WORKERS);
  report.stage.sameLiveState = sameState;
  const costFirst = Number((onB1.heapMb - offA1.heapMb).toFixed(3));
  const costSecond = Number((onB2.heapMb - offA2.heapMb).toFixed(3));
  const cost = Math.max(costFirst, costSecond);
  check(
    "Flag on, 8 agents at work, against flag off (same live state)",
    `<= ${LIMITS.flagOnCostHeapMb} MB`,
    `B1-A1 ${costFirst} MB (first, with the chunk loading), B2-A2 ${costSecond} MB; 8 tasks running in all four samples: ${sameState}`,
    cost <= LIMITS.flagOnCostHeapMb && sameState,
  );
  check(
    "Flag off after on: stage gone from the DOM",
    "no stage frame",
    `frame mounted ${afterOff.mounted}, animations ${afterOff.animations}`,
    !afterOff.mounted && afterOff.animations === 0,
  );
  const cpuGapActive = Number((onActiveCpu - offActiveCpu).toFixed(3));
  report.stage.activeCpu = { off: offActiveCpu, on: onActiveCpu, gap: cpuGapActive };

  // ----- Delegation, done, exit: stop the work and watch the stage. -----
  for (const task of (await client.read(channel.id)).tasks)
    if (task.state === "running" || task.state === "queued" || task.state === "waiting")
      await client.taskCommand("stop", channel.id, task.id).catch(() => undefined);
  const afterStop = await waitUntil(
    "the stage to fold",
    stageReading,
    (reading) => reading.collapsed && reading.actors === 0,
    90_000,
  );
  report.stage.afterStop = afterStop;
  report.owner["1"].note +=
    ` After the work stopped the stage folded into the strip (collapsed ${afterStop.collapsed}).`;

  // ----- Nobody at work: animations, timers, frames, CPU. -----
  await sleep(2_000);
  const idleProbeBefore = await probeCounters();
  const idleStage = await stageReading();
  from = await pageNow();
  const cpuOn = [await cpuWindow("flag-on idle (folded)", 10_000)];
  const idleProbeAfter = await probeCounters();
  await longTasksBetween("flag-on idle", from, await pageNow());
  const stageTimersIdle =
    idleProbeAfter.timeouts - idleProbeBefore.timeouts + (idleProbeAfter.intervals - idleProbeBefore.intervals);
  const stageFramesIdle = idleProbeAfter.frames - idleProbeBefore.frames;
  report.stage.idle = { idleStage, idleProbeBefore, idleProbeAfter };
  check(
    "Nobody at work: stage animations",
    "0",
    `${idleStage.animations} (board in DOM: ${idleStage.board})`,
    idleStage.animations === 0 && !idleStage.board,
  );
  check(
    "Nobody at work: stage timers and animation frames",
    "0 live timers, 0 frames, 0 new timers or frames in 10 s",
    `live timers ${idleProbeAfter.liveTimers}, live frames ${idleProbeAfter.liveFrames}, new timers ${stageTimersIdle}, new frames ${stageFramesIdle}`,
    idleProbeAfter.liveTimers === 0 &&
      idleProbeAfter.liveFrames === 0 &&
      stageTimersIdle === 0 &&
      stageFramesIdle === 0,
  );
  await setFlag({ enabled: false, scope: "all" });
  await sleep(1_500);
  const cpuOff = [await cpuWindow("flag-off idle", 10_000)];
  await setFlag({ enabled: true, scope: "all" });
  await sleep(1_500);
  cpuOn.push(await cpuWindow("flag-on idle (folded)", 10_000));
  await setFlag({ enabled: false, scope: "all" });
  await sleep(1_500);
  cpuOff.push(await cpuWindow("flag-off idle", 10_000));
  const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
  const idleGap = Number((mean(cpuOn) - mean(cpuOff)).toFixed(3));
  check(
    "Nobody at work: renderer CPU against flag off",
    `gap <= ${LIMITS.idleCpuGapPoints} points of one core`,
    `on ${cpuOn.join(" / ")} %, off ${cpuOff.join(" / ")} %, gap ${idleGap}`,
    idleGap <= LIMITS.idleCpuGapPoints,
  );
  await setFlag({ enabled: true, scope: "all" });
  await sleep(1_000);

  // ----- Leak: five cycles of agents entering and leaving, and of leaving the channel. -----
  const short = agents.slice(0, 4);
  const baseline = await sampleMemory("leak L0 (flag on, folded)", channel.id);
  let last = baseline;
  let sawActors = 0;
  for (let cycle = 1; cycle <= 5; cycle += 1) {
    await startRound(SHORT_PROMPT, short);
    sawActors = Math.max(
      sawActors,
      (await waitUntil("stage actors", stageReading, (reading) => reading.actors >= 1, 30_000)).actors,
    );
    await waitUntil(
      "short tasks to end",
      () => runningTasks(channel.id),
      (count) => count === 0,
      120_000,
    );
    await waitUntil("the stage to fold", stageReading, (reading) => reading.collapsed && reading.actors === 0, 60_000);
    await openChannel("Launch room");
    await sleep(800);
    await openChannel(channelName);
    await sleep(800);
    last = await sampleMemory(`leak cycle ${cycle}`, channel.id);
  }
  const heapDelta = Number((last.heapMb - baseline.heapMb).toFixed(3));
  const nodeDelta = last.nodesOutsideTimeline - baseline.nodesOutsideTimeline;
  report.stage.leak = { baseline, last, heapDelta, nodeDelta, stageNodesAtEnd: last.stageNodes, sawActors };
  check(
    "Leak: heap after 5 cycles and GC",
    `within ${LIMITS.leakHeapMb} MB of the base line`,
    `${baseline.heapMb} -> ${last.heapMb} MB (${heapDelta >= 0 ? "+" : ""}${heapDelta})`,
    Math.abs(heapDelta) <= LIMITS.leakHeapMb,
  );
  check(
    "Leak: DOM nodes (outside the message list) after 5 cycles",
    "back to the base line",
    `${baseline.nodesOutsideTimeline} -> ${last.nodesOutsideTimeline} (${nodeDelta >= 0 ? "+" : ""}${nodeDelta}); stage nodes ${baseline.stageNodes} -> ${last.stageNodes}; total ${baseline.nodes} -> ${last.nodes}`,
    nodeDelta === 0 || (Math.abs(nodeDelta) <= 20 && last.stageNodes === baseline.stageNodes),
  );

  // ----- Verdicts that read the figures. -----
  const vsBase = report.flagOffIdleHeapMedianMb ?? 0;
  const basePath = resolve(OUT, "e2e-report-base.json");
  if (existsSync(basePath)) {
    const base = baseSchema.parse(JSON.parse(readFileSync(basePath, "utf8")));
    const baseHeap = base.flagOffIdleHeapMedianMb;
    const gap = Number((vsBase - baseHeap).toFixed(3));
    report.stage.baseComparison = { baseHeapMb: baseHeap, branchHeapMb: vsBase, gapMb: gap };
    check(
      "Flag off against the base commit: JS heap, Launch room idle, after GC (median of 3)",
      `<= ${LIMITS.flagOffVsBaseHeapMb} MB`,
      `base ${baseHeap} MB, branch ${vsBase} MB, gap ${gap} MB`,
      Math.abs(gap) <= LIMITS.flagOffVsBaseHeapMb,
    );
    const sameDom = base.domSignature === report.domSignature;
    report.stage.domSignatureEqualToBase = sameDom;
    report.owner["3"].ok = report.owner["3"].ok && sameDom;
    report.owner["3"].note += ` DOM signature of the conversation equals the base: ${sameDom}.`;
  } else {
    check("Flag off against the base commit", "base report present", "e2e-report-base.json is missing", false);
  }
  const stageLong = (label: string) => report.longTasks[label] ?? { count: 0, maxMs: 0 };
  const onLong = stageLong("flag-on 8 active");
  const offLong = stageLong("flag-off 8 active");
  check(
    "Long tasks of 50 ms or more, flag on, 8 agents, 8 s",
    `none caused by the stage (flag off: ${offLong.count}, max ${offLong.maxMs} ms)`,
    `${onLong.count}, max ${onLong.maxMs} ms; at mount ${stageLong("mount (chunk load and first draw)").count} (max ${stageLong("mount (chunk load and first draw)").maxMs} ms); idle ${stageLong("flag-on idle").count}`,
    onLong.count <= offLong.count && stageLong("flag-on idle").count === 0,
  );
  report.owner["5"].note +=
    ` "This channel" saved ${JSON.stringify(scoped)}: ${channelScopeOk}; "All channels" saved ${JSON.stringify(allScope)}: ${allScopeOk}.`;
  report.owner["5"].ok = report.owner["5"].ok && channelScopeOk && allScopeOk;
} catch (error) {
  report.scriptError = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await finishCleanup();
}

async function finishCleanup(): Promise<void> {
  try {
    await page.evaluate(() => window.localStorage.removeItem("buildersbot:channel-stage:v1")).catch(() => undefined);
    await client.cleanup().catch(() => undefined);
    for (const agentId of created.agents)
      await page.evaluate((id) => window.buildersbot.agent.deleteAgent(id), agentId).catch(() => undefined);
  } finally {
    await cdp.detach().catch(() => undefined);
    await session.close();
    finish();
  }
}

function finish(): never {
  report.failed = [
    ...report.checks.filter((entry) => !entry.passed).map((entry) => entry.name),
    ...Object.entries(report.owner)
      .filter(([, entry]) => !entry.ok)
      .map(([item]) => `owner decision ${item}`),
    ...(report.pageErrors.length > 0 ? ["page errors"] : []),
    ...(report.scriptError ? ["script error"] : []),
  ];
  report.passed = report.failed.length === 0;
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ passed: report.passed, failed: report.failed, report: REPORT }, null, 2)}\n`,
  );
  process.exit(report.passed ? 0 : 1);
}
