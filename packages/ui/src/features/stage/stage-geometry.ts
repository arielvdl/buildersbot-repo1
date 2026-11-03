/**
 * Where the table and the seats of a stage are, in pixels, from the size of its board. Pure: the
 * board measures itself once for each resize and the rest is arithmetic.
 */

/** The seats as a direction from the middle of the table, in half-table units. The lead takes the first. */
export const SEATS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
  [-0.72, 0.72],
  [0.72, 0.72],
  [-0.72, -0.72],
  [0.72, -0.72],
];

export const FIGURE_WIDTH = 100;
export const FIGURE_HEIGHT = 108;
export const TABLE_RATIO = 0.5774;
export const TABLE_DEPTH = 16;
export const TABLE_GRID = 6;
/** A stage of a channel wider than this grows its agents, up to `WIDE_STAGE_GROWTH` at `WIDE_STAGE_FULL`. */
const WIDE_STAGE_FROM = 1200;
const WIDE_STAGE_FULL = 1600;
const WIDE_STAGE_GROWTH = 0.15;

/**
 * How much bigger the agents of a wide stage are: 1 up to 1200 px, then a steady rise to 1.15 at 1600 px,
 * so a resize never makes them jump. Without this, a big window leaves small agents on a big floor.
 */
function wideStageGrowth(width: number): number {
  const reach = (width - WIDE_STAGE_FROM) / (WIDE_STAGE_FULL - WIDE_STAGE_FROM);
  return 1 + WIDE_STAGE_GROWTH * Math.max(0, Math.min(1, reach));
}

export interface StageGeometry {
  width: number;
  height: number;
  tableWidth: number;
  tableHeight: number;
  centerX: number;
  centerY: number;
  /** The size of every figure, so a short stage keeps its agents apart. */
  fit: number;
  /** How far a seat stands from the table, sideways and in depth, in pixels. */
  reach: { x: number; y: number };
}

/**
 * `maxTable` is the widest the table gets: the stage of a channel draws a big one, a feed table a small
 * one. A small table scales with its height (`unit`), so a short box keeps the agents apart and in the box.
 */
export function stageGeometry(width: number, height: number, maxTable = 380): StageGeometry {
  const small = maxTable < 380;
  const unit = small ? Math.max(0.82, Math.min(1, height / 282)) : 1;
  const tableWidth = Math.max(small ? 96 : 120, Math.min(maxTable * unit, width * 0.4, (height * 0.5) / TABLE_RATIO));
  return {
    width,
    height,
    tableWidth,
    tableHeight: tableWidth * TABLE_RATIO,
    centerX: width / 2,
    centerY: height * (small ? 0.485 : 0.52),
    fit: small ? unit : stageFit(width, height),
    reach: small ? { x: 36 * unit, y: 34 * unit } : { x: 44, y: 18 },
  };
}

/**
 * The size of every figure on the stage of a channel. A short stage shrinks it to keep the agents apart. A
 * wide one grows it, but never past what the height holds, so a wide and short stage does not crowd.
 */
function stageFit(width: number, height: number): number {
  const base = Math.max(0.62, Math.min(1, height / 380));
  return Math.min(base * wideStageGrowth(width), Math.max(base, height / 380));
}

export interface SeatPoint {
  x: number;
  y: number;
  scale: number;
}

export function seatPoint(seat: number, geometry: StageGeometry): SeatPoint {
  const [sx, sy] = SEATS[seat] ?? SEATS[0] ?? [0, -1];
  return {
    x: Math.round(geometry.centerX + sx * (geometry.tableWidth / 2 + geometry.reach.x)),
    y: Math.round(geometry.centerY + sy * (geometry.tableHeight / 2 + geometry.reach.y) + 20),
    scale: (0.6 + 0.2 * ((sy + 1) / 2)) * geometry.fit,
  };
}

/** The side of the table that a seat is on. A bubble opens to that side. */
export function seatSide(seat: number): "left" | "right" {
  return (SEATS[seat]?.[0] ?? 0) < -0.1 ? "left" : "right";
}

export function seatIsFront(seat: number): boolean {
  return (SEATS[seat]?.[1] ?? 0) > 0.5;
}

/** The middle of a figure, where a link ends and a packet flies. */
export function centerOf(point: SeatPoint): { x: number; y: number } {
  return { x: point.x, y: point.y - point.scale * FIGURE_HEIGHT * 0.5 };
}

/** A quadratic arc from one figure to another. The packet flies along the same curve. */
export function arcPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const middleX = (from.x + to.x) / 2;
  const middleY = Math.min(from.y, to.y) - 40 - Math.abs(from.x - to.x) * 0.12;
  return {
    d: `M${from.x} ${from.y}Q${Math.round(middleX)} ${Math.round(middleY)} ${to.x} ${to.y}`,
    middleX,
    middleY,
  };
}
