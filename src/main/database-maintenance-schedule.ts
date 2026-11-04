import type { Logger } from "@buildersbot/logging";
import { type DatabaseMaintenanceTarget, runDatabaseMaintenance } from "../backend/database/database-maintenance";

/** The first run waits, so no launch work shares the disk and the main process with it. */
const FIRST_RUN_DELAY_MS = 10 * 60_000;
const RUN_INTERVAL_MS = 6 * 60 * 60_000;

interface DatabaseMaintenanceHandle {
  stop(): void;
}

/**
 * Runs the database maintenance 10 minutes after launch and every 6 hours. A run never throws and
 * never overlaps another. The log line has counts only: no row content, no conversation id.
 */
export function startDatabaseMaintenance(
  target: DatabaseMaintenanceTarget,
  logger: Logger,
  options: { firstRunDelayMs?: number; intervalMs?: number } = {},
): DatabaseMaintenanceHandle {
  let running = false;
  let stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await runDatabaseMaintenance(target);
      if (result.stagingRowsDeleted > 0 || result.pagesReleased > 0 || result.needsFullVacuum)
        logger.info("Database maintenance finished.", { ...result });
    } catch (error) {
      logger.warn("Database maintenance failed.", { error: String(error) });
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => {
    void run();
  }, options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS);
  const every = setInterval(() => void run(), options.intervalMs ?? RUN_INTERVAL_MS);
  first.unref();
  every.unref();
  return {
    stop() {
      stopped = true;
      clearTimeout(first);
      clearInterval(every);
    },
  };
}
