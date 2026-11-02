// The Builders Bot mark as plain data, so that a canvas can draw the same mark that
// `AppLogo` draws as SVG: the social cards in apps/auth-api do.

/** The mark is a square of this side, in its own units. */
export const APP_LOGO_SIZE = 240;
/** The corner radius of the square, in the same units. */
export const APP_LOGO_CORNER = 50;

/**
 * The cube of the app icon, in a 100-unit box. The three faces are drawn in this order, so the
 * left face covers the top one and the right face covers both at the seams.
 */
export const APP_LOGO_CUBE = {
  /** Translate and scale that fit the cube into `APP_LOGO_SIZE`, with the icon's own margin. */
  fit: "translate(14 14) scale(2.12)",
  top: "M50 16 L84 33 L50 50 L16 33 Z",
  left: "M16 33 L50 50 L50 84 L16 67 Z",
  right: "M84 33 L84 67 L50 84 L50 50 Z",
  outline: "M50 16 L84 33 L84 67 L50 84 L16 67 L16 33 Z",
  /** Each eye is one chevron on the left face. */
  eyes: {
    left: "29.6 48.2 31.55 43.7 38 48.2",
    right: "41.6 48.2 43.55 43.7 50 48.2",
  },
  /** The point of the mark under the eyes. */
  dot: { cx: 43.1, cy: 54.8, r: 2.6 },
} as const;
