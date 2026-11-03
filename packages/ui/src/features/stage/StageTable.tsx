import { createMemo } from "solid-js";
import { type StageGeometry, TABLE_DEPTH, TABLE_GRID, TABLE_RATIO } from "./stage-geometry";

/** The table: a diamond with an edge, drawn once for its width. */
export function StageTable(props: { geometry: StageGeometry }) {
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
    return {
      width,
      height,
      top: `${half},0 ${width},${top} ${half},${height} 0,${top}`,
      left: `0,${top} ${half},${height} ${half},${height + TABLE_DEPTH} 0,${top + TABLE_DEPTH}`,
      right: `${width},${top} ${half},${height} ${half},${height + TABLE_DEPTH} ${width},${top + TABLE_DEPTH}`,
      grid: lines.join(""),
    };
  });
  return (
    <svg
      class="agent-stage-table"
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
      <path class="agent-stage-table-grid" d={shape().grid} />
    </svg>
  );
}
