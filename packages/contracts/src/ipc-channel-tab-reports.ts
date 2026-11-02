import { INPUT_LIMITS } from "./input-limits";
import { integerInRange, isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/**
 * How a closed channel tab ended, as the person chose it in the close dialog. The record is kept on
 * this computer and shown in the Profile. It has no foreign key: it outlives the tab and the channel.
 */
export const CHANNEL_TAB_OUTCOMES = ["done", "not-done", "other"] as const;
export type ChannelTabOutcome = (typeof CHANNEL_TAB_OUTCOMES)[number];

export const CHANNEL_TAB_NOTE_LIMIT = 500;
export const CHANNEL_TAB_RESULT_LIMIT = 280;
export const CHANNEL_TAB_REPORT_AGENT_LIMIT = 12;
export const CHANNEL_TAB_REPORT_PAGE = 20;
export const CHANNEL_TAB_REPORT_PAGE_MAX = 50;
/** The longest period one request can ask for. */
export const CHANNEL_TAB_REPORT_PERIOD_DAYS = 366;
const CURSOR_LIMIT = 300;
const NAME_LIMIT = INPUT_LIMITS.agentName;
const DAY_MS = 86_400_000;

/** What the close dialog sends with `topic-delete`. `other` needs a note. */
export interface ChannelTabCloseReport {
  outcome: ChannelTabOutcome;
  note?: string | undefined;
}

export interface ChannelTabReportsInput {
  /** ISO start of the period in the user's time zone, computed in the renderer. */
  since: string;
  /** ISO end of the period, exclusive. The period is at most 366 days. */
  until: string;
  /** Opaque. Absent asks for the first page, which also carries the totals. */
  cursor?: string | undefined;
  /** 1 to 50. The default is 20. */
  limit?: number | undefined;
}

export interface ChannelTabReportAgent {
  id: string;
  name: string;
}

export interface ChannelTabReport {
  id: string;
  channelId: string;
  /** The channel name when the tab closed. */
  channelName: string;
  topicId: string;
  /** The tab name when the tab closed. */
  topicName: string;
  outcome: ChannelTabOutcome;
  note: string | null;
  openedAt: string;
  closedAt: string;
  agents: ChannelTabReportAgent[];
  /** `open` counts the tasks the close stopped. */
  tasks: { completed: number; failed: number; open: number };
  lastResult: string | null;
}

export interface ChannelTabReportsPage {
  /** Only on the first page of a period. Later pages answer null. */
  totals: Record<ChannelTabOutcome, number> | null;
  /** Newest first: `closedAt` then `id`, both descending. */
  reports: ChannelTabReport[];
  nextCursor: string | null;
}

export interface DeleteChannelTabReportInput {
  id: string;
}

export function isChannelTabOutcome(value: unknown): value is ChannelTabOutcome {
  return isOneOf(CHANNEL_TAB_OUTCOMES, value);
}

/**
 * The report of a `topic-delete` command. The UI blocks a bad report first, so the English errors
 * here only reach a malformed payload. A note is trimmed; an empty one is dropped.
 */
export function parseChannelTabCloseReport(value: unknown): ChannelTabCloseReport {
  if (!isDynamicRecord(value) || !isChannelTabOutcome(value.outcome)) throw new Error("The tab outcome is not valid.");
  if (value.note !== undefined && !isBoundedString(value.note, CHANNEL_TAB_NOTE_LIMIT))
    throw new Error("The tab note is too long.");
  const note = value.note?.trim() ?? "";
  if (value.outcome === "other" && note.length === 0) throw new Error("The tab note is required for this outcome.");
  return { outcome: value.outcome, ...(note.length > 0 ? { note } : {}) };
}

// A stored `closed_at` is `toISOString()`, so a bound in the same form compares as text.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function isoBound(value: unknown, label: string): string {
  if (!isString(value) || !ISO_UTC.test(value)) throw new Error(`The ${label} date is not valid.`);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`The ${label} date is not valid.`);
  return new Date(time).toISOString();
}

export function parseChannelTabReportsInput(value: unknown): ChannelTabReportsInput {
  if (!isDynamicRecord(value)) throw new Error("Invalid closed tabs request.");
  const since = isoBound(value.since, "start");
  const until = isoBound(value.until, "end");
  const span = Date.parse(until) - Date.parse(since);
  if (span <= 0 || span > CHANNEL_TAB_REPORT_PERIOD_DAYS * DAY_MS) throw new Error("The period is not valid.");
  if (value.cursor !== undefined && !(isBoundedString(value.cursor, CURSOR_LIMIT) && value.cursor.includes("|")))
    throw new Error("The cursor is not valid.");
  if (value.limit !== undefined && !integerInRange(value.limit, 1, CHANNEL_TAB_REPORT_PAGE_MAX))
    throw new Error("The page size is not valid.");
  return {
    since,
    until,
    ...(value.cursor !== undefined ? { cursor: value.cursor } : {}),
    ...(value.limit !== undefined ? { limit: value.limit } : {}),
  };
}

export function parseDeleteChannelTabReportInput(value: unknown): DeleteChannelTabReportInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.id)) throw new Error("Invalid closed tab id.");
  return { id: value.id };
}

function count(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

export function isReportAgent(value: unknown): value is ChannelTabReportAgent {
  return isDynamicRecord(value) && isIdentifier(value.id) && isBoundedString(value.name, NAME_LIMIT);
}

export function isChannelTabReport(value: unknown): value is ChannelTabReport {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.channelId) &&
    isBoundedString(value.channelName, NAME_LIMIT) &&
    isIdentifier(value.topicId) &&
    isBoundedString(value.topicName, NAME_LIMIT) &&
    isChannelTabOutcome(value.outcome) &&
    (value.note === null || isBoundedString(value.note, CHANNEL_TAB_NOTE_LIMIT)) &&
    isBoundedString(value.openedAt, 64) &&
    isBoundedString(value.closedAt, 64) &&
    Array.isArray(value.agents) &&
    value.agents.length <= CHANNEL_TAB_REPORT_AGENT_LIMIT &&
    value.agents.every(isReportAgent) &&
    isDynamicRecord(value.tasks) &&
    count(value.tasks.completed) &&
    count(value.tasks.failed) &&
    count(value.tasks.open) &&
    (value.lastResult === null || isBoundedString(value.lastResult, CHANNEL_TAB_RESULT_LIMIT))
  );
}

function isTotals(value: unknown): value is Record<ChannelTabOutcome, number> {
  return isDynamicRecord(value) && CHANNEL_TAB_OUTCOMES.every((outcome) => count(value[outcome]));
}

export function decodeChannelTabReportsPage(value: unknown): ChannelTabReportsPage {
  if (
    !isDynamicRecord(value) ||
    !(value.totals === null || isTotals(value.totals)) ||
    !Array.isArray(value.reports) ||
    value.reports.length > CHANNEL_TAB_REPORT_PAGE_MAX ||
    !value.reports.every(isChannelTabReport) ||
    !(value.nextCursor === null || isBoundedString(value.nextCursor, CURSOR_LIMIT))
  )
    throw new Error("Invalid closed tabs response.");
  return {
    totals: value.totals === null ? null : { ...value.totals },
    reports: value.reports,
    nextCursor: value.nextCursor,
  };
}

export function decodeOptionalChannelTabReportsPage(value: unknown): ChannelTabReportsPage | null {
  return value === null ? null : decodeChannelTabReportsPage(value);
}

/** True when the report existed and is gone. A remote server answers null: the records are local. */
export function decodeOptionalDeleteChannelTabReport(value: unknown): boolean | null {
  if (value === null || typeof value === "boolean") return value;
  throw new Error("Invalid closed tab response.");
}
