import { INPUT_LIMITS } from "@buildersbot/contracts/input-limits";
import { createSignal } from "solid-js";
import { z } from "zod";

/**
 * Whether the agent stage shows above a channel's conversation, kept on this computer for each
 * scope (the server). `all` is the default of every channel, `channels` holds the ones that differ,
 * and `collapse` folds the stage into a strip while nobody works. A scope with no entry has the
 * stage off, so a channel that nobody changed costs nothing: its conversation is the plain one.
 */
export interface ChannelStagePreference {
  all: boolean;
  collapse: boolean;
  channels: Readonly<Record<string, boolean>>;
  /** The channels whose stage the reader folded by hand, whoever works. Missing means not folded. */
  folded: Readonly<Record<string, boolean>>;
}

export type ChannelStageScope = "channel" | "all";

/** What the settings show for the open channel. */
export interface ChannelStageSettings {
  enabled: boolean;
  collapse: boolean;
  /** The reader folded this channel's stage by hand. */
  folded: boolean;
  scope: ChannelStageScope;
}

type ChannelStageByScope = Record<string, ChannelStagePreference>;

const STORAGE_KEY = "buildersbot:channel-stage:v1";
const DEFAULT_PREFERENCE: ChannelStagePreference = { all: false, collapse: true, channels: {}, folded: {} };

type ChannelStageStorage = Pick<Storage, "getItem" | "setItem">;

const preferenceSchema = z.object({
  all: z.boolean().catch(false),
  collapse: z.boolean().catch(true),
  channels: z.record(z.string().min(1).max(INPUT_LIMITS.identifier), z.boolean()).catch({}),
  folded: z.record(z.string().min(1).max(INPUT_LIMITS.identifier), z.boolean()).catch({}),
});
const storedSchema = z.record(z.string(), z.unknown());

function readChannelStagePreferences(storage: ChannelStageStorage = window.localStorage): ChannelStageByScope {
  try {
    const parsed = storedSchema.safeParse(JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}"));
    if (!parsed.success) return {};
    return Object.fromEntries(
      Object.entries(parsed.data).flatMap(([scope, value]) => {
        const preference = preferenceSchema.safeParse(value);
        return scope.trim() && preference.success ? [[scope, preference.data]] : [];
      }),
    );
  } catch {
    return {};
  }
}

function writeChannelStagePreferences(
  preferences: ChannelStageByScope,
  storage: ChannelStageStorage = window.localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // A display preference must not block the conversation.
  }
}

/** The settings of one channel. With no channel open, only the default of all channels shows. */
function channelStageSettings(
  preference: ChannelStagePreference | undefined,
  channelId: string | null,
): ChannelStageSettings {
  const current = preference ?? DEFAULT_PREFERENCE;
  const exception = channelId === null ? undefined : current.channels[channelId];
  return {
    enabled: exception ?? current.all,
    collapse: current.collapse,
    folded: channelId === null ? false : (current.folded[channelId] ?? false),
    scope: exception === undefined ? "all" : "channel",
  };
}

/** "This channel" keeps an exception for the channel. "All channels" sets the default and clears them. */
export function withChannelStageEnabled(
  preference: ChannelStagePreference | undefined,
  channelId: string | null,
  scope: ChannelStageScope,
  enabled: boolean,
): ChannelStagePreference {
  const current = preference ?? DEFAULT_PREFERENCE;
  if (scope === "channel" && channelId !== null)
    return { ...current, channels: { ...current.channels, [channelId]: enabled } };
  return { ...current, all: enabled, channels: {} };
}

/** A new scope keeps what the reader sees now, so the stage does not turn on or off by itself. */
export function withChannelStageScope(
  preference: ChannelStagePreference | undefined,
  channelId: string | null,
  scope: ChannelStageScope,
): ChannelStagePreference {
  const shown = channelStageSettings(preference, channelId).enabled;
  return withChannelStageEnabled(preference, channelId, scope, shown);
}

export function withChannelStageCollapse(
  preference: ChannelStagePreference | undefined,
  collapse: boolean,
): ChannelStagePreference {
  return { ...(preference ?? DEFAULT_PREFERENCE), collapse };
}

/** The reader folds or unfolds the stage of one channel by hand. An unfolded channel keeps no entry. */
export function withChannelStageFolded(
  preference: ChannelStagePreference | undefined,
  channelId: string,
  folded: boolean,
): ChannelStagePreference {
  const current = preference ?? DEFAULT_PREFERENCE;
  const { [channelId]: _gone, ...rest } = current.folded;
  return { ...current, folded: folded ? { ...rest, [channelId]: true } : rest };
}

const [preferences, setPreferences] = createSignal<ChannelStageByScope>(readChannelStagePreferences());

/** The settings of a channel in a scope. Reactive: the rail flag and the conversation read the same. */
export function channelStageSettingsFor(scope: string, channelId: string | null): ChannelStageSettings {
  return channelStageSettings(preferences()[scope], channelId);
}

export function updateChannelStage(
  scope: string,
  update: (preference: ChannelStagePreference | undefined) => ChannelStagePreference,
): void {
  setPreferences((current) => {
    const next = { ...current, [scope]: update(current[scope]) };
    writeChannelStagePreferences(next);
    return next;
  });
}
