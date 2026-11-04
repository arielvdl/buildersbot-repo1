import {
  DEFAULT_ON_OPTIMIZATION_IDS,
  isOptimizationId,
  knownOptimizationIds,
  type OptimizationChange,
  type OptimizationId,
  type OptimizationState,
} from "@buildersbot/contracts/ipc";
import { isDynamicRecord } from "@buildersbot/contracts/runtime-values";
import { createBuildersBotLogger } from "@buildersbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import type { OptimizationPort } from "../backend/optimizations";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const OPTIMIZATIONS_FILE = "buildersbot-optimizations-v1.json";

/** An id of a newer version that the file keeps: lower-case words and hyphens, as the known ids are. */
const FOREIGN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
/** The most ids of a newer version that the file keeps. */
const FOREIGN_ID_LIMIT = 64;

const logger = createBuildersBotLogger("optimizations");

interface StoredOptimizations {
  /** The switches that are on now, with the ones that start on and that the person did not turn off. */
  on: OptimizationId[];
  /** Switches that are on in the file but that this version does not know. A write keeps them. */
  foreign: string[];
}

function decodeStored(parsed: unknown): StoredOptimizations | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.on)) return null;
  const foreign = [
    ...new Set(
      parsed.on.filter((id): id is string => typeof id === "string" && !isOptimizationId(id) && FOREIGN_ID.test(id)),
    ),
  ].slice(0, FOREIGN_ID_LIMIT);
  // A file with no `off` list never recorded a choice about the switches that start on.
  const off = new Set(knownOptimizationIds(parsed.off));
  const on = new Set(knownOptimizationIds(parsed.on));
  for (const id of DEFAULT_ON_OPTIMIZATION_IDS) if (!off.has(id)) on.add(id);
  return { on: knownOptimizationIds([...on]), foreign };
}

/** The switches that start on and that are off now: the file keeps them, so a restart does not turn them on. */
function turnedOff(on: readonly OptimizationId[]): OptimizationId[] {
  return DEFAULT_ON_OPTIMIZATION_IDS.filter((id) => !on.includes(id));
}

/**
 * The advanced optimizations (beta) of this host, in `buildersbot-optimizations-v1.json` in the user data
 * folder: `{ "version": 1, "on": [ids], "off": [ids] }`. Every switch is off until the person turns it on, except the ones in `DEFAULT_ON_OPTIMIZATION_IDS`, which `off` can turn off for good. A file that is
 * missing, damaged, of another version or shape reads as the defaults. Main holds the file in memory
 * after `load`, so `optimizationEnabled` is a synchronous read for the code that runs agents. A switch
 * that a newer version wrote stays in the file, so going back to an older version and changing a switch
 * does not turn it off. Writes are chained, as the other preference stores chain theirs.
 */
export class OptimizationStore implements OptimizationPort {
  readonly #path: string;
  #stored: StoredOptimizations = { on: knownOptimizationIds(DEFAULT_ON_OPTIMIZATION_IDS), foreign: [] };
  readonly #listeners = new Set<(id: OptimizationId, enabled: boolean) => void>();
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#path, decodeStored));
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#stored = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
      if (this.#stored.on.length > 0) logger.info("Advanced optimizations are on.", { on: this.#stored.on.join(",") });
    });
  }

  optimizationEnabled(id: OptimizationId): boolean {
    return this.#stored.on.includes(id);
  }

  onOptimizationChange(listener: (id: OptimizationId, enabled: boolean) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  state(): OptimizationState {
    return { on: [...this.#stored.on] };
  }

  /** Saves the changes, then tells each listener once for each switch whose value changed. */
  readonly set = Effect.fn("OptimizationStore.set")(function* (
    this: OptimizationStore,
    changes: readonly OptimizationChange[],
  ) {
    const changed: OptimizationChange[] = [];
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.suspend(() => {
          const on = new Set(this.#stored.on);
          for (const change of changes) {
            if (on.has(change.id) === change.enabled) continue;
            if (change.enabled) on.add(change.id);
            else on.delete(change.id);
            changed.push(change);
          }
          if (changed.length === 0) return Effect.void;
          const next: StoredOptimizations = { on: knownOptimizationIds([...on]), foreign: this.#stored.foreign };
          return writePreferenceFile(this.#path, {
            version: 1,
            on: [...next.on, ...next.foreign],
            off: turnedOff(next.on),
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                this.#stored = next;
              }),
            ),
          );
        }),
      ),
    );
    for (const { id, enabled } of changed) {
      logger.info("An advanced optimization changed.", { id, enabled });
      for (const listener of [...this.#listeners]) {
        try {
          listener(id, enabled);
        } catch (error) {
          logger.warn("A listener of the advanced optimizations failed.", { id, error });
        }
      }
    }
    return this.state();
  });
}
