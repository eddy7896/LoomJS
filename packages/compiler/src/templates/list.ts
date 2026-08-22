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
/** A static number prop, falling back when it is bound or nonsense. */
function staticNumber(
  component: Parameters<ComponentEmitter['emit']>[0],
  key: string,
  fallback: number,
): number {
  const value = component.props[key];
  if (value?.kind !== 'static') return fallback;
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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

    // Paging what was fetched, not what exists: a server-side page needs an offset the caller
    // supplies, and nothing on a screen can hand one over yet. For the hundreds of rows a `limit`
    // already caps, slicing here is the honest answer and costs no round trip.
    const pageSize = Math.trunc(Number(staticNumber(component, 'pageSize', 0)));
    if (pageSize <= 0) {
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
    }

    const page = ctx.requirePageState(component.id);
    const rows = `rows_${page}`;
    const pages = `pages_${page}`;

    return `${indent(depth)}<div${attrs}>
${indent(depth + 1)}{(() => {
${indent(depth + 2)}const ${rows} = ${itemsExpr};
${indent(depth + 2)}const ${pages} = Math.max(1, Math.ceil(${rows}.length / ${pageSize}));
${indent(depth + 2)}// Deleting the last row of the last page must not strand you on an empty one.
${indent(depth + 2)}const current = Math.min(${page}, ${pages} - 1);
${indent(depth + 2)}return ${rows}.length === 0 ? (
${indent(depth + 3)}<span>{${JSON.stringify(empty)}}</span>
${indent(depth + 2)}) : (
${indent(depth + 3)}<>
${indent(depth + 4)}{${rows}.slice(current * ${pageSize}, current * ${pageSize} + ${pageSize}).map((${itemVar}: Record<string, unknown>, index: number) => (
${indent(depth + 5)}<div key={index}>
${template}
${indent(depth + 5)}</div>
${indent(depth + 4)}))}
${indent(depth + 4)}{${pages} > 1 ? (
${indent(depth + 5)}<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
${indent(depth + 6)}<button type="button" disabled={current === 0} onClick={() => set_${page}(current - 1)}>
${indent(depth + 7)}Previous
${indent(depth + 6)}</button>
${indent(depth + 6)}<span>{\`\${current + 1} / \${${pages}}\`}</span>
${indent(depth + 6)}<button type="button" disabled={current >= ${pages} - 1} onClick={() => set_${page}(current + 1)}>
${indent(depth + 7)}Next
${indent(depth + 6)}</button>
${indent(depth + 5)}</div>
${indent(depth + 4)}) : null}
${indent(depth + 3)}</>
${indent(depth + 2)});
${indent(depth + 1)})()}
${indent(depth)}</div>`;
  },
};
