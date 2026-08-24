import type { Component, Layout, Snapshot, Style } from '@loom/ir';
import { layoutToStyle } from './layout';
import { styleToCss } from './style';

/**
 * Responsive overrides (`docs/V1-COMPLETION.md` L3), compiled.
 *
 * ## Why this is a stylesheet and not an inline style
 *
 * Everything else a component is styled with emits as `style={{…}}`, which is the right default:
 * it is local, it is readable in the output, and it needs no machinery. A media query cannot live
 * there. An inline style has no viewport to ask about, so `@media` has nowhere to attach.
 *
 * The alternative would be a `useMediaQuery` hook and a re-render on resize, and it is the wrong
 * trade twice over: it puts a runtime behind a layout decision, and it renders the desktop layout
 * first and corrects it, which is a visible flash on the device that can least afford one. CSS has
 * answered this since 2012 and the emitted repo should look like a developer wrote it.
 *
 * So each component with an override gets one class, one rule, inside one media query, in a file
 * the project owns and can read.
 *
 * ## Two breakpoints, and the second one is the base
 *
 * `sm` is the only override. The flex-first default already carries most of the range on its own,
 * and every builder that offered five breakpoints taught its users to maintain five layouts. This
 * is for the case flex genuinely cannot answer: a row that has to become a column.
 */

/** Where a phone stops and everything else begins. */
export const SM_MAX_WIDTH = 640;

/** The class a component carries when it changes at `sm`. Stable, so the canvas can use it too. */
export function responsiveClassName(componentId: string): string {
  return `loom-sm-${componentId}`;
}

/** The overrides a component declares, if it declares any. */
export function responsiveOf(
  component: Component,
): { style?: Style; layout?: Partial<Layout> } | undefined {
  const style = component.style?.responsive?.sm;
  const layout = component.layout?.responsive?.sm;
  if (!style && !layout) return undefined;
  return { style, layout };
}

export function hasResponsive(component: Component): boolean {
  return responsiveOf(component) !== undefined;
}

/**
 * The CSS an override becomes.
 *
 * Layout first and style second, the same order `componentStyle` uses, so a collision resolves the
 * way it does everywhere else and a designer does not have to hold two rules in their head.
 */
function declarationsFor(component: Component): Record<string, string | number> {
  const overrides = responsiveOf(component);
  if (!overrides) return {};

  const layout = overrides.layout
    ? layoutToStyle({ ...(component.layout ?? {}), ...overrides.layout } as Layout)
    : {};

  // `styleToCss` reads a whole component, so it is handed one wearing the override's style. The
  // conditional styles are dropped: those are decided at run time by a condition, and merging a
  // media query into that would make two mechanisms decide one property.
  const style = overrides.style
    ? styleToCss({ ...component, style: overrides.style, conditionalStyles: undefined })
    : {};

  return { ...layout, ...style };
}

/** `backgroundColor` -> `background-color`. The output is CSS, so it reads as CSS. */
function kebab(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function ruleFor(component: Component): string | undefined {
  const declarations = declarationsFor(component);
  const entries = Object.entries(declarations);
  if (entries.length === 0) return undefined;

  const body = entries
    .map(([property, value]) => {
      // A bare number is px everywhere React would have treated it as px, which is every property
      // in the vocabulary that takes a length.
      const printed = typeof value === 'number' && value !== 0 ? `${value}px` : String(value);
      // `!important` because the base is an inline style, and an inline style beats a stylesheet.
      // This is the one place the emitted CSS is not what a developer would have hand-written, and
      // the alternative is moving every style in the project into a stylesheet to win a specificity
      // argument that only matters here.
      return `  ${kebab(property)}: ${printed} !important;`;
    })
    .join('\n');

  return `.${responsiveClassName(component.id)} {\n${body}\n}`;
}

/**
 * The whole `src/responsive.css` for a project, or nothing at all.
 *
 * Demand-driven like everything else: a project where no one has touched a phone layout gets no
 * file, no import, and no bytes.
 */
export function responsiveCss(snapshot: Snapshot): string | undefined {
  const rules = Object.values(snapshot.components)
    .map(ruleFor)
    .filter((rule): rule is string => rule !== undefined);

  if (rules.length === 0) return undefined;

  return `/* Phone layouts (docs/V1-COMPLETION.md L3). One breakpoint, by design. */
@media (max-width: ${SM_MAX_WIDTH}px) {
${rules
  .map((rule) =>
    rule
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
  )
  .join('\n\n')}
}
`;
}

/**
 * The component as it renders at a given width.
 *
 * The emitted app does not need this — it gets a media query, and the browser decides. The
 * **canvas** does: an artboard has a width of its own, and a media query keyed to the browser
 * window would have nothing to do with the phone-sized screen a designer is looking at.
 *
 * So the two surfaces reach the same answer by different routes, and this is the shared half:
 * both merge the same overrides in the same order, and only the trigger differs. That is the most
 * honest version available — a media query is viewport-keyed by construction, and pretending the
 * canvas could use the same bytes would mean an artboard that ignored its own size.
 */
export function resolveResponsive(component: Component, width: number): Component {
  if (width > SM_MAX_WIDTH) return component;

  const overrides = responsiveOf(component);
  if (!overrides) return component;

  return {
    ...component,
    style: overrides.style ? { ...component.style, ...overrides.style } : component.style,
    layout: overrides.layout
      ? ({ ...component.layout, ...overrides.layout } as Layout)
      : component.layout,
  };
}
