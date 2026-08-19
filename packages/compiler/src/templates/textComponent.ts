import type { ComponentEmitter } from '../types';
import { indent, jsxText } from '../emit/text';
import { staticString } from '../emit/props';

/** Text = a leaf span carrying its `content` prop. */
export const textEmitter: ComponentEmitter = {
  type: 'Text',
  emit(component, _ctx, depth) {
    const content = staticString(component, 'content');
    return `${indent(depth)}<span>${jsxText(content)}</span>`;
  },
};
