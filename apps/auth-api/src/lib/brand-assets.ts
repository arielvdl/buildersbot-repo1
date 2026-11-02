// The logo files of the /brand page, as SVG text. The page shows them, the Worker serves each one at
// `/brand/<file>.svg`, and the browser draws the PNG files and the zip from the same text.
//
// The shapes come from `@buildersbot/brand`, and the layout of the logo with its name from the Figma
// "Logo" board. No JSX and no DOM here: the Worker imports this module.

import { APP_LOGO_CORNER, APP_LOGO_CUBE, APP_LOGO_SIZE } from "@buildersbot/brand/app-logo-shape";
import { WORDMARK_PATHS, WORDMARK_WIDTH } from "@buildersbot/brand/wordmark-shape";
import { BRAND_ROUTE } from "./brand-page";

export const BRAND_ZIP_FILE = "buildersbot-brand.zip";

type IconColor = "lime" | "white" | "dark";
type IconShape = "rounded" | "square";
type Ink = "dark" | "light";
export type BrandSpace = "tight" | "safe";

// The colors of the app logo (`APP_LOGO_COLOR_HEX.noite` and `--buildersbot-logo-eye`). A file must
// not depend on a page's CSS. `FILL` is the square, `FACE` the cube on it.
const FILL: Record<IconColor, string> = { lime: "#98f94f", white: "#ffffff", dark: "#0b0d0a" };
const FACE: Record<IconColor, string> = { lime: "#0b0d0a", white: "#0b0d0a", dark: "#98f94f" };
const INK: Record<Ink, string> = { dark: "#0b0d0a", light: "#ffffff" };
const COLOR_NAME: Record<IconColor, string> = { lime: "Lime", white: "White", dark: "Dark" };

export interface BrandAsset {
  /** The file name without its extension. */
  readonly file: string;
  readonly label: string;
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  /** The background the file is drawn for. */
  readonly surface: "dark" | "light";
}

// Measured on the Figma board: the name starts a little more than a third of a mark after the mark,
// and its baseline is at 195 of the mark's 240. Clear space is half a mark on each side.
const LOCKUP_GAP = 84;
const LOCKUP_BASELINE = 195;
const CLEAR_SPACE = APP_LOGO_SIZE / 2;

/** The square and the cube, as `AppLogo` draws them: the faces lighten from top to right. */
function mark(color: IconColor, shape: IconShape, x: number, y: number): string {
  const corner = shape === "rounded" ? APP_LOGO_CORNER : 0;
  const fill = FILL[color];
  const face = (d: string, opacity: number) =>
    `<path d="${d}" fill="${FACE[color]}" fill-opacity="${opacity}" stroke="${fill}" stroke-width="1.1" stroke-linejoin="round"/>`;
  return [
    `<g transform="translate(${x} ${y})">`,
    `<rect width="${APP_LOGO_SIZE}" height="${APP_LOGO_SIZE}" rx="${corner}" fill="${fill}"/>`,
    `<g transform="${APP_LOGO_CUBE.fit}">`,
    face(APP_LOGO_CUBE.top, 1),
    face(APP_LOGO_CUBE.left, 0.88),
    face(APP_LOGO_CUBE.right, 0.72),
    `<g fill="none" stroke="${fill}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">`,
    `<polyline points="${APP_LOGO_CUBE.eyes.left}"/><polyline points="${APP_LOGO_CUBE.eyes.right}"/>`,
    "</g>",
    `<circle cx="${APP_LOGO_CUBE.dot.cx}" cy="${APP_LOGO_CUBE.dot.cy}" r="${APP_LOGO_CUBE.dot.r}" fill="${fill}"/>`,
    "</g></g>",
  ].join("");
}

function wordmark(ink: Ink, x: number, y: number): string {
  return [
    `<g transform="translate(${x} ${y})" fill="${INK[ink]}">`,
    `<path d="${WORDMARK_PATHS.light}"/><path d="${WORDMARK_PATHS.medium}"/>`,
    "</g>",
  ].join("");
}

function svgDocument(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function iconAsset(color: IconColor, shape: IconShape): BrandAsset {
  return {
    file: shape === "rounded" ? `buildersbot-icon-${color}` : `buildersbot-icon-square-${color}`,
    label: shape === "rounded" ? `${COLOR_NAME[color]} icon` : `${COLOR_NAME[color]} square`,
    svg: svgDocument(APP_LOGO_SIZE, APP_LOGO_SIZE, mark(color, shape, 0, 0)),
    width: APP_LOGO_SIZE,
    height: APP_LOGO_SIZE,
    surface: color === "dark" ? "light" : "dark",
  };
}

function lockupAsset(color: IconColor, ink: Ink, space: BrandSpace): BrandAsset {
  const pad = space === "safe" ? CLEAR_SPACE : 0;
  const width = APP_LOGO_SIZE + LOCKUP_GAP + WORDMARK_WIDTH + pad * 2;
  const height = APP_LOGO_SIZE + pad * 2;
  return {
    file: `buildersbot-logo-${color}-${ink}${space === "safe" ? "-clear-space" : ""}`,
    label: `${COLOR_NAME[color]} icon, ${ink} name`,
    svg: svgDocument(
      width,
      height,
      mark(color, "rounded", pad, pad) + wordmark(ink, pad + APP_LOGO_SIZE + LOCKUP_GAP, pad + LOCKUP_BASELINE),
    ),
    width,
    height,
    surface: ink === "dark" ? "light" : "dark",
  };
}

/** The app icon: the header logo menu copies it. */
export const BRAND_ICON = iconAsset("lime", "rounded");

export const BRAND_ICONS: readonly BrandAsset[] = [
  BRAND_ICON,
  iconAsset("white", "rounded"),
  iconAsset("dark", "rounded"),
];

export const BRAND_SQUARES: readonly BrandAsset[] = [
  iconAsset("lime", "square"),
  iconAsset("white", "square"),
  iconAsset("dark", "square"),
];

/** The four logos with the name on the Figma board, in its order. */
const LOCKUP_STYLES: readonly (readonly [IconColor, Ink])[] = [
  ["lime", "dark"],
  ["lime", "light"],
  ["white", "light"],
  ["dark", "dark"],
];

export const BRAND_LOCKUPS: Record<BrandSpace, readonly BrandAsset[]> = {
  tight: LOCKUP_STYLES.map(([color, ink]) => lockupAsset(color, ink, "tight")),
  safe: LOCKUP_STYLES.map(([color, ink]) => lockupAsset(color, ink, "safe")),
};

/** The logo with its name, for a light page: the header logo menu copies it. */
export const BRAND_LOCKUP = lockupAsset("lime", "dark", "tight");

export const BRAND_ASSETS: readonly BrandAsset[] = [
  ...BRAND_ICONS,
  ...BRAND_SQUARES,
  ...BRAND_LOCKUPS.tight,
  ...BRAND_LOCKUPS.safe,
];

/** The served address of a file. */
export function brandAssetPath(asset: BrandAsset): `${typeof BRAND_ROUTE}/${string}.svg` {
  return `${BRAND_ROUTE}/${asset.file}.svg`;
}

export function findBrandAsset(fileName: string): BrandAsset | undefined {
  return BRAND_ASSETS.find((asset) => `${asset.file}.svg` === fileName);
}

/** A square file is drawn 1024 pixels wide as PNG, and a logo with its name 2048. */
export function brandPngWidth(asset: BrandAsset): 1024 | 2048 {
  return asset.width === asset.height ? 1024 : 2048;
}
