// Checks the host side of the quick chat on the real `AgentService`, `AgentStore` and database of a
// temporary profile. Part 1: the model rule, `ensureQuickChat`, and what keeps the agent out of every list.
//   1. `quickChatDefaultModel`: Cultura Builder with its fast model, without it, another provider, nothing.
//   2. `ensureQuickChat` makes the agent once, hidden from birth, with the default access, 3 tasks at a
//      time, no automation, no early acknowledgement and no account of its own. It calls no model and
//      starts no provider, and no `agents-changed` event ever carries it.
//   3. Calls at once make one agent, and a restart keeps `quickChat`.
//   4. No list shows it (`listAgents`, `listHiddenAgents`), and a restore, a copy and a delete find no agent.
//   5. A model that left the catalog moves the agent to the rule; a call after that changes nothing.
//   6. With no provider that can run, a first call fails and makes no agent; an existing agent stays.
//   7. The preload decoder refuses an answer whose agent is not the quick chat one.
// Part 1 stands the provider runtime in: the catalog and the status are the ones of the test, so no
// provider CLI starts and no model is called. `AgentService.initialize` is not run.
// Part 2 runs the service on a fake bundled Builders CLI (`provider-fakes/agents/cultura-builder-turn.ts`) and
// checks the way in and the ways that stay closed:
//   8. A message sent as the local IPC does (`via: "quick-chat"`) runs a real turn: the drain does not hold
//      it as hidden. The same call with no `via`, and a `via` for an ordinary hidden agent, are refused.
//   9. The Dynamic Island action and a routine run find no agent to send to.
//  10. The Team API on loopback: the quick chat agent is in no list, no id route answers it, a message to it
//      gets a 404, and no event frame carries its id.
//  11. The 51st open conversation archives the oldest idle one. Nothing is deleted.
// Part 3 starts the service with no provider running and a memory level of its own:
//  12. `warmQuickChat` does nothing before the agent exists and nothing while the memory is low; at `ok` it starts the
//      provider process once, however many calls come at once, and opens no session, no conversation and no model call.
// `bun run test:quick-chat-core`. Writes .buildersbot-build/quick-chat-core-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INPUT_LIMITS } from "@buildersbot/contracts/input-limits";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  type AgentModelOption,
  type AgentProviderId,
  type AgentStatus,
} from "@buildersbot/contracts/ipc";
import { QUICK_CHAT_FAST_MODEL, quickChatDefaultModel } from "@buildersbot/contracts/quick-chat-model";
import { TEAM_API_ROUTES } from "@buildersbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@buildersbot/contracts/team-protocol";
import { teamCapabilitiesForProtocol } from "@buildersbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V9 } from "@buildersbot/contracts/team-protocol/v9";
import { sourceText } from "@buildersbot/i18n/source";
import { plugin } from "bun";
import { Effect } from "effect";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { BuildersBotDatabase } from "../src/backend/buildersbot-database";
import { CULTURA_BUILDER_GATEWAY, serializeCulturaBuilderSession } from "../src/backend/cultura-builder-auth";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { HostMemory, HostMemoryLevel } from "../src/backend/host-memory";
import { MailboxStore } from "../src/backend/mailbox-store";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { decodeQuickChatEnsure } from "../src/preload/quick-chat-decoding";
import { installFakeAgent, readJsonl } from "./provider-fakes/host";

// The main process imports Electron for its windows and IPC. No check here opens a window.
plugin({
  name: "quick-chat-core-electron-boundary",
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
const { performDynamicIslandCriticalAction } = await import("../src/main/dynamic-island-actions");

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/quick-chat-core-e2e");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "The real catalog of a Cultura Builder account. The catalog here is the one of the test, so the id of the fast model is the one the contract names, not the one a gateway lists.",
    "The page: no renderer runs here.",
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

/** One catalog entry. `effort` is the list the model accepts; none means it has no effort setting. */
function model(
  provider: AgentProviderId,
  id: string,
  effort: AgentModelOption["supportedReasoningEfforts"] | null,
  extra: Partial<AgentModelOption> = {},
): AgentModelOption {
  return {
    provider,
    id,
    name: id,
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: effort ?? ["medium"],
    ...(effort === null ? { reasoningEffortConfigurable: false } : {}),
    ...extra,
  };
}

const BUILDER_FAST = model("cultura-builder", QUICK_CHAT_FAST_MODEL, null);
const BUILDER_AUTO = model("cultura-builder", "cultura-builder/builder-auto", ["medium", "high"]);
const BUILDER_CODE = model("cultura-builder", "cultura-builder/builder-code", ["low", "medium", "high"]);
const CODEX_MODEL = model("codex", "gpt-6-luna", ["low", "medium", "high"], { fastServiceTier: "priority" });
const CLAUDE_MODEL = model("claude", "claude-sonnet-5-5", ["medium", "high"]);

let catalog: AgentModelOption[] = [];
let available = new Set<AgentProviderId>();
/** The providers whose list a CLI gave. `null` means all of them: the checks that do not care. */
let readProviders: Set<AgentProviderId> | null = null;
const providerCalls: string[] = [];

// The runtime of the providers is stood in at two doors: the catalog it lists, and the one call that
// would reach a model (`createProfileClient`, which the quick chat must never make).
const realListModels = ProviderRuntime.prototype.listModels;
const realCreateProfileClient = ProviderRuntime.prototype.createProfileClient;
const realCatalogRead = ProviderRuntime.prototype.catalogRead;
ProviderRuntime.prototype.listModels = () => catalog;
ProviderRuntime.prototype.catalogRead = (provider) => readProviders === null || readProviders.has(provider);
ProviderRuntime.prototype.createProfileClient = (provider) => {
  providerCalls.push(`createProfileClient:${provider}`);
  throw new Error("The quick chat must not call a model.");
};

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

const root = await mkdtemp(join(tmpdir(), "buildersbot-quick-chat-core-"));
const userData = join(root, "user-data");
const home = join(root, "home");

interface Host {
  database: BuildersBotDatabase;
  store: AgentStore;
  agents: AgentService;
  events: AgentEvent[];
}

/** Starts the stores and the service on the profile, as the app does at a launch. The stores only. */
async function startHost(): Promise<Host> {
  const database = new BuildersBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agents = new AgentService({ store, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  // The status of the providers is the test's: a provider is available when the test says so.
  const status = agents.getStatus();
  agents.getStatus = (): AgentStatus => ({
    ...status,
    providers: [...available].map((id) => ({ id, state: "available", version: null, message: null })),
  });
  const events: AgentEvent[] = [];
  agents.on("event", (event) => events.push(event));
  return { database, store, agents, events };
}

async function stopHost(host: Host): Promise<void> {
  await runCauseEffect(host.agents.stop()).catch(() => undefined);
  host.database.close();
}

const ensure = (host: Host) => runCauseEffect(host.agents.ensureQuickChat());
const quickChatRows = (host: Host) => host.store.list().filter((agent) => agent.quickChat === true);

// ---------------------------------------------------------------------------------------------------
// Part 2

const OWNER = { username: "owner-user", password: "owner-password-123" };
const HOST_VERSION = "0.0.0-e2e";
const COMPANY = "Quick Chat Lab";
const ACCESS = "access-quick-chat";
const WAIT_MS = 30_000;
const realFetch = globalThis.fetch;

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

interface Host2 {
  database: BuildersBotDatabase;
  store: AgentStore;
  agents: AgentService;
  server: InstanceType<typeof TeamApiServer>;
  team: InstanceType<typeof TeamStore>;
  port: number;
  events: AgentEvent[];
}

async function runPart2(): Promise<void> {
  const profile = join(root, "part2");
  const executable = join(root, "builders", "bin", "opencode");
  const log = join(root, "builders.jsonl");
  process.env.FAKE_LOG = log;
  await installFakeAgent(executable, "cultura-builder-turn");
  const session = serializeCulturaBuilderSession({
    access: ACCESS,
    refresh: "refresh-quick-chat",
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
    // The reviewer is a model call of its own; this check is about the way in, not about the reviewer.
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
  const host2: Host2 = { database, store, agents, server, team, port, events };
  const sockets: WebSocket[] = [];
  try {
    await partTwoSteps(host2, log, sockets);
  } finally {
    for (const socket of sockets) socket.close();
    await Effect.runPromise(server.stop()).catch(() => undefined);
    await runCauseEffect(agents.stop()).catch(() => undefined);
    database.close();
  }
}

/** Waits for the first event that `pick` accepts, among the ones that came and the ones to come. Fails after `WAIT_MS`: a missing event is a failure. */
function nextEvent<T>(host2: Host2, pick: (event: AgentEvent) => T | null): Promise<T> {
  return new Promise((resolveEvent, reject) => {
    // An event that came before the call counts: a fake turn can end before the caller starts to wait.
    for (const past of host2.events) {
      const picked = pick(past);
      if (picked !== null) {
        resolveEvent(picked);
        return;
      }
    }
    const timer = setTimeout(() => {
      host2.agents.off("event", onEvent);
      const seen = [...new Set(host2.events.map((event) => event.type))];
      reject(new Error(`No event within ${WAIT_MS} ms. Events seen: ${seen.join(" ")}`));
    }, WAIT_MS);
    const onEvent = (event: AgentEvent) => {
      const picked = pick(event);
      if (picked === null) return;
      clearTimeout(timer);
      host2.agents.off("event", onEvent);
      resolveEvent(picked);
    };
    host2.agents.on("event", onEvent);
  });
}

async function partTwoSteps(host2: Host2, log: string, sockets: WebSocket[]): Promise<void> {
  const { agents, store } = host2;
  // The turns of a conversation never reach the events of the agent's own chat: the task list tells when one ends.
  const turnEnded = (taskId: string) =>
    nextEvent(host2, (event) =>
      event.type === "agent-tasks-changed" &&
      event.snapshot.tasks.some((task) => task.id === taskId && task.state === "idle" && task.outcome !== null)
        ? event
        : null,
    );

  /** Starts one conversation as the local IPC does and waits for its turn to end. */
  const converse = async (agentId: string, text: string) => {
    // The wait looks at the events that came before it, so a turn that ends at once is not missed.
    const task = await runCauseEffect(agents.startTask({ agentId, text }, undefined, undefined, "quick-chat"));
    await turnEnded(task.id);
    return task;
  };

  const made = await step("part 2: ensure on the real catalog of the fake CLI", async () => {
    const providers = agents.getStatus().providers ?? [];
    assert.ok(
      providers.some((row) => row.id === "cultura-builder" && row.state === "available"),
      "The fake Cultura Builder provider is not available.",
    );
    const result = await runCauseEffect(agents.ensureQuickChat());
    assert.equal(result.changed, true);
    assert.equal(result.agent.provider, "cultura-builder");
    assert.ok(result.agent.model.startsWith("cultura-builder/"), `The model id is ${result.agent.model}.`);
    return { id: result.agent.id, model: result.agent.model, effort: result.agent.reasoningEffort };
  });
  const quickId = made.id;

  const first = await step("local IPC send: a real turn runs, and the drain does not hold it as hidden", async () => {
    const task = await runCauseEffect(
      agents.startTask({ agentId: quickId, text: "First question" }, undefined, undefined, "quick-chat"),
    );
    // The turn is what proves it: a hold of the drain would keep the message in the queue for good.
    await turnEnded(task.id);
    const prompts = (await readJsonl<{ event: string; text?: string }>(log)).filter(
      (entry) => entry.event === "prompt",
    );
    assert.ok(
      prompts.some((entry) => entry.text?.includes("First question")),
      "The provider never got the message.",
    );
    const listed = agents.listTasks(quickId).tasks.find((candidate) => candidate.id === task.id);
    assert.equal(listed?.state, "idle");
    assert.equal(listed?.hold, null);
    assert.equal(agents.listQueue(quickId).deliveries.length, 0, "A message is still in the queue.");
    return { taskId: task.id, state: listed?.state };
  });

  await step(
    "with no `via`, the same send and start are refused; so is a `via` for an ordinary hidden agent",
    async () => {
      const hiddenText = sourceText("error.backend.recipientHidden");
      const refused = (run: () => Promise<unknown>, label: string) =>
        assert.rejects(
          run,
          (error: unknown) => messageOf(error).includes(hiddenText),
          `${label} was not refused as hidden.`,
        );
      await refused(
        () => runCauseEffect(agents.sendMessage({ agentId: quickId, text: "x" })),
        "sendMessage with no via",
      );
      await refused(
        () => runCauseEffect(agents.sendMessage({ agentId: quickId, text: "x", taskId: first.taskId })),
        "sendMessage to a conversation with no via",
      );
      await refused(() => runCauseEffect(agents.startTask({ agentId: quickId, text: "x" })), "startTask with no via");
      await refused(
        () =>
          runCauseEffect(agents.steerQueuedMessage({ agentId: quickId, deliveryId: "none", expectedTurnId: "none" })),
        "steer with no via",
      );
      await refused(
        () =>
          runCauseEffect(agents.forceQueuedMessage({ agentId: quickId, deliveryId: "none", expectedTurnId: "none" })),
        "force with no via",
      );
      // An ordinary agent that a user hid: the way in of the quick chat does not open it.
      const ordinary = await runCauseEffect(
        store.createAgent({ name: "Ordinary", description: "", avatarSeed: "ordinary", avatarHue: null }),
      );
      store.setHidden(ordinary.id, new Date().toISOString());
      await refused(
        () =>
          runCauseEffect(agents.sendMessage({ agentId: ordinary.id, text: "x" }, undefined, undefined, "quick-chat")),
        "sendMessage to an ordinary hidden agent with via",
      );
      await refused(
        () => runCauseEffect(agents.startTask({ agentId: ordinary.id, text: "x" }, undefined, undefined, "quick-chat")),
        "startTask to an ordinary hidden agent with via",
      );
      assert.equal(agents.listQueue(quickId).deliveries.length, 0, "A refused message was queued.");
      return { refused: 7 };
    },
  );

  await step("the Dynamic Island action and a routine find no agent to reach", async () => {
    const unknown = sourceText("error.agent.unknown", { id: quickId });
    const hiddenText = sourceText("error.backend.recipientHidden");
    // The action of the island sends as `service.sendMessage` does, with no `via`: the quick chat agent is refused.
    await assert.rejects(
      () =>
        runCauseEffect(
          performDynamicIslandCriticalAction(
            { type: "send-message", serverId: "local", agentId: quickId, text: "x", clientMessageId: "island-1" },
            agents,
            { request: () => Effect.die(new Error("Not used.")) },
            { decodeVoid: () => undefined, decodeQueuedMessageReceipt: (value) => value },
            () => undefined,
          ),
        ),
      (error: unknown) => messageOf(error).includes(hiddenText),
      "The Dynamic Island action reached the quick chat agent.",
    );
    // A routine for it, then a test run: the scheduler sees the hidden state of the quick chat agent.
    let routineError = "";
    try {
      const routine = agents.createRoutine(
        {
          agentId: quickId,
          name: "Nightly",
          instruction: "Check.",
          active: true,
          timezone: "UTC",
          schedule: { kind: "custom", expression: "0 * * * *" },
        },
        { recordConversationEvent: false },
      );
      await runCauseEffect(agents.testRoutine({ agentId: quickId, routineId: routine.id }));
    } catch (error) {
      routineError = messageOf(error);
    }
    assert.ok(
      routineError.includes(hiddenText) || routineError.includes(unknown),
      `A routine run for the quick chat agent was not refused: "${routineError}".`,
    );
    return { routineRefusal: routineError.slice(0, 120) };
  });

  await step(
    "Team API: no list, no id route, no message, and no event frame carries the quick chat agent",
    async () => {
      const call = async (method: string, path: string, token?: string, body?: unknown) => {
        const headers: Record<string, string> = {
          Accept: "application/json",
          [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V9),
          [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
          [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).join(","),
        };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await realFetch(`http://127.0.0.1:${host2.port}${path}`, {
          method,
          headers,
          body: body === undefined ? null : JSON.stringify(body),
        });
        const text = await response.text();
        return { status: response.status, text };
      };
      const login = await call("POST", TEAM_API_ROUTES.auth.login, undefined, OWNER);
      assert.equal(login.status, 200, `Sign-in returned ${login.status}.`);
      const token = String(JSON.parse(login.text).sessionToken);

      // The event socket of the owner, the role that no access rule closes anything for.
      const socket = new WebSocket(`ws://127.0.0.1:${host2.port}${TEAM_API_ROUTES.events}`, [
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
          // As a current client: every capability of the current protocol, so nothing is dropped for want of one.
          capabilities: [...teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9)],
        }),
      );
      // A conversation of the quick chat agent runs while the socket listens.
      const task = await converse(quickId, "Heard on the socket?");
      // An ordinary event after it, so the socket is known to be live when the check ends.
      const ordinary = await runCauseEffect(
        agents.createAgentProfile({ name: "Visible", description: "", avatarSeed: "visible", avatarHue: null }),
      );
      // The same socket then sees an ordinary agent work, so it is known to be live and to carry such events.
      await runCauseEffect(agents.sendMessage({ agentId: ordinary.id, text: "Hello" }));
      await new Promise<void>((resolveFrame, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `No event frame for the ordinary agent. Service saw it: ${host2.events.some((event) => event.type === "agents-changed" && event.agents.some((agent) => agent.id === ordinary.id))}. Frames: ${frames.length}; quick=${quickId} ordinary=${ordinary.id}: ${frames.map((frame) => frame.slice(0, 200)).join(" | ")}`,
              ),
            ),
          WAIT_MS,
        );
        const check = () => {
          if (frames.some((frame) => frame.includes(ordinary.id))) {
            clearTimeout(timer);
            resolveFrame();
            return;
          }
          setTimeout(check, 50);
        };
        check();
      });
      assert.ok(frames.length > 0);
      assert.ok(
        frames.every((frame) => !frame.includes(quickId)),
        "An event frame carried the quick chat agent.",
      );

      const list = await call("GET", TEAM_API_ROUTES.agents.all, token);
      assert.equal(list.status, 200);
      assert.ok(!list.text.includes(quickId), "GET /v1/agents carried the quick chat agent.");
      assert.ok(list.text.includes(ordinary.id), "The ordinary agent is not in the list.");
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
        assert.ok(!answer.text.includes(task.id), `${label} carried a task of the quick chat agent.`);
        missing[label] = answer.status;
      }
      const hiddenList = await call("POST", "/v1/hidden-agents", token, {});
      assert.ok(!hiddenList.text.includes(quickId), "The list of hidden agents carried the quick chat agent.");
      return { frames: frames.length, ...missing };
    },
  );

  await step("the 51st open conversation archives the oldest idle one and deletes none", async () => {
    const before = agents.listTasks(quickId).tasks.filter((task) => task.state !== "closed").length;
    for (let index = before; index < INPUT_LIMITS.agentTasks; index += 1) await converse(quickId, `Question ${index}`);
    const open = agents.listTasks(quickId).tasks.filter((task) => task.state !== "closed");
    assert.equal(open.length, INPUT_LIMITS.agentTasks, "The quick chat is not at its limit.");
    const oldest = [...open].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))[0];
    assert.ok(oldest);
    // The list shows the open conversations first and holds 50 in all, so the archived one is read from the table.
    const rows = () =>
      store.database.connection
        .prepare(
          "SELECT COALESCE(legacy_task_id, thread_id) AS id, archived_at FROM projection_agent_threads WHERE agent_id = ?",
        )
        .all(quickId);
    const read = (row: unknown) => (typeof row === "object" && row !== null ? { ...row } : {});
    const archivedIds = () =>
      rows()
        .map(read)
        .flatMap((row) => ("archived_at" in row && row.archived_at !== null && "id" in row ? [String(row.id)] : []));
    assert.equal(rows().length, INPUT_LIMITS.agentTasks, "The table does not hold the 50 conversations.");
    assert.deepEqual(archivedIds(), [], "A conversation was archived before the limit.");
    const added = await converse(quickId, "The 51st question");
    assert.equal(rows().length, INPUT_LIMITS.agentTasks + 1, "A conversation was deleted.");
    assert.deepEqual(archivedIds(), [oldest.id], "The oldest idle conversation was not the one archived.");
    const openAfter = agents.listTasks(quickId).tasks.filter((task) => task.state !== "closed");
    assert.equal(
      openAfter.length,
      INPUT_LIMITS.agentTasks,
      "The open conversations are not at the limit after the 51st.",
    );
    assert.ok(openAfter.some((task) => task.id === added.id));
    return { open: openAfter.length, archivedId: oldest.id };
  });
}

// ---------------------------------------------------------------------------------------------------
// Part 3: the warm-up

async function runWarmPart(): Promise<void> {
  const profile = join(root, "part3");
  const executable = join(root, "builders", "bin", "opencode");
  const log = join(root, "warm.jsonl");
  process.env.FAKE_LOG = log;
  const spawns = async () =>
    (await readJsonl<{ event: string }>(log)).filter((entry) => entry.event === "spawn").length;
  /** The sessions that opened in a folder. The start of the provider reads its model list in a session of its own, so only the one in the folder of the quick chat agent is the agent's. */
  const sessionsIn = async (folder: string) =>
    (await readJsonl<{ event: string; cwd?: string }>(log)).filter(
      (entry) => entry.event === "session" && entry.cwd === folder,
    ).length;
  const session = serializeCulturaBuilderSession({
    access: ACCESS,
    refresh: "refresh-quick-chat",
    expires: Date.now() + 3_600_000,
    empresa: COMPANY,
  });
  let level: HostMemoryLevel = "ok";
  const memory: HostMemory = {
    level: () => level,
    turnLimit: () => 10,
    reserveTurn: () => () => {},
    subscribe: () => () => {},
    hostedPlan: false,
    kind: "desktop",
  };
  const database = new BuildersBotDatabase(join(profile, "user-data"));
  const store = new AgentStore(join(profile, "user-data"), join(profile, "home"), database);
  const mailbox = new MailboxStore(join(profile, "user-data"), store.sharedRoot, store.database);
  const sidebar = new SidebarLayoutStore(join(profile, "user-data", "sidebar-layout.json"));
  await runCauseEffect(sidebar.initialize());
  // The stores only: `AgentService.initialize` would start the provider, which is what this part holds still.
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agents = new AgentService({
    store,
    mailbox,
    browser: agentBrowser,
    sidebarLayout: sidebar,
    preferredProvider: "cultura-builder",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "cultura-builder"),
    bundledExecutables: { opencode: executable },
    hostMemory: memory,
    credentials: {
      ...NO_PROVIDER_CREDENTIALS,
      apiKey: (provider) => (provider === "cultura-builder" ? session : null),
    },
  });
  // The catalog and the status are the test's until the provider runs: the agent is made with the provider cold.
  catalog = [BUILDER_AUTO];
  ProviderRuntime.prototype.listModels = () => catalog;
  ProviderRuntime.prototype.catalogRead = () => true;
  const status = agents.getStatus();
  agents.getStatus = (): AgentStatus => ({
    ...status,
    providers: [{ id: "cultura-builder", state: "available", version: null, message: null }],
  });
  try {
    await step("warm: before the agent exists it starts nothing", async () => {
      await runCauseEffect(agents.warmQuickChat());
      assert.equal(await spawns(), 0, "A provider started before the quick chat agent existed.");
      return { spawns: 0 };
    });
    const quick = await runCauseEffect(agents.ensureQuickChat());
    await step("warm: making the agent starts no provider process", async () => {
      assert.equal(await spawns(), 0, "`ensure` started the provider.");
      return { spawns: 0 };
    });
    await step("warm: while the memory is low it does nothing", async () => {
      level = "low";
      await runCauseEffect(agents.warmQuickChat());
      assert.equal(await spawns(), 0, "A warm ran with the memory low.");
      level = "critical";
      await runCauseEffect(agents.warmQuickChat());
      assert.equal(await spawns(), 0, "A warm ran with the memory critical.");
      return { spawns: 0 };
    });
    await step(
      "warm: at `ok` it starts the provider once, with no session of the agent, no conversation and no model call",
      async () => {
        level = "ok";
        providerCalls.length = 0;
        await Promise.all([1, 2, 3].map(() => runCauseEffect(agents.warmQuickChat())));
        assert.equal(await spawns(), 1, "The provider did not start exactly once.");
        await runCauseEffect(agents.warmQuickChat());
        assert.equal(await spawns(), 1, "A warm of a running provider started another process.");
        assert.equal(
          await sessionsIn(quick.agent.workspacePath),
          0,
          "A warm opened a session for the quick chat agent.",
        );
        assert.equal(agents.listTasks(quick.agent.id).tasks.length, 0, "A warm made a conversation.");
        assert.equal(store.quickChatAgent()?.threadId, null, "A warm opened the thread of the agent.");
        assert.deepEqual(providerCalls, [], "A warm reached a model.");
        return { spawns: 1, agentSessions: 0 };
      },
    );
  } finally {
    ProviderRuntime.prototype.listModels = realListModels;
    ProviderRuntime.prototype.catalogRead = realCatalogRead;
    await runCauseEffect(agents.stop()).catch(() => undefined);
    database.close();
  }
}

let running: Host | null = null;
/** The text of a failure and of its cause, wherever the effect library put it. */
function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return `${error.message} ${error.cause === undefined ? "" : messageOf(error.cause)}`;
}

/** The host that runs now. */
function host(): Host {
  assert.ok(running, "The host is not running.");
  return running;
}
try {
  await step("model rule: Cultura Builder with its fast model", () => {
    const choice = quickChatDefaultModel({
      models: [BUILDER_AUTO, BUILDER_FAST, CODEX_MODEL],
      providerAvailable: (provider) => provider === "cultura-builder" || provider === "codex",
    });
    assert.deepEqual(choice, { provider: "cultura-builder", model: QUICK_CHAT_FAST_MODEL });
    return choice;
  });
  await step("model rule: Cultura Builder without the fast model takes the first, at its lowest effort", () => {
    const choice = quickChatDefaultModel({
      models: [BUILDER_CODE, BUILDER_AUTO, CODEX_MODEL],
      providerAvailable: () => true,
    });
    assert.deepEqual(choice, {
      provider: "cultura-builder",
      model: "cultura-builder/builder-code",
      reasoningEffort: "low",
    });
    return choice;
  });
  await step(
    "model rule: another provider when Cultura Builder is not available, with fast mode only on a fast tier",
    () => {
      const codex = quickChatDefaultModel({
        models: [BUILDER_FAST, CODEX_MODEL, CLAUDE_MODEL],
        providerAvailable: (provider) => provider === "codex",
      });
      assert.deepEqual(codex, { provider: "codex", model: "gpt-6-luna", reasoningEffort: "low", fastMode: true });
      const claude = quickChatDefaultModel({
        models: [BUILDER_FAST, CODEX_MODEL, CLAUDE_MODEL],
        providerAvailable: (provider) => provider === "claude",
      });
      assert.ok(claude && claude.fastMode === undefined, "A model with no fast tier has no fast mode.");
      assert.equal(claude.reasoningEffort, "medium");
      return { codex, claude };
    },
  );
  await step("model rule: nothing available gives null, and a provider that lists nothing is skipped", () => {
    assert.equal(quickChatDefaultModel({ models: [BUILDER_FAST, CODEX_MODEL], providerAvailable: () => false }), null);
    const skipped = quickChatDefaultModel({
      models: [CLAUDE_MODEL],
      providerAvailable: (provider) => provider === "cultura-builder" || provider === "claude",
    });
    assert.equal(skipped?.provider, "claude");
    return { skipped };
  });

  catalog = [BUILDER_AUTO, BUILDER_FAST, BUILDER_CODE, CODEX_MODEL, CLAUDE_MODEL];
  available = new Set<AgentProviderId>(["cultura-builder", "codex", "claude"]);
  running = await startHost();

  await step("ensure: no quick chat agent exists before the first call", () => {
    assert.equal(quickChatRows(host()).length, 0);
    return { agents: host().store.list().length };
  });

  const made = await step("ensure: makes the agent hidden, on the default access, with no model call", async () => {
    const current = host();
    const eventsBefore = current.events.length;
    const result = await ensure(current);
    assert.equal(result.changed, true);
    const agent = result.agent;
    assert.equal(agent.quickChat, true);
    assert.ok(agent.hiddenAt, "The agent is not hidden.");
    assert.equal(agent.access, "full", "The access is not the default one.");
    assert.equal(agent.taskLimit, 3);
    assert.equal(agent.allowAutomation, false);
    assert.equal(agent.quickAcknowledgement, false);
    assert.equal(agent.providerAccountId, undefined, "The agent has an account of its own.");
    assert.equal(agent.name, sourceText("quick.agentName"));
    assert.equal(agent.provider, "cultura-builder");
    assert.equal(agent.model, QUICK_CHAT_FAST_MODEL);
    assert.deepEqual(providerCalls, [], `A provider or model was reached: ${providerCalls.join(", ")}.`);
    const stored = current.store.list().find((candidate) => candidate.id === agent.id);
    assert.ok(stored?.quickChat === true && stored.hiddenAt === agent.hiddenAt, "The store does not hold it hidden.");
    const carried = current.events
      .slice(eventsBefore)
      .filter((event) => event.type === "agents-changed" || event.type === "hidden-agents-changed");
    assert.deepEqual(carried, [], "An event carried the agent list after the first call.");
    return { id: agent.id, model: agent.model, access: agent.access, taskLimit: agent.taskLimit };
  });

  await step("ensure: calls at once make one agent, and a call after them changes nothing", async () => {
    const current = host();
    const results = await Promise.all([ensure(current), ensure(current), ensure(current)]);
    assert.ok(
      results.every((result) => result.agent.id === made.id),
      "A call made another agent.",
    );
    assert.ok(
      results.every((result) => !result.changed),
      "A call changed the agent that exists.",
    );
    assert.equal(quickChatRows(current).length, 1);
    return { quickChatAgents: quickChatRows(current).length };
  });

  await step("no event and no list ever carried the agent", () => {
    const current = host();
    for (const event of current.events) {
      if (event.type === "agents-changed")
        assert.ok(
          event.agents.every((agent) => agent.id !== made.id),
          "agents-changed carried the agent.",
        );
      if (event.type === "hidden-agents-changed")
        assert.ok(
          event.agents.every((agent) => agent.agentId !== made.id),
          "hidden-agents-changed carried it.",
        );
    }
    assert.ok(
      current.agents.listAgents().every((agent) => agent.id !== made.id),
      "listAgents carried the agent.",
    );
    assert.ok(
      current.agents.listHiddenAgents().agents.every((agent) => agent.agentId !== made.id),
      "listHiddenAgents carried the agent.",
    );
    return { events: current.events.length };
  });

  await step("restore, copy and delete find no agent", async () => {
    const current = host();
    const refused = async (label: string, run: () => Promise<unknown>) => {
      await assert.rejects(
        run,
        (error: unknown) => messageOf(error).includes(sourceText("error.agent.unknown", { id: made.id })),
        `${label} did not answer unknown agent.`,
      );
    };
    await refused("restore", () => runCauseEffect(current.agents.setAgentHidden({ agentId: made.id, hidden: false })));
    await refused("hide", () => runCauseEffect(current.agents.setAgentHidden({ agentId: made.id, hidden: true })));
    await refused("copy", () => runCauseEffect(current.agents.duplicateAgent(made.id)));
    await refused("delete", () => runCauseEffect(current.agents.deleteAgent(made.id)));
    await refused("deletable", () => runCauseEffect(current.agents.ensureAgentDeletable(made.id)));
    assert.equal(quickChatRows(current).length, 1, "A request removed or changed the agent.");
    assert.ok((current.store.quickChatAgent()?.hiddenAt ?? "") !== "", "A request restored the agent.");
    return { stillHidden: true };
  });

  await step("restart: the agent is still the quick chat one, and still no list shows it", async () => {
    await stopHost(host());
    running = null;
    running = await startHost();
    const current = host();
    const rows = quickChatRows(current);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, made.id);
    assert.ok(rows[0]?.hiddenAt);
    assert.ok(current.agents.listAgents().every((agent) => agent.id !== made.id));
    const again = await ensure(current);
    assert.equal(again.agent.id, made.id);
    assert.equal(again.changed, false);
    return { id: made.id };
  });

  await step("a model that left the catalog moves the agent to the rule, once", async () => {
    const current = host();
    catalog = [BUILDER_AUTO, BUILDER_CODE, CODEX_MODEL, CLAUDE_MODEL];
    const moved = await ensure(current);
    assert.equal(moved.changed, true, "The agent stayed on a model that left the catalog.");
    assert.equal(moved.agent.id, made.id);
    assert.equal(moved.agent.model, "cultura-builder/builder-auto");
    assert.equal(moved.agent.provider, "cultura-builder");
    assert.equal(moved.agent.reasoningEffort, "medium");
    const after = await ensure(current);
    assert.equal(after.changed, false, "A second call changed the agent again.");
    assert.equal(quickChatRows(current).length, 1);
    return { model: moved.agent.model, effort: moved.agent.reasoningEffort };
  });

  await step("a restart with the list still the built-in one keeps the model the person chose", async () => {
    const current = host();
    catalog = [BUILDER_AUTO, BUILDER_CODE, CODEX_MODEL, CLAUDE_MODEL];
    available = new Set<AgentProviderId>(["cultura-builder", "codex", "claude"]);
    const chosen = await runCauseEffect(
      current.agents.updateAgent({ agentId: made.id, provider: "cultura-builder", model: BUILDER_CODE.id }),
    );
    assert.equal(chosen.model, BUILDER_CODE.id);
    await stopHost(current);
    running = null;
    running = await startHost();
    // The CLI has not answered yet: the list is the built-in one, which holds none of the Cultura Builder models.
    readProviders = new Set();
    catalog = [CODEX_MODEL, CLAUDE_MODEL];
    const cold = await ensure(host());
    assert.equal(cold.changed, false, "A built-in list moved the agent.");
    assert.equal(cold.agent.model, BUILDER_CODE.id, "A built-in list took the chosen model away.");
    assert.equal(cold.agent.provider, "cultura-builder");
    // The CLI answered with a list that does not hold the model: now it falls back to the rule.
    readProviders = new Set<AgentProviderId>(["cultura-builder", "codex", "claude"]);
    catalog = [BUILDER_AUTO, CODEX_MODEL, CLAUDE_MODEL];
    const real = await ensure(host());
    assert.equal(real.changed, true, "A list that the CLI gave, without the model, did not move the agent.");
    assert.equal(real.agent.model, BUILDER_AUTO.id);
    readProviders = null;
    return { kept: cold.agent.model, afterRealList: real.agent.model };
  });

  await step("nothing can run: an existing agent stays, and a first call makes no agent", async () => {
    const current = host();
    catalog = [];
    available = new Set();
    const kept = await ensure(current);
    assert.equal(kept.changed, false);
    assert.equal(kept.agent.id, made.id);
    await stopHost(current);
    running = null;
    // A new profile that never made the agent.
    await rm(userData, { recursive: true, force: true });
    running = await startHost();
    await assert.rejects(() => ensure(host()), "A first call made an agent with nothing that can run.");
    assert.equal(quickChatRows(host()).length, 0);
    return { agentsMade: 0 };
  });

  await step("a first call with only built-in lists makes no agent, and waits for the real one", async () => {
    catalog = [BUILDER_FAST, CODEX_MODEL, CLAUDE_MODEL];
    available = new Set<AgentProviderId>(["cultura-builder", "codex", "claude"]);
    readProviders = new Set();
    await assert.rejects(() => ensure(host()), "A first call chose a model from a built-in list.");
    assert.equal(quickChatRows(host()).length, 0, "An agent was made on a built-in list.");
    readProviders = null;
    return { agentsMade: 0 };
  });

  await step("preload decoder: refuses an answer whose agent is not the quick chat one", async () => {
    catalog = [BUILDER_FAST];
    available = new Set<AgentProviderId>(["cultura-builder"]);
    const result = await ensure(host());
    assert.deepEqual(decodeQuickChatEnsure(JSON.parse(JSON.stringify(result))), result);
    const { quickChat: _removed, ...normal } = result.agent;
    assert.throws(() => decodeQuickChatEnsure({ agent: normal, changed: true }));
    assert.throws(() => decodeQuickChatEnsure({ ...result, extra: 1 }));
    assert.throws(() => decodeQuickChatEnsure(null));
    return { refused: 3 };
  });

  // ---- Part 2: the way in and the ways that stay closed, on a fake bundled Builders CLI.
  ProviderRuntime.prototype.listModels = realListModels;
  ProviderRuntime.prototype.createProfileClient = realCreateProfileClient;
  ProviderRuntime.prototype.catalogRead = realCatalogRead;
  await stopHost(host());
  running = null;
  await runPart2();
  await runWarmPart();

  report.passed = true;
} finally {
  globalThis.fetch = realFetch;
  ProviderRuntime.prototype.listModels = realListModels;
  ProviderRuntime.prototype.catalogRead = realCatalogRead;
  if (running) await stopHost(running);
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
