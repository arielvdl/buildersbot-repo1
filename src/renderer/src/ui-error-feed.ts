import type { AgentMessage } from "@buildersbot/ui/data";

/**
 * How many different failures one conversation keeps. The same failure already replaces its earlier
 * entry; a conversation whose errors keep changing would otherwise grow for the life of the app.
 */
export const UI_ERROR_LIMIT = 20;

/** The errors of one conversation with `entry` added, and only the newest `UI_ERROR_LIMIT` kept. */
export function withUiError(current: readonly AgentMessage[] | undefined, entry: AgentMessage): AgentMessage[] {
  // The same failure again replaces the earlier one, so a server that is down shows it once.
  const withoutSame = (current ?? []).filter(
    (existing) => existing.status !== entry.status || existing.body !== entry.body,
  );
  return [...withoutSame, entry].slice(-UI_ERROR_LIMIT);
}
