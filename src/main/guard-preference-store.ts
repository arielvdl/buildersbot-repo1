import {
  DEFAULT_GUARD_CUSTOM_RULES,
  DEFAULT_GUARD_PREFERENCE,
  type GuardPreference,
  type GuardPreferenceChange,
  isGuardPreference,
} from "@buildersbot/contracts/ipc";
import { isDynamicRecord } from "@buildersbot/contracts/runtime-values";
import { Effect } from "effect";
import { type PreferenceFileFailure, PreferenceStore } from "./preference-file";

/** The file of the Guard preference in the user data directory. */
export const GUARD_PREFERENCE_FILE = "buildersbot-guard-v1.json";

/**
 * The Guard setting of this computer: its level, its reviewer model and the rules of the Custom level.
 *
 * The Guard is on by default, at Light, with the fast Cultura Builder model as the reviewer. A file
 * that is missing, damaged, of another version or of another shape reads as the default, so a broken
 * file never turns the Guard off. Only the person turns it off.
 */
export class GuardPreferenceStore {
  readonly #store: PreferenceStore<GuardPreference>;

  constructor(path: string) {
    this.#store = new PreferenceStore({
      path,
      defaultValue: DEFAULT_GUARD_PREFERENCE,
      decode: (parsed) => {
        if (!isDynamicRecord(parsed) || parsed.version !== 1) return null;
        // A file from before the Custom level has no rules: it reads as the default rules.
        const value = {
          level: parsed.level,
          judge: parsed.judge,
          custom: parsed.custom === undefined ? DEFAULT_GUARD_CUSTOM_RULES : parsed.custom,
        };
        return isGuardPreference(value) ? value : null;
      },
    });
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return this.#store.load();
  }

  get(): GuardPreference {
    const value = this.#store.get();
    return { level: value.level, judge: value.judge ? { ...value.judge } : null, custom: { ...value.custom } };
  }

  readonly set = Effect.fn("GuardPreference.set")(function* (
    this: GuardPreferenceStore,
    change: GuardPreferenceChange,
  ) {
    const current = this.get();
    const next: GuardPreference = {
      level: change.level ?? current.level,
      judge: change.judge === undefined ? current.judge : change.judge,
      custom: change.custom ?? current.custom,
    };
    // The IPC parser checks the change first, so a value of another shape here is a bug of the caller.
    if (!isGuardPreference(next)) return yield* Effect.die(new Error("Invalid Guard preference."));
    yield* this.#store.set(next);
    return this.get();
  });
}
