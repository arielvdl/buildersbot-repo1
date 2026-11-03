import {
  type AgentLimitPreference,
  type AgentTabsMode,
  DEFAULT_AGENT_LIMIT_PREFERENCE,
  DEFAULT_AGENT_TABS_MODE,
  DEFAULT_AGENTS_PER_TAB,
  DEFAULT_QUICK_CHAT_THREADS,
  defaultAgentTabs,
  isAgentLimitPreference,
} from "@buildersbot/contracts/ipc";
import { isDynamicRecord } from "@buildersbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * The cap on the agents that run at the same time: on or off, and the most agents. It is off until
 * the person turns it on. The same file keeps the most channel tabs of one agent that run at the same
 * time (`tabsPerAgent`, a ceiling when `tabsMode` is `memory`) and the most agents that run at the same
 * time in one tab (`agentsPerTab`); both apply whether the cap is on or off. A file that is missing, damaged,
 * of another shape, or with a value out of range reads as the default. Writes are chained, as the
 * other preference stores chain theirs.
 */
export class AgentLimitPreferenceStore {
  readonly #path: string;
  #preference: AgentLimitPreference = { ...DEFAULT_AGENT_LIMIT_PREFERENCE };
  #writes = Semaphore.makeUnsafe(1);

  readonly #memoryReadable: boolean;

  /**
   * `memoryReadable`: this computer gives a memory reading (a Mac). A file with no `tabsMode` then
   * reads `memory`, and else `fixed`, as `tabsMode()` says.
   */
  constructor(path: string, options: { memoryReadable?: boolean } = {}) {
    this.#path = path;
    this.#memoryReadable = options.memoryReadable ?? false;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): AgentLimitPreference | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && isAgentLimitPreference(parsed)
            ? {
                enabled: parsed.enabled,
                max: parsed.max,
                ...(parsed.tabsPerAgent === undefined ? {} : { tabsPerAgent: parsed.tabsPerAgent }),
                ...(parsed.tabsMode === undefined ? {} : { tabsMode: parsed.tabsMode }),
                ...(parsed.agentsPerTab === undefined ? {} : { agentsPerTab: parsed.agentsPerTab }),
                ...(parsed.quickChatThreads === undefined ? {} : { quickChatThreads: parsed.quickChatThreads }),
              }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#preference = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): AgentLimitPreference {
    return { ...this.#preference };
  }

  /** The most agents that may run now, or null while the cap is off. */
  limit(): number | null {
    return this.#preference.enabled ? this.#preference.max : null;
  }

  /**
   * How the tabs of one agent are limited. The saved mode, else `memory` where this computer gives a
   * memory reading, else `fixed`. The backend still acts as `fixed` when no reading arrives.
   */
  tabsMode(): AgentTabsMode {
    return this.#preference.tabsMode ?? (this.#memoryReadable ? DEFAULT_AGENT_TABS_MODE : "fixed");
  }

  /** The most channel tabs of one agent that run a turn at the same time: the ceiling in `memory` mode. */
  tabsPerAgent(): number {
    return this.#preference.tabsPerAgent ?? defaultAgentTabs(this.tabsMode());
  }

  /** The most agents that run a turn at the same time in one channel tab. */
  agentsPerTab(): number {
    return this.#preference.agentsPerTab ?? DEFAULT_AGENTS_PER_TAB;
  }

  /** The most conversations of the quick chat that run a turn at the same time. 8 until the person sets another. */
  quickChatThreads(): number {
    return this.#preference.quickChatThreads ?? DEFAULT_QUICK_CHAT_THREADS;
  }

  readonly set = Effect.fn("AgentLimitPreference.set")(function* (
    this: AgentLimitPreferenceStore,
    preference: AgentLimitPreference,
  ) {
    // The parser of the IPC input checks this first, so a value out of range here is a bug of the caller.
    if (!isAgentLimitPreference(preference)) return yield* Effect.die(new Error("Invalid agent limit preference."));
    // A client that does not know a tab limit sends none, and the saved one stays.
    const tabsPerAgent = preference.tabsPerAgent ?? this.#preference.tabsPerAgent;
    const tabsMode = preference.tabsMode ?? this.#preference.tabsMode;
    const agentsPerTab = preference.agentsPerTab ?? this.#preference.agentsPerTab;
    const quickChatThreads = preference.quickChatThreads ?? this.#preference.quickChatThreads;
    const next: AgentLimitPreference = {
      enabled: preference.enabled,
      max: preference.max,
      ...(tabsPerAgent === undefined ? {} : { tabsPerAgent }),
      ...(tabsMode === undefined ? {} : { tabsMode }),
      ...(agentsPerTab === undefined ? {} : { agentsPerTab }),
      ...(quickChatThreads === undefined ? {} : { quickChatThreads }),
    };
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, ...next }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#preference = next;
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}
