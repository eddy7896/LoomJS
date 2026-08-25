import { type ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { classAttr } from '../emit/variants';
import { styleAttr } from '../emit/style';
import { staticNumber, staticString, valueExpr } from '../emit/props';

/**
 * The page control (Q2, `docs/V1-COMPLETION.md`).
 *
 * It emits three things and no machinery: a Previous, a "page N of M", and a Next. The page number
 * is ordinary component state, so wiring it into a read makes that read re-run exactly the way any
 * other input to a reactive pipeline does.
 *
 * **What it does not do is fetch.** It changes a number; the pipeline that was already watching
 * that number does the rest. A page control that issued its own request would be a second way to
 * run a query, and the first way already handles the loading state, the error and the
 * invalidation.
 */
export const pagerEmitter: ComponentEmitter = {
  type: 'Pager',
  emit(component, ctx, depth) {
    const page = ctx.requireFieldState(component.id, staticNumber(component, 'value', 0));

    const size = Math.max(1, Math.trunc(staticNumber(component, 'pageSize', 100)));
    const previous = staticString(component, 'previousLabel', 'Previous');
    const next = staticString(component, 'nextLabel', 'Next');

    /**
     * How many rows there are altogether.
     *
     * Unbound it is zero, so there is one page and Next is off. That is the honest answer:
     * nothing has said there are more rows, and letting someone page forward into rows that may
     * not exist trades a control that looks stuck for one that lies.
     *
     * It is not left silent — a Pager with no total raises a Problem naming what to wire into it
     * (`diagnostics.ts`), which is where "why is this disabled" gets answered.
     */
    const total = component.props.total;
    const totalExpr = total ? valueExpr(total, ctx, component.id, 'total') : '0';

    const pages = `pages_${page}`;

    return `${indent(depth)}<div${classAttr(component)}${styleAttr(component, ctx)}>
${indent(depth + 1)}{(() => {
${indent(depth + 2)}const ${pages} = Math.max(1, Math.ceil(Number(${totalExpr}) / ${size}));
${indent(depth + 2)}return (
${indent(depth + 3)}<>
${indent(depth + 4)}<button
${indent(depth + 5)}type="button"
${indent(depth + 5)}className="loom-pager__step"
${indent(depth + 5)}disabled={${page} <= 0}
${indent(depth + 5)}onClick={() => set_${page}(Math.max(0, ${page} - 1))}
${indent(depth + 4)}>
${indent(depth + 5)}{${JSON.stringify(previous)}}
${indent(depth + 4)}</button>
${indent(depth + 4)}<span className="loom-pager__where">{\`\${${page} + 1} / \${${pages}}\`}</span>
${indent(depth + 4)}<button
${indent(depth + 5)}type="button"
${indent(depth + 5)}className="loom-pager__step"
${indent(depth + 5)}disabled={${page} >= ${pages} - 1}
${indent(depth + 5)}onClick={() => set_${page}(${page} + 1)}
${indent(depth + 4)}>
${indent(depth + 5)}{${JSON.stringify(next)}}
${indent(depth + 4)}</button>
${indent(depth + 3)}</>
${indent(depth + 2)});
${indent(depth + 1)}})()}
${indent(depth)}</div>`;
  },
};
