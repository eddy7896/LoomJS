import type { Component } from '@loom/ir';
import { axisValue, defFor, type VariantAxis } from '@loom/components';
import { setStaticProp } from '../state/store';
import { Section } from './Section';

/**
 * Which kind of element this is (`docs/27-variants.md`).
 *
 * It sits at the top of the panel, above position and layout, because it is the **first** decision
 * about an element and the one that settles most of the others: picking `outline` answers the
 * background, the border and the text colour at once, and answers them the same way everywhere in
 * the project. A designer who then wants something else still has Fill, Stroke and Type below —
 * variants are the floor, never the ceiling.
 *
 * Drawn as a segmented control rather than a dropdown. There are three to six options, they are
 * all worth seeing, and comparing them is the whole task — a `<select>` hides five of six answers
 * behind a click.
 */
export function VariantSection({ component }: { component: Component }) {
  const axes = defFor(component.type)?.variants ?? [];
  if (axes.length === 0) return null;

  return (
    <Section name="Style">
      {axes.map((axis) => (
        <AxisRow key={axis.key} component={component} axis={axis} />
      ))}
    </Section>
  );
}

function AxisRow({ component, axis }: { component: Component; axis: VariantAxis }) {
  // The value the element is actually wearing — which is the axis default when the document says
  // nothing, so the control never shows an empty selection for an element that clearly has a look.
  const current = axisValue(component, axis);

  return (
    <div className="field">
      <span className="field__label">{axis.label}</span>
      <div className="segmented" role="group" aria-label={axis.label}>
        {axis.options.map((option) => (
          <button
            key={option}
            type="button"
            className={`segmented__option ${option === current ? 'is-on' : ''}`}
            aria-pressed={option === current}
            data-testid={`variant-${axis.key}-${option}`}
            onClick={() => setStaticProp(component.id, axis.key, option)}
          >
            {label(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** `sm` reads as "SM"; everything else is a word, and a word reads better capitalised. */
function label(option: string): string {
  if (option.length <= 2) return option.toUpperCase();
  return option.charAt(0).toUpperCase() + option.slice(1);
}
