import { createSignal, onCleanup } from "solid-js";

/** How far the row slides to show its buttons, in pixels. */
export const SWIPE_REVEAL = 112;
/** The drag has to move this far, and more sideways than up or down, before it counts as a swipe. */
const SWIPE_START = 6;
/** Horizontal wheel movement (a two-finger swipe on a trackpad) that opens or closes the row. */
const WHEEL_TRIGGER = 12;
const WHEEL_PAUSE_MS = 350;

interface Press {
  pointerId: number;
  x: number;
  y: number;
  base: number;
  swiping: boolean;
}

/**
 * The swipe of one row: a press-and-drag to the left (mouse, finger or pen) or a sideways trackpad swipe
 * slides the row to show its buttons; the other way, or a press outside, closes it. The row stays a
 * normal button: a tap still opens the conversation, and the buttons are also in the row menu.
 */
export function createRowSwipe() {
  const [offset, setOffset] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  let item: HTMLElement | undefined;
  let press: Press | null = null;
  let swallowClick = false;
  let lastWheel = 0;
  const open = () => offset() <= -SWIPE_REVEAL / 2;
  const close = () => setOffset(0);
  const clamp = (value: number) => Math.min(0, Math.max(-SWIPE_REVEAL, value));

  /** In the capture phase: the click that ends a swipe must not open the conversation. */
  const onClickCapture = (event: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const onOutside = (event: PointerEvent) => {
    if (!(event.target instanceof Node && item?.contains(event.target))) close();
  };
  document.addEventListener("pointerdown", onOutside, true);
  onCleanup(() => document.removeEventListener("pointerdown", onOutside, true));

  return {
    offset,
    dragging,
    open,
    close,
    /** True while a swipe is under way: a native drag of the row must not start. */
    swiping: () => press?.swiping === true,
    ref: (element: HTMLElement) => {
      item = element;
      element.addEventListener("click", onClickCapture, true);
      onCleanup(() => element.removeEventListener("click", onClickCapture, true));
    },
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, base: offset(), swiping: false };
    },
    onPointerMove: (event: PointerEvent) => {
      if (!press || press.pointerId !== event.pointerId) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (!press.swiping) {
        if (Math.abs(dx) < SWIPE_START || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        press.swiping = true;
        setDragging(true);
        if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId);
      }
      setOffset(clamp(press.base + dx));
    },
    onPointerEnd: (event: PointerEvent) => {
      if (!press || press.pointerId !== event.pointerId) return;
      const wasSwiping = press.swiping;
      press = null;
      if (!wasSwiping) return;
      swallowClick = true;
      // The click that follows the release comes at once; if none comes, the next real click must work.
      setTimeout(() => {
        swallowClick = false;
      }, 0);
      setDragging(false);
      setOffset(open() ? -SWIPE_REVEAL : 0);
    },
    onWheel: (event: WheelEvent) => {
      if (Math.abs(event.deltaX) < WHEEL_TRIGGER || Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.5) return;
      event.preventDefault();
      // One swipe fires many wheel events, and its inertia fires more: act once, then wait.
      if (event.timeStamp - lastWheel < WHEEL_PAUSE_MS) {
        lastWheel = event.timeStamp;
        return;
      }
      lastWheel = event.timeStamp;
      setOffset(event.deltaX > 0 ? -SWIPE_REVEAL : 0);
    },
  };
}
