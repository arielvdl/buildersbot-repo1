// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { AgentLimitPreferenceStore } from "./agent-limit-preference-store";
import { parseAgentLimitPreference } from "./ipc/app-inputs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function path(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-limit-pref-"));
  roots.push(root);
  return join(root, "agent-limit.json");
}

describe("the agent limit preference", () => {
  it("is off, at ten agents, when nothing is saved, so no limit holds a turn", async () => {
    const store = new AgentLimitPreferenceStore(await path());
    await Effect.runPromise(store.load());
    expect(store.get()).toEqual({ enabled: false, max: 10 });
    expect(store.limit()).toBeNull();
  });

  it("reads as off for a damaged file, another shape, or a value out of range", async () => {
    const file = await path();
    for (const content of [
      "{ nope",
      JSON.stringify({ version: 1, enabled: "yes", max: 10 }),
      JSON.stringify({ version: 1, enabled: true, max: 0 }),
      JSON.stringify({ version: 1, enabled: true, max: 65 }),
      JSON.stringify({ version: 1, enabled: true, max: 3.5 }),
      JSON.stringify({ version: 2, enabled: true, max: 3 }),
    ]) {
      await writeFile(file, content);
      const store = new AgentLimitPreferenceStore(file);
      await Effect.runPromise(store.load());
      expect(store.limit()).toBeNull();
    }
  });

  it("keeps what was set across a restart, and gives the cap while it is on", async () => {
    const file = await path();
    await Effect.runPromise(new AgentLimitPreferenceStore(file).set({ enabled: true, max: 3 }));
    const again = new AgentLimitPreferenceStore(file);
    await Effect.runPromise(again.load());
    expect(again.get()).toEqual({ enabled: true, max: 3 });
    expect(again.limit()).toBe(3);
  });

  it("gives four agents per tab when none is saved, and keeps the saved one when a client sends none", async () => {
    const file = await path();
    const store = new AgentLimitPreferenceStore(file);
    await Effect.runPromise(store.load());
    expect(store.agentsPerTab()).toBe(4);
    await Effect.runPromise(store.set({ enabled: false, max: 10, agentsPerTab: 6 }));
    await Effect.runPromise(store.set({ enabled: true, max: 5 }));
    const again = new AgentLimitPreferenceStore(file);
    await Effect.runPromise(again.load());
    expect(again.agentsPerTab()).toBe(6);
    expect(again.get()).toEqual({ enabled: true, max: 5, agentsPerTab: 6 });
  });

  it("reads the default for a file with agents per tab out of range", async () => {
    const file = await path();
    await writeFile(file, JSON.stringify({ version: 1, enabled: true, max: 3, agentsPerTab: 9 }));
    const store = new AgentLimitPreferenceStore(file);
    await Effect.runPromise(store.load());
    expect(store.get()).toEqual({ enabled: false, max: 10 });
    expect(store.agentsPerTab()).toBe(4);
  });

  it("reads the tab mode as memory with a memory reading and as fixed without one, and keeps the saved one", async () => {
    const file = await path();
    const withReading = new AgentLimitPreferenceStore(file, { memoryReadable: true });
    await Effect.runPromise(withReading.load());
    expect(withReading.tabsMode()).toBe("memory");
    expect(withReading.tabsPerAgent()).toBe(4);
    const without = new AgentLimitPreferenceStore(file);
    await Effect.runPromise(without.load());
    expect(without.tabsMode()).toBe("fixed");
    expect(without.tabsPerAgent()).toBe(2);
    await Effect.runPromise(withReading.set({ enabled: false, max: 10, tabsMode: "fixed", tabsPerAgent: 8 }));
    await Effect.runPromise(withReading.set({ enabled: true, max: 5 }));
    const again = new AgentLimitPreferenceStore(file, { memoryReadable: true });
    await Effect.runPromise(again.load());
    expect(again.get()).toEqual({ enabled: true, max: 5, tabsPerAgent: 8, tabsMode: "fixed" });
    expect(again.tabsMode()).toBe("fixed");
  });

  it("reads the default for a file with a tab mode that is not known or tabs above 8", async () => {
    const file = await path();
    for (const content of [
      { version: 1, enabled: true, max: 3, tabsMode: "fast" },
      { version: 1, enabled: true, max: 3, tabsPerAgent: 9 },
    ]) {
      await writeFile(file, JSON.stringify(content));
      const store = new AgentLimitPreferenceStore(file);
      await Effect.runPromise(store.load());
      expect(store.get()).toEqual({ enabled: false, max: 10 });
    }
  });

  it("refuses a value out of range instead of storing it", async () => {
    const store = new AgentLimitPreferenceStore(await path());
    await expect(Effect.runPromise(store.set({ enabled: true, max: 0 }))).rejects.toBeDefined();
    expect(store.limit()).toBeNull();
  });
});

describe("the IPC input of the agent limit", () => {
  it("takes a whole number of agents from 1 to 64", () => {
    expect(parseAgentLimitPreference({ enabled: true, max: 1 })).toEqual({ enabled: true, max: 1 });
    expect(parseAgentLimitPreference({ enabled: false, max: 64, extra: "dropped" })).toEqual({
      enabled: false,
      max: 64,
    });
    expect(parseAgentLimitPreference({ enabled: true, max: 3, tabsPerAgent: 8, tabsMode: "memory" })).toEqual({
      enabled: true,
      max: 3,
      tabsPerAgent: 8,
      tabsMode: "memory",
    });
    expect(parseAgentLimitPreference({ enabled: true, max: 3, agentsPerTab: 8 })).toEqual({
      enabled: true,
      max: 3,
      agentsPerTab: 8,
    });
  });

  it("refuses anything else, and never clamps it", () => {
    for (const input of [
      null,
      {},
      { enabled: true },
      { enabled: true, max: 0 },
      { enabled: true, max: 65 },
      { enabled: true, max: 2.5 },
      { enabled: true, max: "10" },
      { enabled: true, max: 10, tabsPerAgent: 9 },
      { enabled: true, max: 10, tabsMode: "auto" },
      { enabled: true, max: 10, agentsPerTab: 0 },
      { enabled: true, max: 10, agentsPerTab: 9 },
      { enabled: true, max: 10, agentsPerTab: 2.5 },
      { enabled: "true", max: 10 },
    ])
      expect(() => parseAgentLimitPreference(input)).toThrow();
  });
});
