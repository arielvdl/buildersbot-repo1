// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { BuildersBotDatabase } from "../buildersbot-database";
import { AgentThreadStore } from "./agent-thread-store";

// Failure modes: a title that a model wrote replaces a title that a person set or that an agent chose, or a
// second generation replaces the first one.
const roots: string[] = [];
const databases: BuildersBotDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "thread-title-"));
  roots.push(root);
  const database = new BuildersBotDatabase(root);
  databases.push(database);
  await Effect.runPromise(database.initialize());
  return new AgentThreadStore(database);
}

const start = (store: AgentThreadStore, titleSource: "auto" | "agent") =>
  store.create({
    agentId: "quick",
    origin: "user",
    text: "Faz uma análise pra mim",
    title: "Faz uma análise",
    titleSource,
  });

describe("AgentThreadStore.setGeneratedTitle", () => {
  it("replaces a title that follows the first message, once", async () => {
    const store = await setup();
    const task = start(store, "auto");
    expect(store.setGeneratedTitle(task.threadId, "Análise da extensão")).toBe(true);
    expect(store.task(task.taskId)).toMatchObject({ title: "Análise da extensão", titleSource: "agent" });
    expect(store.setGeneratedTitle(task.threadId, "Outro título")).toBe(false);
    expect(store.task(task.taskId)?.title).toBe("Análise da extensão");
  });

  it("keeps a title that a person set", async () => {
    const store = await setup();
    const task = start(store, "auto");
    store.rename(task.threadId, "Meu título");
    expect(store.setGeneratedTitle(task.threadId, "Título gerado")).toBe(false);
    expect(store.task(task.taskId)?.title).toBe("Meu título");
  });

  it("keeps a title that an agent chose", async () => {
    const store = await setup();
    const task = start(store, "agent");
    expect(store.setGeneratedTitle(task.threadId, "Título gerado")).toBe(false);
  });
});
