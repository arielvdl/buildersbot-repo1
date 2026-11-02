import { type HostMemory, LANE_SESSION_MB } from "../host-memory";

export interface LaneBudgetOptions {
  /** The memory of this computer, or null when it gives no reading (a server, Windows, Linux). */
  memory: HostMemory | null;
  /** The percent of free memory under which the level is `low` (`LOW_BELOW`). The budget ends above it. */
  lowBelowPercent: number;
  /** The MB of one more session. Omitted: `LANE_SESSION_MB`. */
  sessionMb?: number;
}

/**
 * How many more provider sessions fit in the free memory of this computer, for the extra channel tabs
 * of an agent that already works. It holds no state of its own about the machine: it reads the last
 * sample (`HostMemory.freeMb`, which already counts the turns that started since that sample) and
 * takes away the extra tabs that it let start in the same pass (`claim`).
 *
 * `spare = max(0, floor((free - floor) / session))`, with `floor` = the `low` threshold plus two
 * sessions of slack. The budget ends before the machine is `low`, and room is left for the message of
 * the person. The first line of an agent never asks it. Without a reading, there is no budget and the
 * tab limit is the fixed number.
 */
export class LaneBudget {
  readonly #memory: HostMemory | null;
  readonly #lowBelowPercent: number;
  readonly #sessionMb: number;
  /** The MB that extra tabs claimed since the last sample. A sample reads the real memory again. */
  #claimedMb = 0;
  /** An extra tab was refused for lack of room, so the next sample with room must wake the channels. */
  #blocked = false;
  #unsubscribe: (() => void) | null = null;

  constructor(options: LaneBudgetOptions) {
    this.#memory = options.memory;
    this.#lowBelowPercent = options.lowBelowPercent;
    this.#sessionMb = options.sessionMb ?? LANE_SESSION_MB;
  }

  /** Whether a memory reading exists, so the budget applies at all. */
  get readable(): boolean {
    return (this.#memory?.freeMb?.() ?? null) !== null && (this.#memory?.totalMb?.() ?? null) !== null;
  }

  /** The free memory, in MB, under which no extra tab starts: the `low` threshold and two sessions. */
  floorMb(): number | null {
    const total = this.#memory?.totalMb?.() ?? null;
    return total === null ? null : Math.round((total * this.#lowBelowPercent) / 100) + 2 * this.#sessionMb;
  }

  /** The extra sessions that fit now, or null when there is no reading. */
  spareSessions(): number | null {
    const free = this.#memory?.freeMb?.() ?? null;
    const floor = this.floorMb();
    if (free === null || floor === null) return null;
    return Math.max(0, Math.floor((free - this.#claimedMb - floor) / this.#sessionMb));
  }

  /** Whether one extra tab may start. Without a reading it may: the fixed limit decides. */
  hasRoom(): boolean {
    const spare = this.spareSessions();
    if (spare === null || spare >= 1) return true;
    this.#blocked = true;
    return false;
  }

  /**
   * An extra tab starts now: its session counts until the next sample, so a pass cannot overspend. The
   * drain reserves the same session again when the turn starts (`HostMemory.reserveTurn`), so the first
   * seconds count it twice, on the careful side. Both end at the next sample.
   */
  claim(): void {
    this.#claimedMb += this.#sessionMb;
  }

  /**
   * Follows the samples: each one drops the claims, and `onRoom` runs when a sample brings room to a
   * tab that was refused. Starting twice does nothing.
   */
  start(onRoom: () => void): void {
    if (!this.#memory || this.#unsubscribe) return;
    this.#unsubscribe = this.#memory.subscribe(() => {
      this.#claimedMb = 0;
      if (this.#blocked && (this.spareSessions() ?? 1) >= 1) {
        this.#blocked = false;
        onRoom();
      }
    });
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}
