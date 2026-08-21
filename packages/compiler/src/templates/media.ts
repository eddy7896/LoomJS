import { actionsOf } from '@loom/ir';
import { iconPath } from '@loom/components';
import type { ComponentEmitter } from '../types';
import { CompileError } from '../types';
import { indent } from '../emit/text';
import { staticString, valueExpr } from '../emit/props';
import { styleAttr } from '../emit/style';

/**
 * The visual elements beyond Text and Button: a picture, a link, and a glyph.
 *
 * Each is the plain HTML a developer would have written. The interesting decisions are the
 * accessibility ones, and they are enforced rather than encouraged — a builder whose output is
 * inaccessible by default has chosen that for everyone using it.
 */

export const imageEmitter: ComponentEmitter = {
  type: 'Image',
  emit(component, ctx, depth) {
    const src = component.props.src;
    const srcExpr = src ? valueExpr(src, ctx, component.id, 'src') : '""';
    const alt = staticString(component, 'alt');

    // Empty alt is a *decision* — it tells a screen reader the image carries no meaning — but it
    // has to be written out, so `alt` is always present in the output.
    return `${indent(depth)}<img${styleAttr(component, ctx)}
${indent(depth + 1)}src={${srcExpr}}
${indent(depth + 1)}alt={${JSON.stringify(alt)}}
${indent(depth)}/>`;
  },
};

export const linkEmitter: ComponentEmitter = {
  type: 'Link',
  emit(component, ctx, depth) {
    const label = component.props.label;
    const labelExpr = label ? valueExpr(label, ctx, component.id, 'label') : '""';
    const attrs = styleAttr(component, ctx);

    // A Link pointing at a screen is the router's job: a full page load would throw away the
    // app's state to reach a route it already has.
    const onClick = component.props.onClick;
    const navigate =
      onClick?.kind === 'event'
        ? actionsOf(onClick.handler).find((action) => action.kind === 'navigate')
        : undefined;

    if (navigate?.kind === 'navigate') {
      const Link = ctx.requireLink();
      return `${indent(depth)}<${Link}${attrs} to={${ctx.pathExpr(navigate.flowId, component.id)}}>{${labelExpr}}</${Link}>`;
    }

    const href = component.props.href;
    const hrefExpr = href ? valueExpr(href, ctx, component.id, 'href') : '""';
    if (!href || (href.kind === 'static' && !String(href.value ?? '').trim())) {
      throw new CompileError(
        `"${component.name ?? 'Link'}" has nowhere to go. Give it an address, or add a ` +
          `"Go to screen" step.`,
        component.id,
      );
    }

    const newTab = component.props.newTab?.kind === 'static' && component.props.newTab.value === true;
    // `noopener,noreferrer` always: without it the opened page can reach back through
    // `window.opener` and navigate the app somewhere else.
    const target = newTab ? ` target="_blank" rel="noopener noreferrer"` : '';

    return `${indent(depth)}<a${attrs} href={${hrefExpr}}${target}>{${labelExpr}}</a>`;
  },
};

export const iconEmitter: ComponentEmitter = {
  type: 'Icon',
  emit(component, ctx, depth) {
    const name = staticString(component, 'name', 'check');
    const raw = component.props.size;
    const size = raw?.kind === 'static' ? Number(raw.value ?? 20) : 20;
    const px = Number.isFinite(size) && size > 0 ? size : 20;

    // `aria-hidden`: an icon beside a label reads the label twice otherwise, and an icon *without*
    // a label is a button that needs its own name — which is the Button's problem, not this one.
    return `${indent(depth)}<svg${styleAttr(component, ctx)}
${indent(depth + 1)}viewBox="0 0 24 24"
${indent(depth + 1)}width={${px}}
${indent(depth + 1)}height={${px}}
${indent(depth + 1)}fill="none"
${indent(depth + 1)}stroke="currentColor"
${indent(depth + 1)}strokeWidth={1.6}
${indent(depth + 1)}strokeLinecap="round"
${indent(depth + 1)}strokeLinejoin="round"
${indent(depth + 1)}aria-hidden="true"
${indent(depth)}>
${indent(depth + 1)}<path d={${JSON.stringify(iconPath(name))}} />
${indent(depth)}</svg>`;
  },
};
