import type { Component, Effect } from '@loom/ir';
import { setStyle } from '../state/store';
import { Cell, Row, Section } from './Section';

/**
 * Effects (`docs/13-inspector.md`).
 *
 * Each entry is a **composition a designer names**, not a CSS property they assemble: "glass" is a
 * backdrop blur, a translucent tint and a hairline edge, and asking someone to remember that is
 * how a design tool turns into a stylesheet. They stack in the order they are listed, and each one
 * emits ordinary CSS — no runtime, no library, nothing to install.
 */

const NEW: Record<string, Effect> = {
  shadow: { kind: 'shadow', x: 0, y: 8, blur: 24, spread: -4, color: 'rgb(20 22 26 / 18%)' },
  inner: { kind: 'shadow', x: 0, y: 2, blur: 6, spread: 0, color: 'rgb(20 22 26 / 25%)', inset: true },
  glass: { kind: 'glass', blur: 14, tint: '#ffffff', opacity: 40 },
  noise: { kind: 'noise', opacity: 18, scale: 65 },
  blur: { kind: 'blur', radius: 4 },
};

const LABELS: Record<string, string> = {
  shadow: 'Drop shadow',
  inner: 'Inner shadow',
  glass: 'Glass',
  noise: 'Noise',
  blur: 'Layer blur',
};

function nameOf(effect: Effect): string {
  if (effect.kind === 'shadow') return effect.inset ? LABELS.inner! : LABELS.shadow!;
  return LABELS[effect.kind] ?? effect.kind;
}

export function EffectsSection({ component }: { component: Component }) {
  const effects = component.style?.effects ?? [];

  const write = (next: Effect[]): void =>
    setStyle(component.id, { effects: next.length > 0 ? next : undefined });

  const patch = (index: number, change: Partial<Effect>): void =>
    write(effects.map((effect, i) => (i === index ? ({ ...effect, ...change } as Effect) : effect)));

  return (
    <Section
      name="Effects"
      add={
        <select
          className="ins__add"
          data-testid="add-effect"
          value=""
          onChange={(event) => {
            const chosen = NEW[event.target.value];
            if (chosen) write([...effects, chosen]);
          }}
        >
          <option value="">+</option>
          {Object.keys(NEW).map((kind) => (
            <option key={kind} value={kind}>
              {LABELS[kind]}
            </option>
          ))}
        </select>
      }
    >
      {effects.length === 0 ? <p className="panel__hint">Nothing on this yet.</p> : null}

      {effects.map((effect, index) => (
        <div className="ins__effect" key={index} data-testid={`effect-${index}`}>
          <Row>
            <span className="ins__effect-name" data-testid={`effect-${index}-name`}>
              {nameOf(effect)}
            </span>
            <button
              className="ins__icon"
              title="Remove"
              aria-label={`Remove ${nameOf(effect)}`}
              data-testid={`effect-${index}-remove`}
              onClick={() => write(effects.filter((_, i) => i !== index))}
            >
              −
            </button>
          </Row>

          {effect.kind === 'shadow' ? (
            <>
              <Row>
                <Cell mark="X" title="How far across the shadow falls">
                  <input
                    type="number"
                    data-testid={`effect-${index}-x`}
                    value={effect.x}
                    onChange={(e) => patch(index, { x: Number(e.target.value) })}
                  />
                </Cell>
                <Cell mark="Y" title="How far down the shadow falls">
                  <input
                    type="number"
                    data-testid={`effect-${index}-y`}
                    value={effect.y}
                    onChange={(e) => patch(index, { y: Number(e.target.value) })}
                  />
                </Cell>
              </Row>
              <Row>
                <Cell mark="◌" title="Blur — how soft the edge is">
                  <input
                    type="number"
                    min={0}
                    data-testid={`effect-${index}-blur`}
                    value={effect.blur}
                    onChange={(e) => patch(index, { blur: Number(e.target.value) })}
                  />
                </Cell>
                <Cell mark="⤢" title="Spread — how much bigger than the box">
                  <input
                    type="number"
                    data-testid={`effect-${index}-spread`}
                    value={effect.spread}
                    onChange={(e) => patch(index, { spread: Number(e.target.value) })}
                  />
                </Cell>
              </Row>
              <Row>
                <input
                  className="mono ins__grow"
                  data-testid={`effect-${index}-color`}
                  value={effect.color}
                  spellCheck={false}
                  onChange={(e) => patch(index, { color: e.target.value })}
                />
              </Row>
            </>
          ) : null}

          {effect.kind === 'glass' ? (
            <>
              <Row>
                <Cell mark="◌" title="How much what is behind it is blurred">
                  <input
                    type="number"
                    min={0}
                    data-testid={`effect-${index}-blur`}
                    value={effect.blur}
                    onChange={(e) => patch(index, { blur: Number(e.target.value) })}
                  />
                </Cell>
                <Cell mark="%" title="How much tint sits over the blur">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    data-testid={`effect-${index}-opacity`}
                    value={effect.opacity}
                    onChange={(e) => patch(index, { opacity: Number(e.target.value) })}
                  />
                </Cell>
              </Row>
              <Row>
                <input
                  type="color"
                  className="picker__wheel"
                  data-testid={`effect-${index}-tint`}
                  value={effect.tint}
                  onChange={(e) => patch(index, { tint: e.target.value })}
                />
                <span className="panel__hint ins__grow">
                  Glass shows what is behind it — over nothing, it is just a tint.
                </span>
              </Row>
            </>
          ) : null}

          {effect.kind === 'noise' ? (
            <Row>
              <Cell mark="%" title="How much grain">
                <input
                  type="number"
                  min={0}
                  max={100}
                  data-testid={`effect-${index}-opacity`}
                  value={effect.opacity}
                  onChange={(e) => patch(index, { opacity: Number(e.target.value) })}
                />
              </Cell>
              <Cell mark="⁙" title="Grain size — higher is finer">
                <input
                  type="number"
                  min={1}
                  max={200}
                  data-testid={`effect-${index}-scale`}
                  value={effect.scale}
                  onChange={(e) => patch(index, { scale: Number(e.target.value) })}
                />
              </Cell>
            </Row>
          ) : null}

          {effect.kind === 'blur' ? (
            <Row>
              <Cell mark="◌" title="How much the layer itself is blurred">
                <input
                  type="number"
                  min={0}
                  data-testid={`effect-${index}-radius`}
                  value={effect.radius}
                  onChange={(e) => patch(index, { radius: Number(e.target.value) })}
                />
              </Cell>
            </Row>
          ) : null}
        </div>
      ))}
    </Section>
  );
}
