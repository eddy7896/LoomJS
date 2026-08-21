import type { ComponentEmitter } from '../types';
import { layoutToStyle } from '../emit/layout';
import { styleAttr } from '../emit/style';
import { indent } from '../emit/text';
import { staticString, valueExpr } from '../emit/props';

/**
 * List = the implicit map. It renders its **first child** once per row of the data bound to
 * `items`; there is no loop node and never will be (`04-hallucination-check.md`). Inside the
 * template, a property with the `item` kind reads a field of the current row.
 */
export const listEmitter: ComponentEmitter = {
  type: 'List',
  emit(component, ctx, depth) {
    const items = component.props.items;
    const itemsExpr = items ? valueExpr(items, ctx, component.id, 'items') : '[]';

    const attrs = styleAttr(component, ctx, component.layout ? layoutToStyle(component.layout) : { display: 'flex' });
    const itemVar = `item_${component.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const empty = staticString(component, 'empty');

    // The row template is emitted once, with `item` in scope — the same subtree the designer
    // arranged on the artboard, not a special "template" concept.
    // A List with no child yet is a List the designer has not filled in — it renders its empty
    // state rather than refusing to build. Nothing is lost: there is no row template to emit.
    const templateId = (component.children ?? [])[0];
    if (!templateId) {
      return `${indent(depth)}<div${attrs}>
${indent(depth + 1)}<span>{${JSON.stringify(empty)}}</span>
${indent(depth)}</div>`;
    }

    const template = ctx.withItem(itemVar, () => ctx.renderChild(templateId, depth + 3));

    return `${indent(depth)}<div${attrs}>
${indent(depth + 1)}{(${itemsExpr}).length === 0 ? (
${indent(depth + 2)}<span>{${JSON.stringify(empty)}}</span>
${indent(depth + 1)}) : (
${indent(depth + 2)}(${itemsExpr}).map((${itemVar}: Record<string, unknown>, index: number) => (
${indent(depth + 3)}<div key={index}>
${template}
${indent(depth + 3)}</div>
${indent(depth + 2)}))
${indent(depth + 1)})}
${indent(depth)}</div>`;
  },
};
