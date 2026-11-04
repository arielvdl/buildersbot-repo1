// @vitest-environment node

import { DatabaseSync } from "node:sqlite";
import { createBuildersBotLogger } from "@buildersbot/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDatabaseMaintenance } from "./database-maintenance-schedule";

const lines: string[] = [];
const logger = createBuildersBotLogger("maintenance-test", (line) => lines.push(line), "info");

beforeEach(() => {
  vi.useFakeTimers();
  lines.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("startDatabaseMaintenance", () => {
  it("runs after the delay, again at each interval, and logs counts only", async () => {
    const db = new DatabaseSync(":memory:");
    const prune = vi.fn(() => 3);
    const handle = startDatabaseMaintenance({ connection: db, pruneProviderHistoryStaging: prune }, logger, {
      firstRunDelayMs: 1_000,
      intervalMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(prune).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(prune).toHaveBeenCalledTimes(1);
    expect(lines.join("\n")).toContain("Database maintenance finished.");
    expect(lines.join("\n")).toContain("stagingRowsDeleted");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(prune).toHaveBeenCalledTimes(2);
    handle.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prune).toHaveBeenCalledTimes(2);
    db.close();
  });

  it("never throws: a failed run is a warning", async () => {
    const db = new DatabaseSync(":memory:");
    const handle = startDatabaseMaintenance(
      {
        connection: db,
        pruneProviderHistoryStaging: () => {
          throw new Error("database is locked");
        },
      },
      logger,
      { firstRunDelayMs: 1 },
    );
    await vi.advanceTimersByTimeAsync(5);
    expect(lines.join("\n")).toContain("Database maintenance failed.");
    handle.stop();
    db.close();
  });
});
