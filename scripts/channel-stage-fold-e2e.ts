// Gate of the fold of the agent stage of a channel. It drives this worktree's running dev app through
// CDP, on the seeded channel "Launch room": no agent works and no message is sent. Start the app with
// `bun run dev` (never `--shared`), then run `bun scripts/channel-stage-fold-e2e.ts --allow-mutations`.
// It only writes the stage preference of the profile (`buildersbot:channel-stage:v1`) and removes it
// at the end.
//
// What it checks:
// - nobody works and the reader chose to hide the stage then: nothing shows at the top, not a strip and
//   not the words "Nobody is working";
// - the reader folds the stage by hand: the figures fade out first, then the panel folds (measured on
//   every frame), and it opens in the other order;
// - the fold of one channel survives a reload, and unfolding drops its entry from the saved preference.
// Writes .buildersbot-build/channel-stage-fold/report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { translateFor } from "@buildersbot/i18n";
import { createBuildersBotLogger } from "@buildersbot/logging";
import type { Page } from "playwright-core";
import { z } from "zod";
import { connectChannelE2e } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/channel-stage-fold");
mkdirSync(OUT, { recursive: true });
const STORAGE_KEY = "buildersbot:channel-stage:v1";
const CHANNEL = "Launch room";

interface Frame {
  t: number;
  height: number;
  figures: number | null;
}

declare global {
  interface Window {
    __foldFrames?: Frame[];
    __foldRaf?: number;
  }
}

const preferenceSchema = z.record(z.string(), z.object({ folded: z.record(z.string(), z.boolean()).optional() }));

const logger = createBuildersBotLogger("channel-stage-fold-e2e");
const session = await connectChannelE2e("channel-stage-fold-e2e");
const { page } = session;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const report: { checks: { name: string; passed: boolean; note: string }[]; screenshots: string[]; passed: boolean } = {
  checks: [],
  screenshots: [],
  passed: false,
};
let english = translateFor("en");

function check(name: string, passed: boolean, note: string): void {
  report.checks.push({ name, passed, note });
  (passed ? logger.info : logger.error)(`${passed ? "ok" : "FAIL"} ${name}: ${note}`);
}

async function shot(name: string): Promise<void> {
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

/** The ids of the channels that the saved preference holds as folded, in any scope. */
async function foldedChannels(): Promise<string[]> {
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  const scopes = preferenceSchema.parse(JSON.parse(stored ?? "{}"));
  return Object.values(scopes).flatMap((scope) => Object.keys(scope.folded ?? {}));
}

async function openChannel(): Promise<void> {
  const row = page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${CHANNEL}[,.]`) })
    .first();
  await row.click({ timeout: 30_000 });
  await page.getByRole("heading", { level: 1, name: CHANNEL, exact: true }).waitFor({ timeout: 30_000 });
}

const flagButton = () => page.getByRole("button", { name: english("channel.stage.flag.label"), exact: true });

/** Sets a switch of the flag popover through the keyboard: the visible control covers the native input. */
async function setSwitch(name: string, wanted: boolean): Promise<void> {
  await flagButton().click();
  const panel = page.locator(".section-rail-stage-settings");
  await panel.waitFor({ timeout: 10_000 });
  await panel.getByText(english("channel.stage.flag.scopeChannel"), { exact: true }).click();
  const toggle = panel.getByRole("switch", { name });
  if ((await toggle.isChecked()) !== wanted) {
    await toggle.focus();
    await page.keyboard.press("Space");
    await sleep(300);
    assert.equal(await toggle.isChecked(), wanted, `the switch "${name}" did not change`);
  }
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached", timeout: 5_000 });
}

/** The stage as the page draws it: height of the panel, and what the strip and the board show. */
function reading(target: Page) {
  return target.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".channel-stage");
    const frame = document.querySelector<HTMLElement>(".channel-stage-frame");
    return {
      present: stage !== null,
      height: stage ? Math.round(stage.getBoundingClientRect().height) : 0,
      gone: stage?.hasAttribute("data-gone") ?? false,
      collapsed: stage?.hasAttribute("data-collapsed") ?? false,
      strip: document.querySelector(".channel-stage-strip")?.textContent?.trim() ?? null,
      board: document.querySelector(".agent-stage-board") !== null,
      frameHeight: frame ? Math.round(frame.getBoundingClientRect().height) : 0,
    };
  });
}

/** One sample for each animation frame while `act` runs: the panel height and the opacity of the board. */
async function frames(act: () => Promise<void>, ms: number): Promise<Frame[]> {
  await page.evaluate(() => {
    const samples: { t: number; height: number; figures: number | null }[] = [];
    const start = performance.now();
    const tick = () => {
      const stage = document.querySelector<HTMLElement>(".channel-stage");
      const board = document.querySelector<HTMLElement>(".agent-stage-board");
      samples.push({
        t: Math.round(performance.now() - start),
        height: stage ? Math.round(stage.getBoundingClientRect().height) : 0,
        figures: board ? Number(getComputedStyle(board).opacity) : null,
      });
      window.__foldRaf = requestAnimationFrame(tick);
    };
    window.__foldFrames = samples;
    tick();
  });
  await act();
  await sleep(ms);
  return page.evaluate(() => {
    if (window.__foldRaf !== undefined) cancelAnimationFrame(window.__foldRaf);
    return window.__foldFrames ?? [];
  });
}

const foldButton = () => page.locator(".channel-stage-fold");

try {
  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("navigation", { name: /./ }).first().waitFor({ timeout: 60_000 });
  const lang = await page.evaluate(() => document.documentElement.lang);
  english = translateFor(lang === "pt" ? "pt" : "en");
  await sleep(3_000);
  await openChannel();
  await sleep(1_000);

  // ----- Nobody works, the stage is on and hides itself then: nothing at the top. -----
  await setSwitch(english("channel.stage.flag.enable"), true);
  await sleep(1_500);
  const hidden = await reading(page);
  const words = await page.evaluate(() => document.body.innerText);
  await shot("1-hidden-when-nobody-works");
  check(
    "nobody works: the stage leaves the top",
    hidden.height === 0 &&
      hidden.strip === null &&
      !hidden.board &&
      !words.includes("Nobody is working") &&
      !words.includes("Ninguém está trabalhando"),
    `height ${hidden.height}, strip ${JSON.stringify(hidden.strip)}, board ${hidden.board}, frame ${hidden.frameHeight}`,
  );

  // ----- The stage stays open while nobody works (hide off): fold by hand, frame by frame. -----
  await setSwitch(english("channel.stage.flag.collapse"), false);
  await sleep(2_500);
  const open = await reading(page);
  await shot("2-open-empty-stage");
  check(
    "hide off: the empty stage is open",
    open.height > 200 && open.board,
    `height ${open.height}, board ${open.board}`,
  );

  const fold = await frames(() => foldButton().click(), 1_800);
  const startHeight = fold[0]?.height ?? 0;
  const firstShrink = fold.find((frame) => frame.height < startHeight - 2);
  const figuresGone = fold.find((frame) => frame.figures !== null && frame.figures < 0.05);
  const boardUnmounted = fold.find((frame) => frame.figures === null);
  const end = fold.at(-1);
  check(
    "fold: the figures fade out, then the panel folds",
    firstShrink !== undefined &&
      figuresGone !== undefined &&
      figuresGone.t <= firstShrink.t + 17 &&
      (end?.height ?? 999) < 80,
    `figures below 5% at ${figuresGone?.t} ms, height starts to fall at ${firstShrink?.t} ms, final height ${end?.height}, board gone at ${boardUnmounted?.t} ms, ${fold.length} frames`,
  );
  const strip = await reading(page);
  await shot("3-folded-by-hand");
  check(
    "fold: a strip with the name of the stage remains",
    strip.collapsed && strip.strip === english("channel.stage.label"),
    `strip ${JSON.stringify(strip.strip)}`,
  );
  const foldedIds = await foldedChannels();
  check("fold: the channel is saved as folded", foldedIds.length === 1, `folded channels ${JSON.stringify(foldedIds)}`);

  // ----- The fold survives a reload. -----
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("navigation", { name: /./ }).first().waitFor({ timeout: 60_000 });
  await sleep(3_000);
  await openChannel();
  await sleep(1_500);
  const reloaded = await reading(page);
  await shot("4-folded-after-reload");
  check(
    "reload: the stage of this channel is still folded",
    reloaded.collapsed && reloaded.strip === english("channel.stage.label") && !reloaded.board,
    `collapsed ${reloaded.collapsed}, strip ${JSON.stringify(reloaded.strip)}`,
  );

  // ----- Unfold: the panel opens first, then the figures come back; the entry is dropped. -----
  const unfold = await frames(() => foldButton().click(), 2_200);
  const startFolded = unfold[0]?.height ?? 0;
  const firstGrow = unfold.find((frame) => frame.height > startFolded + 2);
  const firstBoard = unfold.find((frame) => frame.figures !== null);
  const finalFrame = unfold.at(-1);
  const heightWhenBoardShows = firstBoard?.height ?? 0;
  check(
    "unfold: the panel opens before the figures come back",
    firstGrow !== undefined &&
      firstBoard !== undefined &&
      firstBoard.t > firstGrow.t &&
      heightWhenBoardShows > (finalFrame?.height ?? 0) * 0.9,
    `height starts to grow at ${firstGrow?.t} ms, board appears at ${firstBoard?.t} ms at height ${heightWhenBoardShows}, final height ${finalFrame?.height}`,
  );
  await shot("5-unfolded");
  const afterFolded = await foldedChannels();
  check(
    "unfold: the entry of the channel is dropped from the saved preference",
    afterFolded.length === 0,
    `folded channels ${JSON.stringify(afterFolded)}`,
  );
} catch (error) {
  check("script", false, error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY).catch(() => undefined);
  report.passed = report.checks.length > 0 && report.checks.every((entry) => entry.passed);
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await session.close().catch(() => undefined);
}
process.exit(report.passed ? 0 : 1);
