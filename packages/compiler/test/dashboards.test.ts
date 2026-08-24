import { describe, expect, it } from 'vitest';
import { createComponent } from '@loom/components';
import type { Component, Snapshot } from '@loom/ir';
import { compile } from '../src';
import { supabaseSnapshot, trivialSnapshot } from './fixtures';

/**
 * Charts, calendar and chat (`docs/30-charts.md`, `docs/31-calendar-chat.md`).
 *
 * All three are the same idea — rows in a shape — so most of what is checked is that the shape is
 * *drawn*, and drawn by the project rather than by something it had to install.
 */

function withElement(
  type: string,
  props: Record<string, unknown> = {},
  base: Snapshot = trivialSnapshot(),
): { file: (path: string) => string; paths: string[] } {
  const root = base.components.cp_root000001!;
  const component: Component = createComponent(type, `cp_${type.toLowerCase()}`);
  for (const [key, value] of Object.entries(props)) {
    component.props[key] = { kind: 'static', value: value as string };
  }

  const result = compile({
    ...base,
    components: {
      ...base.components,
      cp_root000001: { ...root, children: [...(root.children ?? []), component.id] },
      [component.id]: component,
    },
  });

  return {
    file: (path: string) => result.files.find((entry) => entry.path === path)?.content ?? '',
    paths: result.files.map((entry) => entry.path),
  };
}

describe('charts are drawn, not installed', () => {
  it('emit inline SVG and no charting dependency', () => {
    const { file } = withElement('BarChart', { labels: 'month', values: 'sales' });
    const home = file('src/artboards/Home.tsx');

    expect(home).toContain('<svg');
    expect(home).toContain('loom-chart__bar');
    // The rule the icons follow: a dependency whose whole job is drawing shapes is one the emitted
    // app should not carry.
    const packageJson = file('package.json');
    for (const library of ['recharts', 'chart.js', 'd3', 'victory', 'apexcharts']) {
      expect(packageJson).not.toContain(library);
    }
  });

  it('share one copy of the arithmetic', () => {
    const { file, paths } = withElement('LineChart', { labels: 'day', values: 'total' });
    expect(paths).toContain('src/charts.ts');
    expect(file('src/artboards/Home.tsx')).toContain("from '../charts'");
  });

  it('import exactly what they use', () => {
    // The emitted app builds with `noUnusedLocals`, so an import list covering every chart would
    // fail the build of a project that has one.
    const bar = withElement('BarChart', {}).file('src/artboards/Home.tsx');
    expect(bar).toContain('bars');
    expect(bar).not.toContain('slices');

    const pie = withElement('PieChart', {}).file('src/artboards/Home.tsx');
    expect(pie).toContain('slices');
    expect(pie).not.toContain('linePath');
  });

  it('change shape with the variant, not only colour', () => {
    const vertical = withElement('BarChart', { variant: 'vertical' }).file('src/artboards/Home.tsx');
    const horizontal = withElement('BarChart', { variant: 'horizontal' }).file(
      'src/artboards/Home.tsx',
    );
    expect(vertical).toContain('bars(');
    expect(horizontal).toContain('rows(');

    const donut = withElement('PieChart', { variant: 'donut' }).file('src/artboards/Home.tsx');
    expect(donut).toContain('0.58');

    const area = withElement('LineChart', { variant: 'area' }).file('src/artboards/Home.tsx');
    expect(area).toContain('areaPath(');
  });

  it('say what they show, to a screen reader', () => {
    // A chart with no description says nothing at all to some of the people looking at the page.
    const home = withElement('BarChart', { label: 'Sales by month' }).file('src/artboards/Home.tsx');
    expect(home).toContain('role="img"');
    expect(home).toContain('aria-label={describe("Sales by month"');
  });

  it('say so when there is nothing to draw', () => {
    const home = withElement('LineChart', { empty: 'No sales yet' }).file('src/artboards/Home.tsx');
    expect(home).toContain('No sales yet');
  });

  it('are not carried by a project with no chart in it', () => {
    expect(compile(trivialSnapshot()).files.map((file) => file.path)).not.toContain('src/charts.ts');
  });
});

describe('the chart arithmetic', () => {
  const runtime = withElement('BarChart', {}).file('src/charts.ts');

  it('starts the axis at zero', () => {
    // A bar chart that starts at 40 makes a 3% difference look like a doubling. That is the oldest
    // way to lie with a chart, and it is not going to be the default.
    expect(runtime).toContain('Math.max(0, ...values)');
    expect(runtime).toContain('(Math.max(0, value) / max)');
  });

  it('rounds the top of the scale outwards to something readable', () => {
    expect(runtime).toContain('export function niceMax');
    expect(runtime).toMatch(/scaled <= 1 \? 1/);
  });

  it('treats a value that is not a number as zero rather than breaking', () => {
    // One bad row in a thousand should not blank a dashboard.
    expect(runtime).toContain('Number.isFinite(value) ? value : 0');
  });
});

describe('the calendar', () => {
  it('draws six weeks, always', () => {
    const { file, paths } = withElement('Calendar', { dates: 'due', titles: 'name' });
    expect(paths).toContain('src/calendar.ts');
    // A calendar that changes height between March and April makes everything under it jump.
    expect(file('src/calendar.ts')).toContain('length: 42');
  });

  it('reads dates in local time', () => {
    const runtime = withElement('Calendar', {}).file('src/calendar.ts');
    // `new Date("2026-03-04")` is UTC midnight, which is the previous day for anyone west of
    // Greenwich — a row landing on the wrong day is worse than a row not showing.
    expect(runtime).toContain('/^\\d{4}-\\d{2}-\\d{2}$/');
    // The call, not the word: the comment above `dayKey` names it to say why it is not used.
    expect(runtime).not.toContain('toISOString()');
  });

  it('skips a date it cannot read rather than guessing', () => {
    expect(withElement('Calendar', {}).file('src/calendar.ts')).toContain(
      'if (Number.isNaN(date.getTime())) continue;',
    );
  });

  it('has a month that moves, as real state', () => {
    const home = withElement('Calendar', {}).file('src/artboards/Home.tsx');
    expect(home).toContain('useState(0)');
    expect(home).toContain('aria-label="Previous month"');
    expect(home).toContain('aria-label="Next month"');
  });

  it('offers the same events as a list', () => {
    const agenda = withElement('Calendar', { variant: 'agenda' }).file('src/artboards/Home.tsx');
    expect(agenda).toContain('loom-calendar__agenda');
    expect(agenda).not.toContain('loom-calendar__grid');
  });

  it('starts the week where the project says', () => {
    const monday = withElement('Calendar', { weekStart: 'monday' }).file('src/artboards/Home.tsx');
    const sunday = withElement('Calendar', { weekStart: 'sunday' }).file('src/artboards/Home.tsx');
    expect(monday).toContain('WEEKDAYS_MONDAY');
    expect(sunday).toContain('WEEKDAYS_SUNDAY');
  });
});

describe('chat', () => {
  it('is rows in a shape, over whatever connector the project has', () => {
    const home = withElement('Chat', { texts: 'body', authors: 'sender' }).file(
      'src/artboards/Home.tsx',
    );
    expect(home).toContain('loom-chat__log');
    expect(home).toContain('loom-chat__compose');
    // No chat server, no socket library: the messages are rows from a query.
    expect(home).not.toContain('socket.io');
  });

  it('announces new messages without stealing focus', () => {
    const home = withElement('Chat', {}).file('src/artboards/Home.tsx');
    expect(home).toContain('role="log"');
    expect(home).toContain('aria-live="polite"');
  });

  it('holds its draft in ordinary field state, so a save step can read it', () => {
    const home = withElement('Chat', {}).file('src/artboards/Home.tsx');
    expect(home).toContain('const [field_cp_chat, set_field_cp_chat] = useState("")');
  });

  it('does not poll unless it was asked to', () => {
    expect(withElement('Chat', {}).file('src/artboards/Home.tsx')).not.toContain('setInterval');
  });

  it('polls the query that feeds it, and clears the timer', () => {
    // Not a websocket, and the element says so: the app's data goes through server routes so the
    // credentials stay on the server, and a subscription from the browser needs a key in the
    // browser (`docs/31-calendar-chat.md`).
    const base = supabaseSnapshot();
    const root = base.components.cp_root000001!;
    const chat: Component = {
      id: 'cp_chat',
      type: 'Chat',
      name: 'Messages',
      props: {
        items: { kind: 'bound', source: { nodeId: 'nd_read', portId: 'pt_result' } },
        texts: { kind: 'static', value: 'title' },
        refresh: { kind: 'static', value: 5 },
      },
    };

    const code = compile({
      ...base,
      components: {
        ...base.components,
        cp_root000001: { ...root, children: [...(root.children ?? []), chat.id] },
        [chat.id]: chat,
      },
    }).files.find((file) => file.path.startsWith('src/artboards/'))!.content;

    expect(code).toContain('setInterval');
    expect(code).toContain('5000');
    // A timer that outlives the screen keeps setting state on something that is gone.
    expect(code).toContain('return () => clearInterval(timer);');
  });

  it('does not claim to know who you are when nobody signs in', () => {
    // Without sign-in every message is somebody else's, which is honest for a public feed and
    // better than asking for a session that does not exist.
    const home = withElement('Chat', { authors: 'sender' }).file('src/artboards/Home.tsx');
    expect(home).not.toContain('useAuth');
    expect(home).toContain('"loom-chat__message"');
  });
});
