import { createSignal, onSettled } from "solid-js";

/**
 * The window width below which the agent stage never shows, whatever the reader configured: the stage
 * needs room for the actors and the request, and a narrow window keeps that space for the conversation.
 * The saved preference is not touched, so the stage returns when the window grows again.
 */
const CHANNEL_STAGE_MIN_WINDOW_WIDTH = 1000;

const NARROW_QUERY = `(max-width: ${CHANNEL_STAGE_MIN_WINDOW_WIDTH - 1}px)`;

/** Call it in a component. True while the window is too narrow for the stage. */
export function createChannelStageNarrowWindow(): () => boolean {
  const query = window.matchMedia?.(NARROW_QUERY);
  const [narrow, setNarrow] = createSignal(query?.matches ?? false);
  onSettled(() => {
    const update = (event: MediaQueryListEvent) => setNarrow(event.matches);
    setNarrow(query?.matches ?? false);
    query?.addEventListener("change", update);
    return () => query?.removeEventListener("change", update);
  });
  return narrow;
}
