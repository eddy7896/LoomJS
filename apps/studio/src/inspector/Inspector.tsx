import type { ReactNode } from 'react';
import type { Component, Snapshot, Style } from '@loom/ir';
import {
  MATH_BODY_FIELDS,
  MATH_CANVAS_FIELDS,
  DEFAULT_SCREEN,
  SCREEN_PRESETS,
  defFor,
  defForNode,
  presetForSize,
  screenPreset,
  type FieldDef,
} from '@loom/components';
import { formatType } from '@loom/typesys';
import { useEditor } from '../state/useEditor';
import { QuerySection, TableSchemaSection } from './QuerySection';
import { bucketChoices } from '../state/buckets';

/** The steps a filter narrows: everything that reads rather than writes. */
const NARROWABLE = new Set(['select', 'count', 'aggregate']);
import { ActionsSection } from './ActionsSection';
import { Section } from './Section';
import { PositionSection } from './PositionSection';
import { LayoutSection } from './LayoutSection';
import {
  AppearanceSection,
  FillSection,
  StrokeSection,
  TypeSection,
} from './AppearanceSection';
import { EffectsSection } from './EffectsSection';
import { VariantSection } from './VariantSection';
import {
  removeArtboard,
  removeFlow,
  parentOf,
  rename,
  renameArtboard,
  setArtboardParams,
  setArtboardGuard,
  setArtboardSize,
  setEntryArtboard,
  setFlowPayload,
  setProp,
  setRail,
  setStaticProp,
  setThemeToken,
  selectedComponents,
} from '../state/store';
import { removeNode, setNodeConfig } from '../state/graph';
import { connectedTables, connection } from '../state/connectors';
import { operationsOf, setToolConfig } from '../state/tools';
import { groupSelection, groupingProblem, ungroup } from '../state/grouping';
import {
  TOOL_MODELS,
  isRequestTool,
  toolFor,
  type ToolNodeConfig,
  aggregatesFor,
  dbNodeFields,
  filterOpsFor,
  FILTER_OPS,
  type DbFilter,
  type DbOperation,
  type FilterOp,
} from '@loom/connectors';
import { columnsOf, setDbFilters } from '../state/connectors';
import { TOKENS, tokenValue, tokensIn, type TokenGroup } from '@loom/ui';
import type { Condition } from '@loom/ir';
import {
  addConditionalStyle,
  conditionFromKey,
  conditionKey,
  conditionSources,
  setConditionalStyles,
  setVisibleWhen,
} from '../state/conditions';
import { acceptAuto, backendOffer, detachAuto, generateBackend, withdrawAuto } from '../state/autobackend';

/**
 * The inspector is **schema-driven**: it renders whatever `@loom/components` declares for the
 * selected type, so adding a component type never means touching this file (docs/07). Artboards
 * and flows get their own sections — a flow is a first-class object, not a hidden prop.
 */
export function Inspector() {
  const snapshot = useEditor((s) => s.snapshot);
  const selection = useEditor((s) => s.selection);

  if (selection?.kind === 'artboard') {
    return <ArtboardInspector artboardId={selection.id} />;
  }

  if (selection?.kind === 'flow') {
    return <FlowInspector flowId={selection.id} />;
  }

  if (selection?.kind === 'node') {
    return <NodeInspector nodeId={selection.id} />;
  }

  const component = selection?.kind === 'component' ? snapshot.components[selection.id] : undefined;

  if (!component) {
    return (
      <aside className="panel inspector">
        <h2 className="panel__title">Inspector</h2>
        <p className="panel__empty">Select a component, an artboard, or a flow.</p>
      </aside>
    );
  }

  const def = defFor(component.type);

  const parent = parentOf(snapshot, component.id);
  // Text styling only where there is text to style; a rectangle has no weight.
  const carriesText = ['Text', 'Button', 'Link', 'Checkbox'].includes(component.type);

  return (
    <aside className="panel inspector">
      <header className="inspector__head">
        <span className="badge">{component.type}</span>
        <input
          className="inspector__name"
          data-testid="component-name"
          value={component.name ?? ''}
          placeholder={component.type}
          onChange={(e) => rename(component.id, e.target.value)}
        />
      </header>

      {/* Grouping, where the selection is (G1). The keys are ⌘G and ⇧⌘G, and a button that says
          so beats a shortcut nobody was told about. */}
      <GroupSection component={component} />

      {/* Which kind of element this is — the first decision, and the one that settles most of the
          others (`docs/27-variants.md`). */}
      <VariantSection component={component} />

      <PositionSection component={component} parent={parent} />
      <LayoutSection component={component} />
      <AppearanceSection component={component} />
      <FillSection component={component} />
      <StrokeSection component={component} />
      <EffectsSection component={component} />
      {carriesText ? <TypeSection component={component} /> : null}

      {def && def.fields.length > 0 ? (
        <Section name="Properties">
          {def.fields.map((field) => (
            <PropField key={field.key} component={component} field={field} />
          ))}
        </Section>
      ) : null}

      {def?.acceptsClickFlow ? (
        <Section name="On click">
          <ActionsSection component={component} />
        </Section>
      ) : null}

      <Section name="Conditions">
        <ConditionsSection component={component} />
      </Section>

      {def?.isContainer ? (
        <Section name="Backend">
          <AutoBackendSection component={component} />
        </Section>
      ) : null}
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  );
}

function PropField({ component, field }: { component: Component; field: FieldDef }) {
  const snapshot = useEditor((s) => s.snapshot);
  const value = component.props[field.key];

  /**
   * Where an upload lands, chosen from what the project has attached (`docs/29-storage.md`).
   *
   * A text box here would mean typing a connector id, which nobody knows and nobody should have to
   * look up. The list is the buckets under Files — and when there are none, it says so and points
   * at the place to fix it rather than offering an empty dropdown.
   */
  if (field.key === 'bucket' && (component.type === 'FileField' || component.type === 'ImageField')) {
    const choices = bucketChoices(snapshot);
    const current = value?.kind === 'static' ? String(value.value ?? '') : '';

    return (
      <Field label={field.label}>
        {choices.length === 0 ? (
          <button
            className="field__link"
            data-testid="no-buckets"
            onClick={() => setRail('files')}
          >
            Attach one under Files
          </button>
        ) : (
          <select
            value={current}
            data-testid="bucket-choice"
            onChange={(event) => setStaticProp(component.id, field.key, event.target.value)}
          >
            <option value="">— pick a bucket —</option>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        )}
      </Field>
    );
  }

  // Inside a List, a text property can read a column of the current row instead of holding a
  // literal — the implicit map's one authoring affordance.
  const rowFields = field.control === 'text' ? rowFieldsFor(snapshot, component.id) : [];
  if (rowFields.length > 0) {
    const current = value?.kind === 'item' ? value.field : '';
    return (
      <Field label={field.label}>
        <div className="field__row">
          <select
            value={current}
            onChange={(e) =>
              e.target.value
                ? setProp(component.id, field.key, { kind: 'item', field: e.target.value })
                : setStaticProp(component.id, field.key, '')
            }
          >
            <option value="">— text —</option>
            {rowFields.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {value?.kind === 'item' ? null : (
            <input
              value={value?.kind === 'static' ? String(value.value ?? '') : ''}
              onChange={(e) => setStaticProp(component.id, field.key, e.target.value)}
            />
          )}
        </div>
      </Field>
    );
  }

  // Bound values belong to M3 and params resolve at runtime — show them, do not fake an editor.
  if (value && value.kind !== 'static') {
    const shown = value.kind === 'param' ? `param: ${value.name}` : `(${value.kind})`;
    return (
      <Field label={field.label}>
        <input value={shown} readOnly />
      </Field>
    );
  }

  const current = value?.value ?? field.default;

  if (field.control === 'number') {
    return (
      <Field label={field.label}>
        <input
          type="number"
          value={Number(current)}
          onChange={(e) => setStaticProp(component.id, field.key, Number(e.target.value))}
        />
      </Field>
    );
  }

  if (field.control === 'boolean') {
    return (
      <Field label={field.label}>
        <input
          type="checkbox"
          checked={Boolean(current)}
          onChange={(e) => setStaticProp(component.id, field.key, e.target.checked)}
        />
      </Field>
    );
  }

  if (field.control === 'select') {
    return (
      <Field label={field.label}>
        <select
          value={String(current)}
          onChange={(e) => setStaticProp(component.id, field.key, e.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  return (
    <Field label={field.label}>
      <input
        value={String(current)}
        onChange={(e) => setStaticProp(component.id, field.key, e.target.value)}
      />
    </Field>
  );
}


/**
 * Auto-backend inference (M5). A frame holding inputs and one button is a form, and a form whose
 * fields name real columns is a backend loom can write. The offer explains itself either way —
 * a disabled button that will not say why is worse than no button.
 */
function AutoBackendSection({ component }: { component: Component }) {
  const snapshot = useEditor((s) => s.snapshot);
  const offer = backendOffer(snapshot, component.id);

  return (
    <section className="field-group" data-testid="auto-backend">
      <h3 className="field-group__title">Backend</h3>
      {offer.ok ? (
        <>
          <p className="panel__hint">
            Submitting this form can insert into <strong>{offer.table}</strong> (
            {offer.fields.join(', ')}).
          </p>
          {offer.unmatched.length > 0 ? (
            <p className="panel__hint">
              No column matches {offer.unmatched.join(', ')} — those inputs stay unwired.
            </p>
          ) : null}
          <button data-testid="generate-backend" onClick={() => generateBackend(component.id)}>
            Generate backend
          </button>
        </>
      ) : (
        <p className="panel__hint">{offer.reason}</p>
      )}
    </section>
  );
}

/**
 * The frame a screen is drawn at. A preset is a **canvas size, not a breakpoint** — V1 emits one
 * flex layout that adapts (`docs/07-v1-scope.md`), so choosing Phone changes what the designer
 * sees and what the Preview runs at, and changes no emitted CSS.
 */
function ScreenSizeSection({ artboardId }: { artboardId: string }) {
  const snapshot = useEditor((s) => s.snapshot);
  const artboard = snapshot.artboards[artboardId];
  if (!artboard) return null;

  const size = artboard.size ?? { width: DEFAULT_SCREEN.width, height: DEFAULT_SCREEN.height };
  const matched = presetForSize(size.width, size.height);

  const apply = (width: number, height: number): void =>
    setArtboardSize(artboardId, {
      width: Math.max(240, Math.round(width) || 240),
      height: Math.max(240, Math.round(height) || 240),
      preset: presetForSize(width, height)?.id,
    });

  return (
    <section className="field-group" data-testid="screen-size">
      <h3 className="field-group__title">Screen</h3>

      <Field label="Size">
        <select
          data-testid="screen-preset"
          value={matched?.id ?? ''}
          onChange={(event) => {
            const preset = screenPreset(event.target.value);
            if (preset) apply(preset.width, preset.height);
          }}
        >
          {matched ? null : <option value="">Custom</option>}
          {SCREEN_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label} — {preset.width}x{preset.height}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Width">
        <input
          type="number"
          data-testid="screen-width"
          value={size.width}
          onChange={(event) => apply(Number(event.target.value), size.height)}
        />
      </Field>

      <Field label="Height">
        <input
          type="number"
          data-testid="screen-height"
          value={size.height}
          onChange={(event) => apply(size.width, Number(event.target.value))}
        />
      </Field>

      <p className="panel__hint">
        The frame you design in, and the width the Preview runs at. The app itself stays one
        adaptive layout — this is not a breakpoint.
      </p>
    </section>
  );
}

/** Accept / Detach for a generated pipeline (`docs/06-glossary.md`). */
function AutoSection({ group, state }: { group: string; state: 'proposed' | 'accepted' }) {
  return (
    <section className="field-group" data-testid="auto-controls">
      <div className="field-group__head">
        <span className="badge badge--auto">AUTO</span>
        <span className="mono id">{state}</span>
      </div>
      <p className="panel__hint">
        {state === 'proposed'
          ? 'loom generated this from your form. Accept to keep it in sync, or detach to take it over.'
          : 'Kept in sync with the form it came from. Detach to take it over.'}
      </p>
      <div className="row-actions">
        {state === 'proposed' ? (
          <button data-testid="accept-auto" onClick={() => acceptAuto(group)}>
            Accept
          </button>
        ) : null}
        <button data-testid="detach-auto" onClick={() => detachAuto(group)}>
          Detach
        </button>
        {state === 'proposed' ? (
          <button data-testid="discard-auto" onClick={() => withdrawAuto(group)}>
            Discard
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** The styled properties a component owns, picked from the design system rather than typed. */
const STYLE_FIELDS = [
  { key: 'background', label: 'Fill', group: 'color' },
  { key: 'textColor', label: 'Text', group: 'color' },
  { key: 'fontSize', label: 'Size', group: 'text' },
  { key: 'fontWeight', label: 'Weight', group: 'weight' },
  { key: 'radius', label: 'Corners', group: 'radius' },
  { key: 'shadow', label: 'Shadow', group: 'shadow' },
  { key: 'borderColor', label: 'Border', group: 'color' },
] as const satisfies readonly { key: keyof Style; label: string; group: TokenGroup }[];

/**
 * Style is chosen from the system, never typed. Every control lists the tokens in its group and
 * writes a token *reference* into the document, so moving a token moves every surface built on
 * it — that is what makes this a design system rather than a styling panel
 * (`docs/05-guardrails.md` 19-24).
 */
/** The token pickers, shared by the base style and by every conditional override. */
function StyleFields({
  style,
  onChange,
  testPrefix,
}: {
  style: Style;
  onChange: (patch: Partial<Style>) => void;
  testPrefix: string;
}) {
  const theme = useEditor((s) => s.snapshot.theme);

  return (
    <>
      {STYLE_FIELDS.map((entry) => {
        const current = style[entry.key];
        const value = current?.kind === 'token' ? current.token : '';
        return (
          <Field key={entry.key} label={entry.label}>
            <div className="field__row">
              <select
                data-testid={`${testPrefix}${entry.key}`}
                value={value}
                onChange={(event) =>
                  onChange({
                    [entry.key]: event.target.value
                      ? { kind: 'token', token: event.target.value }
                      : undefined,
                  })
                }
              >
                <option value="">—</option>
                {tokensIn(entry.group).map((token) => (
                  <option key={token.id} value={token.id}>
                    {token.label}
                  </option>
                ))}
              </select>
              {entry.group === 'color' && value ? (
                <span
                  className="swatch"
                  style={{ background: tokenValue(value, theme) }}
                  title={value}
                />
              ) : null}
            </div>
          </Field>
        );
      })}
    </>
  );
}

/**
 * Conditions (spec 6): show-when, plus style overrides that hold while a condition does. The
 * picker only offers booleans this screen actually produces — a list including sources the
 * compiler would refuse is worse than a short one.
 */
function ConditionsSection({ component }: { component: Component }) {
  const snapshot = useEditor((s) => s.snapshot);
  const activeArtboardId = useEditor((s) => s.activeArtboardId);
  const sources = conditionSources(snapshot, activeArtboardId);
  const conditionals = component.conditionalStyles ?? [];

  const picker = (
    condition: Condition | undefined,
    onPick: (next: Condition | undefined) => void,
    testId: string,
  ) => (
    <div className="field__row">
      <select
        data-testid={testId}
        value={conditionKey(condition)}
        onChange={(event) => onPick(conditionFromKey(event.target.value, condition?.test))}
      >
        <option value="">Always</option>
        {sources.map((source) => (
          <option key={source.key} value={source.key}>
            {source.label}
          </option>
        ))}
      </select>
      {condition ? (
        <select
          data-testid={`${testId}-test`}
          value={condition.test ?? 'is'}
          onChange={(event) =>
            onPick(
              event.target.value === 'not'
                ? { source: condition.source, test: 'not' }
                : { source: condition.source },
            )
          }
        >
          <option value="is">is on</option>
          <option value="not">is off</option>
        </select>
      ) : null}
    </div>
  );

  return (
    <section className="field-group" data-testid="conditions-section">
      <h3 className="field-group__title">Conditions</h3>

      {sources.length === 0 ? (
        <p className="panel__hint">
          Nothing on this screen produces a true/false value yet. A checkbox, or a Compare node,
          gives a condition something to read.
        </p>
      ) : null}

      <Field label="Show when">
        {picker(component.visibleWhen, (next) => setVisibleWhen(component.id, next), 'visible-when')}
      </Field>

      {conditionals.map((entry, index) => (
        <div key={index} className="conditional-style" data-testid={`conditional-style-${index}`}>
          <div className="field-group__head">
            <span className="badge">Style when</span>
            <button
              title="Remove"
              data-testid={`remove-conditional-${index}`}
              onClick={() =>
                setConditionalStyles(
                  component.id,
                  conditionals.filter((_, i) => i !== index),
                )
              }
            >
              ×
            </button>
          </div>

          {picker(
            entry.when,
            (next) => {
              if (!next) return;
              setConditionalStyles(
                component.id,
                conditionals.map((row, i) => (i === index ? { ...row, when: next } : row)),
              );
            },
            `conditional-when-${index}`,
          )}

          <StyleFields
            style={entry.style}
            testPrefix={`conditional-${index}-`}
            onChange={(patch) =>
              setConditionalStyles(
                component.id,
                conditionals.map((row, i) =>
                  i === index ? { ...row, style: cleaned({ ...row.style, ...patch }) } : row,
                ),
              )
            }
          />
        </div>
      ))}

      {sources.length > 0 ? (
        <button
          data-testid="add-conditional-style"
          onClick={() => addConditionalStyle(component.id)}
        >
          + Style when…
        </button>
      ) : null}
    </section>
  );
}

/** Drop cleared properties, so an override carries only what it actually changes. */
function cleaned(style: Style): Style {
  const next = { ...style } as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) delete next[key];
  }
  return next as Style;
}

/**
 * The project's own tokens. One change here restyles everything built on that token, which is the
 * difference between a system and a habit.
 */
function ThemeSection() {
  const theme = useEditor((s) => s.snapshot.theme) ?? {};

  return (
    <section className="field-group" data-testid="theme-section">
      <h3 className="field-group__title">Theme</h3>
      <p className="panel__hint">
        Every component styled with a token follows it. Clearing a value restores loom's default.
      </p>
      {TOKENS.filter((token) => token.group === 'color').map((token) => (
        <Field key={token.id} label={token.label}>
          <div className="field__row">
            <input
              type="color"
              data-testid={`theme-${token.id}`}
              value={normalizeColor(tokenValue(token.id, theme) ?? token.value)}
              onChange={(event) => setThemeToken(token.id, event.target.value)}
            />
            {theme[token.id] ? (
              <button title="Reset" onClick={() => setThemeToken(token.id, undefined)}>
                ↺
              </button>
            ) : null}
          </div>
        </Field>
      ))}
    </section>
  );
}

/** `<input type="color">` only accepts `#rrggbb`; anything else would silently show black. */
function normalizeColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
}

/**
 * Who may open this screen (spec 10).
 *
 * The guard is a router-level convenience, and the hint says so: the thing that actually keeps one
 * person's rows theirs is the server, which answers every request as whoever is asking.
 */
function GuardSection({ artboardId }: { artboardId: string }) {
  const snapshot = useEditor((s) => s.snapshot);
  const artboard = snapshot.artboards[artboardId];
  if (!artboard) return null;

  // Sending people to a screen that is itself signed-in-only is a bounce with no floor, so it is
  // not offered — the compiler refuses it, and a picker should never offer what will be refused.
  const elsewhere = Object.values(snapshot.artboards).filter(
    (other) => other.id !== artboardId && !other.guard,
  );
  const guard = artboard.guard;

  return (
    <section className="field-group" data-testid="guard-section">
      <h3 className="field-group__title">Who can open this</h3>
      <Field label="Visitors">
        <select
          data-testid="guard-mode"
          value={guard ? 'signedIn' : 'anyone'}
          onChange={(e) => {
            if (e.target.value === 'anyone') return setArtboardGuard(artboardId, undefined);
            const first = elsewhere[0];
            if (first) setArtboardGuard(artboardId, { redirectTo: first.id });
          }}
        >
          <option value="anyone">Anyone</option>
          <option value="signedIn" disabled={!guard && elsewhere.length === 0}>
            Only signed-in people
          </option>
        </select>
      </Field>
      {guard ? (
        <>
          <Field label="Send others to">
            <select
              data-testid="guard-redirect"
              value={guard.redirectTo}
              onChange={(e) => setArtboardGuard(artboardId, { redirectTo: e.target.value })}
            >
              {elsewhere.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="panel__hint">
            This keeps a signed-out visitor from landing here. What keeps their data private is the
            server, which answers every request as whoever is asking.
          </p>
        </>
      ) : null}
    </section>
  );
}

/**
 * A screen, which is a frame with a route (`docs/12-canvas.md`).
 *
 * One panel holds both halves — what the screen is (name, size, route, who may open it) and what
 * its frame does (padding, direction, background). They were two panels for two rows that stood
 * for one object, and the split made a designer hunt for padding in the wrong place.
 */
function ArtboardInspector({ artboardId }: { artboardId: string }) {
  const snapshot = useEditor((s) => s.snapshot);
  const artboard = snapshot.artboards[artboardId];
  const isEntry = (snapshot.entryArtboard ?? '') === artboardId;
  const canDelete = Object.keys(snapshot.artboards).length > 1;

  if (!artboard) return null;

  const params = artboard.params ?? [];
  const root = snapshot.components[artboard.root];

  return (
    <aside className="panel inspector">
      <h2 className="panel__title">Inspector</h2>

      <section className="field-group">
        <div className="field-group__head">
          <span className="badge">Screen</span>
          <code className="mono id">{artboard.id}</code>
        </div>
        <Field label="Name">
          <input
            data-testid="screen-name"
            value={artboard.name}
            onChange={(e) => renameArtboard(artboard.id, e.target.value)}
          />
        </Field>
        <Field label="Entry">
          <button disabled={isEntry} onClick={() => setEntryArtboard(artboard.id)}>
            {isEntry ? 'Entry screen (/)' : 'Make entry screen'}
          </button>
        </Field>
      </section>

      <ScreenSizeSection artboardId={artboard.id} />

      {/* The frame half: this screen's own arrangement, padding and fill. */}
      {root ? (
        <>
          <LayoutSection component={root} />
          <AppearanceSection component={root} />
          <FillSection component={root} />
          <StrokeSection component={root} />
          <EffectsSection component={root} />
        </>
      ) : null}

      <GuardSection artboardId={artboard.id} />

      <section className="field-group">
        <h3 className="field-group__title">Params</h3>
        <p className="panel__hint">
          A param becomes a dynamic segment in this screen&apos;s route, and flows into it must
          carry a value.
        </p>
        {params.map((param, index) => (
          <Field key={index} label={`:${param.name}`}>
            <div className="field__row">
              <input
                value={param.name}
                onChange={(e) =>
                  setArtboardParams(
                    artboard.id,
                    params.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)),
                  )
                }
              />
              <button
                onClick={() =>
                  setArtboardParams(
                    artboard.id,
                    params.filter((_, i) => i !== index),
                  )
                }
              >
                ×
              </button>
            </div>
          </Field>
        ))}
        <button
          onClick={() =>
            setArtboardParams(artboard.id, [...params, { name: 'id', type: { kind: 'text' } }])
          }
        >
          + Param
        </button>
      </section>

      <ThemeSection />

      {canDelete ? (
        <section className="field-group">
          <button onClick={() => removeArtboard(artboard.id)}>Delete artboard</button>
        </section>
      ) : null}
    </aside>
  );
}

function FlowInspector({ flowId }: { flowId: string }) {
  const snapshot = useEditor((s) => s.snapshot);
  const flow = snapshot.flows[flowId];
  if (!flow) return null;

  const from = snapshot.artboards[flow.from];
  const to = snapshot.artboards[flow.to];

  return (
    <aside className="panel inspector">
      <h2 className="panel__title">Inspector</h2>
      <section className="field-group">
        <div className="field-group__head">
          <span className="badge">Flow</span>
          <code className="mono id">{flow.id}</code>
        </div>
        <Field label="From">
          <input value={from?.name ?? '—'} readOnly />
        </Field>
        <Field label="To">
          <input value={to?.name ?? '—'} readOnly />
        </Field>
        {(flow.payload ?? []).map((entry) => (
          <Field key={entry.param} label={entry.param}>
            <input
              value={entry.kind === 'static' ? String(entry.value ?? '') : '(bound)'}
              readOnly={entry.kind !== 'static'}
              onChange={(e) =>
                setFlowPayload(flow.id, [
                  ...(flow.payload ?? []).filter((p) => p.param !== entry.param),
                  { kind: 'static', param: entry.param, value: e.target.value },
                ])
              }
            />
          </Field>
        ))}
        <button onClick={() => removeFlow(flow.id)}>Delete flow</button>
      </section>
    </aside>
  );
}


/**
 * Group and ungroup (G1).
 *
 * A group is a Frame, so ungroup is offered on any frame with something in it — including one a
 * designer built by hand and now wants opened up. Group says *why* it cannot run rather than
 * greying out: "why is this disabled" is the question a disabled button always raises and never
 * answers.
 */
function GroupSection({ component }: { component: Component }) {
  const snapshot = useEditor((s) => s.snapshot);
  // Subscribed one field at a time. A selector returning a fresh array each call hands the store
  // a new reference every render, which is a re-render loop rather than a subscription.
  const selection = useEditor((s) => s.selection);
  const also = useEditor((s) => s.also);

  const ids =
    selection?.kind === 'component' ? [selection.id, ...also] : [];
  const problem = groupingProblem(snapshot, ids);
  const canUngroup = (component.children ?? []).length > 0;

  if (!canUngroup && ids.length < 2) return null;

  return (
    <section className="field-group">
      <div className="row-actions">
        {ids.length >= 2 ? (
          <button data-testid="group" disabled={Boolean(problem)} onClick={() => groupSelection()}>
            Group {ids.length}
          </button>
        ) : null}
        {canUngroup ? (
          <button data-testid="ungroup" onClick={() => ungroup(component.id)}>
            Ungroup
          </button>
        ) : null}
      </div>
      {problem && ids.length >= 2 ? <p className="panel__hint">{problem}</p> : null}
    </section>
  );
}


/**
 * A tool call (T1–T3, `docs/22-api-connectors.md`).
 *
 * What is on the node rather than flowing through it: which operation, which model, how long an
 * answer may be, and — for a request the designer writes — where it goes. Its *inputs* are the
 * operation's parameters and live on the ports, so they are wired rather than typed here.
 */
function ToolSection({ nodeId }: { nodeId: string }) {
  const snapshot = useEditor((s) => s.snapshot);
  const node = snapshot.nodes[nodeId];
  const config = (node?.config ?? {}) as Partial<ToolNodeConfig>;
  const tool = toolFor(String(config.toolId ?? ''));
  if (!node || !tool) return null;

  const operations = operationsOf(tool.id);
  const models = TOOL_MODELS[tool.id] ?? [];

  return (
    <section className="field-group">
      <h3 className="field-group__title">{tool.label}</h3>

      {operations.length > 0 ? (
        <Field label="Operation">
          <select
            data-testid="tool-operation"
            value={config.operationId ?? ''}
            onChange={(event) => setToolConfig(nodeId, { operationId: event.target.value })}
          >
            {operations.map((operation) => (
              <option key={operation.id} value={operation.id}>
                {operation.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {models.length > 0 ? (
        <>
          <Field label="Model">
            <select
              data-testid="tool-model"
              value={config.model ?? models[0]}
              onChange={(event) => setToolConfig(nodeId, { model: event.target.value })}
            >
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Longest answer">
            <input
              type="number"
              data-testid="tool-max-tokens"
              value={config.maxTokens ?? 1024}
              onChange={(event) =>
                setToolConfig(nodeId, { maxTokens: Number(event.target.value) })
              }
            />
          </Field>
        </>
      ) : null}

      {isRequestTool(tool.id) ? (
        <>
          <Field label="Address">
            <input
              data-testid="tool-url"
              value={config.url ?? ''}
              placeholder="https://example.com/hook"
              onChange={(event) => setToolConfig(nodeId, { url: event.target.value })}
            />
          </Field>
          <Field label="Method">
            <select
              data-testid="tool-method"
              value={config.method ?? 'POST'}
              onChange={(event) => setToolConfig(nodeId, { method: event.target.value })}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}

      {/* Said where the call is, because "where does the key go" is asked here and answered
          nowhere else. */}
      <p className="panel__hint">
        Runs on the server. {tool.credentials.map((entry) => entry.name).join(', ')} read there by
        name — never in the browser.
      </p>
    </section>
  );
}

/** A graph node: its config drives its port types, so editing here retypes the ports. */
function NodeInspector({ nodeId }: { nodeId: string }) {
  const snapshot = useEditor((s) => s.snapshot);
  const node = snapshot.nodes[nodeId];
  if (!node) return null;

  const def = defForNode(node);
  const config = (node.config ?? {}) as Record<string, unknown>;
  // A database node's fields come from the connector, not the node vocabulary: a read is a
  // query, and how many rows in what order is part of it.
  const insideRoute = Object.values(snapshot.nodes).some(
    (candidate) =>
      candidate.category === 'api' &&
      (((candidate.config ?? {}) as { body?: string[] }).body ?? []).includes(node.id),
  );

  // Math means different things in the two environments, so it shows different fields. On the
  // canvas its operands are wires; inside a route's body they are named fields of the request.
  const applicable = new Set<string>(insideRoute ? MATH_BODY_FIELDS : MATH_CANVAS_FIELDS);
  const fields =
    node.category === 'db'
      ? node.kind === 'query'
        ? []
        : // A total offers the columns it could total, which means the field list needs the table.
          dbNodeFields(
            node.kind as DbOperation,
            connectedTables(snapshot).find((table) => table.name === config.table),
          ).map((entry) =>
            // A document store totals and averages; it has no min or max.
            entry.key === 'fn'
              ? { ...entry, options: aggregatesFor(connection(snapshot)?.moduleId ?? '') }
              : entry,
          )
      : node.kind === 'math'
        ? (def?.fields ?? []).filter((entry) => applicable.has(entry.key))
        : (def?.fields ?? []);

  return (
    <aside className="panel inspector">
      <h2 className="panel__title">Inspector</h2>

      <section className="field-group">
        <div className="field-group__head">
          <span className="badge">{def?.label ?? `${node.category}:${node.kind}`}</span>
          <code className="mono id">{node.id}</code>
        </div>
        {node.mirrorOf ? (
          <p className="panel__hint">
            A mirror of a component on the artboard. Edit what it looks like in Design mode.
          </p>
        ) : null}
      </section>

      {node.auto ? <AutoSection group={node.auto.group} state={node.auto.state} /> : null}

      {/* Narrowing belongs to anything that reads: a count of everything and a total of
          everything are rarely the numbers a screen wants. */}
      {node.category === 'db' && NARROWABLE.has(node.kind) ? (
        <FiltersSection nodeId={node.id} />
      ) : null}

      {node.category === 'db' && node.kind === 'query' ? <QuerySection nodeId={node.id} /> : null}

      {node.category === 'tool' ? <ToolSection nodeId={node.id} /> : null}

      {node.category === 'db' && typeof config.table === 'string' ? (
        <TableSchemaSection tableName={config.table} />
      ) : null}

      {fields.length > 0 ? (
        <section className="field-group">
          <h3 className="field-group__title">Config</h3>
          {fields.map((field) => {
            const current = config[field.key] ?? field.default;
            if (field.control === 'select') {
              return (
                <Field key={field.key} label={field.label}>
                  <select
                    value={String(current)}
                    onChange={(e) => setNodeConfig(node.id, { [field.key]: e.target.value })}
                  >
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            }
            if (field.control === 'boolean') {
              return (
                <Field key={field.key} label={field.label}>
                  <input
                    type="checkbox"
                    checked={Boolean(current)}
                    onChange={(e) => setNodeConfig(node.id, { [field.key]: e.target.checked })}
                  />
                </Field>
              );
            }
            if (field.control === 'number') {
              return (
                <Field key={field.key} label={field.label}>
                  <input
                    type="number"
                    value={Number(current)}
                    onChange={(e) => setNodeConfig(node.id, { [field.key]: Number(e.target.value) })}
                  />
                </Field>
              );
            }
            return (
              <Field key={field.key} label={field.label}>
                <input
                  value={String(current)}
                  onChange={(e) => setNodeConfig(node.id, { [field.key]: e.target.value })}
                />
              </Field>
            );
          })}
        </section>
      ) : null}

      <section className="field-group">
        <h3 className="field-group__title">Ports</h3>
        {node.ports.map((port) => (
          <div key={port.id} className="portline">
            <span className={`dot dot--${port.portKind}`} />
            <span>{port.name}</span>
            <span className="mono id">{formatType(port.type)}</span>
          </div>
        ))}
      </section>

      {node.mirrorOf ? null : (
        <section className="field-group">
          <button onClick={() => removeNode(node.id)}>Delete node</button>
        </section>
      )}
    </aside>
  );
}

/**
 * The columns available to a component inside a List: follow the List's `items` binding back to
 * the API route that produces them, and read the table its body reads.
 */
function rowFieldsFor(snapshot: Snapshot, componentId: string): string[] {
  let current: string | undefined = componentId;
  const seen = new Set<string>();

  while (current && !seen.has(current)) {
    seen.add(current);
    const parent: Component | undefined = Object.values(snapshot.components).find((candidate) =>
      candidate.children?.includes(current!),
    );
    if (!parent) return [];

    if (parent.type === 'List') {
      const items = parent.props.items;
      if (items?.kind !== 'bound') return [];
      const route = snapshot.nodes[items.source.nodeId];
      const body = ((route?.config ?? {}) as { body?: string[] }).body ?? [];
      for (const stepId of body) {
        const step = snapshot.nodes[stepId];
        const config = (step?.config ?? {}) as { table?: string };
        if (step?.category !== 'db' || !config.table) continue;
        const table = connectedTables(snapshot).find((t) => t.name === config.table);
        if (table) return table.columns.map((column) => column.name);
      }
      return [];
    }

    current = parent.id;
  }

  return [];
}

/**
 * Narrowing a read (P4).
 *
 * A filter comparing against a **value** is a fixed rule — "status is open". One comparing against
 * an **input** becomes a port on the node, which becomes an input on the route, which the browser
 * supplies at call time: that is the whole of search, and it is why search needed no machinery of
 * its own (`packages/connectors/src/nodes.ts`).
 */
function FiltersSection({ nodeId }: { nodeId: string }) {
  const snapshot = useEditor((s) => s.snapshot);
  const node = snapshot.nodes[nodeId];
  const columns = columnsOf(snapshot, nodeId);
  if (!node) return null;

  const filters = ((node.config ?? {}) as { filters?: DbFilter[] }).filters ?? [];

  const patch = (index: number, next: Partial<DbFilter>): void =>
    setDbFilters(
      nodeId,
      filters.map((filter, i) => (i === index ? { ...filter, ...next } : filter)),
    );

  return (
    <section className="field-group" data-testid="filters-section">
      <h3 className="field-group__title">Only rows where</h3>

      {columns.length === 0 ? (
        <p className="panel__hint">Reconnect the database to choose columns.</p>
      ) : null}

      {filters.map((filter, index) => (
        <div key={index} className="action-row" data-testid={`filter-${index}`}>
          <div className="field-group__head">
            <span className="badge">{index + 1}</span>
            <button
              title="Remove"
              data-testid={`filter-${index}-remove`}
              onClick={() => setDbFilters(nodeId, filters.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>

          <Field label="Column">
            <select
              data-testid={`filter-${index}-column`}
              value={filter.column}
              onChange={(event) => patch(index, { column: event.target.value })}
            >
              {columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </Field>

          {/* An index is the difference between a search and reading every row, and the moment
              to know that is while choosing the column — not when the table has grown (D6). */}
          {(() => {
            const chosen = columns.find((column) => column.name === filter.column);
            if (!chosen || chosen.primaryKey || chosen.indexed || chosen.unique) return null;
            return (
              <p className="panel__hint" data-testid={`filter-${index}-unindexed`}>
                No index on “{chosen.name}”, so this reads every row. Add one from the Data panel
                if the table will grow.
              </p>
            );
          })()}

          <Field label="Comparison">
            <select
              data-testid={`filter-${index}-operator`}
              value={filter.operator}
              onChange={(event) => patch(index, { operator: event.target.value as FilterOp })}
            >
              {/* Only the comparisons this connection can actually make: offering one that
                  compiles to a refusal is a dead end the designer cannot see coming. */}
              {filterOpsFor(connection(snapshot)?.moduleId ?? '').map((key) => (
                <option key={key} value={key}>
                  {FILTER_OPS[key].label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Compared with">
            <select
              data-testid={`filter-${index}-source`}
              value={filter.source}
              onChange={(event) =>
                patch(index, { source: event.target.value === 'input' ? 'input' : 'value' })
              }
            >
              <option value="value">A fixed value</option>
              <option value="input">Something the screen supplies</option>
            </select>
          </Field>

          {filter.source === 'value' ? (
            <Field label="Value">
              <input
                data-testid={`filter-${index}-value`}
                value={filter.value ?? ''}
                onChange={(event) => patch(index, { value: event.target.value })}
              />
            </Field>
          ) : (
            <p className="panel__hint">
              Wire a field into the route input named “{filter.column}”. An empty one narrows
              nothing, so the list is not blank before anyone has typed.
            </p>
          )}
        </div>
      ))}

      {columns.length > 0 ? (
        <button
          data-testid="add-filter"
          onClick={() =>
            setDbFilters(nodeId, [
              ...filters,
              { column: columns[0]!.name, operator: 'contains', source: 'input' },
            ])
          }
        >
          + Narrow it down…
        </button>
      ) : null}
    </section>
  );
}
