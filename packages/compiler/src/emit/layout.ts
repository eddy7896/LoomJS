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

export function layoutToStyle(layout: Layout): Record<string, string | number> {
  const style: Record<string, string | number> = {
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
