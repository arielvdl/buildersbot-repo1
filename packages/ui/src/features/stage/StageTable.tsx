import { createEffect, createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { type StageGeometry, TABLE_DEPTH, TABLE_GRID, TABLE_RATIO } from "./stage-geometry";
import { type ScanFocus, scanDepth, scanDirection, scanSpan } from "./stage-scan";

/**
 * The scan (`scan` on the board of a channel): while an agent works, a thin laser crosses the table from the back to
 * the front, takes 9 s, rests 4 s, and crosses back. The cells that it passes glow a little and fade behind it. Every
 * time here is in seconds of one cycle that `agent-stage.css` repeats (`agent-stage-scan-sweep` and
 * `agent-stage-scan-glow`): change a number there when you change one here.
 */
const SCAN_PASS_S = 9;
const SCAN_REST_S = 4;
/** The table has the unit square of its drawing in this many units, so a CSS length in the drawing is a fraction of it. */
const UNITS = 100;
/** Another agent has to hold the work this long before the scan changes to its color and its way. */
const SWITCH_AFTER_MS = 4000;
/** The scan fades out this long before the new one starts, as long as the fade of `agent-stage-scan` in the CSS. */
const SWITCH_FADE_MS = 1500;
/** The glow peaks this long after it starts, so a cell is at its brightest when the laser is on it. */
const SCAN_GLOW_LEAD_S = 0.54;

/** The table: a diamond with an edge, drawn once for its width. */
export function StageTable(props: {
  geometry: StageGeometry;
  scan?: boolean | undefined;
  working?: boolean | undefined;
  /** The agent that the scan follows: its color, and the way from its seat. Without one, the scan is the accent, back to front. */
  focus?: ScanFocus | null | undefined;
}) {
  const clipId = `agent-stage-scan-${createUniqueId()}`;
  // The scan that shows. It follows `focus` at once when none shows, and after `SWITCH_AFTER_MS` when another agent
  // takes the work: it fades out, and the next one starts from its own seat.
  const [shown, setShown] = createSignal<ScanFocus | null>(null);
  const [switching, setSwitching] = createSignal(false);
  createEffect(
    () => props.focus ?? null,
    (focus) => {
      if (focus === null) return;
      const current = shown();
      if (current === null) {
        setShown(focus);
        return;
      }
      if (current.id === focus.id && current.seat === focus.seat) {
        if (current.color !== focus.color) setShown(focus);
        return;
      }
      let finish: ReturnType<typeof setTimeout> | undefined;
      const wait = setTimeout(() => {
        setSwitching(true);
        finish = setTimeout(() => {
          setShown(focus);
          setSwitching(false);
        }, SWITCH_FADE_MS);
      }, SWITCH_AFTER_MS);
      return () => {
        clearTimeout(wait);
        clearTimeout(finish);
        setSwitching(false);
      };
    },
  );
  const direction = createMemo(() => scanDirection(shown()?.seat ?? 0));
  const laser = createMemo(() => {
    // The laser is a line across the way, drawn in the unit square of the table (`UNITS` wide) and moved along the
    // way by the CSS. It starts on the corner of the table that the way leaves from.
    const way = direction();
    const startU = (way.u < 0 ? 1 : 0) * UNITS;
    const startV = (way.v < 0 ? 1 : 0) * UNITS;
    const reach = 2 * UNITS;
    const span = scanSpan(way) * UNITS;
    return {
      x1: startU + way.v * reach,
      y1: startV - way.u * reach,
      x2: startU - way.v * reach,
      y2: startV + way.u * reach,
      travelX: way.u * span,
      travelY: way.v * span,
    };
  });
  const shape = createMemo(() => {
    // Rounded to 8 px, so a drag of the splitter does not build the drawing again for each pixel.
    const width = Math.round(props.geometry.tableWidth / 8) * 8;
    const height = width * TABLE_RATIO;
    const half = width / 2;
    const top = height / 2;
    const lines: string[] = [];
    for (let step = 1; step < TABLE_GRID; step += 1) {
      const fraction = step / TABLE_GRID;
      lines.push(
        `M${half - fraction * half} ${fraction * top}L${width - fraction * half} ${top + fraction * top}`,
        `M${half + fraction * half} ${fraction * top}L${fraction * half} ${top + fraction * top}`,
      );
    }
    // One glow for each cell and direction. `depth` is how far down the table the middle of the cell is, from 0 to 1,
    // and the laser reaches it at that part of its pass: forward at the start of the cycle, back after the rest.
    const cells: { points: string; forward: number; back: number }[] = [];
    for (let row = 0; row < TABLE_GRID; row += 1) {
      for (let column = 0; column < TABLE_GRID; column += 1) {
        const corner = (u: number, v: number) => `${half + (u - v) * half},${(u + v) * top}`;
        const [u0, u1, v0, v1] = [
          row / TABLE_GRID,
          (row + 1) / TABLE_GRID,
          column / TABLE_GRID,
          (column + 1) / TABLE_GRID,
        ];
        const depth = scanDepth(direction(), (row + 0.5) / TABLE_GRID, (column + 0.5) / TABLE_GRID);
        cells.push({
          points: [corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)].join(" "),
          forward: depth * SCAN_PASS_S - SCAN_GLOW_LEAD_S,
          back: SCAN_PASS_S + SCAN_REST_S + (1 - depth) * SCAN_PASS_S - SCAN_GLOW_LEAD_S,
        });
      }
    }
    return {
      width,
      height,
      cells,
      top: `${half},0 ${width},${top} ${half},${height} 0,${top}`,
      left: `0,${top} ${half},${height} ${half},${height + TABLE_DEPTH} 0,${top + TABLE_DEPTH}`,
      right: `${width},${top} ${half},${height} ${half},${height + TABLE_DEPTH} ${width},${top + TABLE_DEPTH}`,
      grid: lines.join(""),
    };
  });
  return (
    <svg
      class="agent-stage-table"
      data-working={props.working ? "" : undefined}
      style={{
        left: `${Math.round(props.geometry.centerX - shape().width / 2)}px`,
        top: `${Math.round(props.geometry.centerY - shape().height / 2 + 20)}px`,
      }}
      width={shape().width}
      height={shape().height + TABLE_DEPTH}
      viewBox={`0 0 ${shape().width} ${shape().height + TABLE_DEPTH}`}
      aria-hidden="true"
    >
      <polygon class="agent-stage-table-left" points={shape().left} />
      <polygon class="agent-stage-table-right" points={shape().right} />
      <polygon class="agent-stage-table-top" points={shape().top} />
      <Show when={props.scan ? shown() : null} keyed>
        {(focus) => (
          <>
            <clipPath id={clipId}>
              <polygon points={shape().top} />
            </clipPath>
            <g
              class="agent-stage-scan"
              data-switching={switching() ? "" : undefined}
              clip-path={`url(#${clipId})`}
              style={{ "--agent-stage-scan-color": focus.color }}
            >
              <For each={shape().cells}>
                {(cell) => (
                  <>
                    <polygon
                      class="agent-stage-scan-cell"
                      points={cell.points}
                      style={{ "animation-delay": `${cell.forward.toFixed(2)}s` }}
                    />
                    <polygon
                      class="agent-stage-scan-cell"
                      points={cell.points}
                      style={{ "animation-delay": `${cell.back.toFixed(2)}s` }}
                    />
                  </>
                )}
              </For>
              <g
                transform={`matrix(${shape().width / 2 / UNITS} ${shape().height / 2 / UNITS} ${-shape().width / 2 / UNITS} ${shape().height / 2 / UNITS} ${shape().width / 2} 0)`}
              >
                <g
                  class="agent-stage-scan-laser"
                  style={{
                    "--agent-stage-scan-tx": `${laser().travelX.toFixed(2)}px`,
                    "--agent-stage-scan-ty": `${laser().travelY.toFixed(2)}px`,
                  }}
                >
                  <line
                    class="agent-stage-scan-halo"
                    x1={laser().x1}
                    y1={laser().y1}
                    x2={laser().x2}
                    y2={laser().y2}
                    vector-effect="non-scaling-stroke"
                  />
                  <line
                    class="agent-stage-scan-ray"
                    x1={laser().x1}
                    y1={laser().y1}
                    x2={laser().x2}
                    y2={laser().y2}
                    vector-effect="non-scaling-stroke"
                  />
                </g>
              </g>
            </g>
          </>
        )}
      </Show>
      <path class="agent-stage-table-grid" d={shape().grid} />
    </svg>
  );
}
