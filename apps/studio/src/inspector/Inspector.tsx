import type { ReactNode } from 'react';
import type { Component, Layout, SizeMode, Snapshot, Style } from '@loom/ir';
import {
  LAYOUT_FIELDS,
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
import { ActionsSection } from './ActionsSection';
import {
  artboardOf,
  flowFor,
  removeArtboard,
  removeFlow,
  rename,
  renameArtboard,
  setArtboardParams,
  setArtboardSize,
  setClickFlow,
  setEntryArtboard,
  setFlowPayload,
  setLayout,
  setProp,
  setSize,
  setStaticProp,
  setStyle,
  setThemeToken,
} from '../state/store';
import { removeNode, setNodeConfig } from '../state/graph';
import { connectedTables } from '../state/connectors';
import { dbNodeFields } from '@loom/connectors';
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

  return (
    <aside className="panel inspector">
      <h2 className="panel__title">Inspector</h2>

      <section className="field-group">
        <div className="field-group__head">
          <span className="badge">{component.type}</span>
          <code className="mono id">{component.id}</code>
        </div>
        <Field label="Name">
          <input
            value={component.name ?? ''}
            onChange={(e) => rename(component.id, e.target.value)}
          />
        </Field>
      </section>

      {def && def.fields.length > 0 ? (
        <section className="field-group">
          <h3 className="field-group__title">Properties</h3>
          {def.fields.map((field) => (
            <PropField key={field.key} component={component} field={field} />
          ))}
        </section>
      ) : null}

      {def?.acceptsClickFlow ? <ActionsSection component={component} /> : null}

      <StyleSection component={component} />

      <ConditionsSection component={component} />

      {component.layout ? <AutoBackendSection component={component} /> : null}

      {component.layout ? (
        <>
          <section className="field-group">
            <h3 className="field-group__title">Layout</h3>
            {LAYOUT_FIELDS.map((field) => (
              <LayoutField key={field.key} component={component} field={field} />
            ))}
          </section>
          <section className="field-group">
            <h3 className="field-group__title">Size</h3>
            <SizeField component={component} axis="width" />
            <SizeField component={component} axis="height" />
          </section>
        </>
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

function LayoutField({ component, field }: { component: Component; field: FieldDef }) {
  const layout = component.layout!;
  const key = field.key as keyof Layout;
  const current = layout[key];

  if (field.control === 'number') {
    return (
      <Field label={field.label}>
        <input
          type="number"
          min={0}
          value={Number(current)}
          onChange={(e) =>
            setLayout(component.id, { [key]: Number(e.target.value) } as Partial<Layout>)
          }
        />
      </Field>
    );
  }

  return (
    <Field label={field.label}>
      <select
        value={String(current)}
        onChange={(e) => setLayout(component.id, { [key]: e.target.value } as Partial<Layout>)}
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

/** hug / fill / fixed per axis (`docs/specs/layout-model.md`). */
function SizeField({ component, axis }: { component: Component; axis: 'width' | 'height' }) {
  const size: SizeMode = component.layout?.size?.[axis] ?? { mode: 'hug' };

  return (
    <Field label={axis === 'width' ? 'Width' : 'Height'}>
      <div className="field__row">
        <select
          value={size.mode}
          onChange={(e) => {
            const mode = e.target.value as SizeMode['mode'];
            setSize(component.id, axis, mode === 'fixed' ? { mode, px: 200 } : { mode });
          }}
        >
          <option value="hug">hug</option>
          <option value="fill">fill</option>
          <option value="fixed">fixed</option>
        </select>
        {size.mode === 'fixed' ? (
          <input
            type="number"
            min={0}
            value={size.px}
            onChange={(e) => setSize(component.id, axis, { mode: 'fixed', px: Number(e.target.value) })}
          />
        ) : null}
      </div>
    </Field>
  );
}

/** "On click, go to <artboard>" — the editor-side face of a flow arrow. */
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

function StyleSection({ component }: { component: Component }) {
  const style = component.style ?? {};

  return (
    <section className="field-group" data-testid="style-section">
      <h3 className="field-group__title">Style</h3>

      <StyleFields
        style={style}
        testPrefix="style-"
        onChange={(patch) => setStyle(component.id, patch)}
      />

      <Field label="Border w">
        <input
          type="number"
          min={0}
          value={style.borderWidth ?? 0}
          onChange={(event) =>
            setStyle(component.id, {
              borderWidth: Number(event.target.value) || undefined,
            })
          }
        />
      </Field>

      <Field label="Align">
        <select
          value={style.align ?? ''}
          onChange={(event) =>
            setStyle(component.id, {
              align: (event.target.value || undefined) as Style['align'],
            })
          }
        >
          <option value="">—</option>
          <option value="start">Start</option>
          <option value="center">Center</option>
          <option value="end">End</option>
        </select>
      </Field>
    </section>
  );
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

function ArtboardInspector({ artboardId }: { artboardId: string }) {
  const snapshot = useEditor((s) => s.snapshot);
  const artboard = snapshot.artboards[artboardId];
  const isEntry = (snapshot.entryArtboard ?? '') === artboardId;
  const canDelete = Object.keys(snapshot.artboards).length > 1;

  if (!artboard) return null;

  const params = artboard.params ?? [];

  return (
    <aside className="panel inspector">
      <h2 className="panel__title">Inspector</h2>

      <section className="field-group">
        <div className="field-group__head">
          <span className="badge">Artboard</span>
          <code className="mono id">{artboard.id}</code>
        </div>
        <Field label="Name">
          <input value={artboard.name} onChange={(e) => renameArtboard(artboard.id, e.target.value)} />
        </Field>
        <Field label="Entry">
          <button disabled={isEntry} onClick={() => setEntryArtboard(artboard.id)}>
            {isEntry ? 'Entry screen (/)' : 'Make entry screen'}
          </button>
        </Field>
      </section>

      <ScreenSizeSection artboardId={artboard.id} />

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
      ? dbNodeFields(node.kind === 'select' ? 'select' : 'insert')
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
