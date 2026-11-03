import { createMemo, createUniqueId, For, Show } from "solid-js";
import { type StageGeometry, TABLE_DEPTH, TABLE_GRID, TABLE_RATIO } from "./stage-geometry";

/**
 * The scan (`scan` on the board of a channel): while an agent works, a thin laser crosses the table from the back to
 * the front, takes 9 s, rests 4 s, and crosses back. The cells that it passes glow a little and fade behind it. Every
 * time here is in seconds of one cycle that `agent-stage.css` repeats (`agent-stage-scan-sweep` and
 * `agent-stage-scan-glow`): change a number there when you change one here.
 */
const SCAN_PASS_S = 9;
const SCAN_REST_S = 4;
/** The glow peaks this long after it starts, so a cell is at its brightest when the laser is on it. */
const SCAN_GLOW_LEAD_S = 0.54;

/** The table: a diamond with an edge, drawn once for its width. */
export function StageTable(props: {
  geometry: StageGeometry;
  scan?: boolean | undefined;
  working?: boolean | undefined;
}) {
  const clipId = `agent-stage-scan-${createUniqueId()}`;
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
        const depth = (row + column + 1) / (2 * TABLE_GRID);
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
        "--agent-stage-scan-travel": `${shape().height}px`,
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
      <Show when={props.scan}>
        <clipPath id={clipId}>
          <polygon points={shape().top} />
        </clipPath>
        <g class="agent-stage-scan" clip-path={`url(#${clipId})`}>
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
          <g class="agent-stage-scan-laser">
            <rect class="agent-stage-scan-halo" x="0" y="-1.8" width={shape().width} height="4.6" />
            <rect class="agent-stage-scan-ray" x="0" y="-0.7" width={shape().width} height="1.4" />
          </g>
        </g>
      </Show>
      <path class="agent-stage-table-grid" d={shape().grid} />
    </svg>
  );
}
