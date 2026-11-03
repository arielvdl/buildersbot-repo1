import { createEffect } from "solid-js";

/**
 * Tells the host when the reader is up in older messages, and when the reader is back at the end.
 *
 * The effect body is a block on purpose: Solid reads what an effect returns as its cleanup. The host
 * often passes the setter of a signal, which returns the value it sets, and `true` is not a cleanup:
 * Solid halts the reactive system and no click works after it.
 */
export function watchReaderAway(readerAway: () => boolean, onChange: ((away: boolean) => void) | undefined): void {
  createEffect(readerAway, (away) => {
    onChange?.(away);
  });
}
