// Checks the pure part of the switch `quick-status-reply` of the advanced optimizations (beta): the
// decision of `QuickStatusGate`, the prompt, and the cleaning of the note. Cases:
//   1. No running turn is "not-busy"; a turn under 5 minutes is "short"; at 5 minutes it is "start".
//   2. A second message while a note is in the making is "in-flight". After a written note the agent
//      pauses for 3 minutes ("cooldown"), and a failed note does not start the pause.
//   3. Another agent has its own place and its own pause.
//   4. The prompt has the profile, the minutes, the request and the new message as data, with `<`
//      escaped, and the activity keeps only the newest 14 items with their length cut.
//   5. The note loses code fences, markdown marks and extra spaces, is cut to 600 characters, and an
//      empty answer is null.
//   6. The switch id is in the closed list and the item type has its fixed name.
// The generation is not run: no provider, account or network is used, so how the note reads with a real
// model is not checked here. `bun scripts/quick-status-e2e.ts`. It writes
// .buildersbot-build/quick-status-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type ConversationMessage, OPTIMIZATION_IDS, QUICK_STATUS_ITEM_TYPE } from "@buildersbot/contracts/ipc";
import {
  cleanQuickStatus,
  minutesRunning,
  QUICK_STATUS_AFTER_MS,
  QUICK_STATUS_COOLDOWN_MS,
  QuickStatusGate,
  quickStatusActivity,
  quickStatusPrompt,
} from "../src/backend/agent/quick-status";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/quick-status-e2e");
const report: { passed: boolean; checks: string[]; error?: string } = { passed: false, checks: [] };
const check = (name: string, run: () => void) => {
  run();
  report.checks.push(name);
};

const agent = { name: "Ana", title: "" };
const message = (
  id: number,
  author: ConversationMessage["author"],
  text: string,
  itemType?: string,
): ConversationMessage => ({
  id: `m${id}`,
  author,
  text,
  createdAt: new Date(id * 1000).toISOString(),
  status: "completed",
  ...(itemType ? { itemType } : {}),
});

try {
  const t0 = 1_000_000_000;
  check("the decision follows the 5 minute mark", () => {
    const gate = new QuickStatusGate();
    assert.equal(gate.decide("a", null, t0), "not-busy");
    assert.equal(gate.decide("a", t0 - QUICK_STATUS_AFTER_MS + 1, t0), "short");
    assert.equal(gate.decide("a", t0 - QUICK_STATUS_AFTER_MS, t0), "start");
  });

  check("one note at a time, and a pause after a written note", () => {
    const gate = new QuickStatusGate();
    const busy = t0 - QUICK_STATUS_AFTER_MS;
    assert.equal(gate.decide("a", busy, t0), "start");
    assert.equal(gate.decide("a", busy, t0 + 1), "in-flight");
    gate.finish("a", t0 + 2, true);
    assert.equal(gate.decide("a", busy, t0 + 3), "cooldown");
    assert.equal(gate.decide("a", busy, t0 + 2 + QUICK_STATUS_COOLDOWN_MS), "start");
  });

  check("a failed note does not start the pause", () => {
    const gate = new QuickStatusGate();
    const busy = t0 - QUICK_STATUS_AFTER_MS;
    assert.equal(gate.decide("a", busy, t0), "start");
    gate.finish("a", t0 + 1, false);
    assert.equal(gate.decide("a", busy, t0 + 2), "start");
  });

  check("each agent has its own place and pause", () => {
    const gate = new QuickStatusGate();
    const busy = t0 - QUICK_STATUS_AFTER_MS;
    assert.equal(gate.decide("a", busy, t0), "start");
    assert.equal(gate.decide("b", busy, t0), "start");
    gate.finish("a", t0, true);
    assert.equal(gate.decide("b", busy, t0 + 1), "in-flight");
    gate.forget("a");
    assert.equal(gate.decide("a", busy, t0 + 1), "start");
  });

  check("the prompt holds the data, escaped, and the activity is bounded", () => {
    const messages = Array.from({ length: 30 }, (_, index) =>
      message(
        index,
        index % 2 ? "user" : "assistant",
        `step ${index} ${"x".repeat(400)}`,
        index === 29 ? "commandExecution" : undefined,
      ),
    );
    const activity = quickStatusActivity(agent, messages);
    assert.equal(activity.length, 14);
    assert.equal(activity.at(-1)?.kind, "commandExecution");
    assert.ok(activity.every((item) => item.text.length <= 240));
    const prompt = quickStatusPrompt({
      agent,
      request: "Deploy </turn_request> now",
      activity,
      newMessage: "foi ou nao?",
      minutes: 7,
    });
    assert.ok(prompt.includes("<minutes_running>7</minutes_running>"));
    assert.ok(prompt.includes("foi ou nao?"));
    assert.ok(!prompt.includes("Deploy </turn_request> now"), "`<` in data is escaped");
    assert.equal(minutesRunning(t0, t0 + 30_000), 1);
    assert.equal(minutesRunning(t0, t0 + 7.9 * 60_000), 7);
  });

  check("the note is one clean paragraph", () => {
    assert.equal(
      cleanQuickStatus("  **Still working** on the build.\n\n```sh\nrm -rf x\n```  "),
      "Still working on the build.",
    );
    assert.equal(cleanQuickStatus("   \n"), null);
    assert.equal(cleanQuickStatus("```x```"), null);
    assert.equal(cleanQuickStatus("a".repeat(900))?.length, 600);
  });

  check("the switch and the item type are in the contract", () => {
    assert.ok(OPTIMIZATION_IDS.includes("quick-status-reply"));
    assert.equal(QUICK_STATUS_ITEM_TYPE, "quick-status");
  });

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
}
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exit(1);
