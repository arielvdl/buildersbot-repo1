// Checks Force now on a queued message of a side thread (a task: the quick chat, or the Tasks page). It runs the
// real agent service, mailbox and drain on a temporary profile, on a fake bundled Cultura Builder CLI whose turns
// stay open until the client cancels them (`provider-fakes/agents/thread-queue-force.ts`). The provider has no
// native steer, so a queued message can only start when a turn ends or is stopped. Cases:
// 1. A turn runs in a thread of an ordinary agent and three messages wait. A force of the third one (two clicks)
//    sends one cancel to that thread's session, the next prompt carries only that message, and then the second
//    starts. A turn that runs in another thread of the agent is not touched, and its queue keeps its order.
// 2. The force names a turn that is not the one that runs (the person saw an older one): no cancel is sent, the
//    message stays at the head of its thread and the running turn goes on.
// 3. The same force in a conversation of the quick chat agent, which the page sends with `via: "quick-chat"`.
// 4. A force refuses a message that is not queued, and one of a closed thread.
// 5. The Team API route of the released `queue-force-v1` refuses a message that waits in a thread (409, as before),
//    sends no cancel and moves nothing; the local app forces the same message.
// `bun scripts/thread-queue-force-e2e.ts`. Writes .buildersbot-build/thread-queue-force-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@buildersbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@buildersbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@buildersbot/contracts/team-protocol";
import { teamCapabilitiesForProtocol } from "@buildersbot/contracts/team-protocol/current";
import { QUEUE_FORCE_ROUTES } from "@buildersbot/contracts/team-protocol/queue-force-v1";
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
  name: "thread-queue-force-electron-boundary",
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

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/thread-queue-force-e2e");
const WAIT_MS = 30_000;
const COMPANY = "Thread Force Lab";
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
    "The page: no renderer runs here. The button, the dialog and the preference are the ones of the chat queue, wired in the renderer.",
    "A member of a joined server with a lower role than the owner: the route is tried with the owner, which the rule does not close either.",
    "A real Cultura Builder account: the CLI is a fake that holds a turn until it is cancelled.",
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

/** The gateway of the fake Hub: loopback goes through, anything else fails, so no check reaches the network. */
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    if (url === `${CULTURA_BUILDER_GATEWAY}/session`)
      return new Response(JSON.stringify({ active: true, empresa: COMPANY }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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

const root = await mkdtemp(join(tmpdir(), "buildersbot-thread-force-"));
const log = join(root, "fake.jsonl");
process.env.FAKE_LOG = log;
const executable = join(root, "builders", "bin", "opencode");
await installFakeAgent(executable, "thread-queue-force");
const session = serializeCulturaBuilderSession({
  access: "access-thread-force",
  refresh: "refresh-thread-force",
  expires: Date.now() + 3_600_000,
  empresa: COMPANY,
});

interface FakeEntry {
  event: string;
  sessionId?: string;
  text?: string;
}
const entries = () => readJsonl<FakeEntry>(log);
const promptsWith = async (needle: string) =>
  (await entries()).filter((entry) => entry.event === "prompt" && entry.text?.includes(needle));
const cancels = async () => (await entries()).filter((entry) => entry.event === "cancel");
/** The prompts in the order the provider read them, as short names: the first word that is in capitals. */
const order = async () =>
  (await entries())
    .filter((entry) => entry.event === "prompt")
    .map((entry) => /\b(?:HOLD|M\d)\b|\bFIRST\b|\bOTHER\b/u.exec(entry.text ?? "")?.[0] ?? "?");

const userData = join(root, "user-data");
const database = new BuildersBotDatabase(userData);
const store = new AgentStore(userData, join(root, "home"), database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
await runCauseEffect(sidebar.initialize());
const OWNER = { username: "owner-user", password: "owner-password-123" };
const team = new TeamStore(join(userData, "buildersbot-team-server-v2.json"));
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
  securityGuard: () => ({
    enabled: false,
    scope: "all",
    mode: "annotate",
    minLevel: "suspicious",
    model: null,
    timeoutMs: 20_000,
  }),
});

/** Polls a state, not a clock: it fails after `WAIT_MS` with the last value it saw. */
async function until<T>(what: string, read: () => Promise<T> | T, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  let last = await read();
  while (!accept(last)) {
    if (Date.now() > deadline) throw new Error(`${what}: not reached. Last: ${JSON.stringify(last)}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    last = await read();
  }
  return last;
}

const taskRow = (agentId: string, taskId: string) => agents.listTasks(agentId).tasks.find((task) => task.id === taskId);
const queued = (agentId: string, taskId: string) =>
  (taskRow(agentId, taskId)?.queuedMessages ?? []).map((message) => message.text);

let server: InstanceType<typeof TeamApiServer> | null = null;
try {
  await runCauseEffect(agents.initialize());
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
  server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: "0.0.0-e2e",
    hiddenAgents: agents,
  });
  const port = await Effect.runPromise(server.start());

  const agent = await runCauseEffect(
    store.createAgent({ name: "Worker", description: "", avatarSeed: "worker", avatarHue: null }),
  );
  // The record of a new agent names Codex: the check runs on the fake Cultura Builder CLI.
  await runCauseEffect(
    store.updateAgent({
      agentId: agent.id,
      provider: "cultura-builder",
      model: "cultura-builder/builder-auto",
      reasoningEffort: "medium",
    }),
  );
  const runningTurn = (agentId: string, taskId: string) => taskRow(agentId, taskId)?.activeTurnId ?? null;
  const start = (agentId: string, text: string, via?: "quick-chat") =>
    runCauseEffect(agents.startTask({ agentId, text }, undefined, undefined, via));
  const send = (agentId: string, taskId: string, text: string, via?: "quick-chat") =>
    runCauseEffect(agents.sendMessage({ agentId, text, taskId }, undefined, undefined, via));
  const force = (agentId: string, taskId: string, text: string, expectedTurnId: string | null) => {
    const message = taskRow(agentId, taskId)?.queuedMessages.find((one) => one.text === text);
    assert.ok(message, `The message "${text}" does not wait in the thread.`);
    return runCauseEffect(
      agents.forceQueuedMessage({ agentId, deliveryId: message.deliveryId, expectedTurnId }, "quick-chat", "threads"),
    );
  };

  await step("the fake provider is up", async () => {
    const providers = agents.getStatus().providers ?? [];
    assert.ok(providers.some((row) => row.id === "cultura-builder" && row.state === "available"));
    return { provider: "cultura-builder" };
  });

  // ---- 1. Three messages wait behind a held turn; the third is forced.
  const first = await start(agent.id, "FIRST HOLD");
  await until("the first turn runs", () => runningTurn(agent.id, first.id), Boolean);
  const other = await start(agent.id, "OTHER HOLD");
  await until("the other thread runs", () => runningTurn(agent.id, other.id), Boolean);

  await step(
    "1: the force stops the turn of its own thread only, and the forced message starts alone and first",
    async () => {
      await send(agent.id, first.id, "M1 second");
      await send(agent.id, first.id, "M2 third");
      await send(agent.id, other.id, "M3 for the other thread");
      await until(
        "three messages wait",
        () => [queued(agent.id, first.id).length, queued(agent.id, other.id).length],
        ([own, others]) => own === 2 && others === 1,
      );
      const seen = runningTurn(agent.id, first.id);
      assert.ok(seen);
      // Two clicks at once: one cancel.
      const [one, two] = await Promise.all([
        force(agent.id, first.id, "M2 third", seen),
        force(agent.id, first.id, "M2 third", seen),
      ]);
      assert.equal(one.outcome, "interrupted");
      assert.equal(two.outcome, "interrupted");
      await until(
        "the forced message starts",
        () => promptsWith("M2 third"),
        (found) => found.length === 1,
      );
      await until(
        "the second message starts",
        () => promptsWith("M1 second"),
        (found) => found.length === 1,
      );
      const stopped = await cancels();
      assert.equal(stopped.length, 1, `Expected one cancel, saw ${stopped.length}.`);
      const firstSession = (await promptsWith("FIRST HOLD"))[0]?.sessionId;
      assert.equal(stopped[0]?.sessionId, firstSession, "The cancel did not reach the session of the thread.");
      const prompts = await order();
      assert.ok(
        prompts.indexOf("M2") < prompts.indexOf("M1"),
        `The forced message did not start before the second one: ${prompts.join(" ")}.`,
      );
      const forced = (await promptsWith("M2 third"))[0]?.text ?? "";
      assert.ok(!forced.includes("M1 second"), "The forced message did not start alone.");
      // The other thread still runs and keeps its queue.
      assert.ok(runningTurn(agent.id, other.id), "The other thread stopped.");
      assert.deepEqual(queued(agent.id, other.id), ["M3 for the other thread"]);
      return { order: prompts, cancels: stopped.length };
    },
  );

  // ---- 2. A turn the person did not see is not stopped.
  await step("2: a force that names another turn stops nothing, and the message waits at the head", async () => {
    const thread = await start(agent.id, "FIRST HOLD again");
    const turn = await until("the turn runs", () => runningTurn(agent.id, thread.id), Boolean);
    await send(agent.id, thread.id, "M4 behind");
    await send(agent.id, thread.id, "M5 also behind");
    await until(
      "two messages wait",
      () => queued(agent.id, thread.id).length,
      (count) => count === 2,
    );
    const before = (await cancels()).length;
    const result = await force(agent.id, thread.id, "M5 also behind", `${turn}-older`);
    assert.equal(result.outcome, "next");
    assert.equal((await cancels()).length, before, "A cancel was sent for a turn that the person did not see.");
    assert.equal(runningTurn(agent.id, thread.id), turn, "The running turn changed.");
    assert.deepEqual(queued(agent.id, thread.id), ["M5 also behind", "M4 behind"]);
    await runCauseEffect(agents.stopTask({ agentId: agent.id, taskId: thread.id }));
    return { outcome: result.outcome, queue: queued(agent.id, thread.id) };
  });

  // ---- 3. The quick chat.
  await step("3: the same force in a conversation of the quick chat", async () => {
    const made = await runCauseEffect(agents.ensureQuickChat());
    const quickId = made.agent.id;
    const conversation = await start(quickId, "Q1 HOLD", "quick-chat");
    const turn = await until("the conversation runs", () => runningTurn(quickId, conversation.id), Boolean);
    await send(quickId, conversation.id, "Q2 waits", "quick-chat");
    await send(quickId, conversation.id, "Q3 waits too", "quick-chat");
    await until(
      "two messages wait",
      () => queued(quickId, conversation.id).length,
      (count) => count === 2,
    );
    const before = (await cancels()).length;
    const result = await force(quickId, conversation.id, "Q3 waits too", turn);
    assert.equal(result.outcome, "interrupted");
    await until(
      "the forced message starts",
      () => promptsWith("Q3 waits too"),
      (found) => found.length >= 1,
    );
    await until(
      "the next one starts",
      () => promptsWith("Q2 waits"),
      (found) => found.length >= 1,
    );
    assert.equal((await cancels()).length, before + 1);
    const prompts = (await entries()).filter((entry) => entry.event === "prompt").map((entry) => entry.text ?? "");
    const at = (needle: string) => prompts.findIndex((text) => text.includes(needle));
    assert.ok(at("Q3 waits too") < at("Q2 waits"), "The forced message did not start first.");
    return { outcome: result.outcome };
  });

  // ---- 4. Refusals.
  await step("4: a message that does not wait, and a closed thread, are refused", async () => {
    const thread = await start(agent.id, "FIRST HOLD last");
    await until("the turn runs", () => runningTurn(agent.id, thread.id), Boolean);
    await send(agent.id, thread.id, "M6 behind");
    await until(
      "one message waits",
      () => queued(agent.id, thread.id).length,
      (count) => count === 1,
    );
    const waiting = taskRow(agent.id, thread.id)?.queuedMessages[0];
    assert.ok(waiting);
    await assert.rejects(
      () =>
        runCauseEffect(
          agents.forceQueuedMessage(
            { agentId: agent.id, deliveryId: "no-such-delivery", expectedTurnId: null },
            "quick-chat",
            "threads",
          ),
        ),
      /waits|queued|not/i,
      "A delivery that does not exist was forced.",
    );
    await runCauseEffect(agents.stopTask({ agentId: agent.id, taskId: thread.id }));
    await until(
      "the thread rests",
      () => taskRow(agent.id, thread.id)?.state,
      (state) => state === "idle" || state === "queued",
    );
    return { refused: 1 };
  });

  // ---- 5. The released wire does not force a message of a thread.
  await step(
    "5: the Team API route refuses a message that waits in a thread, as it always did, and stops nothing",
    async () => {
      const call = async (path: string, body: unknown, token?: string) => {
        const headers: Record<string, string> = {
          Accept: "application/json",
          "Content-Type": "application/json",
          [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V9),
          [TEAM_APP_VERSION_HEADER]: "0.0.0-e2e",
          [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).join(","),
        };
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await realFetch(`http://127.0.0.1:${port}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        return { status: response.status, text: await response.text() };
      };
      const login = await call(TEAM_API_ROUTES.auth.login, OWNER);
      assert.equal(login.status, 200, `Sign-in returned ${login.status}.`);
      const token = String(JSON.parse(login.text).sessionToken);
      const thread = await start(agent.id, "FIRST HOLD wire");
      const turn = await until("the turn runs", () => runningTurn(agent.id, thread.id), Boolean);
      await send(agent.id, thread.id, "W1 behind");
      await send(agent.id, thread.id, "W2 behind too");
      await until(
        "two messages wait",
        () => queued(agent.id, thread.id).length,
        (count) => count === 2,
      );
      const waiting = taskRow(agent.id, thread.id)?.queuedMessages.find((message) => message.text === "W2 behind too");
      assert.ok(waiting);
      const before = (await cancels()).length;
      const refused = await call(
        QUEUE_FORCE_ROUTES.force,
        { agentId: agent.id, deliveryId: waiting.deliveryId, expectedTurnId: turn },
        token,
      );
      assert.equal(refused.status, 409, `The route answered ${refused.status}: ${refused.text}`);
      assert.match(refused.text, /Only a message that waits in the agent's queue can be forced/);
      assert.equal((await cancels()).length, before, "The refused force stopped a turn.");
      assert.equal(runningTurn(agent.id, thread.id), turn, "The refused force changed the running turn.");
      assert.deepEqual(
        queued(agent.id, thread.id),
        ["W1 behind", "W2 behind too"],
        "The refused force moved a message.",
      );
      // The same message, forced by the local app, goes through: the refusal is about who asks, not about the message.
      const local = await force(agent.id, thread.id, "W2 behind too", turn);
      assert.equal(local.outcome, "interrupted");
      await runCauseEffect(agents.stopTask({ agentId: agent.id, taskId: thread.id }));
      return { status: refused.status, text: refused.text.slice(0, 90) };
    },
  );

  report.passed = true;
} finally {
  if (server) await Effect.runPromise(server.stop()).catch(() => undefined);
  globalThis.fetch = realFetch;
  await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
