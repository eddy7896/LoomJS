import type { Component, Layout } from '@loom/ir';
import { LAYOUT_FIELDS, defFor, type FieldDef } from '@loom/components';
import { useEditor } from '../state/useEditor';
import { rename, setLayout, setStaticProp } from '../state/store';

/**
 * The inspector is **schema-driven**: it renders whatever `@loom/components` declares for the
 * selected type, so adding a component type never means touching this file (docs/07).
 */
export function Inspector() {
  const snapshot = useEditor((s) => s.snapshot);
  const selectedId = useEditor((s) => s.selectedId);
  const component = selectedId ? snapshot.components[selectedId] : undefined;

  if (!component) {
    return (
      <aside className="panel inspector">
        <h2 className="panel__title">Inspector</h2>
        <p className="panel__empty">Select a component.</p>
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

      {component.layout ? (
        <section className="field-group">
          <h3 className="field-group__title">Layout</h3>
          {LAYOUT_FIELDS.map((field) => (
            <LayoutField key={field.key} component={component} field={field} />
          ))}
        </section>
      ) : null}
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  );
}

function PropField({ component, field }: { component: Component; field: FieldDef }) {
  const value = component.props[field.key];

  // Bound and event values belong to M3/M2 — show them read-only rather than pretending
  // the inspector can edit a data binding it cannot yet compile.
  if (value && value.kind !== 'static') {
    return (
      <Field label={field.label}>
        <input value={`(${value.kind})`} readOnly />
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
          onChange={(e) => setLayout(component.id, { [key]: Number(e.target.value) } as Partial<Layout>)}
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
