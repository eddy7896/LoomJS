import type { Component } from '@loom/ir';

/**
 * A chart on the canvas (`docs/30-charts.md`).
 *
 * It draws **sample data**, because there is no data in the editor — the rows arrive from a query
 * when the app runs. That is the same honesty as a Table's ghost rows: what is being judged here is
 * the size, the shape and the colour, and all three are real. The numbers are not, and pretending
 * otherwise would be worse than making them up openly.
 *
 * The geometry is written again here rather than imported from the emitted runtime, and that is
 * fine precisely *because* the values differ: there is no drift to protect against between a chart
 * of sample data and a chart of real data. What has to match is the shape and the classes, and both
 * come from the same place the emitted app gets them.
 */

const SAMPLE = [38, 62, 45, 78, 56, 88];
const VIEW = { width: 400, height: 240, padLeft: 44, padBottom: 28, padTop: 12, padRight: 12 };
const plotWidth = VIEW.width - VIEW.padLeft - VIEW.padRight;
const plotHeight = VIEW.height - VIEW.padTop - VIEW.padBottom;

const shapeOf = (component: Component, fallback: string): string => {
  const value = component.props.variant;
  return value?.kind === 'static' ? String(value.value ?? fallback) : fallback;
};

const yOf = (value: number, max: number): number =>
  VIEW.padTop + plotHeight - (value / max) * plotHeight;

const xOf = (index: number, count: number): number => {
  const slot = plotWidth / Math.max(1, count);
  return VIEW.padLeft + slot * index + slot / 2;
};

export function ChartPreview({ component }: { component: Component }) {
  const max = 100;
  const grid = [0, 25, 50, 75, 100];

  if (component.type === 'PieChart') {
    const hole = shapeOf(component, 'pie') === 'donut' ? 0.58 : 0;
    const total = SAMPLE.reduce((sum, value) => sum + value, 0);
    const centre = { x: VIEW.width / 2, y: VIEW.height / 2 };
    const radius = Math.min(plotHeight, VIEW.height) / 2 - 8;
    const inner = radius * hole;

    let angle = -Math.PI / 2;
    const wedges = SAMPLE.map((value, index) => {
      const sweep = (value / total) * Math.PI * 2;
      const end = angle + sweep;
      const start = [centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius];
      const stop = [centre.x + Math.cos(end) * radius, centre.y + Math.sin(end) * radius];
      const large = sweep > Math.PI ? 1 : 0;

      let d = `M ${start[0]} ${start[1]} A ${radius} ${radius} 0 ${large} 1 ${stop[0]} ${stop[1]}`;
      if (inner > 0) {
        const back = [centre.x + Math.cos(end) * inner, centre.y + Math.sin(end) * inner];
        const home = [centre.x + Math.cos(angle) * inner, centre.y + Math.sin(angle) * inner];
        d += ` L ${back[0]} ${back[1]} A ${inner} ${inner} 0 ${large} 0 ${home[0]} ${home[1]} Z`;
      } else {
        d += ` L ${centre.x} ${centre.y} Z`;
      }

      angle = end;
      return { d, opacity: Math.max(0.25, 1 - index * 0.14) };
    });

    return (
      <svg className="loom-chart__svg" viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} preserveAspectRatio="none">
        {wedges.map((wedge, index) => (
          <path key={index} className="loom-chart__slice" d={wedge.d} opacity={wedge.opacity} />
        ))}
      </svg>
    );
  }

  const axis = grid.map((tick) => (
    <line
      key={tick}
      className="loom-chart__grid"
      x1={VIEW.padLeft}
      x2={VIEW.width - VIEW.padRight}
      y1={yOf(tick, max)}
      y2={yOf(tick, max)}
    />
  ));

  if (component.type === 'BarChart') {
    const horizontal = shapeOf(component, 'vertical') === 'horizontal';
    const slot = (horizontal ? plotHeight : plotWidth) / SAMPLE.length;
    const thickness = Math.max(2, slot * 0.62);

    return (
      <svg className="loom-chart__svg" viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} preserveAspectRatio="none">
        {horizontal ? null : axis}
        {SAMPLE.map((value, index) =>
          horizontal ? (
            <rect
              key={index}
              className="loom-chart__bar"
              x={VIEW.padLeft}
              y={VIEW.padTop + slot * index + (slot - thickness) / 2}
              width={(value / max) * plotWidth}
              height={thickness}
            />
          ) : (
            <rect
              key={index}
              className="loom-chart__bar"
              x={VIEW.padLeft + slot * index + (slot - thickness) / 2}
              y={yOf(value, max)}
              width={thickness}
              height={VIEW.padTop + plotHeight - yOf(value, max)}
            />
          ),
        )}
      </svg>
    );
  }

  // Line, smooth and area are one drawing with two switches.
  const kind = shapeOf(component, 'line');
  const smooth = kind === 'smooth';

  let path = `M ${xOf(0, SAMPLE.length)} ${yOf(SAMPLE[0]!, max)}`;
  for (let index = 1; index < SAMPLE.length; index += 1) {
    const x = xOf(index, SAMPLE.length);
    const y = yOf(SAMPLE[index]!, max);
    if (smooth) {
      const previousX = xOf(index - 1, SAMPLE.length);
      const previousY = yOf(SAMPLE[index - 1]!, max);
      const middle = (previousX + x) / 2;
      path += ` C ${middle} ${previousY} ${middle} ${y} ${x} ${y}`;
    } else {
      path += ` L ${x} ${y}`;
    }
  }

  const floor = VIEW.padTop + plotHeight;
  const area = `${path} L ${xOf(SAMPLE.length - 1, SAMPLE.length)} ${floor} L ${xOf(0, SAMPLE.length)} ${floor} Z`;

  return (
    <svg className="loom-chart__svg" viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} preserveAspectRatio="none">
      {axis}
      {kind === 'area' ? <path className="loom-chart__area" d={area} /> : null}
      <path className="loom-chart__line" d={path} />
      {SAMPLE.map((value, index) => (
        <circle
          key={index}
          className="loom-chart__dot"
          cx={xOf(index, SAMPLE.length)}
          cy={yOf(value, max)}
          r={3}
        />
      ))}
    </svg>
  );
}
