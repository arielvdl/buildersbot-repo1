// Checks that an agent can answer the quick chat agent with `buildersbot.send_message`, and only that.
// The quick chat agent is in no list, so a message to it was refused as an unknown agent, and the answer to
// its question never arrived. It takes one kind of message now: the answer to a question that it sent to the
// caller from a conversation that is still open, that the caller has not answered. The check runs the real
// `AgentService`, mailbox, tool router and MCP bridge on a temporary profile. The agents are turns of a fake
// bundled Builders CLI (`provider-fakes/agents/cultura-builder-turn.ts`) that calls the tools that a prompt
// names, over the MCP server that the app gave its session, so each call goes through the real router.
//   1. The quick chat agent asks a helper from a conversation. The helper answers with `send_message` and the
//      `replyToMessageId` of the prompt. The answer is delivered, is a message of that conversation, and runs
//      there; after it the question and the answer are ended and the queue of the quick chat agent is empty.
//   2. A question that no one answered, from an open conversation, is answered by the helper the same way.
//   3. Everything else is still an unknown agent, and no message reaches the quick chat agent: no `replyToMessageId`,
//      the id of a message that was sent to another agent, an id that does not exist, an answer that is already
//      given, a question that wants no answer, a message of the helper's own, an agent that was not asked, an
//      answer with a second recipient, and an answer to a conversation that was closed.
//   4. `list_agents` and `interrupt_agent` of another agent do not find it, and the agent list has no row for it.
//   5. The mailbox rule: a repeat of the same tool call is not a second answer.
//   6. The Team API, on loopback, never carried the quick chat agent: not in its list, not in an event frame,
//      and its id routes answer 404, also after the answers.
// `bun run test:quick-chat-replies`. Writes .buildersbot-build/quick-chat-replies-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent, type QueuedMessageReceipt } from "@buildersbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@buildersbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@buildersbot/contracts/team-protocol";
import { teamCapabilitiesForProtocol } from "@buildersbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V9 } from "@buildersbot/contracts/team-protocol/v9";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { BuildersBotDatabase } from "../src/backend/buildersbot-database";
import { CULTURA_BUILDER_GATEWAY, serializeCulturaBuilderSession } from "../src/backend/cultura-builder-auth";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { installFakeAgent, readJsonl } from "./provider-fakes/host";

// The main process imports Electron for its windows and IPC. No check here opens a window.
plugin({
  name: "quick-chat-replies-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => "0.0.0-e2e", isPackaged: false, on: () => undefined },
        BrowserWindow: Object.assign(class extends Inert {}, { getAllWindows: () => [] }),
        MessageChannelMain: class extends Inert {},
        Notification: Object.assign(class extends Inert {}, { isSupported: () => false }),
        clipboard: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: {},
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});

const { TeamApiServer } = await import("../src/main/team-api-server");
const { TeamStore } = await import("../src/main/team-store");

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/quick-chat-replies-e2e");
const OWNER = { username: "owner-user", password: "owner-password-123" };
const HOST_VERSION = "0.0.0-e2e";
const COMPANY = "Quick Chat Replies Lab";
const ACCESS = "access-quick-chat-replies";
const WAIT_MS = 30_000;
const realFetch = globalThis.fetch;

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "The page and the agent strip as drawn: no renderer runs here. The strip of the quick chat reads outgoing exchange rows and a queue that the conversation of a side thread does not carry (see the report of the change), so this check does not say that the strip closes.",
    "A real provider: the agents are turns of a fake CLI that calls the tools of a prompt.",
  ],
  steps: [],
};

async function step<T>(name: string, run: () => Promise<T> | T): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  try {
    const value = await run();
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** The gateway of the fake Hub. A request to loopback goes through; any other address fails, so no check reaches the network. */
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    if (url === `${CULTURA_BUILDER_GATEWAY}/session`) return jsonResponse(200, { active: true, empresa: COMPANY });
    throw new Error(`The check reached the network: ${url}`);
  },
  { preconnect: () => undefined },
);

const unused = () => Effect.die(new Error("Not used by this check."));
const agentBrowser: AgentBrowserHost = {
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
const teamBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: unused,
  activate: unused,
  navigate: unused,
  reload: unused,
  stop: unused,
  takeUserControl: unused,
  releaseUserControl: () => {},
  releaseUserControlHeldBy: () => {},
  close: unused,
  capturePreview: unused,
  setVisible: unused,
  getDisplayState: () => ({ tabs: [], activeTabId: null }),
  loadUrl: unused,
  isPrivate: () => false,
  startView: unused,
  dispatchViewInput: unused,
  copyViewSelection: unused,
  importSignIn: unused,
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface LogEntry {
  event: string;
  sessionId?: string;
  text?: string;
  name?: string;
  isError?: boolean;
}

/** One line of a prompt that makes the fake turn call a Builders Bot tool. */
const toolLine = (name: string, args: unknown) => `@@tool ${JSON.stringify({ name, arguments: args })}`;
/** A question to `to`. `@@answer` in it makes the fake turn of `to` answer with the reply protocol of its prompt. */
const question = (to: string, text: string, expectsReply = true) =>
  toolLine("send_message", { recipientAgentIds: [to], text, expectsReply });

const root = await mkdtemp(join(tmpdir(), "buildersbot-quick-chat-replies-"));
const profile = join(root, "profile");
const log = join(root, "builders.jsonl");

async function main(): Promise<void> {
  const executable = join(root, "builders", "bin", "opencode");
  process.env.FAKE_LOG = log;
  await installFakeAgent(executable, "cultura-builder-turn");
  const session = serializeCulturaBuilderSession({
    access: ACCESS,
    refresh: "refresh-quick-chat-replies",
    expires: Date.now() + 3_600_000,
    empresa: COMPANY,
  });

  const database = new BuildersBotDatabase(join(profile, "user-data"));
  const store = new AgentStore(join(profile, "user-data"), join(profile, "home"), database);
  const mailbox = new MailboxStore(join(profile, "user-data"), store.sharedRoot, store.database);
  const sidebar = new SidebarLayoutStore(join(profile, "user-data", "sidebar-layout.json"));
  const team = new TeamStore(join(profile, "user-data", "buildersbot-team-server-v2.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(team.initialize());
  await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const agents = new AgentService({
    store,
    mailbox,
    browser: agentBrowser,
    sidebarLayout: sidebar,
    preferredProvider: "cultura-builder",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "cultura-builder"),
    bundledExecutables: { opencode: executable },
    credentials: {
      ...NO_PROVIDER_CREDENTIALS,
      apiKey: (provider) => (provider === "cultura-builder" ? session : null),
    },
    // The reviewer is a model call of its own; this check is about the tools, not about the reviewer.
    securityGuard: () => ({
      enabled: false,
      scope: "all",
      mode: "annotate",
      minLevel: "suspicious",
      model: null,
      timeoutMs: 20_000,
    }),
  });
  const events: AgentEvent[] = [];
  agents.on("event", (event) => events.push(event));
  await runCauseEffect(agents.initialize());
  const server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: HOST_VERSION,
    hiddenAgents: agents,
  });
  const port = await Effect.runPromise(server.start());
  const sockets: WebSocket[] = [];
  try {
    await steps({ agents, store, mailbox, events, port, sockets });
  } finally {
    for (const socket of sockets) socket.close();
    await Effect.runPromise(server.stop()).catch(() => undefined);
    await runCauseEffect(agents.stop()).catch(() => undefined);
    database.close();
  }
}

interface Host {
  agents: AgentService;
  store: AgentStore;
  mailbox: MailboxStore;
  events: AgentEvent[];
  port: number;
  sockets: WebSocket[];
}

async function steps(host: Host): Promise<void> {
  const { agents, store, mailbox, events, port, sockets } = host;

  // ---- helpers ---------------------------------------------------------------------------------------
  /** Waits for a value that `read` gives. A value that does not come is a failure. */
  async function until<T>(
    label: string,
    read: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  ) {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const value = await read();
      if (value !== null && value !== undefined && value !== false) return value;
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}.`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  }
  const toolEntries = async () => (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "tool");
  const promptEntries = async () => (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "prompt");

  const turnEnded = (taskId: string) =>
    until(`the turn of ${taskId} ends`, () =>
      events.some(
        (event) =>
          event.type === "agent-tasks-changed" &&
          event.snapshot.tasks.some((task) => task.id === taskId && task.state === "idle" && task.outcome !== null),
      ),
    );

  /** Starts one conversation of the quick chat agent as the local IPC does, and waits for its turn to end. */
  const converse = async (agentId: string, text: string) => {
    const task = await runCauseEffect(agents.startTask({ agentId, text }, undefined, undefined, "quick-chat"));
    await turnEnded(task.id);
    return task;
  };

  /** A user message to an ordinary agent, whose turn calls the tools in `lines`. Gives the answers of those calls. */
  async function runAs(agentId: string, ...lines: string[]): Promise<LogEntry[]> {
    const before = (await toolEntries()).length;
    await runCauseEffect(agents.sendMessage({ agentId, text: lines.join("\n") }));
    const wanted = before + lines.length;
    return until(`${lines.length} tool answer(s)`, async () => {
      const all = await toolEntries();
      return all.length >= wanted ? all.slice(before, wanted) : null;
    });
  }

  const receiptOf = (entry: LogEntry | undefined): QueuedMessageReceipt => {
    assert.ok(entry, "No tool answer.");
    assert.equal(entry.isError, false, `The tool call failed: ${entry.text}`);
    return JSON.parse(entry.text ?? "{}");
  };
  /** The receipts of the `send_message` calls that worked, with the first recipient of each. */
  const sentMessages = async () =>
    (await toolEntries())
      .filter((entry) => entry.name === "send_message" && entry.isError === false)
      .map((entry) => receiptOf(entry));

  /** A question of the quick chat agent that was sent from `taskId` and has no answer: written to the mailbox as the router writes it. */
  async function openQuestion(taskId: string, to: string, quickId: string, expectsReply = true): Promise<string> {
    const receipt = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: quickId },
        recipientAgentIds: [to],
        text: "A question that waits.",
        replyToMessageId: null,
        senderTaskId: taskId,
        ...(expectsReply ? {} : { expectsReply: false }),
      }),
    );
    const delivery = receipt.deliveries[0];
    assert.ok(delivery);
    // The recipient got it and its turn ended, with no answer.
    await runCauseEffect(mailbox.markStarting(delivery.id));
    await runCauseEffect(mailbox.markTerminal(delivery.id, "completed"));
    return receipt.messageId;
  }

  const refusedAs = async (what: string, agentId: string, quickId: string, args: unknown) => {
    const [answer] = await runAs(agentId, toolLine("send_message", args));
    assert.equal(answer?.isError, true, `${what} was not refused: ${answer?.text}`);
    assert.ok(
      answer.text?.includes(`Unknown Builders Bot agent: ${quickId}`),
      `${what} was refused for another reason: ${answer.text}`,
    );
    assert.equal(
      agents.listQueue(quickId).deliveries.length,
      0,
      `${what}: a message reached the queue of the quick chat agent.`,
    );
    return what;
  };

  // ---- the Team API listens from the start ------------------------------------------------------------
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V9),
      [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
      [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).join(","),
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await realFetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  };
  const login = await call("POST", TEAM_API_ROUTES.auth.login, undefined, OWNER);
  assert.equal(login.status, 200, `Sign-in returned ${login.status}.`);
  const token = String(JSON.parse(login.text).sessionToken);
  const socket = new WebSocket(`ws://127.0.0.1:${port}${TEAM_API_ROUTES.events}`, [
    TEAM_PROTOCOL_V1_WEBSOCKET,
    `buildersbot-token.${token}`,
  ]);
  sockets.push(socket);
  const frames: string[] = [];
  socket.addEventListener("message", (event) => frames.push(String(event.data)));
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
  });
  socket.send(
    JSON.stringify({
      type: "agent-event-scope",
      includeConversations: true,
      capabilities: [...teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9)],
    }),
  );

  // ---- setup -------------------------------------------------------------------------------------------
  const setup = await step("setup: the quick chat agent, a helper and a stranger", async () => {
    const providers = agents.getStatus().providers ?? [];
    assert.ok(
      providers.some((row) => row.id === "cultura-builder" && row.state === "available"),
      "The fake Cultura Builder provider is not available.",
    );
    const quick = (await runCauseEffect(agents.ensureQuickChat())).agent;
    assert.equal(quick.quickChat, true);
    const helper = await runCauseEffect(
      agents.createAgentProfile({ name: "Helper", description: "", avatarSeed: "helper", avatarHue: null }),
    );
    const stranger = await runCauseEffect(
      agents.createAgentProfile({ name: "Stranger", description: "", avatarSeed: "stranger", avatarHue: null }),
    );
    assert.ok(
      !agents.listAgents().some((agent) => agent.id === quick.id),
      "The agent list has a row for the quick chat agent.",
    );
    return { quickId: quick.id, helperId: helper.id, strangerId: stranger.id };
  });
  const { quickId, helperId, strangerId } = setup;

  // ---- 1. the real flow --------------------------------------------------------------------------------
  const real = await step(
    "1. the quick chat agent asks, the helper answers with send_message, and the answer arrives",
    async () => {
      const task = await converse(quickId, question(helperId, "@@answer Result: the tests pass."));
      // The question is the call whose recipient is the helper; the answer is the one whose recipient is the quick chat agent.
      const asked = await until("the question of the quick chat agent", async () =>
        (await sentMessages()).find((receipt) => receipt.deliveries[0]?.recipientAgentId === helperId),
      );
      const answer = await until("the helper's answer", async () => {
        const failed = (await toolEntries()).find((entry) => entry.isError === true);
        assert.equal(failed, undefined, `A tool call was refused: ${failed?.text}`);
        return (await sentMessages()).find((receipt) => receipt.deliveries[0]?.recipientAgentId === quickId);
      });
      const answerDelivery = answer.deliveries[0];
      assert.ok(answerDelivery);
      assert.equal(answerDelivery.recipientAgentId, quickId);
      // The answer ends in the conversation that asked, not in the own chat of the quick chat agent.
      const ended = await until("the answer is read by the quick chat agent", () => {
        const found = mailbox.deliveryForMessage(answer.messageId, quickId);
        return found?.delivery.status === "completed" ? found : null;
      });
      assert.equal(
        mailbox.taskIdForDelivery(ended.delivery.id),
        task.id,
        "The answer did not run in the conversation.",
      );
      const prompts = await promptEntries();
      assert.ok(
        prompts.some(
          (entry) =>
            entry.text?.includes(`This replies to message: ${asked.messageId}`) &&
            entry.text.includes("Result: the tests pass."),
        ),
        "The quick chat agent never read the answer.",
      );
      await turnEnded(task.id);
      // Nobody waits any more: the question and the answer ended, and the queue of the quick chat agent is empty.
      const questionDelivery = mailbox.deliveryForMessage(asked.messageId, helperId);
      assert.equal(questionDelivery?.delivery.status, "completed");
      assert.equal(agents.listQueue(quickId).deliveries.length, 0, "A message still waits in the queue.");
      // The answer is a message of that conversation.
      assert.ok(
        agents.readTask(quickId, task.id).messages.some((message) => message.text.includes("Result: the tests pass.")),
        "The conversation holds no answer.",
      );
      return { questionId: asked.messageId, answerId: answer.messageId, taskId: task.id };
    },
  );

  // ---- 2. an open question from an open conversation --------------------------------------------------
  const open = await step(
    "2. a question with no answer, from an open conversation, is answered the same way",
    async () => {
      const conversation = await converse(quickId, "A plain question");
      const questionId = await openQuestion(conversation.id, helperId, quickId);
      const [answer] = await runAs(
        helperId,
        toolLine("send_message", {
          recipientAgentIds: [quickId],
          replyToMessageId: questionId,
          text: "Result: done.",
          expectsReply: false,
        }),
      );
      const receipt = receiptOf(answer);
      const ended = await until("the answer is read", () => {
        const found = mailbox.deliveryForMessage(receipt.messageId, quickId);
        return found?.delivery.status === "completed" ? found : null;
      });
      assert.equal(mailbox.taskIdForDelivery(ended.delivery.id), conversation.id);
      return { taskId: conversation.id, questionId, answerId: receipt.messageId };
    },
  );

  // ---- 3. everything else stays unknown ---------------------------------------------------------------
  await step("3. any other message to the quick chat agent is still an unknown agent", async () => {
    const conversation = await converse(quickId, "Another plain question");
    const forHelper = await openQuestion(conversation.id, helperId, quickId);
    const forStranger = await openQuestion(conversation.id, strangerId, quickId);
    const noAnswerWanted = await openQuestion(conversation.id, helperId, quickId, false);
    const results: string[] = [];
    results.push(
      await refusedAs("no replyToMessageId", helperId, quickId, { recipientAgentIds: [quickId], text: "hello" }),
    );
    results.push(
      await refusedAs("a reply to a message that was sent to another agent", helperId, quickId, {
        recipientAgentIds: [quickId],
        replyToMessageId: forStranger,
        text: "Result: x",
      }),
    );
    results.push(
      await refusedAs("a reply to an id that does not exist", helperId, quickId, {
        recipientAgentIds: [quickId],
        replyToMessageId: "no-such-message",
        text: "Result: x",
      }),
    );
    results.push(
      await refusedAs("an empty replyToMessageId", helperId, quickId, {
        recipientAgentIds: [quickId],
        replyToMessageId: "",
        text: "Result: x",
      }),
    );
    results.push(
      await refusedAs("a reply to a question that wants no answer", helperId, quickId, {
        recipientAgentIds: [quickId],
        replyToMessageId: noAnswerWanted,
        text: "Result: x",
      }),
    );
    results.push(
      await refusedAs("a reply to a message of the helper's own", helperId, quickId, {
        recipientAgentIds: [quickId],
        replyToMessageId: open.answerId,
        text: "Result: x",
      }),
    );
    results.push(
      await refusedAs("a reply to a question that is already answered", helperId, quickId, {
        recipientAgentIds: [quickId],
        replyToMessageId: real.questionId,
        text: "Result: x",
      }),
    );
    results.push(
      await refusedAs("a reply to a question that step 2 answered", helperId, quickId, {
        recipientAgentIds: [quickId],
        replyToMessageId: open.questionId,
        text: "Result: x",
      }),
    );
    results.push(
      await refusedAs("an agent that was not asked", strangerId, quickId, {
        recipientAgentIds: [quickId],
        replyToMessageId: forHelper,
        text: "Result: x",
      }),
    );
    results.push(
      await refusedAs("an answer with a second recipient", helperId, quickId, {
        recipientAgentIds: [quickId, strangerId],
        replyToMessageId: forHelper,
        text: "Result: x",
      }),
    );
    // The same open question is still open after all of these, and is answered by the one that was asked.
    const [good] = await runAs(
      helperId,
      toolLine("send_message", {
        recipientAgentIds: [quickId],
        replyToMessageId: forHelper,
        text: "Result: now.",
        expectsReply: false,
      }),
    );
    receiptOf(good);
    results.push("the asked agent answers once");
    // The conversation is closed before the answer comes: the answer has nowhere to go.
    const closing = await converse(quickId, "A conversation that closes");
    const forClosed = await openQuestion(closing.id, helperId, quickId);
    await runCauseEffect(agents.closeTask({ agentId: quickId, taskId: closing.id }));
    results.push(
      await refusedAs("an answer to a conversation that was closed", helperId, quickId, {
        recipientAgentIds: [quickId],
        replyToMessageId: forClosed,
        text: "Result: x",
      }),
    );
    return { refused: results };
  });

  // ---- 4. no list, no interrupt -----------------------------------------------------------------------
  await step("4. list_agents and interrupt_agent of another agent do not find the quick chat agent", async () => {
    const [listed, interrupted] = await runAs(
      helperId,
      toolLine("list_agents", {}),
      // `interrupt_agent` is not a direct tool: an agent reaches it through `tool_call`.
      toolLine("tool_call", { name: "buildersbot.interrupt_agent", arguments: { agentId: quickId } }),
    );
    assert.equal(listed?.isError, false, `list_agents failed: ${listed?.text}`);
    assert.ok(!listed.text?.includes(quickId), "list_agents carried the quick chat agent.");
    assert.ok(listed.text?.includes(strangerId), "list_agents lacks an ordinary agent.");
    assert.equal(interrupted?.isError, true, "interrupt_agent reached the quick chat agent.");
    assert.ok(
      interrupted.text?.includes(`Unknown Builders Bot agent: ${quickId}`),
      `Another error: ${interrupted.text}`,
    );
    assert.ok(!agents.listAgents().some((agent) => agent.id === quickId));
    return { listAgentsRows: agents.listAgents().length };
  });

  // ---- 5. the mailbox rule ----------------------------------------------------------------------------
  await step("5. a repeat of the same tool call is not a second answer", async () => {
    const conversation = await converse(quickId, "A question for the mailbox rule");
    const questionId = await openQuestion(conversation.id, helperId, quickId);
    assert.equal(mailbox.openRequestThread(quickId, helperId, questionId, "call-1"), conversation.id);
    const sent = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: helperId },
        recipientAgentIds: [quickId],
        text: "Result: once.",
        replyToMessageId: questionId,
        expectsReply: false,
        idempotencyKey: "call-1",
      }),
    );
    assert.ok(sent.messageId);
    assert.equal(
      mailbox.openRequestThread(quickId, helperId, questionId, "call-1"),
      conversation.id,
      "A repeat of the call was read as a second answer.",
    );
    assert.equal(
      mailbox.openRequestThread(quickId, helperId, questionId, "call-2"),
      null,
      "A second call was read as the first one.",
    );
    assert.equal(mailbox.openRequestThread(quickId, helperId, questionId), null);
    return { checked: 3 };
  });

  // ---- 6. the Team API ----------------------------------------------------------------------------------
  await step("6. the Team API never carried the quick chat agent, during or after the answers", async () => {
    // An ordinary agent works after the answers, so the socket is known to be live and to carry such events.
    await runCauseEffect(agents.sendMessage({ agentId: strangerId, text: "Hello" }));
    await until("an event frame for the ordinary agent", () => frames.some((frame) => frame.includes(strangerId)));
    assert.ok(frames.length > 0);
    // A frame is about the quick chat agent when an object in it is that agent or names it as its `agentId`. The id inside
    // a text is another matter: the text of a message to an ordinary agent holds it, and the error of a refused tool call
    // names the agent that it did not find. Those frames are counted, not accepted without a word.
    const aboutAgent = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(aboutAgent);
      if (typeof value !== "object" || value === null) return false;
      return Object.entries(value).some(
        ([key, inner]) =>
          ((key === "id" || key === "agentId" || key === "botId") && inner === quickId) || aboutAgent(inner),
      );
    };
    const about = frames.filter((frame) => aboutAgent(JSON.parse(frame)));
    assert.equal(
      about.length,
      0,
      `An event frame was about the quick chat agent: ${about.map((frame) => frame.slice(0, 300)).join(" || ")}`,
    );
    const errorFramesWithId = frames.filter(
      (frame) => frame.includes(quickId) && JSON.parse(frame).type === "error",
    ).length;
    const list = await call("GET", TEAM_API_ROUTES.agents.all, token);
    assert.equal(list.status, 200);
    assert.ok(!list.text.includes(quickId), "GET /v1/agents carried the quick chat agent.");
    assert.ok(list.text.includes(strangerId), "The ordinary agent is not in the list.");
    const missing: Record<string, number> = {};
    for (const [label, method, path, body] of [
      ["agent", "GET", `${TEAM_API_ROUTES.agents.all}/${quickId}`, undefined],
      ["messages", "POST", TEAM_API_ROUTES.agent.messages(quickId), { text: "x" }],
      ["conversation", "GET", `${TEAM_API_ROUTES.agents.all}/${quickId}/conversation`, undefined],
      ["tasks", "GET", `${TEAM_API_ROUTES.agents.all}/${quickId}/tasks`, undefined],
      ["queue", "GET", `${TEAM_API_ROUTES.agents.all}/${quickId}/queue`, undefined],
      ["interrupt", "POST", TEAM_API_ROUTES.agent.interrupt(quickId), { turnId: "x" }],
    ] as const) {
      const answer = await call(method, path, token, body);
      assert.equal(answer.status, 404, `${label} answered ${answer.status}, not 404.`);
      missing[label] = answer.status;
    }
    const hiddenList = await call("POST", "/v1/hidden-agents", token, {});
    assert.ok(!hiddenList.text.includes(quickId), "The list of hidden agents carried the quick chat agent.");
    return { frames: frames.length, errorFramesNamingTheId: errorFramesWithId, ...missing };
  });

  assert.equal(store.list().filter((agent) => agent.quickChat === true).length, 1, "More than one quick chat agent.");
}

try {
  await main();
  report.passed = true;
} catch (error) {
  process.stderr.write(`${messageOf(error)}\n`);
  // The fake provider's log says what each turn got and what each tool answered.
  const tail = (await readJsonl<LogEntry>(log)).slice(-12).map((entry) => ({
    ...entry,
    ...(entry.text === undefined ? {} : { text: entry.text.slice(-400) }),
  }));
  process.stderr.write(
    `Provider log, last ${tail.length} entries:\n${tail.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
}
