// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentSummary } from "@buildersbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { BuildersBotDatabase } from "./buildersbot-database";
import { runDatabaseMaintenance } from "./database/database-maintenance";
import { runCauseEffect } from "./effect-boundary";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createDatabase(): Promise<BuildersBotDatabase> {
  const root = await mkdtemp(join(tmpdir(), "buildersbot-db-maintenance-"));
  roots.push(root);
  const database = new BuildersBotDatabase(root);
  await runCauseEffect(database.initialize());
  return database;
}

function testAgent(): AgentSummary {
  return {
    id: "chief",
    provider: "codex",
    name: "Chief",
    title: "Coordinator",
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: "buildersbot-thread-chief",
    workspacePath: "/tmp/buildersbot-chief",
    preview: "42",
    updatedAt: "2026-08-18T10:00:01.000Z",
    avatarSeed: "chief",
    avatarHue: null,
    avatarUrl: null,
  };
}

/** Stages one turn with two items, and marks every row imported when `imported` is true. */
function stageTurn(
  database: BuildersBotDatabase,
  sessionId: string,
  turnId: string,
  input: { complete: boolean; imported: boolean },
): void {
  database.stageProviderHistoryFragment({
    sessionId,
    fragment: {
      turnId,
      status: "completed",
      complete: input.complete,
      items: [
        { id: `${turnId}-a`, type: "agentMessage", text: "first" },
        { id: `${turnId}-b`, type: "agentMessage", text: "second" },
      ],
    },
  });
  if (input.imported) database.markProviderHistoryTurnImported(sessionId, turnId);
}

const staged = (database: BuildersBotDatabase, sessionId: string, turnId: string) =>
  database.stagedProviderHistoryItems({ sessionId, turnId }).length;

describe("pruning of imported provider history staging", () => {
  async function seed() {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("maintenance-agent", [agent], "agents.imported");
    const threadId = agent.threadId;
    if (!threadId) throw new Error("The test agent has no thread.");
    const bind = (provider: "codex" | "claude", externalSessionId: string) =>
      database.bindProviderSession({
        threadId,
        provider,
        externalSessionId,
        model: agent.model,
        effort: agent.reasoningEffort,
      });
    // Each bind retires the one before it, so only the last session is active.
    const retiredClaude = bind("claude", "claude-old");
    const retiredCodex = bind("codex", "codex-old");
    const active = bind("codex", "codex-now");
    for (const session of [retiredClaude, retiredCodex, active])
      database.ensureProviderHistoryImport({
        sessionId: session.id,
        threadId,
        provider: session.provider,
        externalSessionId: session.externalSessionId,
      });
    return { database, retiredClaude, retiredCodex, active };
  }

  const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  it("deletes the imported rows of a retired session whose import is complete", async () => {
    const { database, retiredClaude, retiredCodex } = await seed();
    for (const session of [retiredClaude, retiredCodex]) {
      stageTurn(database, session.id, "turn-1", { complete: true, imported: true });
      database.markProviderHistoryImportState(session.id, "complete");
    }

    expect(database.pruneProviderHistoryStaging({ before: FUTURE, limit: 100 })).toBe(4);

    for (const session of [retiredClaude, retiredCodex]) {
      expect(staged(database, session.id, "turn-1")).toBe(0);
      // The turn row and the import row stay, so the import state keeps its meaning.
      expect(database.stagedProviderHistoryTurns(session.id)).toEqual([
        expect.objectContaining({ turnId: "turn-1", complete: true, imported: true }),
      ]);
      expect(database.providerHistoryImport(session.id)?.state).toBe("complete");
    }
    database.close();
  });

  it("keeps rows that a later read can still need", async () => {
    const { database, retiredCodex, active } = await seed();
    // The session that the agent still runs on: the boot backfill reads it again.
    stageTurn(database, active.id, "turn-1", { complete: true, imported: true });
    database.markProviderHistoryImportState(active.id, "complete");
    // A retired session with a turn that is not complete, one that is not imported, and an import that is not complete.
    stageTurn(database, retiredCodex.id, "turn-open", { complete: false, imported: true });
    stageTurn(database, retiredCodex.id, "turn-pending", { complete: true, imported: false });
    database.markProviderHistoryImportState(retiredCodex.id, "complete");

    expect(database.pruneProviderHistoryStaging({ before: FUTURE, limit: 100 })).toBe(0);
    expect(staged(database, active.id, "turn-1")).toBe(2);
    expect(staged(database, retiredCodex.id, "turn-open")).toBe(2);
    expect(staged(database, retiredCodex.id, "turn-pending")).toBe(2);

    stageTurn(database, retiredCodex.id, "turn-done", { complete: true, imported: true });
    database.markProviderHistoryImportState(retiredCodex.id, "active");
    expect(database.pruneProviderHistoryStaging({ before: FUTURE, limit: 100 })).toBe(0);
    database.close();
  });

  it("keeps rows of an import that changed after the cutoff", async () => {
    const { database, retiredCodex } = await seed();
    stageTurn(database, retiredCodex.id, "turn-1", { complete: true, imported: true });
    database.markProviderHistoryImportState(retiredCodex.id, "complete");

    expect(database.pruneProviderHistoryStaging({ before: "2000-01-01T00:00:00.000Z", limit: 100 })).toBe(0);
    expect(staged(database, retiredCodex.id, "turn-1")).toBe(2);
    database.close();
  });

  it("deletes no more than the limit in one batch", async () => {
    const { database, retiredCodex } = await seed();
    stageTurn(database, retiredCodex.id, "turn-1", { complete: true, imported: true });
    database.markProviderHistoryImportState(retiredCodex.id, "complete");

    expect(database.pruneProviderHistoryStaging({ before: FUTURE, limit: 1 })).toBe(1);
    expect(database.pruneProviderHistoryStaging({ before: FUTURE, limit: 1 })).toBe(1);
    expect(database.pruneProviderHistoryStaging({ before: FUTURE, limit: 1 })).toBe(0);
    database.close();
  });
});

describe("runDatabaseMaintenance", () => {
  it("runs the pruning in batches and yields between them", async () => {
    const calls: number[] = [];
    let remaining = 5_000;
    const db = new DatabaseSync(":memory:");
    let yields = 0;
    const result = await runDatabaseMaintenance(
      {
        connection: db,
        pruneProviderHistoryStaging: ({ limit }) => {
          const deleted = Math.min(limit, remaining);
          remaining -= deleted;
          calls.push(deleted);
          return deleted;
        },
      },
      {
        now: new Date("2026-11-04T12:00:00.000Z"),
        yieldToEventLoop: async () => {
          yields += 1;
        },
      },
    );
    expect(result.stagingRowsDeleted).toBe(5_000);
    expect(calls).toEqual([2_000, 2_000, 1_000]);
    expect(yields).toBe(2);
    db.close();
  });

  it("passes a cutoff of 7 days", async () => {
    const seen: string[] = [];
    const db = new DatabaseSync(":memory:");
    await runDatabaseMaintenance(
      {
        connection: db,
        pruneProviderHistoryStaging: ({ before }) => {
          seen.push(before);
          return 0;
        },
      },
      { now: new Date("2026-11-11T12:00:00.000Z") },
    );
    expect(seen).toEqual(["2026-11-04T12:00:00.000Z"]);
    db.close();
  });

  async function fileWithFreePages(autoVacuum: "none" | "incremental") {
    const root = await mkdtemp(join(tmpdir(), "buildersbot-db-vacuum-"));
    roots.push(root);
    const db = new DatabaseSync(join(root, "test.db"));
    db.exec(`PRAGMA auto_vacuum = ${autoVacuum === "incremental" ? 2 : 0}`);
    db.exec("CREATE TABLE blob (id INTEGER PRIMARY KEY, data TEXT)");
    const insert = db.prepare("INSERT INTO blob (data) VALUES (?)");
    for (let index = 0; index < 600; index += 1) insert.run("x".repeat(8_000));
    db.exec("DELETE FROM blob");
    return db;
  }

  it("gives free pages back when the file uses incremental auto vacuum", async () => {
    const db = await fileWithFreePages("incremental");
    const result = await runDatabaseMaintenance({ connection: db, pruneProviderHistoryStaging: () => 0 });
    expect(result.pagesReleased).toBeGreaterThan(0);
    expect(result.needsFullVacuum).toBe(false);
    db.close();
  });

  it("reports a file that needs a full vacuum and does not run one", async () => {
    const db = await fileWithFreePages("none");
    const result = await runDatabaseMaintenance({ connection: db, pruneProviderHistoryStaging: () => 0 });
    expect(result.pagesReleased).toBe(0);
    expect(result.needsFullVacuum).toBe(true);
    expect(result.freePages).toBeGreaterThan(0);
    db.close();
  });
});
