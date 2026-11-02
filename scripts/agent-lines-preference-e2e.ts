// Checks the saved "agents per tab" setting (`agentsPerTab`) from the file to both ends of the IPC
// boundary. It runs the real preference store on a temporary file, the main-process parser
// (`parseAgentLimitPreference`) and the preload decoder (`decodeAgentLimitPreference`):
// 1. The store saves and reads back every value from 1 to 8, and keeps the other fields.
// 2. 0, 9, 2.5, a string and null are refused by the parser and by the decoder, and the stored
//    preference does not change after a refused value reaches `set` through the parser.
// 3. A file with no `agentsPerTab` reads the default (4); `agentsPerTab()` never returns an
//    out-of-range number.
// 4. A file with an invalid `agentsPerTab` reads the default of the whole preference.
// 5. `set` without the field keeps the saved value (a client that does not know the field).
// 6. The main-process parser and the preload decoder agree on a table of values.
// Phase 2 adds the tab mode and the ceiling of tabs per agent:
// 7. `tabsMode` "fixed" and "memory" are saved and read back; any other value is refused at both ends;
//    `tabsPerAgent` accepts 1 to 8 and refuses 0 and 9.
// 8. A file with no `tabsMode` reads `memory` where the computer gives a memory reading, and `fixed`
//    where it does not; `tabsPerAgent()` then reads the ceiling 4 or the fixed 2.
// 9. `set` without `tabsMode` or `tabsPerAgent` keeps the saved ones.
// `bun scripts/agent-lines-preference-e2e.ts`. Writes .buildersbot-build/agent-lines-preference-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_AGENT_LIMIT_PREFERENCE, DEFAULT_AGENTS_PER_TAB } from "@buildersbot/contracts/ipc";
import { Effect } from "effect";
import { AgentLimitPreferenceStore } from "../src/main/agent-limit-preference-store";
import { parseAgentLimitPreference } from "../src/main/ipc/app-inputs";
import { decodeAgentLimitPreference } from "../src/preload/app-decoding";

const OUT = resolve(import.meta.dirname, "../.buildersbot-build/agent-lines-preference-e2e");
const root = await mkdtemp(join(tmpdir(), "buildersbot-agent-lines-"));
const report: { passed: boolean; error?: string } = { passed: false };
const checks = new Map<string, unknown>();
let fileCount = 0;
const newFile = () => join(root, `limit-${++fileCount}.json`);

const accepts = (decode: (value: unknown) => unknown, value: unknown) => {
  try {
    decode(value);
    return true;
  } catch {
    return false;
  }
};

try {
  // 1. Every value from 1 to 8 is saved and read back.
  const saved: number[] = [];
  for (let value = 1; value <= 8; value += 1) {
    const file = newFile();
    const store = new AgentLimitPreferenceStore(file);
    await Effect.runPromise(store.load());
    await Effect.runPromise(store.set(parseAgentLimitPreference({ enabled: true, max: 7, agentsPerTab: value })));
    const again = new AgentLimitPreferenceStore(file);
    await Effect.runPromise(again.load());
    assert.equal(again.agentsPerTab(), value);
    assert.deepEqual(again.get(), { enabled: true, max: 7, agentsPerTab: value });
    saved.push(again.agentsPerTab());
  }
  checks.set("savedValues", saved);

  // 2. Values out of range are refused at both ends, and the stored value stays.
  const refusedValues: unknown[] = [0, 9, 2.5, -1, "4", null, Number.NaN, Number.POSITIVE_INFINITY];
  const refusals = refusedValues.map((value) => {
    const input = { enabled: true, max: 7, agentsPerTab: value };
    return {
      value: String(value),
      parser: accepts(parseAgentLimitPreference, input),
      decoder: accepts(decodeAgentLimitPreference, input),
    };
  });
  checks.set("refusals", refusals);
  assert.ok(
    refusals.every((entry) => !entry.parser && !entry.decoder),
    "every bad value is refused at both ends",
  );
  {
    const file = newFile();
    const store = new AgentLimitPreferenceStore(file);
    await Effect.runPromise(store.load());
    await Effect.runPromise(store.set({ enabled: true, max: 7, agentsPerTab: 5 }));
    assert.throws(() => parseAgentLimitPreference({ enabled: true, max: 7, agentsPerTab: 9 }));
    assert.equal(store.agentsPerTab(), 5, "a refused value does not change the stored one");
  }

  // 3. A file with no field reads the default.
  {
    const file = newFile();
    await writeFile(file, JSON.stringify({ version: 1, enabled: true, max: 3 }));
    const store = new AgentLimitPreferenceStore(file);
    await Effect.runPromise(store.load());
    checks.set("noField", { agentsPerTab: store.agentsPerTab(), preference: store.get() });
    assert.equal(store.agentsPerTab(), DEFAULT_AGENTS_PER_TAB);
    assert.equal(DEFAULT_AGENTS_PER_TAB, 4);
    assert.deepEqual(store.get(), { enabled: true, max: 3 });
  }

  // 4. A file with an invalid field reads the default of the whole preference.
  {
    const file = newFile();
    await writeFile(file, JSON.stringify({ version: 1, enabled: true, max: 3, agentsPerTab: 9 }));
    const store = new AgentLimitPreferenceStore(file);
    await Effect.runPromise(store.load());
    checks.set("invalidInFile", { agentsPerTab: store.agentsPerTab(), preference: store.get() });
    assert.deepEqual(store.get(), DEFAULT_AGENT_LIMIT_PREFERENCE);
    assert.equal(store.agentsPerTab(), DEFAULT_AGENTS_PER_TAB);
  }

  // 5. `set` without the field keeps the saved value, also after a restart.
  {
    const file = newFile();
    const store = new AgentLimitPreferenceStore(file);
    await Effect.runPromise(store.load());
    await Effect.runPromise(store.set({ enabled: false, max: 10, agentsPerTab: 6 }));
    await Effect.runPromise(store.set(parseAgentLimitPreference({ enabled: true, max: 5 })));
    const again = new AgentLimitPreferenceStore(file);
    await Effect.runPromise(again.load());
    const onDisk = JSON.parse(await readFile(file, "utf8"));
    checks.set("keepOnSetWithoutField", { agentsPerTab: again.agentsPerTab(), onDisk });
    assert.equal(again.agentsPerTab(), 6);
    assert.equal(onDisk.agentsPerTab, 6);
    assert.deepEqual(again.get(), { enabled: true, max: 5, agentsPerTab: 6 });
  }

  // 6. The parser and the decoder agree.
  const table: unknown[] = [
    { enabled: true, max: 10 },
    { enabled: true, max: 10, agentsPerTab: 1 },
    { enabled: false, max: 10, agentsPerTab: 8 },
    { enabled: true, max: 10, agentsPerTab: 4, tabsPerAgent: 3 },
    { enabled: true, max: 10, agentsPerTab: 4.0000001 },
    { enabled: true, max: 0, agentsPerTab: 4 },
    { enabled: "yes", max: 10, agentsPerTab: 4 },
    { enabled: true, max: 10, agentsPerTab: undefined },
    {},
    null,
  ];
  const agreement = table.map((value) => ({
    value: JSON.stringify(value),
    parser: accepts(parseAgentLimitPreference, value),
    decoder: accepts(decodeAgentLimitPreference, value),
  }));
  checks.set("agreement", agreement);
  assert.ok(
    agreement.every((entry) => entry.parser === entry.decoder),
    "the parser and the decoder accept and refuse the same values",
  );
  // 7. The tab mode and the ceiling.
  for (const mode of ["fixed", "memory"]) {
    const file = newFile();
    const store = new AgentLimitPreferenceStore(file, { memoryReadable: true });
    await Effect.runPromise(store.load());
    await Effect.runPromise(
      store.set(parseAgentLimitPreference({ enabled: true, max: 7, tabsMode: mode, tabsPerAgent: 6 })),
    );
    const again = new AgentLimitPreferenceStore(file, { memoryReadable: false });
    await Effect.runPromise(again.load());
    assert.equal(again.tabsMode(), mode, `${mode} is saved and read back, whatever the computer reads`);
    assert.equal(again.tabsPerAgent(), 6);
  }
  const tabsRefusals = [
    { tabsMode: "auto" },
    { tabsMode: "" },
    { tabsMode: 1 },
    { tabsMode: null },
    { tabsPerAgent: 0 },
    { tabsPerAgent: 9 },
    { tabsPerAgent: 2.5 },
  ].map((extra) => {
    const input = { enabled: true, max: 7, ...extra };
    return {
      extra: JSON.stringify(extra),
      parser: accepts(parseAgentLimitPreference, input),
      decoder: accepts(decodeAgentLimitPreference, input),
    };
  });
  checks.set("tabsRefusals", tabsRefusals);
  assert.ok(
    tabsRefusals.every((entry) => !entry.parser && !entry.decoder),
    "bad tab values are refused at both ends",
  );
  for (const tabsPerAgent of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const input = { enabled: true, max: 7, tabsPerAgent };
    assert.ok(
      accepts(parseAgentLimitPreference, input) && accepts(decodeAgentLimitPreference, input),
      `${tabsPerAgent} tabs`,
    );
  }

  // 8. A file with no `tabsMode` reads the mode of the computer.
  {
    const file = newFile();
    await writeFile(file, JSON.stringify({ version: 1, enabled: true, max: 3 }));
    const onMac = new AgentLimitPreferenceStore(file, { memoryReadable: true });
    const elsewhere = new AgentLimitPreferenceStore(file, { memoryReadable: false });
    await Effect.runPromise(onMac.load());
    await Effect.runPromise(elsewhere.load());
    checks.set("noTabsMode", {
      withReading: { mode: onMac.tabsMode(), tabs: onMac.tabsPerAgent() },
      withoutReading: { mode: elsewhere.tabsMode(), tabs: elsewhere.tabsPerAgent() },
    });
    assert.equal(onMac.tabsMode(), "memory");
    assert.equal(onMac.tabsPerAgent(), 4, "the ceiling of the memory mode");
    assert.equal(elsewhere.tabsMode(), "fixed");
    assert.equal(elsewhere.tabsPerAgent(), 2, "the fixed number");
  }

  // 9. `set` without the fields keeps the saved ones, also after a restart.
  {
    const file = newFile();
    const store = new AgentLimitPreferenceStore(file, { memoryReadable: true });
    await Effect.runPromise(store.load());
    await Effect.runPromise(store.set({ enabled: true, max: 7, tabsMode: "fixed", tabsPerAgent: 5 }));
    await Effect.runPromise(store.set(parseAgentLimitPreference({ enabled: false, max: 9 })));
    const again = new AgentLimitPreferenceStore(file, { memoryReadable: true });
    await Effect.runPromise(again.load());
    const onDisk = JSON.parse(await readFile(file, "utf8"));
    checks.set("keepTabsOnSet", { mode: again.tabsMode(), tabs: again.tabsPerAgent(), onDisk });
    assert.equal(again.tabsMode(), "fixed");
    assert.equal(again.tabsPerAgent(), 5);
    assert.equal(onDisk.tabsMode, "fixed");
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  const out = { ...report, checks: Object.fromEntries(checks) };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(out, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
