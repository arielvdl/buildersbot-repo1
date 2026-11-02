// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateBuildersBotDatabase } from "./buildersbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a failed upgrade leaves the table
// or its marker; a newer or incomplete history is accepted; the table accepts an outcome it must refuse;
// a record disappears with its channel. These fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  migrateUpTo(db, version);
  return db;
}

function migrateUpTo(db: DatabaseSync, version: number): void {
  db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateBuildersBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
}

function seed(db: DatabaseSync): void {
  db.prepare(`INSERT INTO projection_agent_memories
    (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('memory-1', 'chief', 'The build runs at night.', 'the build runs at night.', 'manual', NULL,
      '2026-01-01', '2026-01-01', 2)`).run();
}

/** Every row of every table, by table name. */
function contents(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

function reportObjects(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'channel_tab_report%' ORDER BY name").all();
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 51 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

function insertReport(db: DatabaseSync, id: string, outcome: string, agents = "[]"): void {
  db.prepare(`INSERT INTO channel_tab_reports
    (report_id, channel_id, channel_name, topic_id, topic_name, outcome, note, opened_at, closed_at, agents_json)
    VALUES (?, 'channel-1', 'Launch', 'topic-1', 'Plan', ?, NULL, '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z', ?)`).run(id, outcome, agents);
}

describe("channel tab report migration", () => {
  it.each(Array.from({ length: 43 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db);
      // The earlier migrations run first; the rows after them are what v51 must keep.
      if (version < 50) migrateUpTo(db, 50);
      const before = contents(db);
      migrateBuildersBotDatabase(db);
      expect(contents(db)).toEqual({ ...before, channel_tab_reports: [] });
      expectHealthy(db);
    },
  );

  it("creates the table and its one index, and a new database has the same", () => {
    const upgraded = databaseAt(50);
    migrateBuildersBotDatabase(upgraded);
    const fresh = new DatabaseSync(":memory:");
    databases.push(fresh);
    migrateBuildersBotDatabase(fresh);
    expect(reportObjects(upgraded)).toEqual([{ name: "channel_tab_reports" }, { name: "channel_tab_reports_closed" }]);
    expect(reportObjects(fresh)).toEqual(reportObjects(upgraded));
    expectHealthy(fresh);
  });

  it("rolls back the table and the marker after a late failure, then retries", () => {
    const db = databaseAt(50);
    seed(db);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=51
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateBuildersBotDatabase(db)).toThrow("migration to version 51 failed");
    expect(contents(db)).toEqual(before);
    expect(reportObjects(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=51").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateBuildersBotDatabase(db);
    expect(contents(db)).toEqual({ ...before, channel_tab_reports: [] });
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it creates the table", () => {
    const db = databaseAt(50);
    seed(db);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(52,'now')");
    expect(() => migrateBuildersBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=52; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateBuildersBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(reportObjects(db)).toEqual([]);
  });

  it("refuses an unknown outcome and broken agent JSON, and keeps a record when its channel goes", () => {
    const db = databaseAt(50);
    migrateBuildersBotDatabase(db);
    insertReport(db, "report-1", "done", '[{"id":"chief","name":"Chief"}]');
    insertReport(db, "report-2", "not-done");
    insertReport(db, "report-3", "other");
    expect(() => insertReport(db, "report-4", "abandoned")).toThrow("constraint failed");
    expect(() => insertReport(db, "report-5", "done", "{not json")).toThrow("constraint failed");
    expect(() => insertReport(db, "report-1", "done")).toThrow("constraint failed");

    db.prepare("INSERT INTO projection_channels (channel_id, channel_json) VALUES ('channel-1', '{}')").run();
    db.prepare("DELETE FROM projection_channels WHERE channel_id='channel-1'").run();
    expect(db.prepare("SELECT COUNT(*) AS count FROM channel_tab_reports").get()).toEqual({ count: 3 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
