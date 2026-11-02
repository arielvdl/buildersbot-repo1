/**
 * How much memory the computer that runs Builders Bot has left. Only a server gives one (hosted,
 * self-hosted or a container): one unit or container holds Builders Bot, its browser tabs and every
 * provider process. The main process reads the system; this file has no Electron import, so the
 * backend can use it.
 */
export type HostMemoryLevel = "ok" | "low" | "critical";

/**
 * The memory that one more provider session is expected to take, in MB. A measurement of 1 November
 * 2026 gave 200 to 400 MB for a Claude session (197 MB on average over 10); 300 is a careful first
 * guess and is not calibrated yet. A start reserves it (`HostMemory.reserveTurn`) and the lane budget
 * counts it (`LaneBudget`).
 */
export const LANE_SESSION_MB = 300;

export interface HostMemory {
  level(): HostMemoryLevel;
  /** The most agent turns that run at the same time on this machine. */
  turnLimit(): number;
  /**
   * Counts the memory of a turn that starts now, before its processes grow. Returns the release, for
   * a start that ends with no turn.
   */
  reserveTurn(): () => void;
  /**
   * The free memory in MB at the last sample, less what the starts since then reserved
   * (`reserveTurn`). Null before the first sample. Absent where the system gives no reading, as on a
   * server, and then no budget follows the memory.
   */
  freeMb?(): number | null;
  /** The memory of the computer in MB, or null when it is not known. Absent as `freeMb` is. */
  totalMb?(): number | null;
  /** Called after each sample. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** True on a hosted server: its plan sets the memory, so the low-memory notice names the plan. */
  readonly hostedPlan: boolean;
  /**
   * Whose memory it is. A server holds Builders Bot and every agent in one unit; a desktop is a person's
   * own computer, where the notice says that the computer is low on memory. Absent reads as a server.
   */
  readonly kind?: "server" | "desktop";
}

/** A memory level as the browser rules read it. No reading reads as `ok`. */
type MemoryReading = Pick<HostMemory, "level"> | null;

function isLow(reading: MemoryReading): boolean {
  return (reading?.level() ?? "ok") !== "ok";
}

/**
 * How the Builders Bot browser (`BrowserHost`) reads the memory of this computer. A server and a Mac
 * get different rules, so the two readings stay apart.
 */
export interface BrowserMemory {
  /**
   * The server is low on memory: no new tab and no popup opens, for the person or for an agent. A
   * desktop has no server reading, so on a desktop this is always false and the person can always open
   * a tab.
   */
  memoryLow(): boolean;
  /**
   * Whether an idle agent tab unloads its page after 5 min instead of 30. On a server that is low on
   * memory, each idle agent tab does. On a Mac that is low on memory, only the tab of an agent that runs
   * no turn does: a running turn can wait for the approval of the person with a filled form on the page.
   */
  sleepSooner(agentWorking: boolean): boolean;
}

/**
 * The browser rules from the reading of a server (`ServerMemory`) and the reading of the Mac
 * (`MacMemory`). Only one of the two exists in a process; a desktop that is not a Mac has neither.
 */
export function browserMemory(server: MemoryReading, mac: MemoryReading): BrowserMemory {
  return {
    memoryLow: () => isLow(server),
    sleepSooner: (agentWorking) => isLow(server) || (!agentWorking && isLow(mac)),
  };
}
