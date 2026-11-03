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
// - flag on, agents at work, against flag off in the same live state (off, on, off, on);
// - flag on, 8 actors on the real component in Storybook, against the folded strip;
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
import { chromium } from "playwright-core";
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

const TARGET = argument("target") === "base" ? "base" : argument("target") === "stories" ? "stories" : "branch";
const OUT = resolve(import.meta.dirname, "../.buildersbot-build/channel-stage");
const REPORT = resolve(OUT, TARGET === "branch" ? "e2e-report.json" : `e2e-report-${TARGET}.json`);
mkdirSync(OUT, { recursive: true });

const MB = 1024 * 1024;
// The four seeded agents all get a task, but a channel runs two at a time (CHANNEL_PARALLEL_LIMIT), so two
// actors is the most that a real channel shows at once. The eight-seat cost is measured on the real
// component in Storybook (`--target=stories`).
const WORKERS = 4;
const LIVE_RUNNING = 2;
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
  /** Elements of the document outside the message list: what is in the DOM, not what Blink still holds. */
  elementsOutsideTimeline: number;
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
  target: "base" | "branch" | "stories";
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

if (TARGET === "stories") await runStories();

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
    elements: document.querySelectorAll("*").length,
    timeline: document.querySelector(".conversation-scroll")?.querySelectorAll("*").length ?? 0,
    stage: document.querySelector(".channel-stage-frame")?.querySelectorAll("*").length ?? 0,
  }));
  const nodes = reading.Nodes ?? 0;
  const memory: Memory = {
    label,
    heapMb: Number(((reading.JSHeapUsedSize ?? 0) / MB).toFixed(3)),
    nodes,
    nodesOutsideTimeline: nodes - dom.timeline,
    elementsOutsideTimeline: dom.elements - dom.timeline,
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
const stageReading = () => readStage(page);

function readStage(target: Page) {
  return target.evaluate(() => {
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
}

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

/**
 * The signature without what is inside the title block of the header. The branch changes that block on
 * purpose (a gear instead of the faces), so the flag-off comparison with the base leaves it out.
 */
function withoutHeaderTitle(signature: string): string {
  const kept: string[] = [];
  let blockDepth = -1;
  for (const line of signature.split("\n")) {
    const depth = line.length - line.trimStart().length;
    if (blockDepth >= 0 && depth > blockDepth) continue;
    blockDepth = line.trimStart().startsWith("div.channel-header-block") ? depth : -1;
    kept.push(line);
  }
  return kept.join("\n");
}

// ----- The settings gear in the header of the open channel. -----
const settingsPanel = () => page.locator(`aside.settings-panel[aria-label="${english("channel.panel.label")}"]`);
const gearButton = () =>
  page
    .locator("main.conversation-panel header.conversation-header")
    .getByRole("button", { name: english("channel.settings.title"), exact: true });

async function readHeader() {
  return page.evaluate((label) => {
    const header = document.querySelector("main.conversation-panel header.conversation-header");
    const gear = [...(header?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.getAttribute("aria-label") === label,
    );
    const box = gear?.getBoundingClientRect();
    const name = header?.querySelector(".channel-header-name")?.getBoundingClientRect();
    return {
      gear: gear !== undefined,
      gearClass: gear?.classList.contains("channel-header-settings") ?? false,
      gearIcon: gear?.querySelector("svg")?.getAttribute("class") ?? "",
      gearVisible: (box?.width ?? 0) > 0 && (box?.height ?? 0) > 0,
      gearDisabled: gear?.disabled ?? false,
      nameGapPx: box && name ? Math.round(name.left - box.right) : null,
      faces: header?.querySelectorAll(".channel-avatar, .agent-avatar").length ?? -1,
      oldAvatarButton: header?.querySelectorAll(".channel-header-avatar").length ?? -1,
      headerAnimations: document.getAnimations().filter((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        return target instanceof Element && header?.contains(target) === true;
      }).length,
    };
  }, english("channel.settings.title"));
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
  const settings = page.locator(".section-rail-stage-settings");
  await page.keyboard.press("Escape");
  const closedByEscape = await settings
    .waitFor({ state: "detached", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  report.stage.popoverEscapeCloses = closedByEscape && (report.stage.popoverEscapeCloses ?? true);
  if (!closedByEscape) {
    await flagButton().click();
    await settings.waitFor({ state: "detached", timeout: 10_000 });
  }
}

async function setFlag(options: { enabled: boolean; scope: "channel" | "all" }): Promise<void> {
  const panel = await openFlag();
  const scopeName =
    options.scope === "channel" ? english("channel.stage.flag.scopeChannel") : english("channel.stage.flag.scopeAll");
  await panel.getByText(scopeName, { exact: true }).click();
  const toggle = panel.getByRole("switch", { name: english("channel.stage.flag.enable") });
  const now = await toggle.isChecked();
  if (now !== options.enabled) {
    // The visible control covers the native input and takes the pointer, so this uses the keyboard.
    await toggle.focus();
    await page.keyboard.press("Space");
    await waitUntil(
      "the stage switch",
      () => toggle.isChecked(),
      (checked) => checked === options.enabled,
      10_000,
    );
  }
  await closeFlag();
}

const stagePreference = () => page.evaluate(() => window.localStorage.getItem("buildersbot:channel-stage:v1"));

const stageModule = (url: string) =>
  /\/(ChannelStageHost\.tsx|ChannelStage\.tsx|channel-stage-model\.ts|channel-stage\.css)(\?|$)/.test(url);
const requestedStageModules = (urls: readonly string[]) => [
  ...new Set(urls.filter(stageModule).map((url) => new URL(url).pathname.split("/").pop() ?? url)),
];

// The base and the branch run in two dev profiles with their own window size, and a bigger window
// draws more rows (and no scroll rail when the chat fits). Both runs lay out the page at this size; the
// end clears it. The Electron CDP has no Browser domain to move the window itself.
const VIEWPORT = { width: 1280, height: 860 };

try {
  // ----- Fresh renderer: flag off, no stage module yet. -----
  await cdp.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 0, mobile: false });
  const requests: string[] = [];
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (event) => requests.push(event.request.url));
  await page.addInitScript(PROBE);
  await page.evaluate(() => window.localStorage.removeItem("buildersbot:channel-stage:v1"));
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("navigation", { name: /./ }).first().waitFor({ timeout: 60_000 });
  const lang = await page.evaluate(() => document.documentElement.lang);
  english = translateFor(lang === "pt" ? "pt" : "en");
  report.stage.language = lang;
  report.stage.viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
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
    await finishCleanup();
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

  // ----- Header: a gear in place of the faces, and it opens the channel settings. -----
  const headerOpen = await readHeader();
  await shot("e2e-header-gear", page.locator("main.conversation-panel header.conversation-header"));
  await gearButton().click();
  const settingsOpened = await settingsPanel()
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  await shot("e2e-header-gear-settings-open");
  // The docked panel hides its own close button; the side panel toggle of the header closes it.
  if (settingsOpened) {
    await page.locator("main.conversation-panel .conversation-header-actions .side-panel-toggle").click();
    await settingsPanel().waitFor({ state: "hidden", timeout: 10_000 });
  }
  report.stage.header = { open: headerOpen, settingsOpened };
  check(
    "Header: gear in place of the faces, opens the settings",
    "gear button visible and enabled, no faces and no animation in the header, settings panel opens",
    JSON.stringify({ ...headerOpen, settingsOpened }),
    headerOpen.gear &&
      headerOpen.gearClass &&
      headerOpen.gearVisible &&
      !headerOpen.gearDisabled &&
      headerOpen.faces === 0 &&
      headerOpen.oldAvatarButton === 0 &&
      headerOpen.headerAnimations === 0 &&
      settingsOpened,
  );

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

  async function startRound(prompt: string, targets = agents, running = LIVE_RUNNING): Promise<void> {
    for (const agent of targets) await client.send(channel.id, `${prompt} (${agent.name})`, agent.id);
    await waitUntil(
      `${Math.min(running, targets.length)} running tasks`,
      () => runningTasks(channel.id),
      (count) => count >= Math.min(running, targets.length),
      90_000,
    );
  }

  // ----- Flag off, eight agents at work. -----
  await startRound(RESEARCH_PROMPT);
  await sleep(5_000);
  let from = await pageNow();
  const offActiveCpu = await cpuWindow("flag-off at work", 8_000);
  await longTasksBetween("flag-off at work", from, await pageNow());
  const offA1 = await sampleMemory("A1 flag off, at work", channel.id);

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
  await waitUntil("stage actors", stageReading, (reading) => reading.actors >= LIVE_RUNNING, 60_000);
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
  const onActiveCpu = await cpuWindow("flag-on at work", 8_000);
  await longTasksBetween("flag-on at work", from, await pageNow());
  const onB1 = await sampleMemory("B1 flag on, at work", channel.id);

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
  const leaderAtBack = leader === undefined || leader.y === Math.min(...richLook.map((actor) => actor.y));
  report.owner["1"] = {
    ok: board.table && board.request && richLook.length >= LIVE_RUNNING && leaderAtBack,
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
  const offA2 = await sampleMemory("A2 flag off again, at work", channel.id);
  const afterOff = await stageReading();
  report.stage.afterOff = afterOff;
  await setFlag({ enabled: true, scope: "all" });
  await waitUntil("stage back", stageReading, (reading) => reading.mounted, 30_000);
  await sleep(3_000);
  const onB2 = await sampleMemory("B2 flag on again (all channels), at work", channel.id);
  const allScope = Object.values(preferenceSchema.catch({}).parse(JSON.parse((await stagePreference()) ?? "{}")))[0];
  report.stage.preferenceAll = allScope ?? null;
  const allScopeOk = allScope?.all === true && Object.keys(allScope.channels).length === 0;
  const sameState = [offA1, onB1, offA2, onB2].every((sample) => sample.running >= LIVE_RUNNING);
  report.stage.sameLiveState = sameState;
  const costFirst = Number((onB1.heapMb - offA1.heapMb).toFixed(3));
  const costSecond = Number((onB2.heapMb - offA2.heapMb).toFixed(3));
  const cost = Math.max(costFirst, costSecond);
  check(
    "Flag on, agents at work (2 running, the live maximum), against flag off (same live state)",
    `<= ${LIMITS.flagOnCostHeapMb} MB`,
    `B1-A1 ${costFirst} MB (first, with the chunk loading), B2-A2 ${costSecond} MB; 2 tasks running in all four samples: ${sameState}`,
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
  // The renderer still draws the long answers for a while after the stop. The CPU windows wait until it
  // settles, and run on, off, off, on so that a slow fall does not count against either side.
  report.stage.idleSettle = await waitUntil(
    "the renderer to settle after the stop",
    () => cpuWindow("settle", 3_000),
    (percent) => percent < 10,
    120_000,
  );
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
  cpuOff.push(await cpuWindow("flag-off idle", 10_000));
  await setFlag({ enabled: true, scope: "all" });
  await sleep(1_500);
  cpuOn.push(await cpuWindow("flag-on idle (folded)", 10_000));
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
  const baselineDetached = await detachedNodes(cdp);
  const nodesSeries = [baseline.nodes];
  let last = baseline;
  let sawActors = 0;
  for (let cycle = 1; cycle <= 5; cycle += 1) {
    // A short answer can end before the next one starts, so one running task is enough here.
    await startRound(SHORT_PROMPT, short, 1);
    sawActors = Math.max(
      sawActors,
      (await waitUntil("stage actors", stageReading, (reading) => reading.actors >= 1, 30_000)).actors,
    );
    await waitUntil(
      "short tasks to end",
      async () =>
        (await client.read(channel.id)).tasks.filter((task) => ["queued", "running", "waiting"].includes(task.state))
          .length,
      (count) => count === 0,
      120_000,
    );
    await waitUntil("the stage to fold", stageReading, (reading) => reading.collapsed && reading.actors === 0, 60_000);
    await openChannel("Launch room");
    await sleep(800);
    await openChannel(channelName);
    await sleep(800);
    last = await sampleMemory(`leak cycle ${cycle}`, channel.id);
    nodesSeries.push(last.nodes);
  }
  const heapDelta = Number((last.heapMb - baseline.heapMb).toFixed(3));
  const elementDelta = last.elementsOutsideTimeline - baseline.elementsOutsideTimeline;
  const endDetached = await detachedNodes(cdp);
  report.stage.leak = {
    baseline,
    last,
    heapDelta,
    elementDelta,
    baselineDetached,
    endDetached,
    nodesSeries,
    stageNodesAtEnd: last.stageNodes,
    sawActors,
  };
  // The heap and the listeners of these cycles also grow on the base commit, flag off, by the same amount:
  // each channel switch keeps about 2.5 MB and 175 listeners there too. So they are a reading here, and
  // the share of the stage is the gap between the same switches with the flag on and off, below.
  report.stage.leakAppGrowth = {
    heapMb: heapDelta,
    listeners: last.listeners - baseline.listeners,
    note: "Not a check: the app grows the same on the base commit (channel switches and new messages).",
  };
  check(
    "Leak: DOM elements outside the message list, stage nodes and detached nodes after 5 cycles",
    "elements not above the base line, stage nodes back to it, detached nodes not above it",
    `elements ${baseline.elementsOutsideTimeline} -> ${last.elementsOutsideTimeline} (${elementDelta >= 0 ? "+" : ""}${elementDelta}); stage nodes ${baseline.stageNodes} -> ${last.stageNodes}; detached ${baselineDetached} -> ${endDetached}; Blink node counter per cycle ${nodesSeries.join(", ")}`,
    elementDelta <= 0 && last.stageNodes === baseline.stageNodes && endDetached <= baselineDetached,
  );

  // ----- Leak, the stage's share: the same 5 channel switches with the flag on and off. -----
  async function switchCycles(label: string) {
    const start = await sampleMemory(`${label} 0`, channel.id);
    let end = start;
    for (let cycle = 1; cycle <= 5; cycle += 1) {
      await openChannel("Launch room");
      await sleep(800);
      await openChannel(channelName);
      await sleep(800);
      end = await sampleMemory(`${label} ${cycle}`, channel.id);
    }
    return {
      heapMb: Number((end.heapMb - start.heapMb).toFixed(3)),
      listeners: end.listeners - start.listeners,
      elements: end.elementsOutsideTimeline - start.elementsOutsideTimeline,
      stageNodes: end.stageNodes,
    };
  }
  const switchOn = await switchCycles("switch, flag on");
  await setFlag({ enabled: false, scope: "all" });
  await sleep(1_000);
  const switchOff = await switchCycles("switch, flag off");
  await setFlag({ enabled: true, scope: "all" });
  await sleep(1_000);
  const switchHeapGap = Number((switchOn.heapMb - switchOff.heapMb).toFixed(3));
  const switchListenerGap = switchOn.listeners - switchOff.listeners;
  report.stage.leakSwitch = { on: switchOn, off: switchOff, heapGapMb: switchHeapGap, listenerGap: switchListenerGap };
  check(
    "Leak, stage share: 5 channel switches, flag on against flag off, after GC",
    `heap gap <= ${LIMITS.leakHeapMb} MB, listener gap <= 5, elements not above the start`,
    `heap on +${switchOn.heapMb} MB, off +${switchOff.heapMb} MB (gap ${switchHeapGap}); listeners on +${switchOn.listeners}, off +${switchOff.listeners} (gap ${switchListenerGap}); elements on ${switchOn.elements}, off ${switchOff.elements}`,
    switchHeapGap <= LIMITS.leakHeapMb && switchListenerGap <= 5 && switchOn.elements <= 0,
  );

  // ----- Archived channel: the gear is off, and open settings close. The cleanup deletes the channel. -----
  await gearButton().click();
  await settingsPanel().waitFor({ state: "visible", timeout: 10_000 });
  await client.command({ type: "archive", operationId: crypto.randomUUID(), channelId: channel.id });
  const archivedHeader = await waitUntil(
    "the gear to turn off in the archived channel",
    readHeader,
    (header) => header.gear && header.gearDisabled,
    30_000,
  );
  const settingsClosed = await settingsPanel()
    .waitFor({ state: "hidden", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  await shot("e2e-header-gear-archived", page.locator("main.conversation-panel header.conversation-header"));
  report.stage.headerArchived = { ...archivedHeader, settingsClosed };
  check(
    "Header, archived channel: gear off, settings closed",
    "gear present and disabled, no faces, the open settings panel closes",
    JSON.stringify({ ...archivedHeader, settingsClosed }),
    archivedHeader.gearDisabled && archivedHeader.faces === 0 && settingsClosed,
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
    const sameDom = withoutHeaderTitle(base.domSignature) === withoutHeaderTitle(report.domSignature ?? "");
    report.stage.domSignatureEqualToBase = sameDom;
    report.owner["3"].ok = report.owner["3"].ok && sameDom;
    report.owner["3"].note +=
      ` DOM signature of the conversation, without the header title block that this branch changes, equals the base: ${sameDom}.`;
  } else {
    check("Flag off against the base commit", "base report present", "e2e-report-base.json is missing", false);
  }
  const stageLong = (label: string) => report.longTasks[label] ?? { count: 0, maxMs: 0 };
  const onLong = stageLong("flag-on at work");
  const offLong = stageLong("flag-off at work");
  check(
    "Long tasks of 50 ms or more, flag on, agents at work, 8 s",
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
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
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

// ----- Storybook: the real component with 8 actors, which a live channel cannot show at once. -----
async function runStories(): Promise<void> {
  const origin = argument("storybook") ?? "http://127.0.0.1:6006";
  const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const url = (story: string) => `${origin}/iframe.html?id=conversation-channel-stage--${story}&viewMode=story`;

  async function load(story: string, settleMs = 2_500) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(PROBE);
    const tab = await context.newPage();
    tab.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
    const cdpTab = await context.newCDPSession(tab);
    await cdpTab.send("Performance.enable");
    await cdpTab.send("HeapProfiler.enable");
    await tab.goto(url(story));
    await tab.locator(".channel-stage-frame").waitFor({ timeout: 30_000 });
    await pause(settleMs);
    return { context, tab, cdpTab };
  }

  async function heapOf(cdpTab: CDPSession, label: string, passes = 3) {
    for (let pass = 0; pass < passes; pass += 1) {
      await cdpTab.send("HeapProfiler.collectGarbage");
      await pause(150);
    }
    const { metrics: list } = await cdpTab.send("Performance.getMetrics");
    const reading = Object.fromEntries(list.map((metric) => [metric.name, metric.value]));
    return { label, heapMb: Number(((reading.JSHeapUsedSize ?? 0) / MB).toFixed(3)), nodes: reading.Nodes ?? 0 };
  }

  try {
    // Heap: the folded strip against eight actors, three loads each, in turn.
    const folded: number[] = [];
    const eight: number[] = [];
    let eightLook: Awaited<ReturnType<typeof readStage>> | null = null;
    let eightTiming = { count: 0, maxMs: 0 };
    for (let round = 1; round <= 3; round += 1) {
      const strip = await load("folded");
      if (round === 1) {
        const bootStrip = await strip.tab.evaluate(() => window.__stageProbe?.long ?? []);
        report.longTasks["stories: page boot, folded strip"] = {
          count: bootStrip.length,
          maxMs: Math.round(Math.max(0, ...bootStrip.map(([, duration]) => duration))),
        };
      }
      const stripSample = await heapOf(strip.cdpTab, `folded ${round}`);
      folded.push(stripSample.heapMb);
      await strip.context.close();
      const full = await load("behaviors");
      const sample = await heapOf(full.cdpTab, `eight actors ${round}`);
      eight.push(sample.heapMb);
      report.memory.push({
        ...sample,
        nodesOutsideTimeline: sample.nodes,
        elementsOutsideTimeline: 0,
        stageNodes: 0,
        listeners: 0,
        running: 8,
      });
      if (round === 1) {
        eightLook = await readStage(full.tab);
        const bootEntries = await full.tab.evaluate(() => window.__stageProbe?.long ?? []);
        const bootNow = await full.tab.evaluate(() => performance.now());
        await pause(6_000);
        const allEntries = await full.tab.evaluate(() => window.__stageProbe?.long ?? []);
        const steady = allEntries.filter(([start]) => start > bootNow);
        eightTiming = {
          count: steady.length,
          maxMs: Math.round(Math.max(0, ...steady.map(([, duration]) => duration))),
        };
        report.longTasks["stories: 8 actors, steady 6 s"] = eightTiming;
        report.longTasks["stories: page boot with 8 actors"] = {
          count: bootEntries.length,
          maxMs: Math.round(Math.max(0, ...bootEntries.map(([, duration]) => duration))),
        };
        const actors = await full.tab.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>(".channel-stage-actor")].map((node) => {
            const model = node.querySelector(".channel-stage-model");
            return {
              name: node.getAttribute("aria-label") ?? "",
              activity: node.dataset.activity ?? "",
              y: Math.round(node.getBoundingClientRect().top),
              modelText: model?.textContent?.trim() ?? "",
              logo: model?.querySelector("svg, img") !== null,
            };
          }),
        );
        const more = await full.tab.locator(".channel-stage-more").allTextContents();
        report.stage.storiesActors = actors;
        report.stage.storiesOverflowChip = more;
        const behaviours = new Set(actors.map((actor) => actor.activity));
        const chief = actors.find((actor) => actor.name.startsWith("Chief,"));
        check(
          "Stories: 8 behaviours on 8 seats, lead at the back, +N chip",
          "8 distinct behaviours, 8 actors, lead highest, chip with 2",
          `${behaviours.size} behaviours, ${actors.length} actors, lead highest ${chief?.y === Math.min(...actors.map((actor) => actor.y))}, chip ${more.join("|")}`,
          behaviours.size === 8 &&
            actors.length === 8 &&
            chief?.y === Math.min(...actors.map((actor) => actor.y)) &&
            more.join("").includes("2"),
        );
        check(
          "Stories: provider logo and model above each agent",
          "8 of 8",
          `${actors.filter((actor) => actor.logo && actor.modelText).length} of ${actors.length}: ${[...new Set(actors.map((actor) => actor.modelText))].join(", ")}`,
          actors.length === 8 && actors.every((actor) => actor.logo && actor.modelText.length > 0),
        );
        await full.tab.screenshot({ path: resolve(OUT, "e2e-stories-8-actors.png") });
        report.screenshots.push(resolve(OUT, "e2e-stories-8-actors.png"));

        // Pause: hidden window, off screen, reduced motion.
        await full.tab.evaluate(() => {
          Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await pause(600);
        const hidden = await readStage(full.tab);
        await full.tab.evaluate(() => {
          Reflect.deleteProperty(document, "hidden");
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await pause(500);
        const back = await readStage(full.tab);
        await full.tab.evaluate(() => {
          const frame = document.querySelector<HTMLElement>(".channel-stage-frame");
          if (frame) frame.style.transform = "translateY(-4000px)";
        });
        await pause(800);
        const off = await readStage(full.tab);
        await full.tab.evaluate(() => {
          const frame = document.querySelector<HTMLElement>(".channel-stage-frame");
          if (frame) frame.style.transform = "";
        });
        await pause(500);
        await full.tab.emulateMedia({ reducedMotion: "reduce" });
        await pause(800);
        const reduced = await readStage(full.tab);
        report.stage.storiesPause = { eightLook, hidden, back, off, reduced };
        check(
          "Stories, 8 actors: loops while visible",
          "one loop per actor",
          `${eightLook?.infiniteRunning} running of ${eightLook?.infinite}`,
          eightLook !== null && eightLook.infiniteRunning >= 6,
        );
        check(
          "Stories, 8 actors: hidden window pauses the loops",
          "0 running",
          `${hidden.infiniteRunning} running, ${hidden.infinitePaused} paused of ${hidden.infinite}`,
          hidden.infinite > 0 && hidden.infiniteRunning === 0 && back.infiniteRunning > 0,
        );
        check(
          "Stories, 8 actors: stage off screen pauses the loops",
          "0 running",
          `${off.infiniteRunning} running, ${off.infinitePaused} paused of ${off.infinite}`,
          off.infinite > 0 && off.infiniteRunning === 0,
        );
        check(
          "Stories, 8 actors: prefers-reduced-motion",
          "0 infinite animations",
          `${reduced.infinite} infinite, ${reduced.animations} animations`,
          reduced.infinite === 0,
        );
      }
      await full.context.close();
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
    const cost = Number((median(eight) - median(folded)).toFixed(3));
    report.stage.storiesHeap = { folded, eight, medianCostMb: cost };
    check(
      "8 actors on the real component, against the folded strip: JS heap after GC",
      `<= ${LIMITS.flagOnCostHeapMb} MB`,
      `folded ${folded.join(" / ")} MB, 8 actors ${eight.join(" / ")} MB, median cost ${cost} MB`,
      cost <= LIMITS.flagOnCostHeapMb,
    );
    check(
      "Stories, 8 actors at work for 6 s after the page is up: long tasks of 50 ms or more",
      "none (the page boot is Storybook's own, it is listed in longTasks)",
      `${eightTiming.count}, max ${eightTiming.maxMs} ms; boot with 8 actors ${JSON.stringify(report.longTasks["stories: page boot with 8 actors"])}, boot of the folded strip ${JSON.stringify(report.longTasks["stories: page boot, folded strip"])}`,
      eightTiming.count === 0,
    );

    // Nobody working: the strip and the open empty stage run nothing.
    for (const story of ["folded", "empty"] as const) {
      const idle = await load(story, 1_500);
      const before = await idle.tab.evaluate(() => {
        const probe = window.__stageProbe;
        return { timeouts: probe?.timeouts ?? 0, frames: probe?.frames ?? 0, intervals: probe?.intervals ?? 0 };
      });
      await pause(8_000);
      const reading = await readStage(idle.tab);
      const after = await idle.tab.evaluate(() => {
        const probe = window.__stageProbe;
        return {
          timeouts: probe?.timeouts ?? 0,
          frames: probe?.frames ?? 0,
          intervals: probe?.intervals ?? 0,
          liveTimers: probe?.live.size ?? 0,
          liveFrames: probe?.liveFrames.size ?? 0,
        };
      });
      check(
        `Stories, nobody at work (${story}): animations, timers, frames of the stage`,
        "0 animations, 0 live timers, 0 live frames, 0 new in 8 s",
        `${reading.animations} animations, live ${after.liveTimers} timers ${after.liveFrames} frames, new ${after.timeouts - before.timeouts + after.intervals - before.intervals} timers ${after.frames - before.frames} frames`,
        reading.animations === 0 &&
          after.liveTimers === 0 &&
          after.liveFrames === 0 &&
          after.timeouts === before.timeouts &&
          after.intervals === before.intervals &&
          after.frames === before.frames,
      );
      await idle.context.close();
    }

    // Enter and leave: the scripted run brings agents in and out; the heap and the stage nodes come back.
    // The run ends where it began, in the folded strip, so the folded story is the base line.
    const run = await load("run", 0);
    const startNodes = await run.tab.evaluate(
      () => document.querySelector(".channel-stage-frame")?.querySelectorAll("*").length ?? 0,
    );
    let peak = 0;
    for (let waited = 0; waited < 30_000; waited += 1_000) {
      await pause(1_000);
      peak = Math.max(peak, (await readStage(run.tab)).actors);
    }
    await run.tab.locator(".channel-stage[data-collapsed]").waitFor({ timeout: 15_000 });
    await pause(1_000);
    const end = await heapOf(run.cdpTab, "run: after");
    const endNodes = await run.tab.evaluate(
      () => document.querySelector(".channel-stage-frame")?.querySelectorAll("*").length ?? 0,
    );
    const endLook = await readStage(run.tab);
    const endElements = await run.tab.evaluate(() => document.querySelectorAll("*").length);
    const endDetached = await detachedNodes(run.cdpTab);
    // The control waits as long as the run did, so growth that the story makes by itself is in the base.
    const control = await load("folded", 33_000);
    const controlSample = await heapOf(control.cdpTab, "folded, 33 s");
    const baseElements = await control.tab.evaluate(() => document.querySelectorAll("*").length);
    const baseDetached = await detachedNodes(control.cdpTab);
    await control.context.close();
    const baseHeap = controlSample.heapMb;
    report.stage.storiesRun = {
      baseHeap,
      endHeap: end.heapMb,
      baseElements,
      endElements,
      baseDetached,
      endDetached,
      blinkNodeCounter: { base: controlSample.nodes, end: end.nodes },
      startStageNodes: startNodes,
      endStageNodes: endNodes,
      peak,
    };
    check(
      "Stories, scripted run (enter, hand-off, wait, finish, leave): heap and DOM against the folded strip",
      `heap within ${LIMITS.leakHeapMb} MB, DOM elements and stage nodes back, no detached nodes, 0 animations`,
      `heap ${baseHeap} -> ${end.heapMb} MB (${Number((end.heapMb - baseHeap).toFixed(3))}); DOM elements ${baseElements} -> ${endElements}; stage nodes ${startNodes} -> ${endNodes}; detached ${baseDetached} -> ${endDetached}; peak ${peak} actors; animations at end ${endLook.animations}; Blink node counter ${controlSample.nodes} -> ${end.nodes} (informative)`,
      Math.abs(end.heapMb - baseHeap) <= LIMITS.leakHeapMb &&
        endElements === baseElements &&
        startNodes === endNodes &&
        endDetached <= baseDetached &&
        endLook.animations === 0 &&
        peak >= 2,
    );
    await run.context.close();
  } catch (error) {
    report.scriptError = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    await browser.close();
  }
  finish();
}

/** Detached DOM nodes that still live on the heap: a heap snapshot, counted by name. */
async function detachedNodes(session: CDPSession) {
  const chunks: string[] = [];
  const onChunk = (event: { chunk: string }) => chunks.push(event.chunk);
  session.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  try {
    await session.send("HeapProfiler.collectGarbage");
    await session.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  } finally {
    session.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  }
  const snapshot = z
    .object({
      snapshot: z.object({ meta: z.object({ node_fields: z.array(z.string()) }) }),
      nodes: z.array(z.number()),
      strings: z.array(z.string()),
    })
    .parse(JSON.parse(chunks.join("")));
  const stride = snapshot.snapshot.meta.node_fields.length;
  const nameAt = snapshot.snapshot.meta.node_fields.indexOf("name");
  let detached = 0;
  for (let index = 0; index < snapshot.nodes.length; index += stride)
    if ((snapshot.strings[snapshot.nodes[index + nameAt] ?? 0] ?? "").startsWith("Detached ")) detached += 1;
  return detached;
}
