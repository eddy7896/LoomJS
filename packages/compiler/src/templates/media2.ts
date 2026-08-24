import type { Component, PropertyValue } from '@loom/ir';
import { CompileError, type ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { staticString, valueExpr } from '../emit/props';
import { styleAttr } from '../emit/style';
import { layoutToStyle } from '../emit/layout';
import { classAttr } from '../emit/variants';

/**
 * Media: video, audio, carousel, tiles, avatar, embed (`docs/28-media.md`).
 *
 * Each is the **browser's own element**. A `<video>` is a video player: shipping a player library
 * to do what the browser already does would cost a megabyte, take away the native controls people
 * know, and be worse on a phone than what it replaced.
 */

/** A boolean prop's static value. A bound one falls back — an attribute is not a subscription. */
function flag(component: Component, key: string, fallback = false): boolean {
  const value = component.props[key];
  if (value?.kind !== 'static') return fallback;
  return value.value === true || value.value === 'true';
}

function staticNumber(component: Component, key: string, fallback: number): number {
  const value = component.props[key];
  if (value?.kind !== 'static') return fallback;
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The box the element was drawn at.
 *
 * A leaf's size normally goes nowhere: most of the vocabulary hugs its content, so the emitters
 * pass only the style block. Media is the exception — a video, an embed and a carousel have no
 * content to hug, and one without a size collapses to nothing and takes its controls with it.
 */
function box(component: Component): Record<string, string | number> {
  return component.layout ? layoutToStyle(component.layout) : {};
}

/** A prop as an expression, so a bound address works the same as a typed one. */
function expr(component: Component, ctx: Parameters<ComponentEmitter['emit']>[1], key: string): string {
  const value: PropertyValue | undefined = component.props[key];
  return value ? valueExpr(value, ctx, component.id, key) : '""';
}

export const videoEmitter: ComponentEmitter = {
  type: 'Video',
  emit(component, ctx, depth) {
    const controls = flag(component, 'controls', true);
    const autoplay = flag(component, 'autoplay');
    const loop = flag(component, 'loop');
    // Autoplay *sets* muted rather than trusting the designer to also tick it. Every browser blocks
    // sound that starts by itself, so the combination they expect is one that silently refuses to
    // play — and a video that does not start looks like a broken element, not a policy.
    const muted = flag(component, 'muted') || autoplay;
    const poster = staticString(component, 'poster');

    const attributes = [
      controls ? 'controls' : '',
      autoplay ? 'autoPlay' : '',
      loop ? 'loop' : '',
      muted ? 'muted' : '',
      // Without this, iOS takes any playing video fullscreen — which is not what a video inside a
      // page layout is for.
      'playsInline',
    ].filter(Boolean);

    const posterAttr = poster ? `\n${indent(depth + 1)}poster={${JSON.stringify(poster)}}` : '';

    return `${indent(depth)}<video${classAttr(component)}${styleAttr(component, ctx, box(component))}
${indent(depth + 1)}src={${expr(component, ctx, 'src')}}${posterAttr}
${attributes.map((name) => `${indent(depth + 1)}${name}`).join('\n')}
${indent(depth)}/>`;
  },
};

export const audioEmitter: ComponentEmitter = {
  type: 'Audio',
  emit(component, ctx, depth) {
    const attributes = [flag(component, 'controls', true) ? 'controls' : '', flag(component, 'loop') ? 'loop' : '']
      .filter(Boolean)
      .map((name) => `${indent(depth + 1)}${name}`)
      .join('\n');

    return `${indent(depth)}<audio${classAttr(component)}${styleAttr(component, ctx, box(component))}
${indent(depth + 1)}src={${expr(component, ctx, 'src')}}
${attributes}
${indent(depth)}/>`;
  },
};

/**
 * A carousel: one picture at a time, with previous, next and dots.
 *
 * The index is real state in the emitted component — the same `useState` a List's paging declares.
 * A CSS-only carousel is a carousel that cannot be driven from a keyboard and cannot say which
 * slide it is on, and a library would be a dependency for twenty lines of arithmetic.
 */
export const carouselEmitter: ComponentEmitter = {
  type: 'Carousel',
  emit(component, ctx, depth) {
    const index = ctx.requirePageState(component.id);
    const slides = `slides_${index}`;
    const at = `at_${index}`;

    const items = component.props.items;
    const field = staticString(component, 'field');
    const alt = staticString(component, 'alt');
    const dots = flag(component, 'dots', true);
    const seconds = staticNumber(component, 'interval', 0);

    /**
     * Where the pictures come from.
     *
     * Typed in, they are a comma-separated list of addresses. Bound, they are rows — and `field`
     * names the column holding the address, or the row *is* the address when it is blank, which is
     * what a list of plain strings looks like.
     */
    const source =
      items && items.kind !== 'static'
        ? `((${valueExpr(items, ctx, component.id, 'items')}) as unknown[]).map((row) => ${
            field
              ? `String((row as Record<string, unknown>)[${JSON.stringify(field)}] ?? "")`
              : 'String(row ?? "")'
          }).filter(Boolean)`
        : JSON.stringify(
            staticString(component, 'items')
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean),
          );

    /**
     * Auto-advance, when it is asked for.
     *
     * The timer only ever counts *up*, and the render takes the index modulo however many pictures
     * there are. That is what lets the effect exist without knowing the count — it closes over
     * nothing but its own setter, so it never goes stale and never has to be torn down and rebuilt
     * when the pictures change. It is cleared on unmount, which is the half that leaks if forgotten.
     */
    if (seconds > 0) {
      const ms = Math.max(1000, Math.round(seconds * 1000));
      ctx.requireEffect(`  useEffect(() => {
    const timer = setInterval(() => set_${index}((current: number) => current + 1), ${ms});
    return () => clearInterval(timer);
  }, []);`);
    }

    const dotsMarkup = dots
      ? `
${indent(depth + 4)}<div className="loom-carousel__dots">
${indent(depth + 5)}{${slides}.map((_slide: string, dot: number) => (
${indent(depth + 6)}<button
${indent(depth + 7)}key={dot}
${indent(depth + 7)}type="button"
${indent(depth + 7)}className={dot === ${at} ? "loom-carousel__dot is-on" : "loom-carousel__dot"}
${indent(depth + 7)}aria-label={\`Slide \${dot + 1}\`}
${indent(depth + 7)}aria-current={dot === ${at}}
${indent(depth + 7)}onClick={() => set_${index}(dot)}
${indent(depth + 6)}/>
${indent(depth + 5)}))}
${indent(depth + 4)}</div>`
      : '';

    return `${indent(depth)}<div${classAttr(component)}${styleAttr(component, ctx, box(component))}>
${indent(depth + 1)}{(() => {
${indent(depth + 2)}const ${slides}: string[] = ${source};
${indent(depth + 2)}if (${slides}.length === 0) return null;
${indent(depth + 2)}// Modulo rather than a clamp: the timer counts up forever, and removing pictures
${indent(depth + 2)}// must not strand the carousel past the end of what is left.
${indent(depth + 2)}const ${at} = ((${index} % ${slides}.length) + ${slides}.length) % ${slides}.length;
${indent(depth + 2)}return (
${indent(depth + 3)}<>
${indent(depth + 4)}<img className="loom-carousel__slide" src={${slides}[${at}]} alt={${JSON.stringify(alt)}} />
${indent(depth + 4)}{${slides}.length > 1 ? (
${indent(depth + 5)}<>
${indent(depth + 6)}<button
${indent(depth + 7)}type="button"
${indent(depth + 7)}className="loom-carousel__step loom-carousel__step--back"
${indent(depth + 7)}aria-label="Previous"
${indent(depth + 7)}onClick={() => set_${index}(${at} + ${slides}.length - 1)}
${indent(depth + 6)}>
${indent(depth + 7)}{"\u2039"}
${indent(depth + 6)}</button>
${indent(depth + 6)}<button
${indent(depth + 7)}type="button"
${indent(depth + 7)}className="loom-carousel__step loom-carousel__step--next"
${indent(depth + 7)}aria-label="Next"
${indent(depth + 7)}onClick={() => set_${index}(${at} + 1)}
${indent(depth + 6)}>
${indent(depth + 7)}{"\u203a"}
${indent(depth + 6)}</button>
${indent(depth + 5)}</>
${indent(depth + 4)}) : null}${dotsMarkup}
${indent(depth + 3)}</>
${indent(depth + 2)});
${indent(depth + 1)}})()}
${indent(depth)}</div>`;
  },
};

/**
 * Tiles: a grid that wraps by width rather than by count.
 *
 * `repeat(auto-fill, minmax(<min>px, 1fr))` is the whole element. The browser works out how many
 * columns fit, so one gallery is right on a phone and on a desktop — which is the one arrangement
 * the row/column layout genuinely cannot express, and therefore the one that earns an element.
 */
export const tilesEmitter: ComponentEmitter = {
  type: 'Tiles',
  emit(component, ctx, depth) {
    const minWidth = Math.max(40, Math.trunc(staticNumber(component, 'minWidth', 160)));
    const gap = Math.max(0, Math.trunc(staticNumber(component, 'gap', 12)));

    const grid = {
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
      gap: `${gap}px`,
    };

    // The grid goes in as the base and the component's own style still spreads over it, so a
    // designer can override any of it — variants are the floor, never the ceiling.
    // The grid over the drawn box, and the component's own style over both.
    const attrs = styleAttr(component, ctx, { ...box(component), ...grid });
    const children = component.children ?? [];

    if (children.length === 0) return `${indent(depth)}<div${classAttr(component)}${attrs} />`;

    const body = children.map((id) => ctx.renderChild(id, depth + 1)).join('\n');
    return `${indent(depth)}<div${classAttr(component)}${attrs}>\n${body}\n${indent(depth)}</div>`;
  },
};

export const avatarEmitter: ComponentEmitter = {
  type: 'Avatar',
  emit(component, ctx, depth) {
    const size = Math.max(16, Math.trunc(staticNumber(component, 'size', 40)));
    const src = component.props.src;
    const hasSrc = Boolean(src) && !(src?.kind === 'static' && !String(src.value ?? '').trim());

    const nameExpr = expr(component, ctx, 'name');
    const circle = { width: size, height: size, fontSize: Math.round(size * 0.4) };

    // The initials are worked out in the emitted app rather than here, because the name is often
    // bound to a row: computing it at build time would freeze whatever the designer typed.
    // `?? ""` only where the value can actually be missing: a bound name can arrive undefined, and
    // `String(undefined)` would put a "U" in the circle. On a typed-in name the operand is a string
    // literal, and the emitted app's own tsc rejects a `??` whose left side is never nullish.
    const nameSafe = component.props.name?.kind === 'static' ? nameExpr : `(${nameExpr} ?? "")`;
    const initials = `String(${nameSafe}).trim().split(/\\s+/).filter(Boolean).slice(0, 2).map((part: string) => part[0] ?? "").join("").toUpperCase()`;

    if (!hasSrc) {
      return `${indent(depth)}<span${classAttr(component)}${styleAttr(component, ctx, circle)} aria-label={${nameExpr}}>
${indent(depth + 1)}{${initials}}
${indent(depth)}</span>`;
    }

    /**
     * A picture *or* the initials, decided when it renders.
     *
     * An avatar bound to rows of people will sometimes have no picture, and a broken-image icon in
     * a list of names reads as a bug in the app rather than a gap in the data.
     */
    return `${indent(depth)}<span${classAttr(component)}${styleAttr(component, ctx, circle)}>
${indent(depth + 1)}{${expr(component, ctx, 'src')} ? (
${indent(depth + 2)}<img className="loom-avatar__image" src={${expr(component, ctx, 'src')}} alt={${nameExpr}} />
${indent(depth + 1)}) : (
${indent(depth + 2)}<span aria-label={${nameExpr}}>{${initials}}</span>
${indent(depth + 1)})}
${indent(depth)}</span>`;
  },
};

export const embedEmitter: ComponentEmitter = {
  type: 'Embed',
  emit(component, ctx, depth) {
    const title = staticString(component, 'title');
    if (!title.trim()) {
      throw new CompileError(
        `"${component.name ?? 'Embed'}" has no title. A frame with no title is announced to a ` +
          `screen reader as "frame", which says nothing about what is inside it.`,
        component.id,
      );
    }

    const src = component.props.src;
    if (!src || (src.kind === 'static' && !String(src.value ?? '').trim())) {
      throw new CompileError(
        `"${component.name ?? 'Embed'}" has nothing to show. Give it an address.`,
        component.id,
      );
    }

    /**
     * An Embed puts someone else's page inside yours (`docs/28-media.md`).
     *
     * `referrerPolicy="no-referrer"` so the embedded host is not told which page of the app the
     * person is on, and `loading="lazy"` so an embed below the fold costs nothing until it is
     * reached. No `sandbox`: the embeds people actually use need scripts and their own origin, and
     * a sandbox that has to be opened back up is a sandbox in name only.
     */
    const fullscreen = flag(component, 'allowFullscreen', true) ? `\n${indent(depth + 1)}allowFullScreen` : '';

    return `${indent(depth)}<iframe${classAttr(component)}${styleAttr(component, ctx, box(component))}
${indent(depth + 1)}src={${expr(component, ctx, 'src')}}
${indent(depth + 1)}title={${JSON.stringify(title)}}
${indent(depth + 1)}loading="lazy"
${indent(depth + 1)}referrerPolicy="no-referrer"${fullscreen}
${indent(depth)}/>`;
  },
};
