import { springLinearEasing } from "../../spring-motion";

/**
 * The motion of an agent stage, computed once at load. The arrival is a spring that settles a little
 * past its end; where the browser has no `linear()` easing, a cubic curve stands in.
 */
export const ENTER_EASING = supportsLinearEasing()
  ? springLinearEasing({ response: 0.5, dampingFraction: 0.62 })
  : "cubic-bezier(0.34, 1.2, 0.64, 1)";
export const ENTER_MS = 500;
export const LEAVE_MS = 340;
export const FADE_MS = 120;
export const HAND_OFF_MS = 700;

function supportsLinearEasing(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("animation-timing-function", "linear(0, 1)")
  );
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
