// Shared by migration v51 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// `channel_tab_reports`: one record for each channel tab that the user closed with an outcome. It is
// written directly, inside the transaction of `ChannelStore.deleteTopic`, and not through an event: the
// note is private and the event log is never deleted from. It has no foreign key on purpose. The
// record stays after the channel or the tab is gone, and it keeps the names that they had.
//
// `outcome` is the one domain rule kept in SQL. The limits of `note` (500) and `last_result` (280) are
// checked at the contract boundary, and both texts are redacted before they are written. `agents_json`
// is a list of `{ id, name }` with at most 12 items. `tasks_open` counts the tasks that the close stopped.
//
// One index serves the period filter, the newest-first order (read backward) and the totals by outcome.
export const CHANNEL_TAB_REPORT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS channel_tab_reports (
    report_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    topic_name TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('done', 'not-done', 'other')),
    note TEXT,
    opened_at TEXT NOT NULL,
    closed_at TEXT NOT NULL,
    agents_json TEXT NOT NULL CHECK(json_valid(agents_json)),
    tasks_completed INTEGER NOT NULL DEFAULT 0,
    tasks_failed INTEGER NOT NULL DEFAULT 0,
    tasks_open INTEGER NOT NULL DEFAULT 0,
    last_result TEXT
  );
  CREATE INDEX IF NOT EXISTS channel_tab_reports_closed ON channel_tab_reports(closed_at, report_id);
`;
