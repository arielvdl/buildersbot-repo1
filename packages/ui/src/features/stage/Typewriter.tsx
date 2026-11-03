import { createMemo, createSignal, onSettled } from "solid-js";
import { prefersReducedMotion } from "./stage-motion";

/** Typing speed: one character each 28 ms, but never more than `MAX_TYPING_MS` for the whole text. */
const CHARACTER_MS = 28;
const MAX_TYPING_MS = 2200;
/** How long the caret stays after the last character. */
const CARET_HOLD_MS = 700;

/**
 * Text that types in, letter by letter, with a blinking caret that goes away a moment after the last letter. It
 * types once, when it mounts: a caller that wants the effect for each new text mounts it again, as a keyed `Show` does.
 * A reader who asks for less motion gets the whole text at once. A screen reader gets the whole text at once too, so
 * the typing is not read out letter by letter.
 */
export function Typewriter(props: { text: string }) {
  const characters = createMemo(() => Array.from(props.text));
  const reduced = prefersReducedMotion();
  const [count, setCount] = createSignal(reduced ? characters().length : 0);
  const [done, setDone] = createSignal(reduced);

  onSettled(() => {
    if (reduced) return;
    const total = characters().length;
    const perCharacter = Math.min(CHARACTER_MS, MAX_TYPING_MS / Math.max(total, 1));
    const start = performance.now();
    let frame = 0;
    let hold: ReturnType<typeof setTimeout> | undefined;
    const tick = (now: number) => {
      const next = Math.min(total, Math.floor((now - start) / perCharacter) + 1);
      setCount((current) => (next === current ? current : next));
      if (next < total) frame = requestAnimationFrame(tick);
      else hold = setTimeout(() => setDone(true), CARET_HOLD_MS);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(hold);
    };
  });

  return (
    <>
      <span class="sr-only">{props.text}</span>
      <span aria-hidden="true">
        {characters().slice(0, count()).join("")}
        <span class="agent-stage-caret" data-done={done() ? "" : undefined} />
      </span>
    </>
  );
}
