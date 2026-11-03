// Checks the limit of parallel threads of the quick chat. The real agent service, mailbox and drain run on a temporary
// profile, on a fake bundled Cultura Builder CLI whose turns stay open until the client cancels them
// (`provider-fakes/agents/topic-limit.ts`). The person had set the limit of channel tabs per agent to its highest
// value, 8, and the quick chat still held its conversations at 3 (a constant in `AgentStore`, with no setting).
// 1. The setting: it defaults to 8, a saved value is read back by a new store, and a value out of range reads as the default.
// 2. With no setting saved and the tab limit at 8, ten conversations of the quick chat start: eight run and two wait.
// 3. A lower value holds the next conversations at that value, and a higher one starts the waiting ones, with no restart.
// 4. An ordinary agent keeps its own limit: 2 by default, up to 4 as before, and 8 is refused.
// 5. With the memory of the computer critical, a queued thread says that it waits for the memory. Before, it had no named
//    wait, and the page then wrote "Waiting for a free thread. 3 threads running".
// `bun scripts/topic-limit-e2e.ts`. Writes .buildersbot-build/topic-limit-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@buildersbot/contracts/ipc";
import { Effect } from "effect";
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
import { AgentLimitPreferenceStore } from "../src/main/agent-limit-preference-store";
import { installFakeAgent, readJsonl } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/topic-limit-e2e");
const WAIT_MS = 30_000;
const COMPANY = "Topic Limit Lab";
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
    "The page: no renderer runs here, so the select in Settings > Load is not clicked.",
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

const root = await mkdtemp(join(tmpdir(), "buildersbot-topic-limit-"));
const log = join(root, "fake.jsonl");
process.env.FAKE_LOG = log;
const executable = join(root, "builders", "bin", "opencode");
await installFakeAgent(executable, "topic-limit");
const session = serializeCulturaBuilderSession({
  access: "access-topic-limit",
  refresh: "refresh-topic-limit",
  expires: Date.now() + 3_600_000,
  empresa: COMPANY,
});

const userData = join(root, "user-data");
const database = new BuildersBotDatabase(userData);
const store = new AgentStore(userData, join(root, "home"), database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
await runCauseEffect(sidebar.initialize());
// The preference file that Settings > Load writes: the cap on agents, the tabs per agent, and the quick chat threads.
const preferencePath = join(root, "agent-limit.json");
const preference = new AgentLimitPreferenceStore(preferencePath);
await runCauseEffect(preference.set({ enabled: false, max: 10, tabsPerAgent: 8 }));
// The memory of the computer, as a Mac gives it: a test sets the level and sends a sample.
let memoryLevel: HostMemoryLevel = "ok";
const memoryListeners = new Set<() => void>();
const hostMemory: HostMemory = {
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
const sampleMemory = (level: HostMemoryLevel) => {
  memoryLevel = level;
  for (const listener of memoryListeners) listener();
};
const agents = new AgentService({
  hostMemory,
  store,
  mailbox,
  browser: agentBrowser,
  sidebarLayout: sidebar,
  preferredProvider: "cultura-builder",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "cultura-builder"),
  bundledExecutables: { opencode: executable },
  agentLimit: () => preference.limit(),
  channelTabLimit: () => preference.tabsPerAgent(),
  channelParallelLimit: () => preference.agentsPerTab(),
  channelTabsMode: () => preference.tabsMode(),
  quickChatThreadLimit: () => preference.quickChatThreads(),
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

const states = (agentId: string) => {
  const { tasks, limit } = agents.listTasks(agentId);
  const open = tasks.filter((task) => task.state !== "closed");
  return {
    limit,
    running: open.filter((task) => task.state === "running").length,
    queued: open.filter((task) => task.state === "queued").length,
    holds: [...new Set(open.filter((task) => task.state === "queued").map((task) => task.hold))],
  };
};
const start = (agentId: string, text: string, via?: "quick-chat") =>
  runCauseEffect(agents.startTask({ agentId, text }, undefined, undefined, via));
const stopAll = async (agentId: string) => {
  // A Stop that comes before the turn of a thread has started reaches nothing, so it is sent again until no thread runs.
  await until(
    "every thread rests",
    async () => {
      for (const task of agents.listTasks(agentId).tasks)
        if (task.state === "running") await runCauseEffect(agents.stopTask({ agentId, taskId: task.id }));
      return states(agentId);
    },
    (state) => state.running === 0,
  );
  for (const task of agents.listTasks(agentId).tasks)
    if (task.state !== "closed") await runCauseEffect(agents.closeTask({ agentId, taskId: task.id }));
};

try {
  await runCauseEffect(agents.initialize());

  await step(
    "1: the setting defaults to 8, is saved, read back by a new store, and a bad value reads as the default",
    async () => {
      assert.equal(preference.tabsPerAgent(), 8, "The tab limit that the person set is not 8.");
      assert.equal(preference.quickChatThreads(), 8, "The default limit of quick chat threads is not 8.");
      await runCauseEffect(preference.set({ enabled: false, max: 10, tabsPerAgent: 8, quickChatThreads: 5 }));
      const reread = new AgentLimitPreferenceStore(preferencePath);
      await runCauseEffect(reread.load());
      assert.equal(reread.quickChatThreads(), 5, "A saved limit was not read back.");
      assert.equal(reread.tabsPerAgent(), 8, "The tab limit changed.");
      // A client that sends no quick chat limit leaves the saved one.
      await runCauseEffect(preference.set({ enabled: false, max: 10, tabsPerAgent: 8 }));
      assert.equal(preference.quickChatThreads(), 5, "A save with no quick chat limit dropped the saved one.");
      await runCauseEffect(preference.set({ enabled: false, max: 10, tabsPerAgent: 8, quickChatThreads: 8 }));
      await writeFile(preferencePath, JSON.stringify({ version: 1, enabled: false, max: 10, quickChatThreads: 0 }));
      const damaged = new AgentLimitPreferenceStore(preferencePath);
      await runCauseEffect(damaged.load());
      assert.equal(damaged.quickChatThreads(), 8, "A value out of range did not read as the default.");
      await runCauseEffect(preference.set({ enabled: false, max: 10, tabsPerAgent: 8, quickChatThreads: 8 }));
      return { default: 8, saved: 5 };
    },
  );

  const made = await runCauseEffect(agents.ensureQuickChat());
  const quickId = made.agent.id;

  await step(
    "2: with the tab limit at 8 and nothing else saved, ten quick chat threads start: eight run and two wait",
    async () => {
      for (let index = 1; index <= 10; index += 1) await start(quickId, `T${index} HOLD`, "quick-chat");
      const state = await until(
        "threads settle",
        () => states(quickId),
        (value) => value.running + value.queued === 10 && value.running >= 3,
      );
      assert.deepEqual(
        { limit: state.limit, running: state.running, queued: state.queued },
        { limit: 8, running: 8, queued: 2 },
        `The threads stopped at ${state.running} (limit ${state.limit}); the holds are ${JSON.stringify(state.holds)}.`,
      );
      assert.deepEqual(state.holds, ["task-limit"]);
      // A thread that ends frees a place for a waiting one.
      // Stopped once the provider has read the eight turns, so the Stop reaches a turn that runs.
      await until(
        "the provider reads eight turns",
        async () => (await readJsonl<{ event: string }>(log)).filter((entry) => entry.event === "prompt").length,
        (count) => count >= 8,
      );
      const one = agents.listTasks(quickId).tasks.find((task) => task.title.startsWith("T1 "));
      assert.ok(one);
      await runCauseEffect(agents.stopTask({ agentId: quickId, taskId: one.id }));
      // The provider reads a ninth turn: a waiting thread took the place that the stopped one left.
      const ninth = await until(
        "a waiting thread starts",
        async () => (await readJsonl<{ event: string }>(log)).filter((entry) => entry.event === "prompt").length,
        (count) => count >= 9,
      );
      return { limit: states(quickId).limit, promptsRead: ninth };
    },
  );

  await step("3: a lower value holds new threads at that value, and a higher one starts the waiting ones", async () => {
    await stopAll(quickId);
    await runCauseEffect(preference.set({ enabled: false, max: 10, tabsPerAgent: 8, quickChatThreads: 3 }));
    agents.agentLimitChanged();
    for (let index = 1; index <= 5; index += 1) await start(quickId, `L${index} HOLD`, "quick-chat");
    const low = await until(
      "five threads settle at 3",
      () => states(quickId),
      (value) => value.running + value.queued === 5 && value.running >= 3,
    );
    assert.deepEqual(
      { limit: low.limit, running: low.running, queued: low.queued },
      { limit: 3, running: 3, queued: 2 },
    );
    await runCauseEffect(preference.set({ enabled: false, max: 10, tabsPerAgent: 8, quickChatThreads: 6 }));
    agents.agentLimitChanged();
    const high = await until(
      "the waiting threads start",
      () => states(quickId),
      (value) => value.running === 5 && value.queued === 0,
    );
    await stopAll(quickId);
    return {
      lowered: { running: low.running, queued: low.queued },
      raised: { running: high.running, limit: high.limit },
    };
  });

  await step("4: an ordinary agent keeps its own limit: 2 by default, up to 4, and 8 is refused", async () => {
    const worker = await runCauseEffect(
      store.createAgent({ name: "Worker", description: "", avatarSeed: "worker", avatarHue: null }),
    );
    await runCauseEffect(
      store.updateAgent({
        agentId: worker.id,
        provider: "cultura-builder",
        model: "cultura-builder/builder-auto",
        reasoningEffort: "medium",
      }),
    );
    for (let index = 1; index <= 5; index += 1) await start(worker.id, `W${index} HOLD`);
    const byDefault = await until(
      "threads settle at the default",
      () => states(worker.id),
      (value) => value.running + value.queued === 5 && value.running >= 2,
    );
    assert.deepEqual({ limit: byDefault.limit, running: byDefault.running }, { limit: 2, running: 2 });
    await runCauseEffect(agents.updateAgent({ agentId: worker.id, taskLimit: 4 }));
    const four = await until(
      "four run",
      () => states(worker.id),
      (value) => value.running === 4,
    );
    await assert.rejects(
      () => runCauseEffect(agents.updateAgent({ agentId: worker.id, taskLimit: 8 })),
      /task limit/i,
      "A task limit of 8 was accepted for an ordinary agent.",
    );
    return { default: byDefault.running, raised: four.running };
  });

  await step(
    "5: a thread that waits for the memory of the computer says so, not that the limit of threads is reached",
    async () => {
      sampleMemory("critical");
      const waiting = await start(quickId, "M1 HOLD", "quick-chat");
      const held = await until(
        "the thread waits",
        () => agents.listTasks(quickId).tasks.find((task) => task.id === waiting.id),
        (task) => task?.state === "queued",
      );
      assert.equal(states(quickId).running, 0, "A turn started with the memory critical.");
      // Nothing runs and the limit is 8, so "N threads running" would be false: the wait names the memory.
      assert.equal(held?.hold, "server-busy", `The wait is named ${JSON.stringify(held?.hold)}, not the memory.`);
      sampleMemory("ok");
      await until(
        "the thread starts when the memory is back",
        () => states(quickId),
        (state) => state.running === 1,
      );
      await stopAll(quickId);
      return { hold: held?.hold };
    },
  );

  report.passed = true;
} finally {
  globalThis.fetch = realFetch;
  await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
