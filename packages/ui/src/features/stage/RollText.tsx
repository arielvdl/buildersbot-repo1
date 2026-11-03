import { createMemo, Show } from "solid-js";

/**
 * A short label whose new text rolls in from below while the old text rolls out above it, like an odometer. The first
 * text shows at once. A reader who asks for less motion gets a plain swap: the CSS leaves the roll out.
 */
export function RollText(props: { text: string }) {
  let last: string | undefined;
  /** The text now and the text it replaces. A new object for each change, so the keyed `Show` below mounts again. */
  const change = createMemo(() => {
    const now = props.text;
    const before = last;
    last = now;
    return { now, before: before === now ? undefined : before };
  });
  return (
    <Show when={change()} keyed>
      {(item) => (
        <>
          <Show when={item.before}>
            <span class="agent-stage-roll-out" aria-hidden="true">
              {item.before}
            </span>
          </Show>
          <span class="agent-stage-roll-in" data-first={item.before === undefined ? "" : undefined}>
            {item.now}
          </span>
        </>
      )}
    </Show>
  );
}
