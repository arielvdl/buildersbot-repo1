/**
 * How much context a chat may carry. Each turn sends the whole context again, so cost and delay grow
 * with its size. A model window of 1 million tokens hides this: with a share of the window as the
 * only limit, a chat compacts at 800,000 tokens or more (finding F-22 of the stress test of
 * 4 November 2026: 273 sessions above 400,000 tokens, none compacted).
 *
 * The window stays what the model offers. These limits are absolute, so they do not depend on it.
 */

/**
 * The context size, in tokens, at which a chat compacts without a request. A window below 625,000
 * tokens still compacts at 80% of it, as before.
 */
export const CONTEXT_COMPACTION_BUDGET_TOKENS = 500_000;

/** From this size the meter warns that the chat is long and costly. It is below the compaction point. */
export const CONTEXT_WARNING_TOKENS = 400_000;

/** The size at which a chat of this window compacts: 80% of the window, or the budget if that is less. */
export function contextCompactionTokens(windowTokens: number): number {
  return Math.min(Math.floor(windowTokens * 0.8), CONTEXT_COMPACTION_BUDGET_TOKENS);
}

/** The compaction point as a share of the window (0 to 1), for the meter. */
export function contextCompactionShare(windowTokens: number): number {
  return windowTokens > 0 ? contextCompactionTokens(windowTokens) / windowTokens : 0.8;
}
