import type { Component, Layout, SizeMode } from '@loom/ir';
import { defFor } from '@loom/components';
import { setLayout, setLayoutMode, setSize } from '../state/store';
import { Cell, Choice, Glyph, Row, Section } from './Section';

/**
 * Layout — how a frame holds what is inside it (`docs/13-inspector.md`).
 *
 * Figma calls the first control Flow, and loom's version of it is the honest one: a frame either
 * keeps its children where they were put or arranges them along an axis. Grid is not offered,
 * because loom emits flex and a grid control that produced rows of flex would be a picture of a
 * layout the app does not have (`docs/specs/layout-model.md`).
 */

const FLOWS = [
  {
    id: 'free',
    title: 'Free — keep things where I put them',
    path: 'M5 5h5v5H5zM14 9h5v5h-5zM8 15h5v4H8z',
  },
  { id: 'column', title: 'Stack downwards', path: 'M6 4h12M6 12h12M6 20h12' },
  { id: 'row', title: 'Stack across', path: 'M4 6v12M12 6v12M20 6v12' },
] as const;

/** Hug what is inside, fill what is around, or hold a fixed number of pixels. */
const SIZES: readonly SizeMode['mode'][] = ['hug', 'fill', 'fixed'];

function Dimension({ component, axis }: { component: Component; axis: 'width' | 'height' }) {
  const size: SizeMode = component.layout?.size?.[axis] ?? { mode: 'hug' };
  const mark = axis === 'width' ? 'W' : 'H';

  return (
    <Cell mark={mark} title={axis === 'width' ? 'Width' : 'Height'}>
      {size.mode === 'fixed' ? (
        <input
          type="number"
          min={0}
          data-testid={`size-${axis}`}
          value={size.px}
          onChange={(e) => setSize(component.id, axis, { mode: 'fixed', px: Number(e.target.value) })}
        />
      ) : null}
      <select
        data-testid={`size-${axis}-mode`}
        value={size.mode}
        onChange={(e) => {
          const mode = e.target.value as SizeMode['mode'];
          setSize(component.id, axis, mode === 'fixed' ? { mode, px: 200 } : { mode });
        }}
      >
        {SIZES.map((mode) => (
          <option key={mode} value={mode}>
            {mode}
          </option>
        ))}
      </select>
    </Cell>
  );
}

export function LayoutSection({ component }: { component: Component }) {
  const layout = component.layout;
  if (!layout) return null;

  // Only a container arranges anything. A shape or a field carries a size and nothing else — a
  // flow control on a rectangle would be asking how it stacks the children it cannot have.
  const holds = Boolean(defFor(component.type)?.isContainer);
  const free = layout.mode === 'free';
  const flow = free ? 'free' : layout.direction;

  const pick = (id: (typeof FLOWS)[number]['id']): void => {
    if (id === 'free') {
      setLayoutMode(component.id, 'free');
      return;
    }
    if (free) setLayoutMode(component.id, 'stack');
    setLayout(component.id, { direction: id } as Partial<Layout>);
  };

  return (
    <Section
      name={holds ? 'Layout' : 'Size'}
      hint={
        holds && free
          ? 'Placed by hand, so this keeps its shape at any width. Stacking is what makes it reflow.'
          : undefined
      }
    >
      <Row>
        {(holds ? FLOWS : []).map((entry) => (
          <Choice
            key={entry.id}
            active={flow === entry.id}
            title={entry.title}
            testId={`flow-${entry.id}`}
            onPick={() => pick(entry.id)}
          >
            <Glyph path={entry.path} />
          </Choice>
        ))}
      </Row>

      <Row>
        <Dimension component={component} axis="width" />
        <Dimension component={component} axis="height" />
      </Row>

      {holds ? (
      <Row>
        <Cell mark="⬚" title="Padding — the space inside the frame's own edge">
          <input
            type="number"
            min={0}
            data-testid="layout-padding"
            value={layout.padding}
            onChange={(e) => setLayout(component.id, { padding: Number(e.target.value) })}
          />
        </Cell>
        {free ? null : (
          <Cell mark="↔" title="Gap — the space between the things inside">
            <input
              type="number"
              min={0}
              data-testid="layout-gap"
              value={layout.gap}
              onChange={(e) => setLayout(component.id, { gap: Number(e.target.value) })}
            />
          </Cell>
        )}
      </Row>
      ) : null}

      {free || !holds ? null : (
        <Row>
          <select
            className="ins__grow"
            data-testid="layout-align"
            value={layout.align}
            onChange={(e) => setLayout(component.id, { align: e.target.value as Layout['align'] })}
          >
            {(['start', 'center', 'end', 'stretch'] as const).map((value) => (
              <option key={value} value={value}>
                across: {value}
              </option>
            ))}
          </select>
          <select
            className="ins__grow"
            data-testid="layout-justify"
            value={layout.justify}
            onChange={(e) => setLayout(component.id, { justify: e.target.value as Layout['justify'] })}
          >
            {(['start', 'center', 'end', 'between'] as const).map((value) => (
              <option key={value} value={value}>
                along: {value}
              </option>
            ))}
          </select>
        </Row>
      )}
    </Section>
  );
}
