// Checks that a Claude session that closes for being idle opens again with its history, and that a session
// that must not close stays open. Runs the real agent service on a temporary profile, with the real
// `ClaudeAgentClient` connected to a stand-in `claude` executable. Like the real CLI, the stand-in saves
// the session transcript and, on `--resume`, answers from it: its reply names the markers of the earlier
// messages, so a session that opened again without its history would not name them. The idle policy is
// fixed at a limit of 0 sessions and 400 ms, so a session that can close does so at once.
//   1. A session closes after its turn (the process ends), and the next message opens it again from the
//      same session id. The answer names the earlier message; the chat shows each answer one time.
//   2. A turn that is running is never closed, however long it takes: the process stays until the turn ends.
//   3. A session with a background task is never closed (not by the idle limit of 0, not by the timeout),
//      and closes after the task ends.
// `bun scripts/claude-idle-session-e2e.ts`. Writes .buildersbot-build/claude-idle-session-e2e/report.json.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_PROVIDERS, defaultProviderModel } from "@buildersbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { IdlePolicy } from "../src/backend/idle-thread-pool";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/claude-idle-session-e2e");
const root = await mkdtemp(join(tmpdir(), "buildersbot-claude-idle-session-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const claudeConfig = join(home, ".claude");
const projectsDir = join(claudeConfig, "projects", "stand-in");
const pidsDir = join(root, "pids");
const holdFile = join(root, "hold-turn");
const backgroundFile = join(root, "background");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");
const IDLE_MS = 400;
/** The limit is 0, so a session that can close does so when its turn ends. */
const POLICY: IdlePolicy = { idleLimit: 0, releaseAfterMs: IDLE_MS };

// Before the service modules load: the stores and the CLI search read these. The history reader
// finds the transcript in CLAUDE_CONFIG_DIR, as Bun's `homedir()` does not follow HOME.
process.env.HOME = home;
process.env.BUILDERSBOT_CLAUDE_PATH = claudeExecutable;
process.env.CLAUDE_CONFIG_DIR = claudeConfig;
mkdirSync(projectsDir, { recursive: true });
mkdirSync(pidsDir, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { BuildersBotDatabase } = await import("../src/backend/buildersbot-database");

// The stand-in for the Claude CLI. A process of an agent session writes its pid in `pids/`, and answers
// each message with the markers (alpha, beta, gamma, hold, task) of the messages in its transcript. A message
// with "hold" keeps the turn open while `hold-turn` exists. A message with "task" ends its turn with one
// background task running, which ends when `background` exists.
const STAND_IN_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.302 (Claude Code)\\n");
  process.exit(0);
}
const option = (name) => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(name + "="));
  if (index < 0) return null;
  return args[index] === name ? (args[index + 1] ?? null) : args[index].slice(name.length + 1);
};
const sessionId = option("--resume") ?? option("--session-id") ?? randomUUID();
const isAgentSession = !args.includes("--tools=");
const transcript = join(${JSON.stringify(projectsDir)}, sessionId + ".jsonl");
if (isAgentSession) fs.writeFileSync(join(${JSON.stringify(pidsDir)}, process.pid + "." + (option("--resume") ? "resumed" : "new") + "." + sessionId), "");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let parentUuid = null;
const save = (entry) => {
  fs.appendFileSync(transcript, JSON.stringify({ ...entry, parentUuid, sessionId, timestamp: new Date().toISOString(), isSidechain: false }) + "\\n");
  parentUuid = entry.uuid;
};
const frame = (message) => ({ ...message, parent_tool_use_id: null, session_id: sessionId });
const textOf = (message) => {
  const content = message.message?.content;
  return Array.isArray(content) ? content.filter((block) => block && block.type === "text").map((block) => block.text).join(" ") : String(content ?? "");
};
const MARKERS = /\\b(alpha|beta|gamma|hold|task)\\b/g;
/** The markers of the user messages that the transcript held before this message. */
const earlier = () => {
  if (!fs.existsSync(transcript)) return [];
  const found = [];
  for (const line of fs.readFileSync(transcript, "utf8").split("\\n")) {
    if (!line) continue;
    const entry = JSON.parse(line);
    if (entry.type === "user") for (const marker of textOf(entry).match(MARKERS) ?? []) found.push(marker);
  }
  return found;
};
const answer = (message, text) => {
  save({ type: "user", uuid: message.uuid, message: message.message });
  write(frame({ type: "stream_event", uuid: randomUUID(), user_message_uuid: message.uuid, user_message_uuids: [message.uuid],
    event: { type: "message_start", message: { id: "msg_" + message.uuid, type: "message", role: "assistant", content: [] } } }));
  write(frame({ type: "stream_event", uuid: randomUUID(),
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } }));
  const uuid = randomUUID();
  const reply = { id: "msg_" + message.uuid, type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
    content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
  save({ type: "assistant", uuid, message: reply });
  write(frame({ type: "assistant", uuid, message: reply, user_message_uuid: message.uuid }));
  write(frame({ type: "result", subtype: "success", is_error: false, result: text, uuid: randomUUID(),
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 },
    permission_denials: [] }));
};
const turn = (message) => {
  const text = textOf(message);
  const previous = earlier();
  const now = text.match(MARKERS) ?? [];
  const reply = "Seen: [" + previous.join(",") + "] now: [" + now.join(",") + "]";
  if (isAgentSession && now.includes("hold")) {
    const waiting = setInterval(() => {
      if (fs.existsSync(${JSON.stringify(holdFile)})) return;
      clearInterval(waiting);
      answer(message, reply);
    }, 50);
    return;
  }
  // The CLI reports a task that the turn started before the turn's result.
  if (isAgentSession && now.includes("task"))
    write(frame({ type: "system", subtype: "background_tasks_changed", uuid: randomUUID(), tasks: [{ id: "task-1" }] }));
  answer(message, reply);
  if (isAgentSession && now.includes("task")) {
    const ending = setInterval(() => {
      if (!fs.existsSync(${JSON.stringify(backgroundFile)})) return;
      clearInterval(ending);
      write(frame({ type: "system", subtype: "background_tasks_changed", uuid: randomUUID(), tasks: [] }));
    }, 50);
  }
};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.type === "control_request")
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    else if (message.type === "user") turn(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

/**
 * The real Claude client with the idle policy of this check. Only the account, usage and model reads
 * are answered here: the real ones run `claude auth status` or a probe query.
 */
class ClaudeStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "claude";
  readonly contextCompaction = "native";
  readonly #real: InstanceType<typeof ClaudeAgentClient>;
  readonly readHistory: ReadProviderHistory;

  constructor(cli: ClaudeCliInfo) {
    super();
    this.#real = new ClaudeAgentClient(cli);
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => this.emit("notification", notification));
    this.#real.on("request", (request) => this.emit("request", request));
    this.#real.on("diagnostic", (message) => this.emit("diagnostic", message));
    this.#real.on("exit", (error) => this.emit("exit", error));
  }

  get running(): boolean {
    return this.#real.running;
  }

  start(): void {
    this.#real.start();
  }

  stop() {
    return this.#real.stop();
  }

  canReleaseProcess = () => this.#real.canReleaseProcess();

  /** The service gives the policy of the memory of this computer. This check fixes its own. */
  useIdlePolicy(_policy: () => IdlePolicy | null): void {
    this.#real.useIdlePolicy(() => POLICY);
  }

  releaseThread(externalThreadId: string) {
    return this.#real.releaseThread(externalThreadId);
  }

  releaseIdleThreads() {
    return this.#real.releaseIdleThreads();
  }

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number) {
    if (!this.#real.running) return this.#real.request(method, params, decoder, timeoutMs);
    switch (method) {
      case "account/read":
        return providerSync(() => decoder({ account: { type: "claude", email: "claude@example.com" } }));
      case "account/rateLimits/read":
        return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
      case "model/list":
        return providerSync(() => decoder({ data: [{ model: CLAUDE_MODEL, displayName: "Claude" }] }));
      default:
        return this.#real.request(method, params, decoder, timeoutMs);
    }
  }

  notify(): void {
    this.#real.notify();
  }

  respond(id: RequestId, result: unknown): void {
    this.#real.respond(id, result);
  }

  respondError(id: RequestId, error: Parameters<AgentClient["respondError"]>[1]): void {
    this.#real.respondError(id, error);
  }
}

const report: {
  steps: { [step: string]: unknown };
  passed: boolean;
  error?: string;
} = { steps: {}, passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Waits for a state of the service, of its database or of the stand-in. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await sleep(25);
  }
}

/** The sessions that the stand-in started, with whether their process still runs. */
function sessionProcesses() {
  return readdirSync(pidsDir)
    .map((name) => {
      const [pid, mode, sessionId] = name.split(".");
      const alive = (() => {
        try {
          process.kill(Number(pid), 0);
          return true;
        } catch {
          return false;
        }
      })();
      return {
        pid: Number(pid),
        mode: mode === "resumed" ? ("resumed" as const) : ("new" as const),
        sessionId: sessionId ?? "",
        alive,
      };
    })
    .sort((left, right) => left.pid - right.pid);
}
const aliveCount = () => sessionProcesses().filter((entry) => entry.alive).length;

const database = new BuildersBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "claude",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
  busyMessageMode: () => "steer",
  clientFactory: (_provider, cli) => new ClaudeStandIn(cli),
});
const connection: { db: DatabaseSync | null } = { db: null };
/** Opened on first use: the database file exists after `initialize`. */
const sqlite = () => {
  connection.db ??= new DatabaseSync(database.path);
  return connection.db;
};
/** The assistant messages of the chat, in order. */
const assistantTexts = (threadId: string): string[] =>
  sqlite()
    .prepare(
      `SELECT json_extract(message_json, '$.text') AS text FROM projection_thread_messages
       WHERE thread_id = ? AND author = 'assistant' ORDER BY created_at, ordinal`,
    )
    .all(threadId)
    .map((row) => String(row.text));
const settled = (agentId: string) =>
  !agents.listQueue(agentId).deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Idle session",
      description: "Checks that an idle Claude session closes and opens again.",
      avatarSeed: "idle-session",
      avatarHue: null,
      initialMessage: "alpha",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  const threadId = await waitFor("the chat thread", () => store.list().find((item) => item.id === agent.id)?.threadId);
  await waitFor("the first answer", () => assistantTexts(threadId).length >= 1 && settled(agent.id));

  // 1. The session closes after its turn, and the next message opens it again with its history.
  await waitFor("the idle session to close", () => sessionProcesses().length >= 1 && aliveCount() === 0);
  const firstProcess = sessionProcesses()[0];
  assert.ok(firstProcess && firstProcess.mode === "new", "The first process started a new session.");
  report.steps.closedAfterFirstTurn = sessionProcesses();
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "beta" }));
  await waitFor(
    "the answer after the session opened again",
    () => assistantTexts(threadId).length >= 2 && settled(agent.id),
  );
  const reopened = sessionProcesses().filter((entry) => entry.mode === "resumed");
  assert.ok(reopened.length >= 1, "The session opened again with --resume.");
  assert.ok(
    reopened.every((entry) => entry.sessionId === firstProcess.sessionId),
    "It opened again from the same session id.",
  );
  const afterReopen = assistantTexts(threadId);
  report.steps.afterReopen = afterReopen;
  assert.ok(
    afterReopen[1]?.includes("Seen: [alpha]") && afterReopen[1]?.includes("now: [beta]"),
    `The agent remembers the earlier message: ${afterReopen[1]}`,
  );
  assert.equal(afterReopen.length, 2, "Each answer is in the chat one time, with no extra message or error.");
  await waitFor("the session to close again", () => aliveCount() === 0);

  // 2. A turn that runs is never closed, however long it takes.
  writeFileSync(holdFile, "");
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "hold" }));
  await waitFor("the held turn to start", () => aliveCount() === 1);
  await sleep(IDLE_MS * 4);
  assert.equal(aliveCount(), 1, "The process of a running turn stays open past the idle time.");
  assert.equal(assistantTexts(threadId).length, 2, "The held turn has not answered yet.");
  report.steps.heldTurnAliveAfterMs = IDLE_MS * 4;
  await rm(holdFile);
  await waitFor("the held turn to end", () => assistantTexts(threadId).length >= 3 && settled(agent.id));
  assert.ok(assistantTexts(threadId)[2]?.includes("Seen: [alpha,beta]"), "The reopened session still has the history.");
  await waitFor("the session to close after the held turn", () => aliveCount() === 0);

  // 3. A session with a background task never closes, and closes after the task ends.
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "task" }));
  await waitFor("the turn with the task to end", () => assistantTexts(threadId).length >= 4 && settled(agent.id));
  await sleep(IDLE_MS * 5);
  assert.equal(
    aliveCount(),
    1,
    "The process with a background task stays open, over the limit of 0 and past the timeout.",
  );
  report.steps.backgroundTaskAliveAfterMs = IDLE_MS * 5;
  writeFileSync(backgroundFile, "");
  await waitFor("the session to close after the task ends", () => aliveCount() === 0, 15_000);
  assert.equal(assistantTexts(threadId).length, 4, "The chat has no extra message from the closes.");
  report.steps.processes = sessionProcesses();
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  connection.db?.close();
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
