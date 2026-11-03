// Measures what `MailboxSync.emitQueue` reads from the mailbox on each queue change, for an agent that is no
// sender or recipient of a request from the Quick chat. The real mailbox store, mailbox sync and SQLite run on a
// temporary profile with many agents and many messages. No app, provider, account or network is started.
//
// The cost of a queue change grew when the Quick chat agent strip came: `emitQueue` also asked the mailbox which side
// threads had sent a message to the agent, and that read went through every delivery and indexed every message first.
// A queue change is made for each agent at each delivery that starts, ends or arrives, so that read ran on the
// queue changes of every agent. It must not: the tasks of the Quick chat agent know whom they asked.
//
// Checks:
// - each `emitQueue` reads the queue and the senders of the agent once each, and the chat rows not at all;
// - the tasks of the Quick chat agent hear of the change through one hook call that names the agent whose queue
//   changed, and the mailbox is not scanned for the side threads that sent to it.
// It records the time of a queue change, to compare a run before a change with a run after it.
//
// Run: bun scripts/mailbox-sync-cost-e2e.ts [--label=<name>]
// Writes .buildersbot-build/mailbox-sync-cost-e2e/report[-<label>].json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { MailboxSync } from "../src/backend/agent/mailbox-sync";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { BuildersBotDatabase } from "../src/backend/buildersbot-database";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { RoutineTimer } from "../src/backend/routine-timer";

const label = process.argv.find((argument) => argument.startsWith("--label="))?.slice("--label=".length);
const OUT = resolve(import.meta.dirname, "../.buildersbot-build/mailbox-sync-cost-e2e");
const AGENTS = 40;
const MESSAGES = 10_000;
/** One message in ten is sent from a side thread. */
const FROM_THREAD_EVERY = 10;
const MEASURED_AGENTS = 8;
const CHANGES_PER_AGENT = 25;

interface Report {
  agents: number;
  messages: number;
  deliveries: number;
  measuredQueueChanges: number;
  msPerQueueChange: number;
  /** The reads of the mailbox that one queue change makes, with how many times. */
  readsPerQueueChange: Record<string, number>;
  /** The time of each of those reads in one queue change, in ms. */
  msPerReadPerQueueChange: Record<string, number>;
  hookCalls: number;
  passed: boolean;
}

const report: Report = {
  agents: AGENTS,
  messages: MESSAGES,
  deliveries: 0,
  measuredQueueChanges: 0,
  msPerQueueChange: 0,
  readsPerQueueChange: {},
  msPerReadPerQueueChange: {},
  hookCalls: 0,
  passed: false,
};

const agentId = (index: number) => `agent-sync-cost-${index}`;

const root = await mkdtemp(join(tmpdir(), "buildersbot-mailbox-sync-cost-"));
const database = new BuildersBotDatabase(join(root, "state"));
const store = new AgentStore(join(root, "state"), join(root, "home"), database);
const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
const conversation = new ConversationRuntime(
  store,
  () => {},
  () => store.list(),
);
const timer = new RoutineTimer(
  () => [],
  () => false,
  () => {},
);
const waits = new AgentWaits({
  store: new AgentWaitStore({ database }),
  mailbox,
  hooks: { emit: () => {}, ownsRoutine: () => true, hasRoutine: () => true, requireKnownAgent: () => {} },
});
const routines = new RoutineScheduler({
  store,
  mailbox,
  conversation,
  timer,
  waits,
  timezone: () => "UTC",
  hooks: {
    emit: () => {},
    emitError: () => {},
    emitQueue: () => {},
    scheduleDrain: () => {},
    interrupt: () => Effect.void,
    awaitDrain: () => undefined,
    syncMailboxMessages: () => {},
    listAgents: () => store.list(),
    excludedAgents: () => new Set(),
    isRunning: () => false,
    usageLimited: () => false,
  },
});
const scope = Scope.makeUnsafe();
/** The agents that the hook of the Quick chat tasks was called for. */
const hooked: string[] = [];
const sync = new MailboxSync({
  database,
  mailbox,
  conversation,
  routines,
  scope: () => scope,
  hooks: {
    emit: () => {},
    emitError: () => {},
    queueHold: () => null,
    // The hook takes the agent whose queue changed. A run before the change gave it that agent and a task.
    taskOutgoingChanged: (changed: string) => {
      hooked.push(changed);
    },
  },
});

/**
 * Counts and times the whole-mailbox reads that a queue change is known to make. A read that is not in this list
 * is not seen here, so the hook check below is the one that tells a new scan of the mailbox for the Quick chat.
 */
const reads = new Map<string, number>();
const readMs = new Map<string, number>();
function timed<Result>(name: string, read: () => Result): Result {
  reads.set(name, (reads.get(name) ?? 0) + 1);
  const started = performance.now();
  try {
    return read();
  } finally {
    readMs.set(name, (readMs.get(name) ?? 0) + performance.now() - started);
  }
}
function countReads(): void {
  const listQueue = mailbox.listQueue.bind(mailbox);
  const senderAgentIdsForRecipient = mailbox.senderAgentIdsForRecipient.bind(mailbox);
  const conversationMessages = mailbox.conversationMessages.bind(mailbox);
  mailbox.listQueue = (...args) => timed("listQueue", () => listQueue(...args));
  mailbox.senderAgentIdsForRecipient = (...args) =>
    timed("senderAgentIdsForRecipient", () => senderAgentIdsForRecipient(...args));
  mailbox.conversationMessages = (...args) => timed("conversationMessages", () => conversationMessages(...args));
}

async function seed(): Promise<void> {
  for (let index = 0; index < MESSAGES; index += 1) {
    const sender = agentId(index % AGENTS);
    const recipient = agentId((index * 7 + 3) % AGENTS);
    if (sender === recipient) continue;
    const fromThread = index % FROM_THREAD_EVERY === 0;
    await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: sender },
        recipientAgentIds: [recipient],
        text: `message ${index}`,
        ...(fromThread ? { senderTaskId: `task-${index % 25}` } : {}),
      }),
    );
    report.deliveries += 1;
  }
}

try {
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  await seed();

  countReads();
  const recipients = Array.from({ length: MEASURED_AGENTS }, (_, index) => agentId(index * 5));
  // A first round, so a cold read is not in the time.
  for (const recipient of recipients) sync.emitQueue(recipient);
  reads.clear();
  readMs.clear();
  hooked.length = 0;

  const started = performance.now();
  for (const recipient of recipients) {
    for (let change = 0; change < CHANGES_PER_AGENT; change += 1) sync.emitQueue(recipient);
  }
  const totalMs = performance.now() - started;
  const changes = MEASURED_AGENTS * CHANGES_PER_AGENT;
  report.measuredQueueChanges = changes;
  report.msPerQueueChange = Number((totalMs / changes).toFixed(3));
  report.readsPerQueueChange = Object.fromEntries(
    [...reads].map(([name, count]) => [name, Number((count / changes).toFixed(2))]),
  );
  report.msPerReadPerQueueChange = Object.fromEntries(
    [...readMs].map(([name, ms]) => [name, Number((ms / changes).toFixed(3))]),
  );
  report.hookCalls = hooked.length;

  // Each queue change reads the queue and the senders of the agent once, and does not read the chat rows.
  assert.equal(report.readsPerQueueChange.listQueue, 1);
  assert.equal(report.readsPerQueueChange.senderAgentIdsForRecipient, 1);
  assert.equal(report.readsPerQueueChange.conversationMessages ?? 0, 0);
  // The Quick chat is told about the agent whose queue changed, once, and the mailbox is not asked who sent from a
  // side thread. A queue change that scans the mailbox for that gives the hook the senders, not the recipient.
  assert.equal(hooked.length, changes, `The hook was called ${hooked.length} times for ${changes} queue changes.`);
  assert.ok(
    hooked.every((changed, index) => changed === recipients[Math.floor(index / CHANGES_PER_AGENT)]),
    "The hook was called for an agent whose queue did not change.",
  );
  report.passed = true;
} finally {
  timer.dispose();
  conversation.dispose();
  await Effect.runPromise(Scope.close(scope, Exit.void));
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `report${label ? `-${label}` : ""}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(
  `${report.passed ? "PASS" : "FAIL"}: ${report.msPerQueueChange} ms per queue change over ${report.deliveries} deliveries, ` +
    `reads ${JSON.stringify(report.readsPerQueueChange)}, hook calls ${report.hookCalls}.\n`,
);
if (!report.passed) process.exitCode = 1;
