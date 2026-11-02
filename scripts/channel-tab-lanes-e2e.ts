// Checks that each tab of a channel is its own line of work for each agent (channel tab lanes). Runs
// the real agent service, channel service, mailbox and drain on a temporary profile, with a fake Codex
// app-server. A turn whose message names a held mark runs until the mark is released; a turn whose
// message names an ask mark asks the person a question and runs until the answer comes; any other
// turn ends at once. Cases:
// 1. A long request in one tab and a short one in another tab of the same agent: the short one
//    starts and ends while the long one runs.
// 2. Two requests in the same tab: the second one waits, with the reason "tab", and starts only
//    after the first one ended.
// 3. The limit of parallel tabs (2): a third tab waits with the reason "agent-tabs" and starts when
//    a place frees, before a newer request of the tab that freed it (no starvation).
// 4. A tab whose turn waits for the person, and a tab whose task waits for another agent, do not take
//    a place: a third tab starts.
// 5. A wait cycle through dependencies is refused when the agent makes it.
// 6. Low memory: a new tab of a working agent does not start, with the reason "memory", and starts
//    when the memory is back.
// 7. The agent's own chat and a channel tab are lines of their own: a chat message starts and ends
//    while a tab turn runs, and the queue of the chat shows no hold.
// 8. Deleting a tab stops only the turn of that tab. The other tab of the same agent keeps running.
// 9. A restart: the requests that waited in two tabs each start once, and the turn that ran at the
//    stop does not run again.
// 10. A start that the provider refuses (529) in one tab waits for its retry with its own marker. It
//    takes no place among the agent's tabs, so another tab starts during the wait, and it runs once.
// 11. A tab request starts while a chat turn runs, with no wait.
// 12. Two chat messages run in order, with the tab running.
// 13. A message from a colleague starts at once in the chat of the receiver, beside a running tab turn,
//    and never steers the turn of the tab.
// 14. A provider that runs one turn at a time keeps the old rule: the chat waits for the channel and
//    names it.
// 15. Forcing a chat message stops only the turn of the chat; the turn of the tab keeps running.
// 16. `interrupt_agent` stops only the chat turn that works on the caller's message; the tab turn of
//    the same agent keeps running.
// 17. With a tab running and the chat idle, "new chat" and "compact" are not refused for the tab.
// 18. "Agents per tab": 3 allow 3 of 4 members, and the 4th starts when one ends; 1 allows one at a
//    time.
// 19. No hook for the limit: the default (4) lets 4 members of a tab run.
// 20. The chat turn gets a short note (at most 300 characters, names and resources only) when a tab of
//    the same agent holds a reserved resource, and no note otherwise.
// Every case ends with no delivery in `queued`, `starting` or `running` for any agent.
// `bun scripts/channel-tab-lanes-e2e.ts`. Writes .buildersbot-build/channel-tab-lanes-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  agentProviderDescriptor,
  type ChannelTask,
  DEFAULT_START_RETRY_SETTINGS,
} from "@buildersbot/contracts/ipc";
import { sourceText } from "@buildersbot/i18n/source";
import { Effect } from "effect";
import type { StoredStartBreaker } from "../src/backend/agent/start-retry";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { LINES_NOTICE_START } from "../src/backend/channel-lines-notice";
import type { HostMemory, HostMemoryLevel } from "../src/backend/host-memory";
import { getString, isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/channel-tab-lanes-e2e");
const root = await mkdtemp(join(tmpdir(), "buildersbot-tab-lanes-"));
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
 * whose turns keep running, `ask`, the marks whose turns ask the person a question first, and
 * `refuse`, how many starts of the turn with a mark the fake refuses with a 529 before one runs.
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
    return { hold: [], ask: [] };
  }
};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
let asks = 0;
/** turnId -> { threadId, texts, marks, asked, answered } of each turn that runs. */
const running = new Map();
/**
 * The marks that a turn already took. A mark holds only the first turn that gets it: a later turn of
 * the same tab gets the earlier request again in its channel history, and must not be held by it.
 */
const claimed = new Set();
/** The starts that the fake refused, by mark. Kept here, so the check never writes over the count. */
const refused = new Map();
const OVERLOADED = 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
/** The id of each question this fake asked -> its turn. */
const questions = new Map();
const reviewThreads = new Set();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
process.on("SIGTERM", () => process.exit(0));
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (turnId, status) => {
  const turn = running.get(turnId);
  if (turn === undefined) return;
  running.delete(turnId);
  log({ turnEnded: turnId, threadId: turn.threadId, status });
  if (status === "completed") {
    const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
    write({ method: "item/completed", params: { threadId: turn.threadId, turnId, item } });
  }
  write({ method: "turn/completed", params: { threadId: turn.threadId, turn: { id: turnId, status } } });
};
const marked = (turn, marks) => (marks || []).some((mark) => turn.marks.includes(mark));
/** The id of each tool call this fake made -> the mark of its turn. */
const calls = new Map();
let callCount = 0;
setInterval(() => {
  if (running.size === 0) return;
  const current = control();
  for (const [turnId, turn] of [...running]) {
    // A turn whose text has a call mark makes that tool call once, as a model does.
    for (const [mark, call] of Object.entries(current.call || {})) {
      if (turn.called || !turn.texts.some((text) => text.includes(mark))) continue;
      turn.called = true;
      const id = "call-" + process.pid + "-" + (++callCount);
      calls.set(id, mark);
      write({
        id,
        method: "item/tool/call",
        params: { threadId: turn.threadId, turnId, callId: "call-" + callCount, namespace: "buildersbot", tool: call.tool, arguments: call.arguments },
      });
    }
    if (marked(turn, current.hold)) continue;
    if (marked(turn, current.ask) && !turn.answered) {
      if (turn.asked) continue;
      turn.asked = true;
      const id = "ask-" + process.pid + "-" + (++asks);
      questions.set(id, turnId);
      log({ asked: turnId, threadId: turn.threadId });
      write({
        id,
        method: "item/tool/requestUserInput",
        params: {
          threadId: turn.threadId,
          turnId,
          itemId: "question-" + turnId,
          questions: [{ id: "go", header: "Go", question: "May I go on?", options: [{ label: "Yes", description: "" }] }],
        },
      });
      continue;
    }
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
      // Each agent has its own process, so an id names its process too: two processes log to one file.
      const threadId = "thread-" + process.pid + "-" + (++threads);
      if (params.ephemeral) reviewThreads.add(threadId);
      return write({ id: message.id, result: { thread: { id: threadId, turns: [] } } });
    }
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      if (reviewThreads.has(params.threadId)) {
        write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
        write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
        running.set(turnId, { threadId: params.threadId, texts: [], marks: [], asked: false, answered: true });
        return finish(turnId, "completed");
      }
      const turnTexts = texts(params.input);
      const current = control();
      const refuse = Object.entries(current.refuse || {}).find(
        ([mark, count]) => (refused.get(mark) || 0) < count && turnTexts.some((text) => text.includes(mark)),
      );
      if (refuse && params.clientUserMessageId) {
        refused.set(refuse[0], (refused.get(refuse[0]) || 0) + 1);
        log({ refused: refuse[0], threadId: params.threadId });
        return write({ id: message.id, error: { code: -32000, message: OVERLOADED } });
      }
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const marks = [...(current.hold || []), ...(current.ask || [])].filter(
        (mark) => !claimed.has(mark) && turnTexts.some((text) => text.includes(mark)),
      );
      for (const mark of marks) claimed.add(mark);
      running.set(turnId, { threadId: params.threadId, texts: turnTexts, marks, asked: false, answered: false });
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
      log({ method: message.method ?? null, id: message.id ?? null, params: message.params ?? null });
      if (message.method && message.id !== undefined) answer(message);
      else if (message.id !== undefined && calls.has(message.id)) {
        log({ toolResult: calls.get(message.id), ok: message.result?.success === true, text: JSON.stringify(message.result ?? message.error ?? null) });
        calls.delete(message.id);
      } else if (message.id !== undefined && questions.has(message.id)) {
        const turn = running.get(questions.get(message.id));
        questions.delete(message.id);
        if (turn) turn.answered = true;
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface Control {
  hold: string[];
  ask: string[];
  refuse: Record<string, number>;
  /** Mark -> the tool call that the first turn with this mark makes. */
  call: Record<string, { tool: string; arguments: unknown }>;
}

interface ProtocolEntry {
  index: number;
  method: string | null;
  threadId: string | null;
  turnId: string | null;
  turnStarted: string | null;
  turnEnded: string | null;
  asked: string | null;
  refused: string | null;
  status: string | null;
  texts: string[];
}

/** What a case saw, as the report keeps it in JSON. */
type Fact = string | number | boolean | null | Fact[] | { [key: string]: Fact };

interface CaseReport {
  name: string;
  facts: { [key: string]: Fact };
  passed: boolean;
  error?: string;
}

const report: { cases: CaseReport[]; passed: boolean; error?: string } = { cases: [], passed: false };

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

function protocol(): ProtocolEntry[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line, index) => protocolEntry(JSON.parse(line), index));
  } catch {
    return [];
  }
}

function protocolEntry(value: unknown, index: number): ProtocolEntry {
  const entry = isRecord(value) ? value : {};
  const params = isRecord(entry.params) ? entry.params : {};
  return {
    index,
    method: getString(entry, "method"),
    threadId: getString(params, "threadId") ?? getString(entry, "threadId"),
    turnId: getString(params, "turnId"),
    turnStarted: getString(entry, "turnStarted"),
    turnEnded: getString(entry, "turnEnded"),
    asked: getString(entry, "asked"),
    refused: getString(entry, "refused"),
    status: getString(entry, "status"),
    texts: Array.isArray(entry.texts) ? entry.texts.filter((text): text is string => typeof text === "string") : [],
  };
}

/** The start of the turn that carries this mark, or undefined. */
const started = (mark: string) =>
  protocol().find((line) => line.turnStarted && line.texts.some((text) => text.includes(mark)));
/** The end of the turn that carries this mark, or undefined. */
function ended(mark: string): ProtocolEntry | undefined {
  const turnId = started(mark)?.turnStarted;
  return turnId ? protocol().find((line) => line.turnEnded === turnId) : undefined;
}

/** The result that the fake saw for the tool call of the turn with this mark. */
function toolResult(mark: string): { ok: boolean; text: string } | undefined {
  try {
    for (const line of readFileSync(logPath, "utf8").split("\n").filter(Boolean)) {
      const entry = JSON.parse(line);
      if (isRecord(entry) && entry.toolResult === mark)
        return { ok: entry.ok === true, text: typeof entry.text === "string" ? entry.text : "" };
    }
  } catch {
    // The log is not there yet.
  }
  return undefined;
}

/** Waits for a state of the service or of the fake Codex. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const control: Control = { hold: [], ask: [], refuse: {}, call: {} };
const writeControl = () => writeFile(controlPath, JSON.stringify(control));
const hold = async (...marks: string[]) => {
  control.hold.push(...marks);
  await writeControl();
};
const release = async (...marks: string[]) => {
  control.hold = control.hold.filter((mark) => !marks.includes(mark));
  control.ask = control.ask.filter((mark) => !marks.includes(mark));
  await writeControl();
};
const ask = async (mark: string) => {
  control.ask.push(mark);
  await writeControl();
};

/** The memory reading of this computer, which the check moves between ok and low. */
let memoryLevel: HostMemoryLevel = "ok";
const memoryListeners = new Set<() => void>();
const memoryPressure: HostMemory = {
  level: () => memoryLevel,
  turnLimit: () => 64,
  reserveTurn: () => () => {},
  subscribe: (listener) => {
    memoryListeners.add(listener);
    return () => memoryListeners.delete(listener);
  },
  hostedPlan: false,
  kind: "desktop",
};
const setMemory = (level: HostMemoryLevel) => {
  memoryLevel = level;
  for (const listener of memoryListeners) listener();
};

await writeControl();
await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
/** The most tabs of one agent that run a turn at the same time, as the person set it. */
const tabLimit = 2;
/** The most agents that run a turn at the same time in one tab, as the person set it. */
let parallelLimit = 4;

/** The breakers of the start retry, kept across a restart as the main process keeps its file. */
let storedBreakers: readonly StoredStartBreaker[] = [];

/** The services of one run of the app on the profile. A restart makes them again. */
function openServices(withoutParallelLimit = false) {
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
    channelTabLimit: () => tabLimit,
    // Omitted, the service uses its default (`DEFAULT_AGENTS_PER_TAB`).
    ...(withoutParallelLimit ? {} : { channelParallelLimit: () => parallelLimit }),
    // Short waits, so a start that the provider refuses tries again in a second or two.
    startRetry: {
      settings: () => ({ ...DEFAULT_START_RETRY_SETTINGS, firstDelaySeconds: 1, maxDelaySeconds: 2 }),
      breakers: {
        read: () => storedBreakers,
        write: (breakers) => {
          storedBreakers = breakers;
        },
      },
    },
  });
  return { database, mailbox, agents };
}

let { database, mailbox, agents } = openServices();
const actor = { id: "local", name: "Alex" };

async function createAgent(name: string): Promise<string> {
  const first = `${name}-hello-${randomUUID()}`;
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: "Checks the tab lanes of channels.",
      avatarSeed: name,
      avatarHue: null,
      initialMessage: first,
    }),
  );
  await waitFor(`${name}: the first turn ends`, () => ended(first));
  allAgentIds.push(agent.id);
  return agent.id;
}

const allAgentIds: string[] = [];

/** No line is stuck: no delivery of any agent is `queued`, `starting` or `running` once the case is over. */
async function assertNoStuckLines(facts: CaseReport["facts"]): Promise<void> {
  const stuck = () => [
    ...allAgentIds.flatMap((agentId) =>
      agents
        .listQueue(agentId)
        .deliveries.filter((delivery) => ["queued", "starting", "running"].includes(delivery.status))
        .map((delivery) => `${agentId.slice(0, 6)}:queue:${delivery.status}`),
    ),
    ...mailbox
      .unresolvedDeliveries()
      .map(({ delivery }) => `${delivery.recipientAgentId.slice(0, 6)}:${delivery.status}:${delivery.id.slice(0, 6)}`),
  ];
  await waitFor("every line is idle", () => stuck().length === 0, 15_000).catch(() => undefined);
  facts.stuckDeliveries = stuck();
  assert.deepEqual(facts.stuckDeliveries, [], "no delivery is left queued, starting or running");
}

async function createChannel(name: string, memberIds: string[]): Promise<string> {
  const channelId = randomUUID();
  await runCauseEffect(
    agents.channels.command(
      {
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
      },
      actor,
    ),
  );
  return channelId;
}

/** A new tab of the channel. The first tab of a channel has the id `buildersbot-topic-<channelId>`. */
async function createTab(channelId: string): Promise<string> {
  const topicId = randomUUID();
  await runCauseEffect(
    agents.channels.command({ type: "topic-create", operationId: randomUUID(), channelId, topicId }, actor),
  );
  return topicId;
}

async function send(channelId: string, topicId: string, text: string, agentId: string): Promise<void> {
  await runCauseEffect(
    agents.channels.command(
      {
        type: "send",
        operationId: randomUUID(),
        channelId,
        topicId,
        text,
        recipientAgentId: agentId,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    ),
  );
}

/** The task of the request with this mark, as the screen reads it. */
function task(channelId: string, topicId: string, mark: string): ChannelTask | undefined {
  return agents.channels.page(channelId, topicId).tasks.find((item) => item.instruction.includes(mark));
}

/** `TAB_LANES_CASES=1,4` runs only those cases, to look at one failure again. */
const onlyCases = process.env.TAB_LANES_CASES?.split(",").map((value) => Number(value.trim()));
let caseNumber = 0;

async function runCase(name: string, check: (facts: CaseReport["facts"]) => Promise<void>) {
  caseNumber += 1;
  if (onlyCases && !onlyCases.includes(caseNumber)) return;
  const result: CaseReport = { name, facts: {}, passed: false };
  report.cases.push(result);
  try {
    await check(result.facts);
    result.passed = true;
  } catch (error) {
    result.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    // A failed case lets its turns end, so the next case starts with an idle agent.
    control.hold = [];
    control.ask = [];
    control.refuse = {};
    control.call = {};
    await writeControl();
    setMemory("ok");
  }
}

try {
  await runCauseEffect(agents.initialize());
  const ada = await createAgent("ada");
  const bob = await createAgent("bob");

  await runCase("a short request in another tab does not wait for a long one", async (facts) => {
    const channelId = await createChannel("lanes-1", [ada]);
    const first = `buildersbot-topic-${channelId}`;
    const second = await createTab(channelId);
    await hold("long-1a");
    await send(channelId, first, "long-1a: write a long report", ada);
    await waitFor("the long turn starts", () => started("long-1a"));
    await send(channelId, second, "short-1b: reply ready", ada);
    const shortEnd = await waitFor("the short turn ends while the long one runs", () => ended("short-1b"));
    facts.longStillRunning = ended("long-1a") === undefined;
    facts.shortEndedAt = shortEnd.index;
    assert.equal(facts.longStillRunning, true, "the long turn still runs");
    await release("long-1a");
    await waitFor("the long turn ends", () => ended("long-1a"));
  });

  await runCase("two requests in one tab run in order", async (facts) => {
    const channelId = await createChannel("lanes-2", [ada]);
    const tab = await createTab(channelId);
    await hold("order-2a");
    await send(channelId, tab, "order-2a: first request", ada);
    await waitFor("the first turn starts", () => started("order-2a"));
    await send(channelId, tab, "order-2b: second request", ada);
    const waiting = await waitFor("the second request waits for the first one of its tab", () => {
      const second = task(channelId, tab, "order-2b");
      return second?.state === "queued" && second.wait?.reason === "tab" ? second : null;
    });
    facts.secondWait = waiting.wait?.reason ?? null;
    facts.secondStartedEarly = started("order-2b") !== undefined;
    assert.equal(facts.secondStartedEarly, false);
    await release("order-2a");
    const firstEnd = await waitFor("the first turn ends", () => ended("order-2a"));
    const secondStart = await waitFor("the second turn starts", () => started("order-2b"));
    facts.order = [firstEnd.index, secondStart.index];
    assert.ok(firstEnd.index < secondStart.index, "the second request starts after the first one ended");
    await waitFor("the second turn ends", () => ended("order-2b"));
  });

  await runCase("the limit of parallel tabs holds a third tab, without starvation", async (facts) => {
    const channelId = await createChannel("lanes-3", [ada]);
    const [one, two, three] = [await createTab(channelId), await createTab(channelId), await createTab(channelId)];
    await hold("cap-3a", "cap-3b");
    await send(channelId, one, "cap-3a: hold one", ada);
    await send(channelId, two, "cap-3b: hold two", ada);
    await waitFor("two tabs run", () => started("cap-3a") && started("cap-3b"));
    await send(channelId, three, "cap-3c: third tab", ada);
    const waiting = await waitFor("the third tab waits for a place", () => {
      const third = task(channelId, three, "cap-3c");
      return third?.state === "queued" && third.wait?.reason === "agent-tabs" ? third : null;
    });
    facts.thirdWait = {
      reason: waiting.wait?.reason ?? null,
      busy: waiting.wait?.busy ?? null,
      limit: waiting.wait?.limit ?? null,
    };
    // A newer request in the first tab waits behind its running turn. When that turn ends, the third
    // tab waited longer, so it takes the free place first.
    await send(channelId, one, "cap-3d: newer request of tab one", ada);
    await waitFor("the newer request waits in its tab", () => task(channelId, one, "cap-3d")?.state === "queued");
    await release("cap-3a");
    const third = await waitFor("the third tab starts", () => started("cap-3c"));
    const newer = await waitFor("the newer request starts", () => started("cap-3d"));
    facts.startOrder = { third: third.index, newer: newer.index };
    assert.ok(third.index < newer.index, "the tab that waited longer starts first");
    await release("cap-3b");
    await waitFor("every turn ends", () => ended("cap-3b") && ended("cap-3c") && ended("cap-3d"));
  });

  await runCase("a tab that waits for the person or for another agent takes no place", async (facts) => {
    const channelId = await createChannel("lanes-4", [ada, bob]);
    const [asking, holding, third, fourth] = [
      await createTab(channelId),
      await createTab(channelId),
      await createTab(channelId),
      await createTab(channelId),
    ];
    await ask("ask-4a");
    await send(channelId, asking, "ask-4a: ask me first", ada);
    await waitFor("the turn asks the person", () => protocol().some((line) => line.asked));
    await hold("hold-4b");
    await send(channelId, holding, "hold-4b: keep working", ada);
    await waitFor("the second tab runs", () => started("hold-4b"));
    await send(channelId, third, "free-4c: third tab", ada);
    await waitFor("the third tab runs while one tab waits for the person", () => ended("free-4c"));
    facts.thirdRanBesideQuestion = true;
    // A task that hands work to another agent ends its turn and waits with no assignment.
    await hold("parent-4d", "child-4d");
    await send(channelId, fourth, "parent-4d: hand work to bob", ada);
    const parentStart = await waitFor("the parent turn starts", () => started("parent-4d"));
    const parent = await waitFor("the parent task runs", () => {
      const current = task(channelId, fourth, "parent-4d");
      return current?.state === "running" ? current : null;
    });
    const turnId = parentStart.turnStarted ?? "";
    const handoff = await runCauseEffect(
      agents.channels.tool(channelId, ada, turnId, randomUUID(), "channel_assign", {
        recipientAgentId: bob,
        task: "child-4d: work for bob",
        expectedResult: "A report.",
        sourceMessageIds: [parent.requestMessageId],
      }),
    );
    facts.handoff = isRecord(handoff) ? Object.keys(handoff) : typeof handoff;
    await release("parent-4d");
    await waitFor("the parent waits for bob", () => task(channelId, fourth, "parent-4d")?.state === "waiting");
    await waitFor("bob works on the child", () => started("child-4d"));
    await send(channelId, fourth, "after-4e: another request in the waiting tab", ada);
    await waitFor("ada answers in the tab whose task waits for bob", () => ended("after-4e")).catch((error) => {
      const waiting = task(channelId, fourth, "after-4e");
      facts.afterTask = {
        state: waiting?.state ?? null,
        owner: waiting?.ownerAgentId === ada,
        wait: waiting?.wait?.reason ?? null,
        hold: waiting ? (agents.channels.queuedHolds().get(waiting.id) ?? null) : null,
        started: started("after-4e") !== undefined,
      };
      throw error;
    });
    facts.ranBesideHandoff = true;
    await release("ask-4a", "hold-4b", "child-4d");
    await runCauseEffect(
      agents.channels.command(
        {
          type: "stop",
          operationId: randomUUID(),
          channelId,
          taskId: task(channelId, asking, "ask-4a")?.id ?? "",
          recipientAgentId: null,
        },
        actor,
      ),
    );
    await waitFor("the asking turn ends", () => ended("ask-4a"));
    await waitFor("the other turns end", () => ended("hold-4b") && ended("child-4d"));
  });

  await runCase("a wait cycle through dependencies is refused", async (facts) => {
    const channelId = await createChannel("lanes-5", [ada, bob]);
    const tab = await createTab(channelId);
    await hold("cycle-5a");
    await send(channelId, tab, "cycle-5a: plan the work", ada);
    const start = await waitFor("the turn starts", () => started("cycle-5a"));
    const parent = await waitFor("the task runs", () => {
      const current = task(channelId, tab, "cycle-5a");
      return current?.state === "running" ? current : null;
    });
    const refused = await runCauseEffect(
      agents.channels.tool(channelId, ada, start.turnStarted ?? "", randomUUID(), "channel_assign", {
        recipientAgentId: bob,
        task: "cycle-5b: wait for my own task",
        expectedResult: "A report.",
        sourceMessageIds: [parent.requestMessageId],
        dependencies: [parent.id],
      }),
    ).then(
      () => null,
      (failure: unknown) => (failure instanceof Error ? failure.message : String(failure)),
    );
    facts.refused = refused;
    assert.ok(refused, "a dependency on the calling task is refused");
    await release("cycle-5a");
    await waitFor("the turn ends", () => ended("cycle-5a"));
  });

  await runCase("low memory holds a new tab with a reason, and the memory return starts it", async (facts) => {
    const channelId = await createChannel("lanes-6", [ada]);
    const [one, two] = [await createTab(channelId), await createTab(channelId)];
    await hold("mem-6a");
    await send(channelId, one, "mem-6a: long work", ada);
    await waitFor("the first tab runs", () => started("mem-6a"));
    setMemory("low");
    await send(channelId, two, "mem-6b: second tab", ada);
    const waiting = await waitFor("the second tab waits for memory", () => {
      const second = task(channelId, two, "mem-6b");
      return second?.state === "queued" && second.wait?.reason === "memory" ? second : null;
    });
    facts.wait = waiting.wait?.reason ?? null;
    facts.startedDuringLowMemory = started("mem-6b") !== undefined;
    assert.equal(facts.startedDuringLowMemory, false);
    setMemory("ok");
    await waitFor("the second tab runs when the memory is back", () => ended("mem-6b"));
    facts.firstStillRunning = ended("mem-6a") === undefined;
    assert.equal(facts.firstStillRunning, true);
    await release("mem-6a");
    await waitFor("the first tab ends", () => ended("mem-6a"));
  });

  await runCase("the agent's own chat runs beside its channel tab, and its queue shows no hold", async (facts) => {
    const channelId = await createChannel("lanes-7", [ada]);
    const tab = await createTab(channelId);
    await hold("chan-7a");
    await send(channelId, tab, "chan-7a: channel work", ada);
    await waitFor("the channel turn starts", () => started("chan-7a"));
    const receipt = await runCauseEffect(agents.sendMessage({ agentId: ada, text: "own-7b: a message to ada" }));
    const deliveryId = receipt.deliveries[0]?.id ?? "";
    await waitFor("the chat turn ends while the tab turn runs", () => ended("own-7b"));
    facts.tabStillRunning = ended("chan-7a") === undefined;
    facts.queueHold = agents.listQueue(ada).hold?.channelId ?? null;
    assert.equal(facts.tabStillRunning, true, "the tab turn still runs");
    assert.equal(facts.queueHold, null, "the queue of the chat shows no hold");
    await waitFor(
      "the chat delivery completes",
      () => mailbox.getDelivery(deliveryId)?.delivery.status === "completed",
    );
    facts.delivery = mailbox.getDelivery(deliveryId)?.delivery.status ?? null;
    await release("chan-7a");
    await waitFor("the tab turn ends", () => ended("chan-7a"));
    await assertNoStuckLines(facts);
  });

  await runCase("deleting a tab stops only that tab's turn", async (facts) => {
    const channelId = await createChannel("lanes-8", [ada]);
    const [gone, kept] = [await createTab(channelId), await createTab(channelId)];
    await hold("gone-8a", "kept-8b");
    await send(channelId, gone, "gone-8a: work in the tab that goes", ada);
    await send(channelId, kept, "kept-8b: work in the tab that stays", ada);
    await waitFor("both tabs run", () => started("gone-8a") && started("kept-8b"));
    await runCauseEffect(
      agents.channels.command({ type: "topic-delete", operationId: randomUUID(), channelId, topicId: gone }, actor),
    );
    const stopped = await waitFor("the deleted tab's turn stops", () => ended("gone-8a"));
    facts.goneStatus = stopped.status;
    facts.keptRunning = ended("kept-8b") === undefined;
    assert.equal(stopped.status, "interrupted");
    assert.equal(facts.keptRunning, true, "the other tab keeps running");
    await send(channelId, kept, "kept-8c: next request in the tab that stays", ada);
    await release("gone-8a", "kept-8b");
    await waitFor("the kept tab ends its work", () => ended("kept-8b") && ended("kept-8c"));
    facts.keptTask = task(channelId, kept, "kept-8b")?.state ?? null;
  });

  await runCase("a restart starts each waiting request once and does not run a stopped turn again", async (facts) => {
    const channelId = await createChannel("lanes-9", [ada, bob]);
    const [running, first, second] = [
      await createTab(channelId),
      await createTab(channelId),
      await createTab(channelId),
    ];
    await hold("restart-9a");
    await send(channelId, running, "restart-9a: runs at the stop", ada);
    await waitFor("the turn that runs at the stop starts", () => started("restart-9a"));
    // No new turn starts while memory is low. Bob's request waits in the drain with its assignment,
    // and ada's second tab waits in its channel, as ada already works.
    setMemory("low");
    await send(channelId, first, "restart-9b: waits in the drain", bob);
    await send(channelId, second, "restart-9c: waits in the channel", ada);
    await waitFor("both requests wait for memory", () => {
      const one = task(channelId, first, "restart-9b");
      const two = task(channelId, second, "restart-9c");
      return one?.wait?.reason === "memory" && two?.wait?.reason === "memory";
    });
    await runCauseEffect(agents.stop());
    database.close();
    await release("restart-9a");
    setMemory("ok");
    ({ database, mailbox, agents } = openServices());
    await runCauseEffect(agents.initialize());
    await waitFor("both waiting requests run after the restart", () => ended("restart-9b") && ended("restart-9c"));
    const starts = (mark: string) =>
      protocol().filter((line) => line.turnStarted && line.texts.some((text) => text.includes(mark))).length;
    facts.starts = { running: starts("restart-9a"), first: starts("restart-9b"), second: starts("restart-9c") };
    facts.runningTask = task(channelId, running, "restart-9a")?.state ?? null;
    assert.deepEqual(facts.starts, { running: 1, first: 1, second: 1 }, "each request starts once");
    assert.notEqual(facts.runningTask, "running", "the stopped turn does not run again");
  });

  await runCase("a start retry in one tab takes no place, keeps its own marker, and runs once", async (facts) => {
    const channelId = await createChannel("lanes-10", [ada]);
    const [retrying, holding, free] = [
      await createTab(channelId),
      await createTab(channelId),
      await createTab(channelId),
    ];
    control.refuse = { "retry-10a": 2 };
    await hold("hold-10b");
    await send(channelId, holding, "hold-10b: keep working", ada);
    await waitFor("the second tab runs", () => started("hold-10b"));
    await send(channelId, retrying, "retry-10a: the provider refuses the first starts", ada);
    const waiting = await waitFor("the first tab waits for its retry", () => {
      const current = task(channelId, retrying, "retry-10a");
      return current?.state === "queued" && current.startRetry ? current : null;
    });
    facts.retry = { attempt: waiting.startRetry?.attempt ?? null, phase: waiting.startRetry?.phase ?? null };
    // With one tab at work and one that waits for its retry, the agent has a free place.
    await send(channelId, free, "free-10c: a third tab", ada);
    const freeStart = await waitFor("the third tab starts during the retry", () => started("free-10c"));
    const freeTask = task(channelId, free, "free-10c");
    facts.freeHadRetry = freeTask?.startRetry !== undefined;
    const retried = await waitFor("the first tab runs after its retries", () => ended("retry-10a"));
    const runs = protocol().filter((line) => line.turnStarted && line.texts.some((text) => text.includes("retry-10a")));
    const refusals = protocol().filter((line) => line.refused === "retry-10a").length;
    facts.order = { free: freeStart.index, retried: retried.index };
    facts.runs = runs.length;
    facts.refusals = refusals;
    assert.equal(facts.freeHadRetry, false, "the marker stays on its own delivery");
    assert.ok(
      freeStart.index < (runs[0]?.index ?? Number.POSITIVE_INFINITY),
      "the third tab started before the retry ran",
    );
    assert.equal(refusals, 2, "two starts were refused");
    assert.equal(runs.length, 1, "the retried request runs once");
    await release("hold-10b");
    await waitFor("every turn ends", () => ended("hold-10b") && ended("free-10c"));
  });

  await runCase("a tab request starts while a chat turn runs, with no wait", async (facts) => {
    const channelId = await createChannel("lanes-11", [ada]);
    const tab = await createTab(channelId);
    await hold("own-11a");
    await runCauseEffect(agents.sendMessage({ agentId: ada, text: "own-11a: chat work that keeps running" }));
    await waitFor("the chat turn starts", () => started("own-11a"));
    await send(channelId, tab, "chan-11b: tab request", ada);
    await waitFor("the tab turn ends while the chat turn runs", () => ended("chan-11b"));
    facts.chatStillRunning = ended("own-11a") === undefined;
    facts.tabWait = task(channelId, tab, "chan-11b")?.wait?.reason ?? null;
    assert.equal(facts.chatStillRunning, true, "the chat turn still runs");
    assert.equal(facts.tabWait, null, "the tab request has no wait");
    await release("own-11a");
    await waitFor("the chat turn ends", () => ended("own-11a"));
    await assertNoStuckLines(facts);
  });

  await runCase("two chat messages run in order while a tab runs", async (facts) => {
    const channelId = await createChannel("lanes-12", [ada]);
    const tab = await createTab(channelId);
    await hold("chan-12t", "own-12a");
    await send(channelId, tab, "chan-12t: tab work", ada);
    await waitFor("the tab turn starts", () => started("chan-12t"));
    await runCauseEffect(agents.sendMessage({ agentId: ada, text: "own-12a: first chat message" }));
    await waitFor("the first chat turn starts", () => started("own-12a"));
    const second = await runCauseEffect(agents.sendMessage({ agentId: ada, text: "own-12b: second chat message" }));
    await waitFor("the second message waits in the queue", () =>
      agents.listQueue(ada).deliveries.some((delivery) => delivery.id === second.deliveries[0]?.id),
    );
    facts.secondStartedEarly = started("own-12b") !== undefined;
    facts.queueHold = agents.listQueue(ada).hold?.channelId ?? null;
    assert.equal(facts.secondStartedEarly, false, "the second message waits for the first one");
    assert.equal(facts.queueHold, null, "the wait is for the first message, not for the tab");
    await release("own-12a");
    const firstEnd = await waitFor("the first chat turn ends", () => ended("own-12a"));
    const secondStart = await waitFor("the second chat turn starts", () => started("own-12b"));
    facts.order = [firstEnd.index, secondStart.index];
    assert.ok(firstEnd.index < secondStart.index, "the second message starts after the first one ended");
    facts.tabStillRunning = ended("chan-12t") === undefined;
    assert.equal(facts.tabStillRunning, true);
    await release("chan-12t");
    await waitFor("every turn ends", () => ended("own-12b") && ended("chan-12t"));
    await assertNoStuckLines(facts);
  });

  await runCase("a message from a colleague starts at once in the chat and never steers a tab turn", async (facts) => {
    const channelId = await createChannel("lanes-13", [ada]);
    const tab = await createTab(channelId);
    await hold("chan-13a");
    await send(channelId, tab, "chan-13a: tab work", ada);
    const tabStart = await waitFor("the tab turn starts", () => started("chan-13a"));
    await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: bob },
        recipientAgentIds: [ada],
        text: "mate-13b: a question from bob",
      }),
    );
    // The tool that sends a message also asks the drain to run; here the same ask comes from the cap hook.
    agents.agentLimitChanged();
    const mateEnd = await waitFor("the message of the colleague runs and ends beside the tab turn", () =>
      ended("mate-13b"),
    );
    const mateStart = started("mate-13b");
    facts.tabStillRunning = ended("chan-13a") === undefined;
    facts.mateThreadIsTabThread = mateStart?.threadId === tabStart.threadId;
    facts.steers = protocol().filter((line) => line.method === "turn/steer").length;
    facts.mateEndedAt = mateEnd.index;
    assert.equal(facts.tabStillRunning, true, "the tab turn still runs");
    assert.equal(facts.mateThreadIsTabThread, false, "the colleague's message does not run in the tab thread");
    assert.equal(facts.steers, 0, "no message steers a running turn");
    await release("chan-13a");
    await waitFor("the tab turn ends", () => ended("chan-13a"));
    await assertNoStuckLines(facts);
  });

  await runCase("a provider that runs one turn at a time keeps the old rule", async (facts) => {
    // Only the custom ACP agent has this flag. The check sets it on the Codex descriptor for this case,
    // because a fake ACP agent would test the same two clauses of the drain.
    const descriptor = agentProviderDescriptor("codex");
    Reflect.set(descriptor, "concurrentTurns", false);
    try {
      const channelId = await createChannel("lanes-14", [ada]);
      const tab = await createTab(channelId);
      await hold("chan-14a");
      await send(channelId, tab, "chan-14a: channel work", ada);
      await waitFor("the channel turn starts", () => started("chan-14a"));
      await runCauseEffect(agents.sendMessage({ agentId: ada, text: "own-14b: a message to ada" }));
      const held = await waitFor("the own chat names the channel", () => {
        const queue = agents.listQueue(ada);
        return queue.hold?.channelId === channelId ? queue : null;
      });
      facts.hold = { channelId: held.hold?.channelId ?? null, tabs: held.hold?.tabs ?? null };
      facts.ownStartedEarly = started("own-14b") !== undefined;
      assert.equal(facts.ownStartedEarly, false, "the chat waits for the channel work");
      await release("chan-14a");
      await waitFor("the chat message runs after the channel turn", () => ended("own-14b"));
      await assertNoStuckLines(facts);
    } finally {
      Reflect.set(descriptor, "concurrentTurns", true);
    }
  });

  await runCase("forcing a chat message stops only the chat turn", async (facts) => {
    const channelId = await createChannel("lanes-15", [ada]);
    const tab = await createTab(channelId);
    await hold("chan-15t", "own-15a");
    await send(channelId, tab, "chan-15t: tab work", ada);
    await waitFor("the tab turn starts", () => started("chan-15t"));
    await runCauseEffect(agents.sendMessage({ agentId: ada, text: "own-15a: chat work" }));
    const chatStart = await waitFor("the chat turn starts", () => started("own-15a"));
    const queued = await runCauseEffect(agents.sendMessage({ agentId: ada, text: "own-15b: force this one" }));
    const deliveryId = queued.deliveries[0]?.id ?? "";
    await waitFor("the second message waits", () =>
      agents.listQueue(ada).deliveries.some((delivery) => delivery.id === deliveryId),
    );
    const result = await runCauseEffect(
      agents.forceQueuedMessage({ agentId: ada, deliveryId, expectedTurnId: chatStart.turnStarted }),
    );
    facts.forceResult = isRecord(result) ? Object.keys(result) : typeof result;
    const stopped = await waitFor("the chat turn stops", () => ended("own-15a"));
    facts.chatStatus = stopped.status;
    assert.equal(stopped.status, "interrupted", "the chat turn was stopped");
    await waitFor("the forced message runs", () => ended("own-15b"));
    facts.tabStillRunning = ended("chan-15t") === undefined;
    assert.equal(facts.tabStillRunning, true, "the tab turn keeps running");
    await release("chan-15t");
    await waitFor("the tab turn ends", () => ended("chan-15t"));
    await assertNoStuckLines(facts);
  });

  await runCase("interrupt_agent stops only the chat turn of the work of the caller", async (facts) => {
    const channelId = await createChannel("lanes-16", [bob]);
    const tab = await createTab(channelId);
    await hold("chan-16t", "mate-16b");
    await send(channelId, tab, "chan-16t: bob works in the tab", bob);
    await waitFor("the tab turn starts", () => started("chan-16t"));
    await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: ada },
        recipientAgentIds: [bob],
        text: "mate-16b: ada asks bob for work in the chat",
      }),
    );
    agents.agentLimitChanged();
    await waitFor("the chat turn of bob starts", () => started("mate-16b"));
    // Ada's own turn calls the tool, as a model does.
    control.call["caller-16c"] = { tool: "interrupt_agent", arguments: { agentId: bob, reason: "check of the lanes" } };
    await writeControl();
    await runCauseEffect(agents.sendMessage({ agentId: ada, text: "caller-16c: stop bob now" }));
    const result = await waitFor("the tool answers", () => toolResult("caller-16c"));
    facts.toolResult = result.text.slice(0, 200);
    assert.ok(result.ok, `the tool succeeded: ${result.text}`);
    const stopped = await waitFor("the chat turn of bob stops", () => ended("mate-16b"));
    facts.chatStatus = stopped.status;
    facts.tabStillRunning = ended("chan-16t") === undefined;
    assert.equal(stopped.status, "interrupted", "the chat turn was stopped");
    assert.equal(facts.tabStillRunning, true, "the tab turn of bob keeps running");
    control.call = {};
    await release("chan-16t");
    await waitFor("the tab turn ends", () => ended("chan-16t"));
    await assertNoStuckLines(facts);
  });

  await runCase("new chat and compact are not refused because a tab runs", async (facts) => {
    const channelId = await createChannel("lanes-17", [ada]);
    const tab = await createTab(channelId);
    await hold("chan-17a");
    await send(channelId, tab, "chan-17a: tab work", ada);
    await waitFor("the tab turn starts", () => started("chan-17a"));
    // Compact first: a new chat starts a new session, and compact needs one.
    const refusedAsBusy = (failure: unknown) =>
      failure instanceof Error &&
      [sourceText("error.agent.waitBeforeCompactContext"), sourceText("error.agent.waitBeforeClearContext")].includes(
        failure.message,
      );
    const compacted = await runCauseEffect(agents.compactAgentContext(ada)).then(
      () => "ok",
      (failure: unknown) => (refusedAsBusy(failure) ? "busy" : "other"),
    );
    // The fake Codex has no compaction. What the check proves is that the busy refusal is gone.
    facts.compact = compacted;
    assert.notEqual(compacted, "busy", "compact is not refused because a tab runs");
    const cleared = await runCauseEffect(agents.clearAgentContext(ada)).then(
      () => "ok",
      (failure: unknown) => (refusedAsBusy(failure) ? "busy" : "other"),
    );
    facts.newChat = cleared;
    assert.equal(cleared, "ok", "new chat works with a tab running");
    facts.tabStillRunning = ended("chan-17a") === undefined;
    assert.equal(facts.tabStillRunning, true, "the tab turn keeps running");
    await release("chan-17a");
    await waitFor("the tab turn ends", () => ended("chan-17a"));
    await assertNoStuckLines(facts);
  });

  /**
   * The tasks of a tab by state. A mark in a request can show again in the channel history of a later
   * turn, so a start is read from the task and not from the text of a turn.
   */
  const tabTasks = (channelId: string, tab: string) => agents.channels.page(channelId, tab).tasks;
  const runningTasks = (channelId: string, tab: string) =>
    tabTasks(channelId, tab).filter((item) => item.state === "running").length;
  const queuedTasks = (channelId: string, tab: string) =>
    tabTasks(channelId, tab).filter((item) => item.state === "queued").length;
  const allCompleted = (channelId: string, tab: string) =>
    tabTasks(channelId, tab).every((item) => item.state === "completed");
  const pause = () => new Promise((done) => setTimeout(done, 500));

  await runCase(
    "agents per tab: 3 let 3 of 4 run, the 4th starts when one ends; 1 runs one at a time",
    async (facts) => {
      const carol = await createAgent("carol");
      const dan = await createAgent("dan");
      const members = [ada, bob, carol, dan];
      const channelId = await createChannel("lanes-18", members);
      const tab = await createTab(channelId);
      parallelLimit = 3;
      const three = ["lim-18a", "lim-18b", "lim-18c", "lim-18d"];
      await hold(...three);
      // One request at a time: the fake holds a mark for the first turn whose text shows it, and the
      // channel history of a turn shows the requests that came before it.
      for (const [index, mark] of three.entries()) {
        await send(channelId, tab, `${mark}: work for member ${index}`, members[index] ?? ada);
        if (index < 3) await waitFor(`task ${index + 1} runs`, () => runningTasks(channelId, tab) >= index + 1);
      }
      await pause();
      facts.runningWithLimit3 = runningTasks(channelId, tab);
      facts.queuedWithLimit3 = queuedTasks(channelId, tab);
      assert.equal(facts.runningWithLimit3, 3, "three run");
      assert.equal(facts.queuedWithLimit3, 1, "the fourth waits in the tab");
      // The first request ran alone in its turn, so releasing its mark ends only that turn.
      await release("lim-18a");
      await waitFor("the fourth starts when one ends", () => queuedTasks(channelId, tab) === 0);
      facts.runningAfterFree = runningTasks(channelId, tab);
      assert.equal(facts.runningAfterFree, 3, "three run again");
      await release(...three);
      await waitFor("the four tasks end", () => allCompleted(channelId, tab));

      parallelLimit = 1;
      agents.agentLimitChanged();
      const tabTwo = await createTab(channelId);
      const one = ["lim-18e", "lim-18f", "lim-18g"];
      await hold(...one);
      for (const [index, mark] of one.entries())
        await send(channelId, tabTwo, `${mark}: work for member ${index}`, members[index] ?? ada);
      await waitFor("one task runs", () => runningTasks(channelId, tabTwo) >= 1);
      await pause();
      facts.runningWithLimit1 = runningTasks(channelId, tabTwo);
      facts.queuedWithLimit1 = queuedTasks(channelId, tabTwo);
      assert.equal(facts.runningWithLimit1, 1, "one runs at a time");
      assert.equal(facts.queuedWithLimit1, 2, "the other two wait in the tab");
      await release(...one);
      await waitFor("the three tasks end", () => allCompleted(channelId, tabTwo));
      parallelLimit = 4;
      await assertNoStuckLines(facts);
    },
  );

  await runCase("without the hook, the default limit lets 4 members of a tab run", async (facts) => {
    // The agents of the case before, or new ones when this case runs alone.
    const members =
      allAgentIds.length >= 4
        ? allAgentIds.slice(0, 4)
        : [ada, bob, await createAgent("erin"), await createAgent("finn")];
    // A restart makes the services again, now without `channelParallelLimit`.
    await runCauseEffect(agents.stop());
    database.close();
    ({ database, mailbox, agents } = openServices(true));
    await runCauseEffect(agents.initialize());
    const marks = ["def-19a", "def-19b", "def-19c", "def-19d"];
    const channelId = await createChannel("lanes-19", members);
    const tab = await createTab(channelId);
    await hold(...marks);
    for (const [index, mark] of marks.entries()) {
      await send(channelId, tab, `${mark}: work for member ${index}`, members[index] ?? ada);
      await waitFor(`task ${index + 1} runs`, () => runningTasks(channelId, tab) >= index + 1);
    }
    await pause();
    facts.running = runningTasks(channelId, tab);
    assert.equal(facts.running, 4, "the default limit is 4");
    await release(...marks);
    await waitFor("the four tasks end", () => allCompleted(channelId, tab));
    await assertNoStuckLines(facts);
  });

  await runCase("the chat turn gets a short note only when a tab holds a reserved resource", async (facts) => {
    const channelId = await createChannel("lanes-20", [ada, bob]);
    const tab = await createTab(channelId);
    await hold("parent-20a", "child-20b");
    await send(channelId, tab, "parent-20a: hand work to bob", ada);
    const parentStart = await waitFor("the parent turn starts", () => started("parent-20a"));
    const parent = await waitFor("the parent task runs", () => {
      const current = task(channelId, tab, "parent-20a");
      return current?.state === "running" ? current : null;
    });
    await runCauseEffect(
      agents.channels.tool(channelId, ada, parentStart.turnStarted ?? "", randomUUID(), "channel_assign", {
        recipientAgentId: bob,
        task: "child-20b: secret task text for bob",
        expectedResult: "A report.",
        sourceMessageIds: [parent.requestMessageId],
        resources: ["browser"],
      }),
    );
    await release("parent-20a");
    await waitFor("bob works on the child with the browser reserved", () => started("child-20b"));
    await runCauseEffect(agents.sendMessage({ agentId: bob, text: "own-20c: a chat message to bob" }));
    const withNote = await waitFor("the chat turn of bob starts beside the tab", () => started("own-20c"));
    const textOf = (entry: { texts: string[] }) => entry.texts.join("\n");
    const noteStart = textOf(withNote).indexOf(LINES_NOTICE_START);
    facts.noteFound = noteStart >= 0;
    assert.ok(noteStart >= 0, "the chat turn has the note");
    const note = textOf(withNote).slice(noteStart).split("\n")[0] ?? "";
    facts.noteLength = note.length;
    facts.note = note;
    assert.ok(note.length <= 300, "the note has at most 300 characters");
    assert.ok(note.includes("browser"), "the note names the resource");
    assert.ok(note.includes("lanes-20"), "the note names the channel");
    assert.equal(note.includes("secret task text"), false, "the note has no text of the tab");
    await waitFor("the chat turn ends", () => ended("own-20c"));
    await release("child-20b");
    await waitFor("the child ends", () => ended("child-20b"));
    await waitFor(
      "no assignment of bob is left",
      () => agents.channels.store.agentAssignments(bob, ["starting", "running"]).length === 0,
    );
    await runCauseEffect(agents.sendMessage({ agentId: bob, text: "own-20d: a second chat message" }));
    const without = await waitFor("the second chat turn starts", () => started("own-20d"));
    facts.noNoteWithoutTab = !textOf(without).includes(LINES_NOTICE_START);
    assert.equal(facts.noNoteWithoutTab, true, "a chat turn with no tab at work has no note");
    await waitFor("the second chat turn ends", () => ended("own-20d"));
    await assertNoStuckLines(facts);
  });

  report.passed = report.cases.length === (onlyCases?.length ?? 20) && report.cases.every((entry) => entry.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
