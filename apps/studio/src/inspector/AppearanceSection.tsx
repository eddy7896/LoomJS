import type { Component, Style } from '@loom/ir';
import { tokensIn } from '@loom/ui';
import { defFor } from '@loom/components';
import { useEditor } from '../state/useEditor';
import { isHiddenInEditor, setStyle, toggleEditorVisibility } from '../state/store';
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

/** What a token id resolves to right now, project overrides included, for the swatch. */
function swatch(token: string | undefined, overrides: Record<string, string> | undefined): string {
  if (!token) return 'transparent';
  return overrides?.[token] ?? tokensIn('color').find((entry) => entry.id === token)?.value ?? 'transparent';
}

function ColourRow({
  component,
  property,
  testId,
}: {
  component: Component;
  property: 'background' | 'textColor' | 'borderColor';
  testId: string;
}) {
  const theme = useEditor((s) => s.snapshot.theme);
  const value = component.style?.[property];
  const token = value?.kind === 'token' ? value.token : undefined;

  return (
    <Row>
      <span className="ins__swatch" style={{ background: swatch(token, theme) }} />
      <select
        className="ins__grow"
        data-testid={testId}
        value={token ?? ''}
        onChange={(e) =>
          setStyle(component.id, {
            [property]: e.target.value ? { kind: 'token', token: e.target.value } : undefined,
          })
        }
      >
        <option value="">—</option>
        {tokensIn('color').map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
      {token ? (
        <button
          className="ins__icon"
          title="Remove"
          aria-label={`Remove ${property}`}
          data-testid={`${testId}-clear`}
          onClick={() => setStyle(component.id, { [property]: undefined })}
        >
          −
        </button>
      ) : null}
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
        <TokenRow
          component={component}
          property="radius"
          group="radius"
          testId="style-radius"
          mark="⌜"
          title="Corner rounding, from the system"
        />
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
    <Section name="Fill" hint="A fill names a decision in the system, so moving that decision moves everything built on it.">
      <ColourRow component={component} property="background" testId="style-background" />
    </Section>
  );
}

export function StrokeSection({ component }: { component: Component }) {
  const width = component.style?.borderWidth ?? 0;

  return (
    <Section name="Stroke">
      <ColourRow component={component} property="borderColor" testId="style-borderColor" />
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

export function EffectsSection({ component }: { component: Component }) {
  return (
    <Section name="Effects">
      <Row>
        <TokenRow
          component={component}
          property="shadow"
          group="shadow"
          testId="style-shadow"
          mark="◍"
          title="Shadow, from the system"
        />
      </Row>
    </Section>
  );
}

export function TypeSection({ component }: { component: Component }) {
  return (
    <Section name="Text">
      <ColourRow component={component} property="textColor" testId="style-textColor" />
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
