import type { Layout, SizeMode } from '@loom/ir';

/**
 * Flex-first layout emission (guardrail: never absolute positioning). The layout model is
 * spec #5; this is the v0 subset the snapshot schema already carries.
 */

const ALIGN: Record<Layout['align'], string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

const JUSTIFY: Record<Layout['justify'], string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
};

function sizeStyle(
  axis: 'width' | 'height',
  size: SizeMode,
  style: Record<string, string | number>,
): void {
  switch (size.mode) {
    case 'hug':
      // Hug = size to content: the flex default, plus no growing.
      style.flexGrow = 0;
      break;
    case 'fill':
      style.flexGrow = 1;
      style[axis] = '100%';
      break;
    case 'fixed':
      style[axis] = size.px;
      style.flexShrink = 0;
      break;
  }
}

/**
 * Just the size a component was drawn at, with none of the arrangement.
 *
 * A leaf has no children to arrange, so `layoutToStyle` would give it a `display: flex` it has no
 * use for — but it does have a size, and that size was going nowhere. A Text dragged out to 320
 * pixels on the canvas emitted a span that hugged its word, so the canvas and the running app
 * disagreed about the shape of the screen (`docs/12-canvas.md`).
 */
export function layoutSizeStyle(layout: Layout | undefined): Record<string, string | number> {
  if (!layout?.size) return {};
  const style: Record<string, string | number> = {};
  sizeStyle('width', layout.size.width, style);
  sizeStyle('height', layout.size.height, style);
  return style;
}

export function layoutToStyle(layout: Layout): Record<string, string | number> {
  // A free frame is a drawing board: it holds its children where they were put, so it is the
  // positioning context and nothing else about it is flex (`docs/12-canvas.md`).
  const style: Record<string, string | number> =
    layout.mode === 'free'
      ? { position: 'relative', padding: layout.padding }
      : {
          display: 'flex',
          flexDirection: layout.direction,
          gap: layout.gap,
          padding: layout.padding,
          alignItems: ALIGN[layout.align],
          justifyContent: JUSTIFY[layout.justify],
        };

  if (layout.size) {
    sizeStyle('width', layout.size.width, style);
    sizeStyle('height', layout.size.height, style);
  }

  return style;
}

/**
 * Where a component sits inside a **free** parent.
 *
 * Absolute, and only here: the child of a stacked frame has no coordinates at all, and a document
 * that carried them anyway would be describing two layouts at once.
 */
export function positionToStyle(
  component: { position?: { x: number; y: number } },
  parent: { layout?: Layout } | undefined,
): Record<string, string | number> {
  if (parent?.layout?.mode !== 'free') return {};
  const position = component.position ?? { x: 0, y: 0 };
  return { position: 'absolute', left: Math.round(position.x), top: Math.round(position.y) };
}
