import type { DatabaseSync } from "node:sqlite";
import { databaseRow, requiredNumberColumn } from "./database-rows";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an inactive session keeps its imported staged rows before the pruning takes them. */
const STAGING_RETENTION_MS = 7 * DAY_MS;
/** The rows of one delete. A batch is one short write lock, so a turn never waits behind a big one. */
const STAGING_BATCH_ROWS = 2_000;
/** The most batches of one run. A later run takes the rest. */
const STAGING_MAX_BATCHES = 25;
/** The most pages that one run gives back to the disk when the file uses incremental auto vacuum. */
const INCREMENTAL_VACUUM_PAGES = 2_000;
/** Below this many free pages the file is left as it is. */
const INCREMENTAL_VACUUM_MIN_FREE_PAGES = 512;
/** SQLite value of `PRAGMA auto_vacuum` for incremental mode. */
const AUTO_VACUUM_INCREMENTAL = 2;

export interface DatabaseMaintenanceTarget {
  readonly connection: DatabaseSync;
  pruneProviderHistoryStaging(input: { before: string; limit: number }): number;
}

interface DatabaseMaintenanceResult {
  stagingRowsDeleted: number;
  freePages: number;
  pageSize: number;
  /** The pages that this run gave back to the disk. */
  pagesReleased: number;
  /** True when pages are free but the file cannot give them back without a full `VACUUM`. */
  needsFullVacuum: boolean;
}

interface DatabaseMaintenanceOptions {
  now?: Date;
  retentionMs?: number;
  /** Runs between two batches, so the event loop can answer. Omitted: the next turn of the event loop. */
  yieldToEventLoop?: () => Promise<void>;
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

function pragmaNumber(db: DatabaseSync, pragma: string, column: string): number {
  const row = databaseRow(db.prepare(`PRAGMA ${pragma}`).get());
  return row ? requiredNumberColumn(row, column) : 0;
}

/**
 * Keeps the database from growing for rows that nothing reads again. It runs off the hot path, in
 * short batches. It deletes only what `ProviderHistoryStore.pruneImportedStaging` proves derived, and
 * it keeps no content in its result, so the caller can log it as it is.
 *
 * `orchestration_events` is not pruned by age on purpose: `rebuildThreadProjection` and the
 * roster, memory and channel readers replay it, and each writer already drops the events that a
 * later one supersedes. An age rule would delete events that a replay still needs.
 */
export async function runDatabaseMaintenance(
  target: DatabaseMaintenanceTarget,
  options: DatabaseMaintenanceOptions = {},
): Promise<DatabaseMaintenanceResult> {
  const now = options.now ?? new Date();
  const before = new Date(now.getTime() - (options.retentionMs ?? STAGING_RETENTION_MS)).toISOString();
  const yieldToEventLoop = options.yieldToEventLoop ?? nextTurn;
  let stagingRowsDeleted = 0;
  for (let batch = 0; batch < STAGING_MAX_BATCHES; batch += 1) {
    const deleted = target.pruneProviderHistoryStaging({ before, limit: STAGING_BATCH_ROWS });
    stagingRowsDeleted += deleted;
    if (deleted < STAGING_BATCH_ROWS) break;
    await yieldToEventLoop();
  }

  const db = target.connection;
  const pageSize = pragmaNumber(db, "page_size", "page_size");
  const freePages = pragmaNumber(db, "freelist_count", "freelist_count");
  const incremental = pragmaNumber(db, "auto_vacuum", "auto_vacuum") === AUTO_VACUUM_INCREMENTAL;
  let pagesReleased = 0;
  if (incremental && freePages >= INCREMENTAL_VACUUM_MIN_FREE_PAGES) {
    const pages = Math.min(freePages, INCREMENTAL_VACUUM_PAGES);
    db.exec(`PRAGMA incremental_vacuum(${pages})`);
    pagesReleased = pages;
  }
  return {
    stagingRowsDeleted,
    freePages: Math.max(0, freePages - pagesReleased),
    pageSize,
    pagesReleased,
    needsFullVacuum: !incremental && freePages >= INCREMENTAL_VACUUM_MIN_FREE_PAGES,
  };
}
