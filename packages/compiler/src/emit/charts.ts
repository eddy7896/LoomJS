import type { EmittedFile } from '../types';

/**
 * The chart runtime the emitted project owns (`docs/30-charts.md`).
 *
 * Inline SVG, worked out from the rows at render time. No charting library: that is the same rule
 * the icons follow, and for the same reason — a dependency whose whole job is drawing shapes is a
 * dependency the emitted app should not carry, and it would decide what the charts can look like
 * for as long as the project lives.
 *
 * It is emitted as **one module the chart components import**, rather than pasted into each of
 * them: a project with four charts should have one copy of the arithmetic, and a person reading the
 * repo should have one place to check what the axis actually does.
 */

const CHART_RUNTIME = `/**
 * Chart geometry (generated — docs/30-charts.md).
 *
 * Small on purpose. Everything here is arithmetic on numbers you can print: no library, no canvas,
 * no measurement of the DOM. A chart is drawn into a fixed viewBox and the browser scales it, so
 * none of this has to know how wide the element ended up.
 */

export interface Point {
  label: string;
  value: number;
}

/** The box every chart is drawn into. The browser scales it to whatever the element is. */
export const VIEW = { width: 400, height: 240, padLeft: 44, padBottom: 28, padTop: 12, padRight: 12 };

export const plotWidth = VIEW.width - VIEW.padLeft - VIEW.padRight;
export const plotHeight = VIEW.height - VIEW.padTop - VIEW.padBottom;

/**
 * Rows to points.
 *
 * A value that is not a number counts as zero rather than breaking the chart: one bad row in a
 * thousand should not blank a dashboard, and a gap in the data is a fact about the data.
 */
export function toPoints(
  rows: readonly Record<string, unknown>[],
  labelKey: string,
  valueKey: string,
): Point[] {
  return rows.map((row) => {
    const raw = valueKey ? row[valueKey] : undefined;
    const value = typeof raw === 'number' ? raw : Number(raw);
    return {
      label: labelKey ? String(row[labelKey] ?? '') : '',
      value: Number.isFinite(value) ? value : 0,
    };
  });
}

/**
 * A top for the axis that a person can read.
 *
 * 0, 250, 500 rather than 0, 237, 474. The axis always starts at zero: a bar chart that starts at
 * 40 makes a 3% difference look like a doubling, which is the oldest way to lie with a chart.
 */
export function niceMax(values: readonly number[]): number {
  const highest = Math.max(0, ...values);
  if (highest <= 0) return 1;

  const magnitude = Math.pow(10, Math.floor(Math.log10(highest)));
  const scaled = highest / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

/** The gridline values, bottom to top, including zero and the top of the axis. */
export function ticks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_unused, index) => (max / count) * index);
}

/** Where a value sits vertically, in view units. */
export function yOf(value: number, max: number): number {
  return VIEW.padTop + plotHeight - (Math.max(0, value) / max) * plotHeight;
}

/** Where a point sits horizontally: the centre of its share of the width. */
export function xOf(index: number, count: number): number {
  const slot = plotWidth / Math.max(1, count);
  return VIEW.padLeft + slot * index + slot / 2;
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
  point: Point;
}

export function bars(points: readonly Point[], max: number): Bar[] {
  const slot = plotWidth / Math.max(1, points.length);
  // A quarter of the slot as breathing room, so bars are separate things rather than a block.
  const width = Math.max(2, slot * 0.62);
  return points.map((point, index) => {
    const y = yOf(point.value, max);
    return {
      x: VIEW.padLeft + slot * index + (slot - width) / 2,
      y,
      width,
      height: Math.max(0, VIEW.padTop + plotHeight - y),
      point,
    };
  });
}

/** Horizontal bars: the same arithmetic with the axes swapped. */
export function rows(points: readonly Point[], max: number): Bar[] {
  const slot = plotHeight / Math.max(1, points.length);
  const height = Math.max(2, slot * 0.62);
  return points.map((point, index) => ({
    x: VIEW.padLeft,
    y: VIEW.padTop + slot * index + (slot - height) / 2,
    width: Math.max(0, (Math.max(0, point.value) / max) * plotWidth),
    height,
    point,
  }));
}

export function linePath(points: readonly Point[], max: number, smooth: boolean): string {
  if (points.length === 0) return '';

  const at = (index: number): [number, number] => [
    xOf(index, points.length),
    yOf(points[index]!.value, max),
  ];

  const [startX, startY] = at(0);
  let path = 'M ' + startX + ' ' + startY;

  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = at(index);
    if (!smooth) {
      path += ' L ' + x + ' ' + y;
      continue;
    }
    // A cubic whose handles sit halfway between the points horizontally: enough to round the
    // corners without inventing peaks the data does not have.
    const [previousX, previousY] = at(index - 1);
    const middle = (previousX + x) / 2;
    path += ' C ' + middle + ' ' + previousY + ' ' + middle + ' ' + y + ' ' + x + ' ' + y;
  }

  return path;
}

/** The line, closed down to the axis — an area is a line plus a floor. */
export function areaPath(points: readonly Point[], max: number, smooth: boolean): string {
  if (points.length === 0) return '';
  const floor = VIEW.padTop + plotHeight;
  const last = xOf(points.length - 1, points.length);
  const first = xOf(0, points.length);
  return linePath(points, max, smooth) + ' L ' + last + ' ' + floor + ' L ' + first + ' ' + floor + ' Z';
}

export interface Slice {
  d: string;
  point: Point;
  share: number;
  /** Falling opacity rather than invented hues, so a restyle keeps the chart legible. */
  opacity: number;
}

/**
 * Pie and donut wedges.
 *
 * The arc flag is the only fiddly part: an SVG arc needs to be told when it is going the long way
 * round, and a single slice covering everything would otherwise draw as nothing at all.
 */
export function slices(points: readonly Point[], hole: number): Slice[] {
  const total = points.reduce((sum, point) => sum + Math.max(0, point.value), 0);
  if (total <= 0) return [];

  const centreX = VIEW.width / 2;
  const centreY = VIEW.height / 2;
  const radius = Math.min(plotHeight, VIEW.height) / 2 - 8;
  const inner = radius * hole;

  let angle = -Math.PI / 2;
  return points.map((point, index) => {
    const share = Math.max(0, point.value) / total;
    const sweep = share * Math.PI * 2;
    const end = angle + sweep;

    const point1 = [centreX + Math.cos(angle) * radius, centreY + Math.sin(angle) * radius];
    const point2 = [centreX + Math.cos(end) * radius, centreY + Math.sin(end) * radius];
    const large = sweep > Math.PI ? 1 : 0;

    let d =
      'M ' + point1[0] + ' ' + point1[1] +
      ' A ' + radius + ' ' + radius + ' 0 ' + large + ' 1 ' + point2[0] + ' ' + point2[1];

    if (inner > 0) {
      const inner1 = [centreX + Math.cos(end) * inner, centreY + Math.sin(end) * inner];
      const inner2 = [centreX + Math.cos(angle) * inner, centreY + Math.sin(angle) * inner];
      d +=
        ' L ' + inner1[0] + ' ' + inner1[1] +
        ' A ' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + inner2[0] + ' ' + inner2[1] + ' Z';
    } else {
      d += ' L ' + centreX + ' ' + centreY + ' Z';
    }

    angle = end;
    return { d, point, share, opacity: Math.max(0.25, 1 - index * 0.14) };
  });
}

/** A number a person reads, not a float with fourteen digits. */
export function format(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1).replace(/\\.0$/, '') + 'M';
  if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1).replace(/\\.0$/, '') + 'k';
  return String(Math.round(value * 100) / 100);
}

/**
 * A value of unknown shape, as something to print.
 *
 * A Stat can be bound to a count, to a text column, or to nothing yet. Deciding which at *emit*
 * time meant writing a type test into the markup, and the emitted app's own build rejected it twice
 * over — once for the type and once for a \`??\` whose left side could never be null. The decision
 * belongs here, where the value actually is.
 */
export function formatValue(value: unknown): string {
  if (typeof value === 'number') return format(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return format(Number(value));
  }
  return value === null || value === undefined ? '' : String(value);
}

/**
 * What a screen reader is told.
 *
 * A chart with no description says nothing at all to some of the people looking at the page, and
 * "chart" says nearly nothing to the rest.
 */
export function describe(title: string, points: readonly Point[]): string {
  if (points.length === 0) return title + ': no data yet.';
  const parts = points.slice(0, 12).map((point) => point.label + ' ' + format(point.value));
  const more = points.length > 12 ? ', and ' + (points.length - 12) + ' more' : '';
  return title + ': ' + parts.join(', ') + more + '.';
}
`;

/** The module, when this project has at least one chart. */
export function emitChartRuntime(): EmittedFile {
  return { path: 'src/charts.ts', content: CHART_RUNTIME };
}
