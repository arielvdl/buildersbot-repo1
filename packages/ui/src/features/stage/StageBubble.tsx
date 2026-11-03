import { createEffect, createSignal, flush, onCleanup, Show } from "solid-js";
import { ENTER_EASING, prefersReducedMotion } from "./stage-motion";
import { Typewriter } from "./Typewriter";

/** The bubble as a small pill with three dots, between one line and the next. */
const PILL_WIDTH = 44;
const PILL_HEIGHT = 28;
const SQUEEZE_MS = 170;
const EXPAND_MS = 640;
/** The line shows again this long after the bubble starts to open. */
const REVEAL_MS = 130;
/** If the opening has not ended this long after it should have, the bubble shows its line anyway. */
const FAILSAFE_MS = SQUEEZE_MS + EXPAND_MS + 250;

interface Shown {
  tone: string | null;
  text: string;
  /** The first line types in. A line that replaces another one comes with the opening of the bubble. */
  typed: boolean;
}

/**
 * The speech bubble of an agent. When its status changes, the bubble closes to a pill with three dots and opens with a
 * spring round the new line, so the line never jumps. The bubble does the size change with the Web Animations API, and
 * it ends with the bubble. With reduced motion the new line shows at once. A new line under the same status (the host
 * sends a new progress line at each step) takes the place of the old one with no motion: the bubble moves only when
 * the status changes.
 */
export function StageBubble(props: { activity: string; tone: string | null; sentence: string }) {
  let bubble: HTMLDivElement | undefined;
  const [shown, setShown] = createSignal<Shown>({ tone: props.tone, text: props.sentence, typed: true });
  const [morphing, setMorphing] = createSignal(false);
  let run = 0;
  let animations: Animation[] = [];
  let reveal: ReturnType<typeof setTimeout> | undefined;
  let failsafe: ReturnType<typeof setTimeout> | undefined;
  let first = true;
  let lastActivity = props.activity;

  const stop = () => {
    run += 1;
    clearTimeout(reveal);
    clearTimeout(failsafe);
    for (const animation of animations) animation.cancel();
    animations = [];
  };
  const size = (node: HTMLElement) => ({ width: `${node.offsetWidth}px`, height: `${node.offsetHeight}px` });

  const morph = (next: Shown) => {
    const node = bubble;
    if (!node || prefersReducedMotion()) {
      stop();
      setMorphing(false);
      setShown(next);
      return;
    }
    const from = size(node);
    stop();
    const token = run;
    setMorphing(true);
    // The bubble never stays a pill with three dots: whatever stops the animation, the line shows in the end.
    failsafe = setTimeout(() => {
      if (token !== run) return;
      for (const animation of animations) animation.cancel();
      setShown(next);
      setMorphing(false);
    }, FAILSAFE_MS);
    const pill = { width: `${PILL_WIDTH}px`, height: `${PILL_HEIGHT}px` };
    const squeeze = node.animate([from, pill], {
      duration: SQUEEZE_MS,
      easing: "cubic-bezier(0.5, 0, 0.75, 0)",
      fill: "forwards",
    });
    animations = [squeeze];
    squeeze.finished.then(
      () => {
        if (token !== run) return;
        setShown(next);
        flush();
        // Without the pill the bubble has the size of the new line. Measure it, and open from the pill in the
        // same frame, so no frame shows the bubble at full size with no line.
        squeeze.cancel();
        const open = node.animate([pill, size(node)], { duration: EXPAND_MS, easing: ENTER_EASING });
        animations = [open];
        reveal = setTimeout(() => {
          if (token === run) setMorphing(false);
        }, REVEAL_MS);
      },
      () => {},
    );
  };

  createEffect(
    () => ({ activity: props.activity, tone: props.tone, text: props.sentence }),
    ({ activity, ...now }) => {
      const before = lastActivity;
      lastActivity = activity;
      if (first) {
        first = false;
        return;
      }
      if (before === activity) {
        // Same status, a new line: swap the text in place. No squeeze, no spring.
        stop();
        setMorphing(false);
        setShown({ ...now, typed: false });
        return;
      }
      morph({ ...now, typed: false });
    },
  );
  onCleanup(stop);

  return (
    <div
      class="agent-stage-bubble"
      data-tone={props.activity}
      data-morph={morphing() ? "" : undefined}
      ref={(node) => {
        bubble = node;
      }}
    >
      <div class="agent-stage-bubble-body">
        <Show when={shown()} keyed>
          {(line) => (
            <>
              <Show when={line.tone}>
                <span class="agent-stage-bubble-tone">{line.tone}</span>
              </Show>
              <Show when={line.text}>
                <span class="agent-stage-bubble-text">{line.typed ? <Typewriter text={line.text} /> : line.text}</span>
              </Show>
            </>
          )}
        </Show>
      </div>
      <span class="agent-stage-bubble-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
