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
// The provider runtime is stood in: the catalog and the status are the ones of the test, so no provider
// CLI starts and no model is called. `AgentService.initialize` is not run.
// `bun run test:quick-chat-core`. Writes .buildersbot-build/quick-chat-core-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, AgentModelOption, AgentProviderId, AgentStatus } from "@buildersbot/contracts/ipc";
import { QUICK_CHAT_FAST_MODEL, quickChatDefaultModel } from "@buildersbot/contracts/quick-chat-model";
import { sourceText } from "@buildersbot/i18n/source";
import { Effect } from "effect";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { BuildersBotDatabase } from "../src/backend/buildersbot-database";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { decodeQuickChatEnsure } from "../src/preload/quick-chat-decoding";

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
const providerCalls: string[] = [];

// The runtime of the providers is stood in at two doors: the catalog it lists, and the one call that
// would reach a model (`createProfileClient`, which the quick chat must never make).
ProviderRuntime.prototype.listModels = () => catalog;
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

  report.passed = true;
} finally {
  if (running) await stopHost(running);
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
