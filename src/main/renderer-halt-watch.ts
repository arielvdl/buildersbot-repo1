import { createBuildersBotLogger } from "@buildersbot/logging";

const logger = createBuildersBotLogger("renderer-halt");

/** What SolidJS writes to the console when an uncaught error halts the reactive system of the window. */
const HALT_MARKER = "[REACTIVITY_HALTED]";
/** The window waits this long before it loads again, so the error that halted it reaches the log first. */
const RELOAD_DELAY_MS = 1_500;
/** One reload for each period: a halt that comes back at once would otherwise load the window in a loop. */
const RELOAD_PERIOD_MS = 5 * 60_000;

/** The part of a `WebContents` that the watch uses. */
export interface HaltWatchContents {
  on(event: "console-message", listener: (event: { message: string }) => void): unknown;
  reload(): void;
  isDestroyed(): boolean;
}

export interface RendererHaltWatchOptions {
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
}

/**
 * Watches the window for a halted reactive system. After a halt no click works and nothing on the
 * screen changes, while the process stays idle and shows no error. The halt writes one line to the
 * main log, so the next freeze has a trace, and the window loads again once for each period, which
 * revives it. The agents run in the main process, so a reload does not stop a turn.
 */
export function watchRendererHalt(contents: HaltWatchContents, options: RendererHaltWatchOptions = {}): void {
  const now = options.now ?? Date.now;
  const later = options.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
  let reloadedAt = Number.NEGATIVE_INFINITY;
  let reloading = false;
  contents.on("console-message", (event) => {
    if (!event.message.startsWith(HALT_MARKER)) return;
    if (reloading) return;
    const reload = now() - reloadedAt >= RELOAD_PERIOD_MS;
    logger.error("The reactive system of the window halted.", { reload });
    if (!reload) return;
    reloading = true;
    later(() => {
      reloading = false;
      if (contents.isDestroyed()) return;
      reloadedAt = now();
      contents.reload();
    }, RELOAD_DELAY_MS);
  });
}
