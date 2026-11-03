// Checks the close record of a channel tab (tab close report). Runs the real agent service, channel
// service and mailbox on a temporary profile, with a fake Codex app-server. A turn whose message names
// a held mark runs until the mark is released; a turn whose message names a reply mark answers with
// that text; any other turn answers "Done." at once. Cases (criteria of specs/tab-close-report.md):
// A9. The record keeps the channel name, tab name and open date of the tab, the agents that wrote in
//     it (12 at most), and the last visible agent text, cut to 280 characters.
// A10. A test token in the note and in the last agent text is stored as `[redacted]`.
// A8. A tab with a running turn: the close stops the turn, the tab goes, and the record has
//     `tasks.open >= 1`.
// A11. Two parallel closes of one tab give one record and one `channelTopicNotFound` error.
// A12. `other` with no note, or a note of 501 characters, fails the parse, and nothing changes.
// A7. With no `channel_tab_reports` table, a close with a report fails: the tab, its messages and its
//     tasks stay, and no row is added. With the table back, the same close works.
// A13. 25 records: the first page has 20 items, the totals and a cursor; the second page has 5 items,
//     no totals and no cursor; no item repeats. A future period gives 0.
// A19. Deleting one record removes only it and the totals go down by one. A second delete is false.
// A14. The IPC route of `listChannelTabReports` and `deleteChannelTabReport` gives null for a remote
//     server and the page for the local one.
// It also times `topic-delete` with and without a report (the cost of the record).
// `bun scripts/channel-tab-close-report-service-e2e.ts`.
// Writes .buildersbot-build/tab-close-report/service-e2e.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  AGENT_PROVIDERS,
  type ChannelCommand,
  type ChannelTabCloseReport,
  type ChannelTabReport,
  LOCAL_SERVER_ID,
  parseChannelCommand,
  parseChannelTabReportsInput,
  parseDeleteChannelTabReportInput,
} from "@buildersbot/contracts/ipc";
import { sourceText } from "@buildersbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { CHANNEL_TAB_REPORT_SCHEMA_SQL } from "../src/backend/channel-tab-report-schema";
import type { HostMemory } from "../src/backend/host-memory";
import { getString, isRecord } from "../src/backend/protocol";
import { agentRequest } from "../src/main/ipc/agent-inputs";
import { routeToServer } from "../src/main/ipc/route-to-server";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/tab-close-report");
const root = await mkdtemp(join(tmpdir(), "buildersbot-tab-close-report-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const fakeCodex = join(root, "codex");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.BUILDERSBOT_CODEX_PATH = fakeCodex;
process.env.BUILDERSBOT_FAKE_CODEX_LOG = logPath;
process.env.BUILDERSBOT_FAKE_CODEX_CONTROL = controlPath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { BuildersBotDatabase } = await import("../src/backend/buildersbot-database");

/**
 * A Codex app-server with the methods that the service calls. `control.json` holds `hold`, the marks
 * whose turns keep running, and `reply`, the final text of a turn whose newest text names the mark.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.BUILDERSBOT_FAKE_CODEX_LOG, JSON.stringify(entry) + "\\n");
const control = () => {
  try {
    return JSON.parse(fs.readFileSync(process.env.BUILDERSBOT_FAKE_CODEX_CONTROL, "utf8"));
  } catch {
    return { hold: [], reply: {} };
  }
};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
const running = new Map();
const claimed = new Set();
const sideThreads = new Set();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
process.on("SIGTERM", () => process.exit(0));
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
// The reply of the mark that comes last in the texts: a later turn also sees the earlier requests.
const replyOf = (turn) => {
  if (turn.ephemeral) return "Done.";
  const all = turn.texts.join("\\n");
  let best = null;
  for (const [mark, text] of Object.entries(control().reply || {})) {
    const at = all.lastIndexOf(mark);
    if (at >= 0 && (best === null || at > best.at)) best = { at, text };
  }
  return best ? best.text : "Done.";
};
const finish = (turnId, status) => {
  const turn = running.get(turnId);
  if (turn === undefined) return;
  running.delete(turnId);
  log({ turnEnded: turnId, threadId: turn.threadId, status });
  if (status === "completed") {
    const item = { type: "agentMessage", id: "message-" + turnId, text: replyOf(turn), phase: "final_answer" };
    write({ method: "item/completed", params: { threadId: turn.threadId, turnId, item } });
  }
  write({ method: "turn/completed", params: { threadId: turn.threadId, turn: { id: turnId, status } } });
};
setInterval(() => {
  if (running.size === 0) return;
  const current = control();
  for (const [turnId, turn] of [...running]) {
    if ((current.hold || []).some((mark) => turn.marks.includes(mark))) continue;
    finish(turnId, "completed");
  }
}, 25);
const texts = (input) =>
  (Array.isArray(input) ? input : []).flatMap((item) => (item && typeof item.text === "string" ? [item.text] : []));
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": {
      const threadId = "thread-" + process.pid + "-" + (++threads);
      // A side thread, such as the one that names a tab, ends at once and never takes a mark.
      if (params.ephemeral) sideThreads.add(threadId);
      return write({ id: message.id, result: { thread: { id: threadId, turns: [] } } });
    }
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      if (sideThreads.has(params.threadId)) {
        running.set(turnId, { threadId: params.threadId, texts: [], marks: [], ephemeral: true });
        return finish(turnId, "completed");
      }
      const turnTexts = texts(params.input);
      const marks = (control().hold || []).filter((mark) => !claimed.has(mark) && turnTexts.some((text) => text.includes(mark)));
      for (const mark of marks) claimed.add(mark);
      running.set(turnId, { threadId: params.threadId, texts: turnTexts, marks });
      log({ turnStarted: turnId, threadId: params.threadId, texts: turnTexts });
      return;
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      return finish(params.turnId, "interrupted");
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      log({ method: message.method ?? null, id: message.id ?? null });
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface ProtocolEntry {
  index: number;
  turnStarted: string | null;
  turnEnded: string | null;
  status: string | null;
  texts: string[];
}

type Fact = string | number | boolean | null | Fact[] | { [key: string]: Fact };
interface CaseReport {
  name: string;
  facts: { [key: string]: Fact };
  passed: boolean;
  error?: string;
}
const report: {
  cases: CaseReport[];
  timing: { [key: string]: Fact };
  passed: boolean;
  error?: string;
} = { cases: [], timing: {}, passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};
const memoryPressure: HostMemory = {
  level: () => "ok",
  freeMb: () => null,
  totalMb: () => null,
  turnLimit: () => 64,
  reserveTurn: () => () => {},
  subscribe: () => () => {},
  hostedPlan: false,
  kind: "desktop",
};

function protocol(): ProtocolEntry[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line, index) => {
        const entry = JSON.parse(line);
        const value = isRecord(entry) ? entry : {};
        return {
          index,
          turnStarted: getString(value, "turnStarted"),
          turnEnded: getString(value, "turnEnded"),
          status: getString(value, "status"),
          texts: Array.isArray(value.texts)
            ? value.texts.filter((text): text is string => typeof text === "string")
            : [],
        };
      });
  } catch {
    return [];
  }
}
const started = (mark: string) =>
  protocol().find((line) => line.turnStarted && line.texts.some((text) => text.includes(mark)));
function ended(mark: string): ProtocolEntry | undefined {
  const turnId = started(mark)?.turnStarted;
  return turnId ? protocol().find((line) => line.turnEnded === turnId) : undefined;
}

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const control: { hold: string[]; reply: Record<string, string> } = { hold: [], reply: {} };
const writeControl = () => writeFile(controlPath, JSON.stringify(control));
await writeControl();
await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });

const database = new BuildersBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  memoryPressure,
});
const channels = agents.channels;
const reports = channels.store.tabReports;
const actor = { id: "local", name: "Alex" };
/** The start of the run: every record of this run closes after it. */
const runStart = new Date(Date.now() - 1_000).toISOString();
const farEnd = () => new Date(Date.now() + 60_000).toISOString();
const allReports = () => reports.list({ since: runStart, until: farEnd(), limit: 50 });
const allTotals = () => {
  const totals = reports.list({ since: runStart, until: farEnd(), limit: 1 }).totals;
  assert.ok(totals, "the first page has totals");
  return totals;
};
const rowCount = () => {
  const totals = allTotals();
  return totals.done + totals["not-done"] + totals.other;
};

async function createAgent(name: string): Promise<string> {
  const first = `${name}-hello-${randomUUID()}`;
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: "Checks the tab close report.",
      avatarSeed: name,
      avatarHue: null,
      initialMessage: first,
    }),
  );
  await waitFor(`${name}: the first turn ends`, () => ended(first));
  return agent.id;
}

const command = (value: ChannelCommand) => runCauseEffect(channels.command(value, actor));

async function createChannel(name: string, memberIds: string[]): Promise<string> {
  const channelId = randomUUID();
  await command({
    type: "save",
    operationId: randomUUID(),
    channelId,
    draft: {
      name,
      title: "",
      instructions: "Answer each request.",
      members: memberIds.map((agentId) => ({ agentId })),
      leadAgentId: memberIds[0] ?? null,
    },
  });
  return channelId;
}

async function createTab(channelId: string, name?: string): Promise<string> {
  const topicId = randomUUID();
  await command({ type: "topic-create", operationId: randomUUID(), channelId, topicId, ...(name ? { name } : {}) });
  return topicId;
}

async function send(channelId: string, topicId: string, text: string, agentId: string): Promise<void> {
  await command({
    type: "send",
    operationId: randomUUID(),
    channelId,
    topicId,
    text,
    recipientAgentId: agentId,
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
}

const closeTab = (channelId: string, topicId: string, closeReport?: ChannelTabCloseReport) =>
  command({
    type: "topic-delete",
    operationId: randomUUID(),
    channelId,
    topicId,
    ...(closeReport ? { report: closeReport } : {}),
  });

const tabExists = (channelId: string, topicId: string) =>
  channels.store.topics(channelId).some((topic) => topic.id === topicId);
const tabOf = (channelId: string, topicId: string) => {
  const topic = channels.store.topics(channelId).find((item) => item.id === topicId);
  assert.ok(topic, "the tab exists");
  return topic;
};
const recordOf = (topicId: string): ChannelTabReport | undefined =>
  allReports().reports.find((item) => item.topicId === topicId);
const tasksOf = (channelId: string, topicId: string) => channels.page(channelId, topicId).tasks;
const messagesOf = (channelId: string, topicId: string) => channels.page(channelId, topicId).messages;
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

async function runCase(name: string, check: (facts: CaseReport["facts"]) => Promise<void>) {
  const result: CaseReport = { name, facts: {}, passed: false };
  report.cases.push(result);
  try {
    await check(result.facts);
    result.passed = true;
  } catch (error) {
    result.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    control.hold = [];
    await writeControl();
  }
}

/** A test token in the format of a provider key. It is fake, and the redaction rules match it. */
const TOKEN = `sk-ant-api03-${"Q".repeat(24)}`;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] ?? 0) : 0;
};

try {
  await runCauseEffect(agents.initialize());
  const ada = await createAgent("ada");
  const bob = await createAgent("bob");
  const channelId = await createChannel("close-report", [ada, bob]);

  await runCase(
    "A9/A10: the record keeps a snapshot of the tab, with the note and the last result redacted",
    async (facts) => {
      const tab = await createTab(channelId, "Release notes");
      const longReply = `Final summary for the release. ${"The checks passed and the notes are ready. ".repeat(12)}`;
      control.reply["snap-a"] = "Ada did the first part.";
      control.reply["snap-b"] = `Bob key ${TOKEN} then ${longReply}`;
      await writeControl();
      await send(channelId, tab, "snap-a: do the first part", ada);
      await waitFor("ada's turn ends", () => ended("snap-a"));
      await waitFor("ada's task completes", () =>
        tasksOf(channelId, tab).some((task) => task.instruction.includes("snap-a") && task.state === "completed"),
      );
      await send(channelId, tab, "snap-b: do the second part", bob);
      await waitFor("bob's turn ends", () => ended("snap-b"));
      await waitFor("bob's task completes", () =>
        tasksOf(channelId, tab).some((task) => task.instruction.includes("snap-b") && task.state === "completed"),
      );
      const visibleAgentTexts = messagesOf(channelId, tab)
        .filter((message) => message.author.kind === "agent")
        .map((message) => message.message.text);
      facts.agentMessages = visibleAgentTexts.length;
      const topic = tabOf(channelId, tab);
      await closeTab(channelId, tab, { outcome: "done", note: `Shipped. Key ${TOKEN} was in the log.` });
      const record = recordOf(tab);
      assert.ok(record, "one record for the tab");
      facts.record = {
        channelName: record.channelName,
        topicName: record.topicName,
        openedAt: record.openedAt,
        agents: record.agents.map((agent) => agent.name),
        tasks: record.tasks,
        note: record.note,
        lastResultLength: record.lastResult?.length ?? null,
        lastResult: record.lastResult,
      };
      assert.equal(record.channelName, "close-report");
      assert.equal(record.topicName, topic.name, "the tab name at the close");
      assert.equal(record.openedAt, topic.createdAt);
      assert.equal(record.outcome, "done");
      assert.deepEqual(new Set(record.agents.map((agent) => agent.id)), new Set([ada, bob]), "both agents");
      assert.ok(record.agents.length <= 12);
      assert.ok(record.tasks.completed >= 2, "two completed tasks");
      assert.equal(record.tasks.open, 0);
      assert.ok(record.lastResult, "a last result");
      assert.ok(record.lastResult.length <= 280, "the last result has at most 280 characters");
      assert.ok(record.lastResult.startsWith("Bob key"), "the last result is bob's text, the last agent text");
      assert.ok(!record.lastResult.includes(TOKEN) && record.lastResult.includes("[redacted]"), "last result redacted");
      assert.ok(record.note && !record.note.includes(TOKEN) && record.note.includes("[redacted]"), "note redacted");
      assert.equal(tabExists(channelId, tab), false, "the tab is gone");
      // The note is not in the event log.
      const events = database.connection
        .prepare("SELECT COUNT(*) AS count FROM orchestration_events WHERE payload_json LIKE ? OR payload_json LIKE ?")
        .get("%Shipped. Key%", "%sk-ant-api03%");
      facts.noteInEvents = isRecord(events) ? Number(events.count) : -1;
      assert.equal(facts.noteInEvents, 0, "no event payload carries the note");
    },
  );

  await runCase("A8: a close stops a running turn and counts it as open", async (facts) => {
    const tab = await createTab(channelId, "Long work");
    control.hold.push("busy-8");
    await writeControl();
    await send(channelId, tab, "busy-8: long work", ada);
    await waitFor("the turn starts", () => started("busy-8"));
    await waitFor("the task runs", () =>
      tasksOf(channelId, tab).some((task) => task.instruction.includes("busy-8") && task.state === "running"),
    );
    await closeTab(channelId, tab, { outcome: "not-done" });
    const stopped = await waitFor("the turn stops", () => ended("busy-8"));
    const record = recordOf(tab);
    facts.turnStatus = stopped.status;
    facts.tasks = record ? record.tasks : null;
    facts.tabGone = !tabExists(channelId, tab);
    assert.equal(stopped.status, "interrupted");
    assert.ok(record && record.tasks.open >= 1, "the record counts the stopped task");
    assert.equal(record?.outcome, "not-done");
    assert.equal(facts.tabGone, true);
    control.hold = [];
    await writeControl();
  });

  await runCase("A11: two parallel closes of one tab give one record and one error", async (facts) => {
    const tab = await createTab(channelId, "Race");
    await send(channelId, tab, "race-11: a request", ada);
    await waitFor("the turn ends", () => ended("race-11"));
    const before = rowCount();
    const results = await Promise.allSettled([
      closeTab(channelId, tab, { outcome: "done", note: "first" }),
      closeTab(channelId, tab, { outcome: "other", note: "second" }),
    ]);
    const errors = results.flatMap((result) =>
      result.status === "rejected"
        ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
        : [],
    );
    facts.fulfilled = results.filter((result) => result.status === "fulfilled").length;
    facts.errors = errors;
    facts.newRecords = rowCount() - before;
    assert.equal(facts.fulfilled, 1);
    assert.deepEqual(errors, [sourceText("error.backend.channelTopicNotFound")]);
    assert.equal(facts.newRecords, 1);
  });

  await runCase("A12: a bad report fails the parse and nothing changes", async (facts) => {
    const tab = await createTab(channelId, "Bad report");
    const before = rowCount();
    const parse = (closeReport: unknown) =>
      (() => {
        try {
          parseChannelCommand({
            type: "topic-delete",
            operationId: randomUUID(),
            channelId,
            topicId: tab,
            report: closeReport,
          });
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      })();
    facts.otherNoNote = parse({ outcome: "other" });
    facts.otherBlankNote = parse({ outcome: "other", note: "   \n " });
    facts.longNote = parse({ outcome: "done", note: "x".repeat(501) });
    facts.badOutcome = parse({ outcome: "finished" });
    facts.note500 = parse({ outcome: "done", note: "x".repeat(500) });
    assert.ok(facts.otherNoNote && facts.otherBlankNote && facts.longNote && facts.badOutcome, "the parse fails");
    assert.equal(facts.note500, null, "500 characters pass");
    facts.tabStays = tabExists(channelId, tab);
    facts.newRecords = rowCount() - before;
    assert.equal(facts.tabStays, true);
    assert.equal(facts.newRecords, 0);
    await closeTab(channelId, tab);
    facts.closeWithoutReportAddsNone = rowCount() - before;
    assert.equal(facts.closeWithoutReportAddsNone, 0, "a close with no report writes no record");
  });

  await runCase("A7: with no table, a close with a report fails and the tab stays", async (facts) => {
    const tab = await createTab(channelId, "Atomic");
    await send(channelId, tab, "atomic-7: a request", ada);
    await waitFor("the turn ends", () => ended("atomic-7"));
    await waitFor("the task completes", () => tasksOf(channelId, tab).some((task) => task.state === "completed"));
    const messagesBefore = messagesOf(channelId, tab).length;
    const tasksBefore = tasksOf(channelId, tab).map((task) => `${task.id}:${task.state}`);
    database.connection.exec("DROP TABLE channel_tab_reports");
    const error = await failure(closeTab(channelId, tab, { outcome: "done", note: "atomic" }));
    facts.error = error;
    facts.tabStays = tabExists(channelId, tab);
    facts.messages = { before: messagesBefore, after: messagesOf(channelId, tab).length };
    const tasksAfter = tasksOf(channelId, tab).map((task) => `${task.id}:${task.state}`);
    facts.tasksSame = JSON.stringify(tasksAfter) === JSON.stringify(tasksBefore);
    const tableRow = database.connection
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'channel_tab_reports'")
      .get();
    facts.tableBack = isRecord(tableRow) ? Number(tableRow.count) : -1;
    database.connection.exec(CHANNEL_TAB_REPORT_SCHEMA_SQL);
    assert.ok(error, "the close fails");
    assert.equal(facts.tableBack, 0, "the failed close made no table");
    assert.equal(facts.tabStays, true, "the tab stays");
    assert.equal(messagesOf(channelId, tab).length, messagesBefore, "the messages stay");
    assert.equal(facts.tasksSame, true, "the tasks stay");
    // The tab still works and a new close with the table back records it.
    await send(channelId, tab, "atomic-7b: after the failure", ada);
    await waitFor("the next turn ends", () => ended("atomic-7b"));
    await closeTab(channelId, tab, { outcome: "done", note: "atomic" });
    facts.retryRecorded = recordOf(tab) !== undefined;
    facts.retryTabGone = !tabExists(channelId, tab);
    assert.equal(facts.retryRecorded, true);
    assert.equal(facts.retryTabGone, true);
  });

  // Timing and the 25 records of A13. Each pair has a tab with one finished request; the close with a
  // report and the close without one alternate, so both see the same database size.
  const withReport: number[] = [];
  const withoutReport: number[] = [];
  const pageStart = new Date().toISOString();
  await runCase("timing: topic-delete with and without a report (and 25 records for A13)", async (facts) => {
    const timingChannel = await createChannel("close-timing", [ada]);
    const outcomes = ["done", "not-done", "other"] as const;
    for (let index = 0; index < 25; index += 1) {
      const pair = await Promise.all([createTab(timingChannel), createTab(timingChannel)]);
      for (const [slot, tab] of pair.entries()) {
        const mark = `time-${index}-${slot}`;
        await send(timingChannel, tab, `${mark}: a request`, ada);
        await waitFor(`${mark} ends`, () => ended(mark));
        await waitFor(`${mark} completes`, () =>
          tasksOf(timingChannel, tab).some((task) => task.state === "completed"),
        );
      }
      const [reported, plain] = pair;
      if (!reported || !plain) throw new Error("Two tabs were not made.");
      const outcome = outcomes[index % 3] ?? "done";
      let start = performance.now();
      await closeTab(timingChannel, reported, { outcome, note: `note ${index}` });
      withReport.push(performance.now() - start);
      start = performance.now();
      await closeTab(timingChannel, plain);
      withoutReport.push(performance.now() - start);
    }
    const round = (value: number) => Math.round(value * 100) / 100;
    report.timing = {
      samples: withReport.length,
      withReportMedianMs: round(median(withReport)),
      withoutReportMedianMs: round(median(withoutReport)),
      extraMedianMs: round(median(withReport) - median(withoutReport)),
      withReportMs: withReport.map(round),
      withoutReportMs: withoutReport.map(round),
    };
    facts.samples = withReport.length;
  });

  await runCase("A13: 25 records page as 20 + 5, totals on the first page only", async (facts) => {
    const period = { since: pageStart, until: farEnd() };
    const first = reports.list(period);
    assert.ok(first.nextCursor, "a cursor after the first page");
    const second = reports.list({ ...period, cursor: first.nextCursor });
    const ids = [...first.reports, ...second.reports].map((item) => item.id);
    const closed = [...first.reports, ...second.reports].map((item) => `${item.closedAt}|${item.id}`);
    facts.first = { items: first.reports.length, totals: first.totals, cursor: first.nextCursor !== null };
    facts.second = { items: second.reports.length, totals: second.totals, cursor: second.nextCursor };
    facts.unique = new Set(ids).size;
    assert.equal(first.reports.length, 20);
    assert.deepEqual(first.totals, { done: 9, "not-done": 8, other: 8 });
    assert.equal(second.reports.length, 5);
    assert.equal(second.totals, null);
    assert.equal(second.nextCursor, null);
    assert.equal(facts.unique, 25, "no item repeats");
    assert.deepEqual(closed, [...closed].sort().reverse(), "newest first");
    const future = reports.list({
      since: new Date(Date.now() + 86_400_000).toISOString(),
      until: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });
    facts.future = { items: future.reports.length, totals: future.totals };
    assert.equal(future.reports.length, 0);
    assert.deepEqual(future.totals, { done: 0, "not-done": 0, other: 0 });
    // The main process decodes the request: a bad period or limit is refused before the store.
    const refused = (value: unknown) => failure(Promise.resolve().then(() => parseChannelTabReportsInput(value)));
    facts.refused = {
      reversed: await refused({ since: period.until, until: period.since }),
      tooLong: await refused({ since: "2025-01-01T00:00:00.000Z", until: "2026-01-03T00:00:00.000Z" }),
      limit51: await refused({ ...period, limit: 51 }),
      notUtc: await refused({ since: "2026-11-01T00:00:00+02:00", until: period.until }),
    };
    assert.ok(Object.values(facts.refused).every(Boolean), "each bad request is refused");
  });

  await runCase("A19: deleting a record removes only that record", async (facts) => {
    const before = allReports();
    const totalsBefore = allTotals();
    const target = before.reports.find((item) => item.outcome === "done");
    assert.ok(target, "a done record");
    facts.first = reports.delete(target.id);
    facts.second = reports.delete(target.id);
    const after = allReports();
    const totalsAfter = allTotals();
    facts.totals = { before: totalsBefore, after: totalsAfter };
    assert.equal(facts.first, true);
    assert.equal(facts.second, false);
    assert.equal(totalsAfter.done, totalsBefore.done - 1);
    assert.equal(totalsAfter["not-done"], totalsBefore["not-done"]);
    assert.equal(totalsAfter.other, totalsBefore.other);
    assert.deepEqual(
      after.reports.map((item) => item.id),
      before.reports.map((item) => item.id).filter((id) => id !== target.id),
      "only that record went",
    );
    facts.badId = await failure(Promise.resolve().then(() => parseDeleteChannelTabReportInput({ id: "" })));
    assert.ok(facts.badId, "an empty id is refused at the boundary");
  });

  await runCase("A14: the IPC route gives null for a remote server", async (facts) => {
    // The same composition as `scopedHandler` in src/main/ipc/agent-handlers.ts, without Electron.
    const source = readFileSync(resolve(import.meta.dirname, "../src/main/ipc/agent-handlers.ts"), "utf8");
    const route = <Payload, Result>(
      decode: (value: unknown) => Payload,
      local: (payload: Payload) => Result,
      request: unknown,
    ) => {
      const scoped = agentRequest(decode)(request);
      return routeToServer(scoped.serverId, { local: () => local(scoped.payload), remote: () => null });
    };
    const period = { since: runStart, until: farEnd() };
    const list = (input: Parameters<typeof reports.list>[0]) => reports.list(input);
    const remote = await route(parseChannelTabReportsInput, list, { serverId: "team-server", payload: period });
    const local = await route(parseChannelTabReportsInput, list, { serverId: LOCAL_SERVER_ID, payload: period });
    const remoteDelete = await route(parseDeleteChannelTabReportInput, (input) => reports.delete(input.id), {
      serverId: "team-server",
      payload: { id: randomUUID() },
    });
    facts.remote = remote === null;
    facts.remoteDelete = remoteDelete === null;
    facts.localItems = local ? local.reports.length : -1;
    facts.handlersRemoteNull =
      /listChannelTabReports: scopedHandler\(parseChannelTabReportsInput, \{[^}]*remote: \(\) => null/s.test(source) &&
      /deleteChannelTabReport: scopedHandler\(parseDeleteChannelTabReportInput, \{[^}]*remote: \(\) => null/s.test(
        source,
      );
    assert.equal(facts.remote, true);
    assert.equal(facts.remoteDelete, true);
    assert.ok(Number(facts.localItems) > 0);
    assert.equal(facts.handlersRemoteNull, true, "both handlers answer null for a remote server");
  });

  report.passed = report.cases.length === 9 && report.cases.every((entry) => entry.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "service-e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(
    `${JSON.stringify({ passed: report.passed, cases: report.cases.map(({ name, passed, error }) => ({ name, passed, error: error?.split("\n")[0] })), timing: { ...report.timing, withReportMs: undefined, withoutReportMs: undefined } }, null, 2)}\n`,
  );
}
