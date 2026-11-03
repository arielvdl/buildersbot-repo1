// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateBuildersBotDatabase } from "./buildersbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; an old thread gets a model; a failed
// upgrade leaves the column or the marker; a retry adds the column twice or drops the value that a
// development build wrote; a newer or incomplete history is accepted; a new database differs from an
// upgraded one. Sources 8 to 50 reach version 52 in the older migration tests; these fixtures cover the
// released version 51 and a version 47 source.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

type Rows = Record<string, Record<string, SQLOutputValue>[]>;

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateBuildersBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
  return db;
}

/** The agent's own chat, an open thread, an archived thread and a branch, in the version 51 columns. */
function seed(db: DatabaseSync): void {
  const conversation = db.prepare("INSERT INTO projection_threads VALUES (?, 'chief', ?, NULL, ?, ?, 1)");
  for (const [id, title] of [
    ["buildersbot-thread-chief", 'Chief 界"\\'],
    ["buildersbot-thread-open", "Billing export"],
    ["buildersbot-thread-closed", "Release notes"],
    ["buildersbot-thread-branch", "Billing export #2"],
  ] as const)
    conversation.run(id, title, "2026-10-01T07:00:00.000Z", "2026-10-01T07:00:00.000Z");
  db.exec(`INSERT INTO projection_agent_threads
    (thread_id, agent_id, legacy_task_id, origin, title, title_source, outcome, error, created_at, updated_at,
     archived_at, last_event_sequence, first_message, preview, branch_source_thread_id,
     branch_source_message_id, branch_through_message_id)
    VALUES ('buildersbot-thread-open', 'chief', NULL, 'user', 'Billing export', 'user', NULL, NULL,
        '2026-10-01T08:00:00.000Z', '2026-10-02T08:00:00.000Z', NULL, 4, 'Export', 'Now CSV', NULL, NULL, NULL),
      ('buildersbot-thread-closed', 'chief', 'agent-task-closed', 'agent', 'Release notes', 'agent', 'failed',
        'Provider said no', '2026-10-01T09:00:00.000Z', '2026-10-02T09:00:00.000Z', '2026-10-03T09:00:00.000Z', 7,
        '', '', NULL, NULL, NULL),
      ('buildersbot-thread-branch', 'chief', NULL, 'user', 'Billing export #2', 'auto', NULL, NULL,
        '2026-10-04T08:00:00.000Z', '2026-10-04T08:00:00.000Z', NULL, 9, '', '', 'buildersbot-thread-open',
        'message-1', 'message-2')`);
}

/** Every row of every table, by table name. */
function contents(db: DatabaseSync): Rows {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

/** What the upgrade adds to each old thread: a null model. */
function withNullRuntime(before: Rows): Rows {
  return {
    ...before,
    projection_agent_threads: (before.projection_agent_threads ?? []).map((row) => ({ ...row, runtime_json: null })),
  };
}

function threadColumns(db: DatabaseSync): string[] {
  return db
    .prepare("PRAGMA table_info(projection_agent_threads)")
    .all()
    .map((column) => String(column.name));
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 52 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("agent thread runtime migration", () => {
  it("keeps every row from released schema 51, and no old thread has a model", () => {
    const db = databaseAt(51);
    seed(db);
    const before = contents(db);
    migrateBuildersBotDatabase(db);
    expect(contents(db)).toEqual(withNullRuntime(before));
    expect(threadColumns(db).at(-1)).toBe("runtime_json");
    expectHealthy(db);
  });

  it("keeps every row from released schema 47 on the way to 52", () => {
    const db = databaseAt(47);
    seed47(db);
    migrateBuildersBotDatabase(db);
    expect(db.prepare("SELECT thread_id, runtime_json FROM projection_agent_threads ORDER BY thread_id").all()).toEqual(
      [
        { thread_id: "buildersbot-thread-closed", runtime_json: null },
        { thread_id: "buildersbot-thread-open", runtime_json: null },
      ],
    );
    expectHealthy(db);
  });

  it("rolls back the column and the marker after a late failure, then retries", () => {
    const db = databaseAt(51);
    seed(db);
    const before = contents(db);
    const columnsBefore = threadColumns(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=52
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateBuildersBotDatabase(db)).toThrow("migration to version 52 failed");
    expect(contents(db)).toEqual(before);
    expect(threadColumns(db)).toEqual(columnsBefore);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=52").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateBuildersBotDatabase(db);
    expect(contents(db)).toEqual(withNullRuntime(before));
    expectHealthy(db);
  });

  it("keeps the column and the values that a development build wrote before the marker", () => {
    const db = databaseAt(51);
    seed(db);
    const stored = '{"v":1,"provider":"codex","model":"gpt-5.5"}';
    db.exec("ALTER TABLE projection_agent_threads ADD COLUMN runtime_json TEXT");
    db.prepare("UPDATE projection_agent_threads SET runtime_json = ? WHERE thread_id = 'buildersbot-thread-open'").run(
      stored,
    );
    migrateBuildersBotDatabase(db);
    expect(threadColumns(db).filter((column) => column === "runtime_json")).toHaveLength(1);
    expect(db.prepare("SELECT thread_id, runtime_json FROM projection_agent_threads ORDER BY thread_id").all()).toEqual(
      [
        { thread_id: "buildersbot-thread-branch", runtime_json: null },
        { thread_id: "buildersbot-thread-closed", runtime_json: null },
        { thread_id: "buildersbot-thread-open", runtime_json: stored },
      ],
    );
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the column", () => {
    const db = databaseAt(51);
    seed(db);
    const before = contents(db);
    const columnsBefore = threadColumns(db);
    db.exec("INSERT INTO schema_migrations VALUES(53,'now')");
    expect(() => migrateBuildersBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=53; DELETE FROM schema_migrations WHERE version=46");
    expect(() => migrateBuildersBotDatabase(db)).toThrow("missing version 46");
    expect(contents(db)).toEqual(before);
    expect(threadColumns(db)).toEqual(columnsBefore);
  });

  it("refuses to open a version 52 database in an application that knows only 51", () => {
    const db = databaseAt(51);
    seed(db);
    migrateBuildersBotDatabase(db);
    const after = contents(db);
    // An application one release older knows versions up to 51: version 52 is newer than it supports.
    db.exec("INSERT INTO schema_migrations VALUES(53,'now')");
    expect(() => migrateBuildersBotDatabase(db)).toThrow("newer than this application supports");
    expect(contents(db)).toEqual(after);
  });

  it("keeps a row and its model when the thread is deleted next to it", () => {
    const db = databaseAt(51);
    seed(db);
    migrateBuildersBotDatabase(db);
    db.prepare("UPDATE projection_agent_threads SET runtime_json = ? WHERE thread_id = 'buildersbot-thread-open'").run(
      '{"v":1,"provider":"codex","model":"gpt-5.5"}',
    );
    db.exec("DELETE FROM projection_threads WHERE thread_id='buildersbot-thread-closed'");
    expect(db.prepare("SELECT thread_id FROM projection_agent_threads ORDER BY thread_id").all()).toEqual([
      { thread_id: "buildersbot-thread-branch" },
      { thread_id: "buildersbot-thread-open" },
    ]);
    expectHealthy(db);
  });
});

/** A version 47 database: the agent's own chat, an open thread and an archived one. */
function seed47(db: DatabaseSync): void {
  const conversation = db.prepare("INSERT INTO projection_threads VALUES (?, 'chief', ?, NULL, ?, ?, 1)");
  for (const [id, title] of [
    ["buildersbot-thread-chief", "Chief"],
    ["buildersbot-thread-open", "Billing export"],
    ["buildersbot-thread-closed", "Release notes"],
  ] as const)
    conversation.run(id, title, "2026-10-01T07:00:00.000Z", "2026-10-01T07:00:00.000Z");
  db.exec(`INSERT INTO projection_agent_threads
    (thread_id, agent_id, legacy_task_id, origin, title, title_source, outcome, error, created_at, updated_at,
     archived_at, last_event_sequence)
    VALUES ('buildersbot-thread-open', 'chief', NULL, 'user', 'Billing export', 'user', NULL, NULL,
        '2026-10-01T08:00:00.000Z', '2026-10-02T08:00:00.000Z', NULL, 4),
      ('buildersbot-thread-closed', 'chief', 'agent-task-closed', 'agent', 'Release notes', 'agent', 'failed',
        'Provider said no', '2026-10-01T09:00:00.000Z', '2026-10-02T09:00:00.000Z', '2026-10-03T09:00:00.000Z', 7)`);
}
