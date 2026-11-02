import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  CHANNEL_TAB_REPORT_AGENT_LIMIT,
  CHANNEL_TAB_REPORT_PAGE,
  CHANNEL_TAB_RESULT_LIMIT,
  type ChannelTabCloseReport,
  type ChannelTabOutcome,
  type ChannelTabReport,
  type ChannelTabReportAgent,
  type ChannelTabReportsInput,
  type ChannelTabReportsPage,
  isChannelTabOutcome,
  isReportAgent,
} from "@buildersbot/contracts/ipc";
import type { DynamicRecord } from "@buildersbot/contracts/runtime-values";
import { redactText } from "@buildersbot/logging";
import type { BuildersBotDatabase } from "./buildersbot-database";
import { VISIBLE_MESSAGE_FILTER, VISIBLE_MESSAGE_PARAMETER } from "./channel-message-filter";
import {
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database/database-rows";
import { messageExcerpt } from "./message-excerpt";

/** What `deleteTopic` knows about the tab it removes. The tab name and dates come from the tab row. */
export interface ChannelTabReportSnapshot extends ChannelTabCloseReport {
  channelId: string;
  channelName: string;
  topicId: string;
  topicName: string;
  openedAt: string;
  /** The tasks that the close stopped, counted before the stop. */
  tasksOpen: number;
}

/**
 * Writes the close record of one tab. It runs inside the transaction of `ChannelStore.deleteTopic`,
 * before the DELETE statements, on the connection that `dispatch` gives: it opens no transaction of
 * its own, so an error here rolls back the whole close and the tab stays. `ofTopic` is the SQL
 * filter that `deleteTopic` uses for the rows of the tab, with one `?` for the tab id.
 *
 * It reads three small things from the rows of the tab: the task counts, the agents that wrote in
 * it, and the last text of an agent. The note and that text are redacted before they are stored.
 */
export function writeChannelTabReport(
  db: DatabaseSync,
  ofTopic: (row: string) => string,
  snapshot: ChannelTabReportSnapshot,
): string {
  const { channelId, topicId } = snapshot;
  let completed = 0;
  let failed = 0;
  for (const row of databaseRows(
    db
      .prepare(
        `SELECT json_extract(task_json, '$.state') AS state, COUNT(*) AS count FROM projection_channel_tasks
         WHERE channel_id = ? AND ${ofTopic("task_json")} GROUP BY state`,
      )
      .all(channelId, topicId),
  )) {
    if (row.state === "completed") completed = requiredNumberColumn(row, "count");
    if (row.state === "failed") failed = requiredNumberColumn(row, "count");
  }
  const agents: ChannelTabReportAgent[] = databaseRows(
    db
      .prepare(
        `SELECT json_extract(message_json, '$.author.id') AS id, json_extract(message_json, '$.author.name') AS name,
           MIN(sequence) AS first
         FROM projection_channel_messages
         WHERE channel_id = ? AND ${ofTopic("message_json")} AND json_extract(message_json, '$.author.kind') = 'agent'
         GROUP BY id ORDER BY first LIMIT ?`,
      )
      .all(channelId, topicId, CHANNEL_TAB_REPORT_AGENT_LIMIT),
  ).map((row) => ({ id: requiredStringColumn(row, "id"), name: requiredStringColumn(row, "name") }));
  const last = databaseRow(
    db
      .prepare(
        `SELECT json_extract(message_json, '$.message.text') AS text FROM projection_channel_messages
         WHERE channel_id = ? AND ${ofTopic("message_json")}
           AND json_extract(message_json, '$.author.kind') = 'agent'
           AND COALESCE(json_extract(message_json, '$.superseded'), 0) = 0
           AND ${VISIBLE_MESSAGE_FILTER("message_json")}
           AND trim(COALESCE(json_extract(message_json, '$.message.text'), ''), char(9, 10, 13, 32)) != ''
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(channelId, topicId, VISIBLE_MESSAGE_PARAMETER),
  );
  const text = last ? optionalStringColumn(last, "text") : null;
  // Redact the whole text, then cut: a cut first could leave the start of a secret that the rules no longer match.
  const lastResult = text ? messageExcerpt(redactText(text), CHANNEL_TAB_RESULT_LIMIT) : null;
  const reportId = randomUUID();
  db.prepare(
    `INSERT INTO channel_tab_reports
       (report_id, channel_id, channel_name, topic_id, topic_name, outcome, note, opened_at, closed_at, agents_json,
        tasks_completed, tasks_failed, tasks_open, last_result)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    reportId,
    channelId,
    snapshot.channelName,
    topicId,
    snapshot.topicName,
    snapshot.outcome,
    snapshot.note ? redactText(snapshot.note) : null,
    snapshot.openedAt,
    new Date().toISOString(),
    JSON.stringify(agents),
    completed,
    failed,
    snapshot.tasksOpen,
    lastResult,
  );
  return reportId;
}

function agentsOf(json: string): ChannelTabReportAgent[] {
  const parsed = JSON.parse(json);
  return Array.isArray(parsed) ? parsed.filter(isReportAgent) : [];
}

function reportOf(row: DynamicRecord): ChannelTabReport {
  const outcome = requiredStringColumn(row, "outcome");
  if (!isChannelTabOutcome(outcome)) throw new Error("A stored tab outcome is not valid.");
  return {
    id: requiredStringColumn(row, "report_id"),
    channelId: requiredStringColumn(row, "channel_id"),
    channelName: requiredStringColumn(row, "channel_name"),
    topicId: requiredStringColumn(row, "topic_id"),
    topicName: requiredStringColumn(row, "topic_name"),
    outcome,
    note: optionalStringColumn(row, "note"),
    openedAt: requiredStringColumn(row, "opened_at"),
    closedAt: requiredStringColumn(row, "closed_at"),
    agents: agentsOf(requiredStringColumn(row, "agents_json")),
    tasks: {
      completed: requiredNumberColumn(row, "tasks_completed"),
      failed: requiredNumberColumn(row, "tasks_failed"),
      open: requiredNumberColumn(row, "tasks_open"),
    },
    lastResult: optionalStringColumn(row, "last_result"),
  };
}

/** `${closedAt}|${reportId}`. An ISO date has no `|`, so the last one splits the two. */
function splitCursor(cursor: string): { closedAt: string; reportId: string } {
  const at = cursor.lastIndexOf("|");
  if (at <= 0 || at === cursor.length - 1) throw new Error("The cursor is not valid.");
  return { closedAt: cursor.slice(0, at), reportId: cursor.slice(at + 1) };
}

/**
 * Owns the reads and the delete of the close records. The write is `writeChannelTabReport`, because
 * it must share the transaction of `deleteTopic`. It holds the core object and reads `.connection`
 * at each use, as the other stores do.
 */
export class ChannelTabReportStore {
  readonly #database: BuildersBotDatabase;

  constructor(database: BuildersBotDatabase) {
    this.#database = database;
  }

  /**
   * One page of a period, newest first. The totals by outcome come only with the first page, so the
   * pages after it cost one indexed read each. The page asks for one more row than it returns: that
   * row only tells whether there is a next page.
   */
  list(input: ChannelTabReportsInput): ChannelTabReportsPage {
    const db = this.#database.connection;
    const limit = input.limit ?? CHANNEL_TAB_REPORT_PAGE;
    const after = input.cursor === undefined ? null : splitCursor(input.cursor);
    const rows = databaseRows(
      db
        .prepare(
          `SELECT * FROM channel_tab_reports
           WHERE closed_at >= ? AND closed_at < ?${after ? " AND (closed_at, report_id) < (?, ?)" : ""}
           ORDER BY closed_at DESC, report_id DESC LIMIT ?`,
        )
        .all(input.since, input.until, ...(after ? [after.closedAt, after.reportId] : []), limit + 1),
    );
    const reports = rows.slice(0, limit).map(reportOf);
    const lastKept = reports.at(-1);
    return {
      totals: after ? null : this.#totals(input.since, input.until),
      reports,
      nextCursor: rows.length > limit && lastKept ? `${lastKept.closedAt}|${lastKept.id}` : null,
    };
  }

  /** True when the record existed. The other records, and their totals, are not touched. */
  delete(id: string): boolean {
    return this.#database.connection.prepare("DELETE FROM channel_tab_reports WHERE report_id = ?").run(id).changes > 0;
  }

  #totals(since: string, until: string): Record<ChannelTabOutcome, number> {
    const totals: Record<ChannelTabOutcome, number> = { done: 0, "not-done": 0, other: 0 };
    for (const row of databaseRows(
      this.#database.connection
        .prepare(
          `SELECT outcome, COUNT(*) AS count FROM channel_tab_reports
           WHERE closed_at >= ? AND closed_at < ? GROUP BY outcome`,
        )
        .all(since, until),
    )) {
      const outcome = requiredStringColumn(row, "outcome");
      if (isChannelTabOutcome(outcome)) totals[outcome] = requiredNumberColumn(row, "count");
    }
    return totals;
  }
}
