import { afterEach, describe, expect, it, vi } from 'vitest';
import { compile } from '@loom/compiler';
import { __resetStore, addArtboard, getState } from '../src/state/store';
import { connectPostgres } from '../src/state/connectors';
import { askableColumns, fieldTypeFor, generateForm, labelFor } from '../src/state/forms';

/**
 * A form built from a table's columns (D8, `docs/15-schema.md`).
 *
 * The claim being checked is that what comes out is *ordinary components* — a frame, labels,
 * inputs and a button — wired to a route that writes the row, and that the project still
 * compiles afterwards. A generator whose output the compiler rejects is worse than no generator.
 */

const COLUMN = (table: string, name: string, type: string, extra: Record<string, unknown> = {}) => ({
  table_name: table,
  column_name: name,
  data_type: type,
  is_nullable: 'YES',
  column_default: null,
  is_primary: false,
  ...extra,
});

const ROWS = [
  COLUMN('notes', 'id', 'uuid', { is_primary: true, column_default: 'gen_random_uuid()' }),
  COLUMN('notes', 'title', 'text'),
  COLUMN('notes', 'weight', 'integer'),
  COLUMN('notes', 'done', 'boolean'),
  COLUMN('notes', 'due_at', 'timestamp with time zone'),
];

async function connected(): Promise<void> {
  __resetStore();
  addArtboard('Home');
  vi.stubGlobal('fetch', async (input: RequestInfo) =>
    String(input).includes('introspect-sql')
      ? new Response(JSON.stringify({ ok: true, rows: ROWS }))
      : new Response(JSON.stringify({ ok: true })),
  );
  await connectPostgres({ connectionString: 'postgresql://app:pw@db:5432/app' });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('what a form asks for', () => {
  it('skips what the database fills in by itself', () => {
    const table = {
      name: 'notes',
      columns: [
        { name: 'id', type: { kind: 'text' as const }, required: false, primaryKey: true, generated: true },
        { name: 'created', type: { kind: 'date' as const }, required: false, primaryKey: false, generated: true },
        { name: 'title', type: { kind: 'text' as const }, required: true, primaryKey: false, generated: false },
      ],
    };
    expect(askableColumns(table).map((column) => column.name)).toEqual(['title']);
  });

  it('picks the control that suits what the column holds', () => {
    const of = (kind: string) =>
      fieldTypeFor({
        name: 'x',
        type: { kind } as never,
        required: false,
        primaryKey: false,
        generated: false,
      });

    expect(of('text')).toBe('TextField');
    expect(of('number')).toBe('NumberField');
    expect(of('boolean')).toBe('Checkbox');
    expect(of('date')).toBe('DateField');
    // Nothing edits a structure, so it is text a designer can put JSON into.
    expect(of('record')).toBe('MultilineField');
  });

  it('reads a column name as a label rather than as a column name', () => {
    expect(labelFor('due_at')).toBe('Due at');
    expect(labelFor('title')).toBe('Title');
  });
});

describe('what it builds', () => {
  it('lays out a labelled field per column, and a button', async () => {
    await connected();
    const frame = generateForm('notes')!.frameId;

    const snapshot = getState().snapshot;
    const children = (snapshot.components[frame]?.children ?? []).map(
      (id) => snapshot.components[id]!,
    );

    expect(children.map((child) => child.type)).toEqual([
      'Text',
      'TextField',
      'Text',
      'NumberField',
      'Text',
      'Checkbox',
      'Text',
      'DateField',
      'Button',
    ]);
    expect(children[0]!.props.content).toEqual({ kind: 'static', value: 'Title' });
  });

  it('wires every field to the column it was made for', async () => {
    await connected();
    generateForm('notes');

    const snapshot = getState().snapshot;
    const route = Object.values(snapshot.nodes).find((node) => node.category === 'api')!;
    const wired = Object.values(snapshot.wires)
      .filter((wire) => wire.to.nodeId === route.id)
      .map((wire) => wire.to.portId);

    // One per column, plus the button's trigger.
    expect(wired).toContain('pt_col_title');
    expect(wired).toContain('pt_col_weight');
    expect(wired).toContain('pt_col_done');
    expect(wired).toContain('pt_run');
  });

  it('puts the conversion in when a date column needs one', async () => {
    await connected();
    const made = generateForm('notes')!;

    // A DateField hands back the browser's `YYYY-MM-DD` text, and loom will not call that a date.
    // The form wires the same "Read as date" step a designer would have added by hand, so nothing
    // is left connected to nothing.
    expect(made.unwired).toEqual([]);

    const snapshot = getState().snapshot;
    const conversion = Object.values(snapshot.nodes).find(
      (node) => node.kind === 'compute' && (node.config as { op?: string }).op === 'toDate',
    );
    expect(conversion).toBeDefined();

    // And it sits between the field and the column, rather than beside them.
    const wires = Object.values(snapshot.wires);
    expect(wires.some((wire) => wire.to.nodeId === conversion!.id)).toBe(true);
    expect(
      wires.some(
        (wire) => wire.from.nodeId === conversion!.id && wire.to.portId === 'pt_col_due_at',
      ),
    ).toBe(true);
  });

  it('makes components a designer can edit, not a special element', async () => {
    await connected();
    const frame = generateForm('notes')!.frameId;
    const snapshot = getState().snapshot;

    // Nothing here is a "Form": the vocabulary did not grow to make this possible.
    expect(snapshot.components[frame]!.type).toBe('Frame');
    for (const id of snapshot.components[frame]!.children ?? []) {
      expect(['Text', 'TextField', 'NumberField', 'Checkbox', 'DateField', 'Button']).toContain(
        snapshot.components[id]!.type,
      );
    }
  });

  it('compiles: the route writes the row the fields filled in', async () => {
    await connected();
    generateForm('notes');

    const files = compile(getState().snapshot).files;
    const route = files.find((file) => file.path.startsWith('api/'))!;
    expect(route.content).toContain('INSERT INTO \\"notes\\"');

    const home = files.find((file) => file.path === 'src/artboards/Home.tsx')!;
    expect(home.content).toContain('type="checkbox"');
    expect(home.content).toContain('type="date"');
  });

  it('says nothing to build when every column is filled in by the database', async () => {
    __resetStore();
    addArtboard('Home');
    vi.stubGlobal('fetch', async (input: RequestInfo) =>
      String(input).includes('introspect-sql')
        ? new Response(
            JSON.stringify({
              ok: true,
              rows: [COLUMN('events', 'id', 'uuid', { is_primary: true, column_default: 'x' })],
            }),
          )
        : new Response(JSON.stringify({ ok: true })),
    );
    await connectPostgres({ connectionString: 'postgresql://app:pw@db:5432/app' });

    expect(generateForm('events')).toBeUndefined();
  });
});
