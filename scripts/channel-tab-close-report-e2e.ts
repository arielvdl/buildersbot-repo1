// Checks the tab close report through the UI of this worktree's running dev app. Start the app with
// `bun run dev` (never `--shared`), then run `bun scripts/channel-tab-close-report-e2e.ts --allow-mutations
// [--agent=<agent id>]`. It needs one visible agent; no provider turn has to finish.
//
// It makes its own channel with tabs, closes them through the UI, and checks (specs/tab-close-report.md):
// A1. The X of a tab with a message opens the dialog with 3 outcomes, none chosen and Confirm off.
//     "Done" turns Confirm on; Confirm closes the tab and the Profile shows the record.
// A2. "Other": Confirm stays off with an empty or blank note and turns on with text. The Profile shows the note.
// A3. Cancel and Escape keep the tab and add no record.
// A4. A new empty tab closes with no dialog and adds no record.
// A5. The totals of "7 days" match the closes of this run. "30 days" makes one read. With more than 20
//     records, "Show more" brings the next ones with no repeat. No read runs while the Profile is closed.
// A20. "Continue in new tab" makes a new tab in the channel and fills its message box. Nothing is sent.
// A6. After the channel is deleted, the records stay with the saved names, and Continue is off with the reason.
// A21. Each record starts closed: no note and no last result show. The name is a button with
//     `aria-expanded`; a click, Enter or Space opens and closes it, with a visible focus ring after a key.
//     A long note shows at most four lines and is cut.
// It counts the reads of the Profile with a conditional breakpoint (CDP) on the two calls in
// `profile-tab-reports-store.ts`. It deletes its channel and the records it made at the end.
// Writes .buildersbot-build/tab-close-report/ui-e2e.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type ChannelTabReportsPage, LOCAL_SERVER_ID } from "@buildersbot/contracts/ipc";
import { translateFor } from "@buildersbot/i18n";
import { argument, ChannelClient, connectChannelE2e, waitFor } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/tab-close-report");
const UI_WAIT_MS = 15_000;
const STORE_SOURCE = "profile-tab-reports-store";
const COUNTER = "__tabReportReads";

type Fact = string | number | boolean | null | Fact[] | { [key: string]: Fact };
const report: {
  facts: { [key: string]: Fact };
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
  error?: string;
} = {
  facts: {},
  pageErrors: [],
  screenshots: [],
  passed: false,
};
mkdirSync(OUT, { recursive: true });
const session = await connectChannelE2e("channel-tab-close-report-e2e");
const { page } = session;
page.setDefaultTimeout(20_000);
/** A line per step on stderr, so a stuck run shows where it stopped. */
const step = (label: string) => process.stderr.write(`[${new Date().toISOString()}] ${label}\n`);
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const client = new ChannelClient(page);
const lang = await page.evaluate(() => document.documentElement.lang || navigator.language);
const t = translateFor(lang.startsWith("pt") ? "pt" : "en");
report.facts.locale = lang;
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stamp = Date.now().toString(36);
const name = `Close report ${stamp}`;
const createdReports = new Set<string>();

async function shot(label: string): Promise<void> {
  const path = resolve(OUT, `ui-${label}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

/** The records of this run, read through the same bridge as the Profile, for the checks only. */
async function records(): Promise<ChannelTabReportsPage> {
  const page_ = await page.evaluate(
    (input) => window.buildersbot.agent.listChannelTabReports(input.range, input.server),
    {
      range: {
        since: new Date(Date.now() - 3_600_000).toISOString(),
        until: new Date(Date.now() + 3_600_000).toISOString(),
        limit: 50,
      },
      server: LOCAL_SERVER_ID,
    },
  );
  assert.ok(page_, "the local server gives a page");
  return { ...page_, reports: page_.reports.filter((item) => item.channelName === name) };
}

/** The records of the runs of this script: the channel names start with "Close report ". Nothing else is touched. */
async function purgeTestRecords() {
  let removed = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = await page.evaluate(
      (server) =>
        window.buildersbot.agent.listChannelTabReports(
          {
            since: new Date(Date.now() - 300 * 86_400_000).toISOString(),
            until: new Date(Date.now() + 86_400_000).toISOString(),
            limit: 50,
          },
          server,
        ),
      LOCAL_SERVER_ID,
    );
    const mine = (found?.reports ?? []).filter((item) => item.channelName.startsWith("Close report "));
    if (mine.length === 0) break;
    for (const item of mine) {
      await page.evaluate((input) => window.buildersbot.agent.deleteChannelTabReport({ id: input.id }, input.server), {
        id: item.id,
        server: LOCAL_SERVER_ID,
      });
      removed += 1;
    }
  }
  return removed;
}

/** Counts each run of the two read calls of the Profile store, without pausing (condition false). */
const cdp = await page.context().newCDPSession(page);
await cdp.send("Debugger.enable");
const storeUrl = await page.evaluate(() => location.origin);
const source = await (await fetch(`${storeUrl}/src/features/settings/${STORE_SOURCE}.ts`)).text();
const callLines = source
  .split("\n")
  .flatMap((line, index) => (line.includes(".listChannelTabReports(") ? [index] : []));
assert.equal(callLines.length, 2, "the store has the first-page read and the next-page read");
for (const lineNumber of callLines)
  await cdp.send("Debugger.setBreakpointByUrl", {
    urlRegex: `${STORE_SOURCE}\\.ts`,
    lineNumber,
    condition: `(globalThis.${COUNTER} = (globalThis.${COUNTER} || 0) + 1, false)`,
  });
const reads = async () => Number(await page.evaluate(`Number(globalThis.${COUNTER} || 0)`));

const tabs = () => page.getByRole("group", { name: t("channel.topic.name") });
const tabButton = (label: string) => tabs().getByRole("button", { name: label, exact: true });
const closeButton = (label: string) =>
  tabs().getByRole("button", { name: `${t("channel.topic.delete")}: ${label}`, exact: true });
const dialog = () => page.getByRole("alertdialog").or(page.getByRole("dialog")).last();
const confirmButton = () => dialog().getByRole("button", { name: t("channel.topic.delete"), exact: true });
const radio = (key: "channel.topic.outcome.done" | "channel.topic.outcome.notDone" | "channel.topic.outcome.other") =>
  dialog().getByRole("radio", { name: t(key), exact: true });
/** The outcome a person picks, by its visible label. The radio input itself is hidden under it. */
const pick = (key: Parameters<typeof radio>[0]) => dialog().getByText(t(key), { exact: true }).click();

async function topicNames(channelId: string): Promise<Map<string, string>> {
  const summary = await client.summary(channelId);
  return new Map((summary.topics ?? []).map((topic) => [topic.id, topic.name]));
}

/** A tab with a name of its own. A rename always wins over the name that the first message gives. */
async function newTab(
  channelId: string,
  text: string | null,
  agentId: string,
  label: string,
): Promise<{ id: string; name: string }> {
  const topicId = crypto.randomUUID();
  const tabName = `${label} ${stamp}`;
  await client.command({ type: "topic-create", operationId: crypto.randomUUID(), channelId, topicId, name: tabName });
  if (text !== null) {
    await client.command({
      type: "send",
      operationId: crypto.randomUUID(),
      channelId,
      topicId,
      text,
      recipientAgentId: agentId,
      replyToMessageId: null,
      attachmentDraftIds: [],
    });
    await client.command({ type: "topic-rename", operationId: crypto.randomUUID(), channelId, topicId, name: tabName });
  }
  await waitFor(
    page,
    `the name of ${label}`,
    () => topicNames(channelId),
    (names) => names.get(topicId) === tabName,
    UI_WAIT_MS,
  );
  await tabButton(tabName).waitFor({ timeout: UI_WAIT_MS });
  return { id: topicId, name: tabName };
}

async function openProfile(): Promise<void> {
  await page.keyboard.press("Meta+Comma");
  // Settings is a page with a list of sections; Profile is one of them.
  await page.getByText(t("settings.tab.profile.title"), { exact: true }).first().click();
  await page.getByText(t("settings.profile.tabReports.title"), { exact: true }).waitFor({ timeout: UI_WAIT_MS });
  await page.getByText(t("settings.profile.tabReports.loading")).waitFor({ state: "hidden", timeout: UI_WAIT_MS });
}

/** Is the page of Settings on screen? Its heading is the one of `app.settingsPage.title`. */
const settingsOpen = () => page.getByRole("heading", { name: t("app.settingsPage.title"), exact: true }).isVisible();

/** Back to the workspace: Escape first, then the Agents button of the rail. */
async function closeSettings(): Promise<void> {
  if (await settingsOpen()) await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if (await settingsOpen())
    await page
      .getByRole("navigation", { name: t("app.rail.label") })
      .getByRole("button", { name: t("app.rail.agents") })
      .first()
      .click();
  await page.getByRole("navigation", { name: t("sidebar.nav.label") }).waitFor({ timeout: UI_WAIT_MS });
  report.facts.settingsClosed = !(await settingsOpen());
}

/** The section is far down the page; the screenshots show it. */
const showSection = () =>
  page.getByRole("heading", { name: t("settings.profile.tabReports.title"), exact: true }).scrollIntoViewIfNeeded();

const periodTab = (key: "settings.profile.tabReports.period.week" | "settings.profile.tabReports.period.month") =>
  page.getByRole("tablist", { name: t("settings.profile.tabReports.period.label") }).getByRole("tab", { name: t(key) });
/** The names of the records on screen, in order. */
const listed = () =>
  page.locator(".profile-tab-report-name").evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ""));

try {
  const agents = await client.agents();
  const agentId = argument("agent") ?? agents[0]?.id;
  assert.ok(agentId, "The app has no visible agent.");
  report.facts.purgedAtStart = await purgeTestRecords();
  const channel = await client.create(name, [agentId], agentId);
  report.facts.channelId = channel.id;

  // A run that stopped in Settings leaves that page open.
  await closeSettings();
  // Open the channel in the UI.
  await page
    .getByRole("navigation", { name: t("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(name)}[,.]`) })
    .click();
  await tabs().waitFor({ timeout: UI_WAIT_MS });
  const readsAtStart = await reads();

  step("A1");
  // A1: Done.
  const doneTab = await newTab(channel.id, `Close report A1 ${stamp}. Reply with ready.`, agentId, "Tab A1");
  await closeButton(doneTab.name).click();
  await radio("channel.topic.outcome.done").waitFor({ timeout: UI_WAIT_MS });
  const a1 = {
    radios: await dialog().getByRole("radio").count(),
    noneChecked: (await dialog().getByRole("radio", { checked: true }).count()) === 0,
    confirmOffAtOpen: await confirmButton().isDisabled(),
    recordLine: await dialog().getByText(t("channel.topic.closeRecord")).isVisible(),
  };
  await shot("a1-dialog-open");
  await pick("channel.topic.outcome.done");
  const a1On = await confirmButton().isEnabled();
  await dialog().getByRole("textbox").fill(`Shipped ${stamp}`);
  await shot("a1-dialog-done");
  await confirmButton().click();
  await tabButton(doneTab.name).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  report.facts.a1 = { ...a1, confirmOnAfterDone: a1On, tabGone: true };

  step("A2");
  // A2: Other.
  const otherTab = await newTab(channel.id, `Close report A2 ${stamp}. Reply with ready.`, agentId, "Tab A2");
  await closeButton(otherTab.name).click();
  await pick("channel.topic.outcome.other");
  const offEmpty = await confirmButton().isDisabled();
  await dialog().getByRole("textbox").fill("   ");
  const offBlank = await confirmButton().isDisabled();
  // Longer than four lines at any width of the Profile, so A21 can see the cut.
  const otherNote =
    `Blocked by review ${stamp}. ${"The owner waits for the legal check of the new terms before the launch. ".repeat(6)}`.trim();
  await dialog().getByRole("textbox").fill(otherNote);
  const onText = await confirmButton().isEnabled();
  await shot("a2-dialog-other");
  await confirmButton().click();
  await tabButton(otherTab.name).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  report.facts.a2 = { offEmpty, offBlank, onText };

  step("A3");
  // A3: Cancel and Escape.
  const keptTab = await newTab(channel.id, `Close report A3 ${stamp}. Reply with ready.`, agentId, "Tab A3");
  const beforeCancel = (await records()).reports.length;
  await closeButton(keptTab.name).click();
  await pick("channel.topic.outcome.notDone");
  await dialog()
    .getByRole("button", { name: t("common.cancel"), exact: true })
    .click();
  await radio("channel.topic.outcome.done").waitFor({ state: "hidden", timeout: UI_WAIT_MS });
  await closeButton(keptTab.name).click();
  await radio("channel.topic.outcome.done").waitFor({ timeout: UI_WAIT_MS });
  const reopenedClean = (await dialog().getByRole("radio", { checked: true }).count()) === 0;
  await page.keyboard.press("Escape");
  await radio("channel.topic.outcome.done").waitFor({ state: "hidden", timeout: UI_WAIT_MS });
  const keptVisible = await tabButton(keptTab.name).isVisible();
  const a3Facts = { keptVisible, reopenedClean, newRecords: (await records()).reports.length - beforeCancel };

  step("A4");
  // A4: an empty tab closes with no dialog.
  const emptyTab = await newTab(channel.id, null, agentId, "Tab A4 empty");
  await closeButton(emptyTab.name).click();
  await tabButton(emptyTab.name).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const dialogShown = await radio("channel.topic.outcome.done").isVisible();
  const a4Facts = { dialogShown, newRecords: (await records()).reports.length - beforeCancel };

  // No read of the Profile while it is closed, through all the closes above.
  report.facts.readsWhileProfileClosed = (await reads()) - readsAtStart;

  step("A5 bulk");
  // A5 needs more than 20 records: 20 more closes through the command, as the dialog sends it.
  for (let index = 0; index < 20; index += 1) {
    const topicId = crypto.randomUUID();
    await client.command({ type: "topic-create", operationId: crypto.randomUUID(), channelId: channel.id, topicId });
    await client.command({
      type: "topic-delete",
      operationId: crypto.randomUUID(),
      channelId: channel.id,
      topicId,
      report: { outcome: index % 2 === 0 ? "not-done" : "done" },
    });
  }
  const mine = await records();
  for (const item of mine.reports) createdReports.add(item.id);
  const expected = {
    done: mine.reports.filter((item) => item.outcome === "done").length,
    notDone: mine.reports.filter((item) => item.outcome === "not-done").length,
    other: mine.reports.filter((item) => item.outcome === "other").length,
  };
  report.facts.a4 = a4Facts;
  report.facts.a3 = a3Facts;
  report.facts.expected = expected;
  report.facts.readsAfterBulkWithProfileClosed = (await reads()) - readsAtStart;

  step("Profile");
  const readsBeforeOpen = await reads();
  await openProfile();
  const readsOnOpen = (await reads()) - readsBeforeOpen;
  await showSection();
  await shot("a5-profile-30-days");
  const tile = (
    key:
      | "settings.profile.tabReports.total.done"
      | "settings.profile.tabReports.total.notDone"
      | "settings.profile.tabReports.total.other",
  ) =>
    page
      .locator(".profile-tiles")
      .filter({ hasText: t("settings.profile.tabReports.total.notDone") })
      .locator(".profile-tile")
      .filter({ has: page.locator("dt", { hasText: new RegExp(`^${literal(t(key))}$`) }) })
      .locator("strong");
  const uiTotals = async () => ({
    done: Number(await tile("settings.profile.tabReports.total.done").textContent()),
    notDone: Number(await tile("settings.profile.tabReports.total.notDone").textContent()),
    other: Number(await tile("settings.profile.tabReports.total.other").textContent()),
  });
  const loaded = () =>
    page.getByText(t("settings.profile.tabReports.loading")).waitFor({ state: "hidden", timeout: UI_WAIT_MS });
  const monthTotals = await uiTotals();
  const beforeWeek = await reads();
  await periodTab("settings.profile.tabReports.period.week").click();
  await loaded();
  const weekReads = (await reads()) - beforeWeek;
  const weekTotals = await uiTotals();
  await showSection();
  await shot("a5-profile-7-days");
  const beforeMonth = await reads();
  await periodTab("settings.profile.tabReports.period.month").click();
  await loaded();
  const monthReads = (await reads()) - beforeMonth;
  const firstPage = await listed();
  const beforeMore = await reads();
  await page.getByRole("button", { name: t("settings.profile.tabReports.more"), exact: true }).click();
  await waitFor(page, "the next page", listed, (items) => items.length > firstPage.length, UI_WAIT_MS);
  const allItems = await listed();
  const moreReads = (await reads()) - beforeMore;
  await showSection();
  await shot("a5-profile-more");
  // The same two pages through the bridge: no record is on both.
  const pages = await page.evaluate(async (server) => {
    const range = {
      since: new Date(Date.now() - 6 * 86_400_000).toISOString(),
      until: new Date(Date.now() + 86_400_000).toISOString(),
      limit: 20,
    };
    const first = await window.buildersbot.agent.listChannelTabReports(range, server);
    const second = first?.nextCursor
      ? await window.buildersbot.agent.listChannelTabReports({ ...range, cursor: first.nextCursor }, server)
      : null;
    return { first: first?.reports.map((item) => item.id) ?? [], second: second?.reports.map((item) => item.id) ?? [] };
  }, LOCAL_SERVER_ID);
  const doneItem = page.locator(".profile-tab-report").filter({ hasText: `${doneTab.name} · ${name}` });
  const otherItem = page.locator(".profile-tab-report").filter({ hasText: `${otherTab.name} · ${name}` });
  // A21: the records start closed, and the name opens and closes the note and the last result.
  step("A21");
  const lastResultPrefix = t("settings.profile.tabReports.lastResult", { result: "" }).trim();
  const otherToggle = otherItem.getByRole("button", { name: `${otherTab.name} · ${name}`, exact: true });
  const noteText = otherItem.getByText(otherNote);
  const expandedState = async () => (await otherToggle.getAttribute("aria-expanded")) === "true";
  const a21Closed = {
    openAtStart: await page.locator('.profile-tab-report [aria-expanded="true"]').count(),
    lastResultShown: await page.locator(".profile-tab-report").getByText(lastResultPrefix).count(),
    notesShown: await page.locator(".profile-tab-report").getByText(`Shipped ${stamp}`).count(),
    otherClosed: !(await expandedState()),
    otherNoteShown: await noteText.count(),
  };
  await otherToggle.click();
  await noteText.waitFor({ timeout: UI_WAIT_MS });
  const openOnClick = await expandedState();
  const clamp = await noteText.evaluate((node) => {
    const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
    return { lines: Math.round(node.clientHeight / lineHeight), cut: node.scrollHeight > node.clientHeight + 1 };
  });
  await otherItem.scrollIntoViewIfNeeded();
  await shot("a21-expanded");
  await otherToggle.click();
  await noteText.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const closedOnSecondClick = !(await expandedState());
  await otherToggle.focus();
  await page.keyboard.press("Enter");
  await noteText.waitFor({ timeout: UI_WAIT_MS });
  const openOnEnter = await expandedState();
  const focusVisible = await otherToggle.evaluate((node) => node.matches(":focus-visible"));
  await shot("a21-keyboard-focus");
  await page.keyboard.press("Space");
  await noteText.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const closedOnSpace = !(await expandedState());
  await page.keyboard.press("Space");
  await noteText.waitFor({ timeout: UI_WAIT_MS });
  const a21Facts = { ...a21Closed, openOnClick, clamp, closedOnSecondClick, openOnEnter, focusVisible, closedOnSpace };
  report.facts.a21 = a21Facts;
  const profileItemsFacts = {
    done:
      (await doneItem.count()) === 1 &&
      (await doneItem.getByText(t("settings.profile.tabReports.total.done")).count()) > 0,
    otherNote: (await otherItem.count()) === 1 && (await otherItem.getByText(otherNote).count()) === 1,
    cancelledAbsent:
      (await page
        .locator(".profile-tab-report")
        .filter({ hasText: `${keptTab.name} · ${name}` })
        .count()) === 0,
    emptyAbsent:
      (await page
        .locator(".profile-tab-report")
        .filter({ hasText: `${emptyTab.name} · ${name}` })
        .count()) === 0,
  };
  report.facts.profileItems = profileItemsFacts;
  const a5Facts = {
    readsOnOpen,
    weekReads,
    monthReads,
    moreReads,
    monthTotals,
    weekTotals,
    firstPage: firstPage.length,
    afterMore: allItems.length,
    pageIdsOverlap: pages.first.filter((id) => pages.second.includes(id)).length,
  };
  report.facts.a5 = a5Facts;

  // A19 through the UI: delete the "Other" record; only it goes and the totals follow.
  step("A19");
  await otherItem
    .getByRole("button", { name: t("settings.profile.tabReports.delete.label", { name: otherTab.name }), exact: true })
    .click();
  await shot("a19-delete-confirm");
  await dialog()
    .getByRole("button", { name: t("settings.profile.tabReports.delete.confirm"), exact: true })
    .click();
  await otherItem.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const afterDeleteTotals = await waitFor(
    page,
    "the totals after the delete",
    uiTotals,
    (value) => value.other === 0,
    UI_WAIT_MS,
  );
  // The list reads the first page again after a delete, so the loaded pages collapse to 20 items.
  const itemsAfterDelete = (await listed()).length;
  const hostAfterDelete = (await records()).reports;
  const a19Facts = {
    totals: afterDeleteTotals,
    itemsAfterDelete,
    hostRecords: hostAfterDelete.length,
    otherGoneInHost: !hostAfterDelete.some((item) => item.topicId === otherTab.id),
    doneKeptInHost: hostAfterDelete.some((item) => item.topicId === doneTab.id && item.outcome === "done"),
  };
  report.facts.a19 = a19Facts;
  if ((await doneItem.count()) === 0)
    await page.getByRole("button", { name: t("settings.profile.tabReports.more"), exact: true }).click();
  await doneItem.waitFor({ timeout: UI_WAIT_MS });

  // A20: continue the Done tab in a new tab.
  step("A20");
  const topicsBefore = await topicNames(channel.id);
  await page
    .getByRole("button", { name: t("settings.profile.tabReports.continue.label", { name: doneTab.name }), exact: true })
    .click();
  const summaryAfter = await waitFor(
    page,
    "a new tab",
    () => client.summary(channel.id),
    (current) => (current.topics?.length ?? 0) > topicsBefore.size,
    UI_WAIT_MS,
  );
  const newTopic = summaryAfter.topics?.find((topic) => !topicsBefore.has(topic.id));
  assert.ok(newTopic, "a new tab");
  await tabButton(newTopic.name).waitFor({ timeout: UI_WAIT_MS });
  await page.waitForTimeout(500);
  const settingsStillOpen = await page.getByText(t("settings.profile.tabReports.title"), { exact: true }).isVisible();
  if (settingsStillOpen) await closeSettings();
  const draft = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>('[contenteditable="true"], textarea')];
    return boxes.map((box) => (box instanceof HTMLTextAreaElement ? box.value : (box.innerText ?? ""))).join("\n---\n");
  });
  const openTabName = await tabs().locator('[aria-current="true"]').first().textContent();
  const newTabPage = await page.evaluate(
    (input) => window.buildersbot.agent.readChannel({ channelId: input.channelId, topicId: input.topicId }),
    { channelId: channel.id, topicId: newTopic.id },
  );
  await shot("a20-new-tab-draft");
  const a20Facts = {
    newTab: newTopic.name,
    openTab: openTabName?.trim() ?? null,
    settingsStillOpen,
    draftHasIntro: draft.includes(doneTab.name) && draft.includes(t("settings.profile.tabReports.total.done")),
    draftHasNote: draft.includes(`Shipped ${stamp}`),
    newTabMessages: newTabPage.messages.length,
    newTabTasks: newTabPage.tasks.length,
    draft: draft.slice(0, 400),
  };
  report.facts.a20 = a20Facts;

  // A6: delete the channel; the record stays with the saved names and Continue is off with the reason.
  step("A6");
  // The bulk records go through the bridge so the record of the first tab is on the first page.
  for (const item of (await records()).reports)
    if (item.topicId !== doneTab.id)
      await page.evaluate((input) => window.buildersbot.agent.deleteChannelTabReport({ id: input.id }, input.server), {
        id: item.id,
        server: LOCAL_SERVER_ID,
      });
  await client.command({ type: "archive", operationId: crypto.randomUUID(), channelId: channel.id });
  await page.evaluate((id) => window.buildersbot.agent.deleteChannel(id), channel.id);
  client.created.splice(0);
  await waitFor(
    page,
    "the channel leaves the list",
    () => client.list(),
    (list) => !list.some((item) => item.id === channel.id),
    UI_WAIT_MS,
  );
  const afterDelete = await records();
  await openProfile();
  const goneItem = page.locator(".profile-tab-report").filter({ hasText: `${doneTab.name} · ${name}` });
  await goneItem.waitFor({ timeout: UI_WAIT_MS });
  const continueOff = await goneItem
    .getByRole("button", { name: t("settings.profile.tabReports.continue.label", { name: doneTab.name }), exact: true })
    .isDisabled();
  const reason = await goneItem.getByText(t("settings.profile.tabReports.continue.unavailable.gone")).count();
  await goneItem.scrollIntoViewIfNeeded();
  await shot("a6-channel-deleted");
  const a6Facts = {
    recordsKept: afterDelete.reports.length,
    savedChannelName: afterDelete.reports[0]?.channelName ?? null,
    savedTopicName: afterDelete.reports[0]?.topicName ?? null,
    continueOff,
    reasonShown: reason > 0,
  };
  report.facts.a6 = a6Facts;
  await closeSettings();

  // The checks.
  assert.equal(a1.radios, 3);
  assert.ok(a1.noneChecked && a1.confirmOffAtOpen && a1On, "A1 dialog");
  assert.ok(profileItemsFacts.done, "A1 record in the Profile");
  assert.ok(offEmpty && offBlank && onText, "A2 Confirm rule");
  assert.ok(profileItemsFacts.otherNote, "A2 note in the Profile");
  assert.equal(a21Facts.openAtStart, 0, "A21 every record starts closed");
  assert.equal(
    a21Facts.lastResultShown + a21Facts.notesShown + a21Facts.otherNoteShown,
    0,
    "A21 closed hides the text",
  );
  assert.ok(
    a21Facts.otherClosed && a21Facts.openOnClick && a21Facts.closedOnSecondClick,
    "A21 a click opens and closes",
  );
  assert.ok(a21Facts.openOnEnter && a21Facts.closedOnSpace, "A21 Enter and Space open and close");
  assert.ok(a21Facts.focusVisible, "A21 the focus shows after a key");
  assert.deepEqual(a21Facts.clamp, { lines: 4, cut: true }, "A21 a long note shows four lines and is cut");
  assert.ok(keptVisible && a3Facts.newRecords === 0 && a3Facts.reopenedClean, "A3");
  assert.ok(!dialogShown && a4Facts.newRecords === 0, "A4");
  assert.ok(profileItemsFacts.cancelledAbsent && profileItemsFacts.emptyAbsent, "A3 and A4 add no item to the Profile");
  assert.equal(report.facts.readsWhileProfileClosed, 0, "no read while the Profile is closed");
  assert.equal(report.facts.readsAfterBulkWithProfileClosed, 0, "no read while the Profile is closed");
  assert.equal(readsOnOpen, 1, "one read when the Profile opens");
  assert.equal(weekReads, 1, "one read for 7 days");
  assert.equal(monthReads, 1, "one read for 30 days");
  assert.equal(moreReads, 1, "one read for Show more");
  assert.deepEqual(monthTotals, expected, "A5 totals of 30 days");
  assert.deepEqual(weekTotals, expected, "A5 totals of 7 days");
  assert.equal(firstPage.length, 20);
  assert.equal(
    allItems.length,
    expected.done + expected.notDone + expected.other,
    "A5 Show more brings every record, no repeat",
  );
  assert.equal(pages.first.length + pages.second.length, allItems.length);
  assert.equal(new Set([...pages.first, ...pages.second]).size, allItems.length, "A5 no id on two pages");
  assert.deepEqual(a19Facts.totals, { done: expected.done, notDone: expected.notDone, other: 0 }, "A19 totals");
  assert.ok(a19Facts.otherGoneInHost && a19Facts.doneKeptInHost, "A19 only that record goes");
  assert.equal(a19Facts.hostRecords, allItems.length - 1, "A19 one record fewer in the host");
  assert.ok(a20Facts.draftHasIntro && a20Facts.draftHasNote, "A20 draft filled");
  assert.equal(a20Facts.newTabMessages, 0, "A20 nothing sent");
  assert.equal(a20Facts.newTabTasks, 0, "A20 no task started");
  assert.equal(a20Facts.openTab, a20Facts.newTab, "A20 the new tab is the open tab");
  assert.equal(a6Facts.recordsKept, 1, "A6 the record stays");
  assert.equal(a6Facts.savedTopicName, doneTab.name, "A6 the saved tab name");
  assert.ok(continueOff && reason > 0, "A6 Continue off with the reason");
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
  await shot("failure").catch(() => undefined);
} finally {
  // The records of this script go, so the dev profile keeps only its own.
  await purgeTestRecords().catch(() => undefined);
  await client.cleanup();
  await cdp.detach().catch(() => undefined);
  writeFileSync(resolve(OUT, "ui-e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
  await session.close();
  process.stdout.write(
    `${JSON.stringify({ passed: report.passed, error: report.error?.split("\n")[0], facts: report.facts }, null, 2)}\n`,
  );
}
