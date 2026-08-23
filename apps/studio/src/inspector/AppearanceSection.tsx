import type { Component, Style } from '@loom/ir';
import { tokensIn } from '@loom/ui';
import { useState } from 'react';
import { defFor } from '@loom/components';
import { useEditor } from '../state/useEditor';
import { isHiddenInEditor, setStyle, toggleEditorVisibility } from '../state/store';
import { ColorField } from './ColorField';
import { Cell, Choice, Glyph, Row, Section } from './Section';

/**
 * Appearance, Fill, Stroke and Effects — the sections a designer reaches for constantly
 * (`docs/13-inspector.md`).
 *
 * The split matters: **opacity and corner rounding are per-object**, and **colour is not**. A fill
 * names a token, so moving the token moves every surface built on it; that is the difference
 * between a design system and a styling panel (`docs/05-guardrails.md` 19-24). Figma offers a hex
 * field here and loom deliberately does not — the swatch shows what the token currently resolves
 * to, and the project's palette is edited in one place.
 */

const EYE = 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z';
const EYE_OFF = 'M4 4l16 16M9.5 9.6A2.5 2.5 0 0012 14.5c.6 0 1.2-.2 1.6-.6M6.7 6.8C3.9 8.4 2 12 2 12s4 6 10 6c1.6 0 3-.4 4.2-1M9.9 6.2A9.7 9.7 0 0112 6c6 0 10 6 10 6a19 19 0 01-2.7 3.1';

function ColourRow({
  component,
  property,
  testId,
  label,
}: {
  component: Component;
  property: 'background' | 'textColor' | 'borderColor';
  testId: string;
  label: string;
}) {
  return (
    <Row>
      <ColorField
        label={label}
        testId={testId}
        value={component.style?.[property]}
        onChange={(next) => setStyle(component.id, { [property]: next })}
      />
    </Row>
  );
}

function TokenRow({
  component,
  property,
  group,
  testId,
  mark,
  title,
}: {
  component: Component;
  property: keyof Style;
  group: 'radius' | 'shadow' | 'text' | 'weight';
  testId: string;
  mark: string;
  title: string;
}) {
  const value = component.style?.[property];
  const token = value && typeof value === 'object' && 'token' in value ? value.token : '';

  return (
    <Cell mark={mark} title={title}>
      <select
        data-testid={testId}
        value={token}
        onChange={(e) =>
          setStyle(component.id, {
            [property]: e.target.value ? { kind: 'token', token: e.target.value } : undefined,
          })
        }
      >
        <option value="">—</option>
        {tokensIn(group).map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
    </Cell>
  );
}

/**
 * Corner rounding: a token, a number, or four numbers.
 *
 * The token still comes first — it is the project's decision, and a screen full of `radius.md` is
 * a screen that restyles in one move. But "round the top two corners of this card" is a real thing
 * to want and no scale answers it, so a literal is offered beside the scale rather than instead of
 * it. Four corners are one CSS value, not four properties, which is why they live in one field.
 */
function Corners({ component }: { component: Component }) {
  const value = component.style?.radius;
  const literal = value?.kind === 'literal' ? value.value : undefined;
  const [perCorner, setPerCorner] = useState(Boolean(literal && literal.trim().includes(' ')));

  const corners = (literal ?? '0px 0px 0px 0px').trim().split(/\s+/);
  const at = (index: number): number => Number.parseFloat(corners[index] ?? corners[0] ?? '0') || 0;

  const writeCorners = (next: number[]): void =>
    setStyle(component.id, {
      radius: { kind: 'literal', value: next.map((n) => `${n}px`).join(' ') },
    });

  if (perCorner) {
    const all = [at(0), at(1), at(2), at(3)];
    return (
      <>
        <Row>
          {(['↖', '↗', '↘', '↙'] as const).map((mark, index) => (
            <Cell key={mark} mark={mark} title="Corner rounding">
              <input
                type="number"
                min={0}
                data-testid={`radius-${index}`}
                value={all[index]}
                onChange={(e) =>
                  writeCorners(all.map((n, i) => (i === index ? Number(e.target.value) : n)))
                }
              />
            </Cell>
          ))}
          <button
            className="ins__icon"
            title="One radius for every corner"
            data-testid="radius-single"
            onClick={() => {
              setPerCorner(false);
              writeCorners([all[0]!, all[0]!, all[0]!, all[0]!]);
            }}
          >
            ⌷
          </button>
        </Row>
      </>
    );
  }

  return (
    <>
      <Cell mark="⌜" title="Corner rounding">
        <input
          type="number"
          min={0}
          data-testid="radius"
          value={literal ? at(0) : ''}
          placeholder={value?.kind === 'token' ? 'token' : '0'}
          onChange={(e) => writeCorners(Array(4).fill(Number(e.target.value)))}
        />
        <select
          data-testid="style-radius"
          value={value?.kind === 'token' ? value.token : ''}
          onChange={(e) =>
            setStyle(component.id, {
              radius: e.target.value ? { kind: 'token', token: e.target.value } : undefined,
            })
          }
        >
          <option value="">custom</option>
          {tokensIn('radius').map((token) => (
            <option key={token.id} value={token.id}>
              {token.label}
            </option>
          ))}
        </select>
      </Cell>
      <button
        className="ins__icon"
        title="A different radius per corner"
        data-testid="radius-per-corner"
        onClick={() => setPerCorner(true)}
      >
        ⌟
      </button>
    </>
  );
}

export function AppearanceSection({ component }: { component: Component }) {
  const hidden = useEditor((s) => isHiddenInEditor(s.snapshot, s.hiddenInEditor, component.id));
  const style = component.style ?? {};
  // Only something that *holds* things can crop them.
  const isFrame = Boolean(defFor(component.type)?.isContainer);

  return (
    <Section name="Appearance">
      <Row>
        <Cell mark="%" title="How see-through it is">
          <input
            type="number"
            min={0}
            max={100}
            data-testid="opacity"
            value={style.opacity ?? 100}
            onChange={(e) => {
              const next = Math.max(0, Math.min(100, Number(e.target.value)));
              setStyle(component.id, { opacity: next === 100 ? undefined : next });
            }}
          />
        </Cell>
        <Corners component={component} />
        <Choice
          active={!hidden}
          title={hidden ? 'Hidden while designing' : 'Visible'}
          testId="editor-visibility"
          onPick={() => toggleEditorVisibility(component.id)}
        >
          <Glyph path={hidden ? EYE_OFF : EYE} />
        </Choice>
      </Row>

      {isFrame ? (
        <Row>
          <label className="ins__check">
            <input
              type="checkbox"
              data-testid="clip-content"
              checked={Boolean(style.clip)}
              onChange={(e) => setStyle(component.id, { clip: e.target.checked || undefined })}
            />
            Clip content
          </label>
        </Row>
      ) : null}
    </Section>
  );
}

export function FillSection({ component }: { component: Component }) {
  return (
    <Section
      name="Fill"
      hint="A token is a decision the whole project follows; a custom colour is a value on this one thing."
    >
      <ColourRow component={component} property="background" testId="style-background" label="Fill" />
    </Section>
  );
}

export function StrokeSection({ component }: { component: Component }) {
  const width = component.style?.borderWidth ?? 0;

  return (
    <Section name="Stroke">
      <ColourRow
        component={component}
        property="borderColor"
        testId="style-borderColor"
        label="Stroke"
      />
      <Row>
        <Cell mark="W" title="Stroke width, in pixels">
          <input
            type="number"
            min={0}
            data-testid="style-borderWidth"
            value={width}
            onChange={(e) =>
              setStyle(component.id, { borderWidth: Number(e.target.value) || undefined })
            }
          />
        </Cell>
      </Row>
    </Section>
  );
}

export function TypeSection({ component }: { component: Component }) {
  return (
    <Section name="Text">
      <ColourRow component={component} property="textColor" testId="style-textColor" label="Text" />
      <Row>
        <TokenRow
          component={component}
          property="fontSize"
          group="text"
          testId="style-fontSize"
          mark="A"
          title="Type size, from the scale"
        />
        <TokenRow
          component={component}
          property="fontWeight"
          group="weight"
          testId="style-fontWeight"
          mark="B"
          title="Weight, from the scale"
        />
      </Row>
      <Row>
        {(['start', 'center', 'end'] as const).map((at) => (
          <Choice
            key={at}
            active={component.style?.align === at}
            title={`Align ${at}`}
            testId={`text-align-${at}`}
            onPick={() =>
              setStyle(component.id, { align: component.style?.align === at ? undefined : at })
            }
          >
            <Glyph
              path={
                at === 'start'
                  ? 'M4 6h16M4 12h10M4 18h14'
                  : at === 'center'
                    ? 'M4 6h16M7 12h10M5 18h14'
                    : 'M4 6h16M10 12h10M6 18h14'
              }
            />
          </Choice>
        ))}
      </Row>
    </Section>
  );
}
