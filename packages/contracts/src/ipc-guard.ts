// The Guard: a default agent that checks what enters an agent's work and what leaves it.
//
// It is on by default at the Light level. At Light, the Guard looks for prompt injection: content
// from a page, a file, a tool or a third party that carries instructions for the agent, and actions
// that send data or run code outside the computer. A local check runs first. A small, fast model
// reviews only what the local check marks as suspicious. The person can turn the Guard off.

import { type AgentProviderId, isAgentProvider } from "./agent-providers";
import { isDynamicRecord, isOneOf } from "./runtime-values";

/**
 * Every level of the Guard, from off to the most careful. The list is stable: a saved level never
 * changes its meaning. Every level can be chosen.
 */
export const GUARD_LEVELS = ["off", "light", "strict", "very-strict", "custom"] as const;
export type GuardLevel = (typeof GUARD_LEVELS)[number];

/** The levels that this version runs: all of them. */
export const GUARD_AVAILABLE_LEVELS = GUARD_LEVELS satisfies readonly GuardLevel[];
export type GuardAvailableLevel = (typeof GUARD_AVAILABLE_LEVELS)[number];

export function isGuardAvailableLevel(value: unknown): value is GuardAvailableLevel {
  return isOneOf(GUARD_AVAILABLE_LEVELS, value);
}

/** What the Guard decides about one item: let it pass, ask the person, or stop it. */
export const GUARD_VERDICTS = ["allow", "ask", "block"] as const;
export type GuardVerdict = (typeof GUARD_VERDICTS)[number];

/** The kind of risk that a check found. `none` when it found nothing. */
export const GUARD_CATEGORIES = [
  "none",
  "instruction-override",
  "prompt-leak",
  "role-change",
  "hidden-text",
  "judge-manipulation",
  "secret-leak",
  "exfiltration",
  "remote-code",
  "other",
] as const;
export type GuardCategory = (typeof GUARD_CATEGORIES)[number];

/** The model that reviews suspicious items. */
export interface GuardJudgeChoice {
  provider: AgentProviderId;
  /** The model id as the model list gives it, such as `cultura-builder/builder-fast`. */
  model: string;
}

/** The default reviewer: the fast model of the Cultura Builder provider. */
export const DEFAULT_GUARD_JUDGE: GuardJudgeChoice = {
  provider: "cultura-builder",
  model: "cultura-builder/builder-fast",
};

/** The longest model id that a choice can hold. */
const GUARD_MODEL_ID_LIMIT = 200;

/** How long the reviewer may take before the Guard decides with the local check only. */
export const GUARD_JUDGE_TIMEOUT_MS = 4_000;

/** The most characters of one suspicious item that the reviewer receives, after secrets are masked. */
export const GUARD_JUDGE_EXCERPT_LIMIT = 2_000;

/**
 * The rules of the Custom level, for a suspicious item that the Guard cannot clear:
 * - `content`: what happens to content that enters. `note` passes it with a note to the agent; `ask`
 *   asks the person first.
 * - `actions`: what happens to an action that leaves. `allow` lets it go; `ask` asks the person first.
 * - `modelCanClear`: whether the reviewer model may clear a suspicious item. Off, a suspicious item is
 *   always handled by the two rules above, whatever the model says.
 * A clear risk (a high finding) still asks, and a secret that would leave still stops, at every level.
 */
export interface GuardCustomRules {
  content: "note" | "ask";
  actions: "allow" | "ask";
  modelCanClear: boolean;
}

/** The starting rules of Custom: the same as Light. */
export const DEFAULT_GUARD_CUSTOM_RULES: GuardCustomRules = { content: "note", actions: "allow", modelCanClear: true };

export interface GuardPreference {
  /** Light by default. */
  level: GuardLevel;
  /** The reviewer of suspicious items. Null uses the local check only, and sends nothing out. */
  judge: GuardJudgeChoice | null;
  /** The rules that the Custom level uses. The other levels ignore them. */
  custom: GuardCustomRules;
}

export const DEFAULT_GUARD_PREFERENCE: GuardPreference = {
  level: "light",
  judge: DEFAULT_GUARD_JUDGE,
  custom: DEFAULT_GUARD_CUSTOM_RULES,
};

/** What the settings screen shows: the preference, and whether the chosen reviewer can run now. */
export interface GuardState {
  preference: GuardPreference;
  /**
   * False when the reviewer cannot run now, such as Cultura Builder with no sign-in. The Guard then
   * uses the local check only. Also false when no reviewer is chosen.
   */
  judgeReady: boolean;
}

/** The choices to change. A choice that is not given keeps its value. */
export interface GuardPreferenceChange {
  level?: GuardAvailableLevel;
  judge?: GuardJudgeChoice | null;
  custom?: GuardCustomRules;
}

export function isGuardCustomRules(value: unknown): value is GuardCustomRules {
  return (
    isDynamicRecord(value) &&
    (value.content === "note" || value.content === "ask") &&
    (value.actions === "allow" || value.actions === "ask") &&
    typeof value.modelCanClear === "boolean"
  );
}

export function isGuardJudgeChoice(value: unknown): value is GuardJudgeChoice {
  return (
    isDynamicRecord(value) &&
    isAgentProvider(value.provider) &&
    typeof value.model === "string" &&
    value.model.length > 0 &&
    value.model.length <= GUARD_MODEL_ID_LIMIT &&
    // A model id is printable text with no spaces: it goes into a request body, never a command.
    /^[\x21-\x7e]+$/u.test(value.model)
  );
}

export function isGuardPreference(value: unknown): value is GuardPreference {
  return (
    isDynamicRecord(value) &&
    isOneOf(GUARD_LEVELS, value.level) &&
    (value.judge === null || isGuardJudgeChoice(value.judge)) &&
    isGuardCustomRules(value.custom)
  );
}

export function isGuardState(value: unknown): value is GuardState {
  return isDynamicRecord(value) && isGuardPreference(value.preference) && typeof value.judgeReady === "boolean";
}

/**
 * Reads the change a window sends. At least one choice is required, and only a level that this
 * version runs is accepted.
 */
export function parseGuardPreferenceChange(input: unknown): GuardPreferenceChange {
  if (!isDynamicRecord(input)) throw new Error("The Guard change is required.");
  const change: GuardPreferenceChange = {};
  for (const key of Object.keys(input)) {
    if (key !== "level" && key !== "judge" && key !== "custom")
      throw new Error("The Guard change has an unknown field.");
  }
  if ("level" in input) {
    if (!isGuardAvailableLevel(input.level)) throw new Error("The Guard level is invalid.");
    change.level = input.level;
  }
  if ("judge" in input) {
    if (input.judge !== null && !isGuardJudgeChoice(input.judge)) throw new Error("The Guard model is invalid.");
    change.judge = input.judge === null ? null : { provider: input.judge.provider, model: input.judge.model };
  }
  if ("custom" in input) {
    if (!isGuardCustomRules(input.custom)) throw new Error("The Guard rules are invalid.");
    const { content, actions, modelCanClear } = input.custom;
    change.custom = { content, actions, modelCanClear };
  }
  if (Object.keys(change).length === 0) throw new Error("The Guard change is required.");
  return change;
}

/** The level that the Guard runs for a saved level. Every level runs as itself. */
export function guardEffectiveLevel(level: GuardLevel): GuardAvailableLevel {
  return level;
}
