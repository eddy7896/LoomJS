import type { Component } from '@loom/ir';
import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { staticString, valueExpr } from '../emit/props';
import { styleAttr } from '../emit/style';
import { layoutSizeStyle } from '../emit/layout';
import { classAttr } from '../emit/variants';

/**
 * The charts (`docs/30-charts.md`).
 *
 * Each one is inline SVG drawn from the rows it is bound to, with the arithmetic in `src/charts.ts`
 * — one copy for the whole project, and one place to look when the question is "what does the axis
 * actually do".
 *
 * Every chart is labelled: `role="img"` and a sentence naming what it shows and what the numbers
 * are. A chart with no description says nothing at all to some of the people looking at the page.
 */

/** The rows expression, whether they are bound to a query or nothing yet. */
function rowsExpr(component: Component, ctx: Parameters<ComponentEmitter['emit']>[1]): string {
  const items = component.props.items;
  return items ? valueExpr(items, ctx, component.id, 'items') : '[]';
}

/** The variant a chart is wearing, which decides its shape rather than only its paint. */
function shape(component: Component, fallback: string): string {
  const value = component.props.variant;
  return value?.kind === 'static' ? String(value.value ?? fallback) : fallback;
}

/** Everything each chart shares: the rows, the points, the empty state, the label. */
function chartFrame(
  component: Component,
  ctx: Parameters<ComponentEmitter['emit']>[1],
  depth: number,
  body: (points: string, max: string, at: number) => string,
  options: { needsMax?: boolean } = {},
): string {
  const ident = component.id.replace(/[^a-zA-Z0-9_]/g, '_');
  const points = `points_${ident}`;
  const max = `max_${ident}`;

  const label = staticString(component, 'label') || component.name || 'Chart';
  const empty = staticString(component, 'empty', 'Nothing yet');
  const labelKey = staticString(component, 'labels');
  const valueKey = staticString(component, 'values');

  // Exactly what this chart uses, and nothing else: the emitted app builds with `noUnusedLocals`,
  // so an import list written to cover every chart would fail the build of a project with one.
  ctx.requireChart(['toPoints', 'describe', 'VIEW']);
  const wantsMax = options.needsMax !== false;
  if (wantsMax) ctx.requireChart(['niceMax']);

  const maxLine = wantsMax
    ? `${indent(depth + 2)}const ${max} = niceMax(${points}.map((point) => point.value));\n`
    : '';

  return `${indent(depth)}<div${classAttr(component)}${styleAttr(component, ctx, layoutSizeStyle(component.layout))}>
${indent(depth + 1)}{(() => {
${indent(depth + 2)}const ${points} = toPoints((${rowsExpr(component, ctx)}) as Record<string, unknown>[], ${JSON.stringify(labelKey)}, ${JSON.stringify(valueKey)});
${indent(depth + 2)}if (${points}.length === 0) return <span className="loom-chart__empty">{${JSON.stringify(empty)}}</span>;
${maxLine}${indent(depth + 2)}return (
${indent(depth + 3)}<svg
${indent(depth + 4)}className="loom-chart__svg"
${indent(depth + 4)}viewBox={\`0 0 \${VIEW.width} \${VIEW.height}\`}
${indent(depth + 4)}preserveAspectRatio="none"
${indent(depth + 4)}role="img"
${indent(depth + 4)}aria-label={describe(${JSON.stringify(label)}, ${points})}
${indent(depth + 3)}>
${body(points, max, depth + 4)}
${indent(depth + 3)}</svg>
${indent(depth + 2)});
${indent(depth + 1)}})()}
${indent(depth)}</div>`;
}

/** The gridlines and the numbers beside them — the part that makes a chart readable. */
function axis(ctx: Parameters<ComponentEmitter['emit']>[1], max: string, at: number): string {
  ctx.requireChart(['ticks', 'yOf', 'format']);

  return `${indent(at)}{ticks(${max}).map((tick) => (
${indent(at + 1)}<g key={tick}>
${indent(at + 2)}<line
${indent(at + 3)}className="loom-chart__grid"
${indent(at + 3)}x1={VIEW.padLeft}
${indent(at + 3)}x2={VIEW.width - VIEW.padRight}
${indent(at + 3)}y1={yOf(tick, ${max})}
${indent(at + 3)}y2={yOf(tick, ${max})}
${indent(at + 2)}/>
${indent(at + 2)}<text className="loom-chart__tick" x={VIEW.padLeft - 6} y={yOf(tick, ${max}) + 4} textAnchor="end">
${indent(at + 3)}{format(tick)}
${indent(at + 2)}</text>
${indent(at + 1)}</g>
${indent(at)}))}`;
}

export const barChartEmitter: ComponentEmitter = {
  type: 'BarChart',
  emit(component, ctx, depth) {
    const horizontal = shape(component, 'vertical') === 'horizontal';
    ctx.requireChart(horizontal ? ['rows', 'format'] : ['bars']);

    return chartFrame(component, ctx, depth, (points, max, at) =>
      horizontal
        ? `${indent(at)}{rows(${points}, ${max}).map((bar, index) => (
${indent(at + 1)}<g key={index}>
${indent(at + 2)}<rect className="loom-chart__bar" x={bar.x} y={bar.y} width={bar.width} height={bar.height} />
${indent(at + 2)}<text className="loom-chart__tick" x={VIEW.padLeft - 6} y={bar.y + bar.height / 2 + 4} textAnchor="end">
${indent(at + 3)}{bar.point.label}
${indent(at + 2)}</text>
${indent(at + 1)}</g>
${indent(at)}))}`
        : `${axis(ctx, max, at)}
${indent(at)}{bars(${points}, ${max}).map((bar, index) => (
${indent(at + 1)}<g key={index}>
${indent(at + 2)}<rect className="loom-chart__bar" x={bar.x} y={bar.y} width={bar.width} height={bar.height} />
${indent(at + 2)}<text
${indent(at + 3)}className="loom-chart__label"
${indent(at + 3)}x={bar.x + bar.width / 2}
${indent(at + 3)}y={VIEW.height - 8}
${indent(at + 3)}textAnchor="middle"
${indent(at + 2)}>
${indent(at + 3)}{bar.point.label}
${indent(at + 2)}</text>
${indent(at + 1)}</g>
${indent(at)}))}`,
    );
  },
};

export const lineChartEmitter: ComponentEmitter = {
  type: 'LineChart',
  emit(component, ctx, depth) {
    const kind = shape(component, 'line');
    const smooth = kind === 'smooth' ? 'true' : 'false';
    const filled = kind === 'area';
    ctx.requireChart(['linePath', 'xOf', 'yOf']);
    if (filled) ctx.requireChart(['areaPath']);

    return chartFrame(component, ctx, depth, (points, max, at) => {
      const fill = filled
        ? `${indent(at)}<path className="loom-chart__area" d={areaPath(${points}, ${max}, ${smooth})} />\n`
        : '';

      return `${axis(ctx, max, at)}
${fill}${indent(at)}<path className="loom-chart__line" d={linePath(${points}, ${max}, ${smooth})} />
${indent(at)}{${points}.map((point, index) => (
${indent(at + 1)}<g key={index}>
${indent(at + 2)}<circle className="loom-chart__dot" cx={xOf(index, ${points}.length)} cy={yOf(point.value, ${max})} r={3} />
${indent(at + 2)}<text
${indent(at + 3)}className="loom-chart__label"
${indent(at + 3)}x={xOf(index, ${points}.length)}
${indent(at + 3)}y={VIEW.height - 8}
${indent(at + 3)}textAnchor="middle"
${indent(at + 2)}>
${indent(at + 3)}{point.label}
${indent(at + 2)}</text>
${indent(at + 1)}</g>
${indent(at)}))}`;
    });
  },
};

export const pieChartEmitter: ComponentEmitter = {
  type: 'PieChart',
  emit(component, ctx, depth) {
    // A donut is a pie with a hole; nothing else about it differs, so it is a number rather than a
    // second code path.
    const hole = shape(component, 'pie') === 'donut' ? '0.58' : '0';
    ctx.requireChart(['slices']);

    return chartFrame(
      component,
      ctx,
      depth,
      (points, _max, at) => `${indent(at)}{slices(${points}, ${hole}).map((slice, index) => (
${indent(at + 1)}<path
${indent(at + 2)}key={index}
${indent(at + 2)}className="loom-chart__slice"
${indent(at + 2)}d={slice.d}
${indent(at + 2)}opacity={slice.opacity}
${indent(at + 1)}/>
${indent(at)}))}`,
      { needsMax: false },
    );
  },
};

/**
 * One number, large.
 *
 * Not a chart, and the thing people put at the top of every dashboard. It reads a *value* rather
 * than rows — the count a query already answered with, most of the time.
 */
export const statEmitter: ComponentEmitter = {
  type: 'Stat',
  emit(component, ctx, depth) {
    const value = component.props.value;
    const valueExpression = value ? valueExpr(value, ctx, component.id, 'value') : '0';
    const label = staticString(component, 'label', 'Total');
    const note = staticString(component, 'note');
    ctx.requireChart(['formatValue']);

    const noteLine = note
      ? `\n${indent(depth + 1)}<span className="loom-stat__note">{${JSON.stringify(note)}}</span>`
      : '';

    return `${indent(depth)}<div${classAttr(component)}${styleAttr(component, ctx, layoutSizeStyle(component.layout))}>
${indent(depth + 1)}<span className="loom-stat__label">{${JSON.stringify(label)}}</span>
${indent(depth + 1)}<span className="loom-stat__value">{formatValue(${valueExpression})}</span>${noteLine}
${indent(depth)}</div>`;
  },
};
