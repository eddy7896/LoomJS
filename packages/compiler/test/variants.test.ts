import { describe, expect, it } from 'vitest';
import { componentsCss } from '@loom/ui';
import type { Snapshot } from '@loom/ir';
import { compile } from '../src';
import { trivialSnapshot } from './fixtures';
import {
  axisValue,
  classStem,
  componentDefs,
  createComponent,
  variantClassName,
  variantClasses,
} from '@loom/components';

/**
 * Variants (`docs/27-variants.md`).
 *
 * The rule these protect is the one that is easy to break silently: a class emitted with no rule
 * behind it renders as *nothing*, so an element keeps working and quietly stops looking like the
 * variant it says it is. Nobody notices until a designer does.
 */

/**
 * Picking an option has to *do* something.
 *
 * Two ways it can: a rule in the stylesheet, or different markup out of the emitter. Charts are the
 * second kind — `horizontal`, `smooth`, `area` and `donut` change the geometry that gets drawn, and
 * a CSS rule for them would be a rule with nothing to say.
 *
 * The class attribute is stripped before comparing, because otherwise every option would "differ"
 * by its own class name and the check would pass for options that change nothing at all.
 */
const CSS = componentsCss();

function markupFor(type: string, axis: string, option: string): string {
  const base = trivialSnapshot();
  const root = base.components.cp_root000001!;
  const component = createComponent(type, 'cp_variant');
  component.props[axis] = { kind: 'static', value: option };
  // Enough for the charts and the list-like elements to draw something rather than their empty
  // state, which would be the same whatever the variant is.
  if ('labels' in component.props) component.props.labels = { kind: 'static', value: 'name' };
  if ('values' in component.props) component.props.values = { kind: 'static', value: 'total' };
  if ('columns' in component.props) component.props.columns = { kind: 'static', value: 'name' };

  const code = compile({
    ...base,
    components: {
      ...base.components,
      cp_root000001: { ...root, children: [...(root.children ?? []), component.id] },
      [component.id]: component,
    },
  }).files.find((file) => file.path.startsWith('src/artboards/'))!.content;

  return code.replace(/className="[^"]*"/g, '');
}

describe('every variant an element offers is one something honours', () => {
  for (const def of componentDefs()) {
    for (const axis of def.variants ?? []) {
      for (const option of axis.options) {
        const stem = classStem(def.type);
        it(`${def.type}: ${axis.key}=${option}`, () => {
          expect(stem, `${def.type} offers variants but has no class stem`).toBeTruthy();

          // A rule in the stylesheet is the usual way.
          if (CSS.includes(`.${stem}--${option}`)) return;

          /**
           * The neutral option is allowed to add nothing.
           *
           * "Plain" that drew a border would not be plain, and the option that means "no card" works
           * by *not* being the one that draws the card. Same for an axis default: an element has to
           * look like something before anybody picks anything.
           */
          if (option === axis.default || option === 'plain') return;

          // Otherwise the emitter has to be honouring it, or picking it does nothing and the
          // control is a lie.
          expect(
            markupFor(def.type, axis.key, option),
            `.${stem}--${option} has no rule and changes no markup`,
          ).not.toBe(markupFor(def.type, axis.key, axis.default));
        });
      }
    }
  }
});

describe('variantClasses', () => {
  it('names the stem and every axis, in order', () => {
    const button = createComponent('Button', 'cp_1');
    expect(variantClasses(button)).toEqual([
      'loom-button',
      'loom-button--solid',
      'loom-button--md',
    ]);
  });

  it('writes the defaults into the document rather than leaving them implicit', () => {
    // A document that said nothing would silently follow loom the day loom changed its mind, and
    // a project's screens should not restyle themselves because the tool was upgraded.
    const button = createComponent('Button', 'cp_1');
    expect(button.props.variant).toEqual({ kind: 'static', value: 'solid' });
    expect(button.props.size).toEqual({ kind: 'static', value: 'md' });
  });

  it('falls back when an option is no longer offered', () => {
    const button = createComponent('Button', 'cp_1');
    const stale = { ...button, props: { ...button.props, variant: { kind: 'static' as const, value: 'neon' } } };
    // Rather than emitting `loom-button--neon`, which has no rule and renders as nothing at all.
    expect(variantClassName(stale)).toBe('loom-button loom-button--solid loom-button--md');
  });

  it('falls back when the choice is bound to data', () => {
    const button = createComponent('Button', 'cp_1');
    const bound = {
      ...button,
      props: { ...button.props, variant: { kind: 'binding' as const, from: 'nd_x', port: 'out' } },
    };
    // An axis is settled before the app runs. A shape that depends on run-time data is a
    // conditional style, which the document already has and which is the honest way to say it.
    expect(axisValue(bound, { key: 'variant', label: 'Style', options: ['solid'], default: 'solid' })).toBe(
      'solid',
    );
  });

  it('says nothing about a type with no variants', () => {
    // A Shape paints itself from its own style block; a class styling it would argue with it.
    expect(variantClasses(createComponent('Shape', 'cp_1'))).toEqual([]);
    expect(variantClassName(createComponent('Shape', 'cp_1'))).toBeUndefined();
  });
});

describe('the fields that are one control wearing four value types look identical', () => {
  it('shares a stem across text, number, date and select', () => {
    // They are the same control to the person filling them in, so they had better be the same
    // control to look at.
    const stems = ['TextField', 'NumberField', 'DateField', 'Select', 'MultilineField'].map(classStem);
    expect(new Set(stems)).toEqual(new Set(['loom-field']));
  });
});

describe('the stylesheet', () => {
  it('is written in tokens and nothing else', () => {
    // A hex code here is a colour the project's theme cannot move, which defeats the point of
    // having tokens at all. The data-URI tick is the one exception: it is a shape, not a colour,
    // and its `white` is the contrast against whatever the brand colour turns out to be.
    const withoutDataUris = CSS.replace(/url\("data:[^"]*"\)/g, '');
    expect(withoutDataUris).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('never removes a focus ring', () => {
    // A builder whose default controls are invisible to a keyboard produces inaccessible apps by
    // default, which is the kind of thing nobody goes back and fixes.
    // Removing the browser's outline is allowed *only* where something visible replaces it — the
    // fields swap it for a brand border and a soft ring, which is louder than what it replaced.
    // Removing it and putting nothing back is the failure this catches.
    for (const block of CSS.split('}')) {
      if (!/outline:\s*(none|0)/.test(block)) continue;
      expect(block, `${block.trim().slice(0, 80)} removes focus without replacing it`).toMatch(
        /box-shadow|border-color|border-bottom-width/,
      );
    }
    expect(CSS).toContain(':focus-visible');
  });
});
