import { describe, expect, it } from 'vitest';
import { applyOps, type Snapshot } from '@loom/ir';
import { createDbNode, dbNodePorts, filterPortId, ID_PORT, primaryKeyOf } from '@loom/connectors';
import { compile } from '../src/index';
import { crudSnapshot, NOTES_TABLE } from './fixtures';

/**
 * CRUD and search (P4).
 *
 * The load-bearing ideas: a row identity comes from the **primary key in the cached schema**, not
 * from something a designer supplies; a search is a filter whose value arrives as a route input,
 * so it needs no machinery of its own; and a write makes a read of the same table stale.
 */

const fileAt = (snapshot: Snapshot, path: string): string => {
  const file = compile(snapshot).files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`no ${path} emitted`);
  return file.content;
};

const home = (snapshot: Snapshot): string => fileAt(snapshot, 'src/artboards/Home.tsx');

describe('a row identity comes from the schema', () => {
  it('gives update and delete an id port typed as the key', () => {
    const key = primaryKeyOf(NOTES_TABLE)!;
    for (const operation of ['update', 'delete'] as const) {
      const ports = dbNodePorts(NOTES_TABLE, operation);
      const id = ports.find((port) => port.id === ID_PORT);
      expect(id, operation).toBeDefined();
      expect(id!.name, operation).toBe(key.name);
      expect(id!.type, operation).toEqual(key.type);
    }
  });

  it('makes every column optional on an update', () => {
    // Changing one field is the common case; demanding the rest would make an edit form re-send
    // data it never showed.
    const ports = dbNodePorts(NOTES_TABLE, 'update');
    const title = ports.find((port) => port.name === 'title')!;
    expect(title.type.kind).toBe('optional');

    // The same column is required on an insert, because there is nothing to fall back to.
    const inserting = dbNodePorts(NOTES_TABLE, 'insert').find((port) => port.name === 'title')!;
    expect(inserting.type.kind).not.toBe('optional');
  });

  it('a delete asks for the identity and nothing else', () => {
    const ports = dbNodePorts(NOTES_TABLE, 'delete').filter((port) => port.direction === 'in');
    expect(ports.map((port) => port.id)).toEqual([ID_PORT]);
  });
});

describe('what update and delete emit', () => {
  const project = crudSnapshot();

  it('finds the row by its key and patches the rest', () => {
    const api = fileAt(project, 'api/editnote.ts');
    // The parts, not the exact chain: a tenanted project adds an organisation clause between
    // the key and the select, and asserting the whole line would break on a change to a
    // different feature.
    expect(api).toContain('.update(patch)');
    expect(api).toContain('.eq("id", id)');
    expect(api).toContain('.single()');
    // Sending the key back as a column would ask the database to rewrite the row it is finding by.
    expect(api).toContain('if (column !== "id" && entry !== undefined) patch[column] = entry;');
  });

  it('refuses an update with no row to change', () => {
    expect(fileAt(project, 'api/editnote.ts')).toContain('Update needs the row it is changing.');
  });

  it('deletes by key and returns what it removed', () => {
    const api = fileAt(project, 'api/removenote.ts');
    expect(api).toContain('.delete()');
    expect(api).toContain('.eq("id", id)');
    expect(api).toContain('.single()');
    expect(api).toContain('Delete needs the row it is removing.');
  });

  it('refuses a table with no primary key, rather than rewriting every row', () => {
    const keyless = {
      name: 'events',
      columns: [
        {
          name: 'label',
          type: { kind: 'text' as const },
          required: true,
          primaryKey: false,
          generated: false,
        },
      ],
    };
    const broken = applyOps(crudSnapshot(), [
      {
        type: 'setNodeConfig',
        nodeId: 'nd_upd',
        config: { connectorId: 'cn_supabase', table: 'events', operation: 'update' },
        ports: dbNodePorts(keyless, 'update'),
      },
    ]);
    expect(() => compile(broken)).toThrow(/no primary key/);
  });
});

describe('search is a filter whose value the screen supplies', () => {
  const project = crudSnapshot({ search: true });

  it('turns the filter into a port, and the port into a route input', () => {
    const read = project.nodes.nd_read!;
    expect(read.ports.some((port) => port.id === filterPortId('title'))).toBe(true);
  });

  it('narrows the query with what was typed', () => {
    const api = fileAt(project, 'api/notes.ts');
    expect(api).toContain('query = query.ilike("title", "%" + String(input["title"]) + "%");');
  });

  it('treats an empty box as no narrowing at all', () => {
    // Otherwise the list would be blank before anyone had typed in it.
    const api = fileAt(project, 'api/notes.ts');
    expect(api).toContain(
      'input["title"] !== undefined && input["title"] !== null && input["title"] !== ""',
    );
  });

  it('re-reads as the person types, because the input is a dependency', () => {
    expect(home(project)).toContain('field_cp_search');
  });

  it('compares against a fixed value without asking for an input', () => {
    const select = crudSnapshot().nodes.nd_select!;
    const fixed = applyOps(crudSnapshot(), [
      {
        type: 'setNodeConfig',
        nodeId: 'nd_select',
        config: {
          ...(select.config as Record<string, unknown>),
          filters: [{ column: 'title', operator: 'equals', source: 'value', value: 'first note' }],
        },
        ports: dbNodePorts(NOTES_TABLE, 'select', []),
      },
    ]);
    expect(fileAt(fixed, 'api/notes.ts')).toContain('query = query.eq("title", "first note");');
  });
});

describe('a write invalidates a read of the same table', () => {
  const code = home(crudSnapshot());

  it('keeps one counter for the table', () => {
    expect(code.match(/const \[rows_notes, set_rows_notes\] = useState\(0\)/g)).toHaveLength(1);
  });

  it('bumps it from every route that changes the table', () => {
    // Insert, update and delete all make the list on screen out of date.
    expect(code.match(/set_rows_notes\(\(n\) => n \+ 1\)/g)).toHaveLength(3);
  });

  it('names it in the reactive read, which is what makes the list catch up', () => {
    expect(code).toMatch(
      /useEffect\(\(\) => \{\s*void run_nd_read\(\);\s*\}, \[run_nd_read, rows_notes\]\)/,
    );
  });

  it('emits no counter when nothing writes the table it reads', () => {
    const readOnly = applyOps(crudSnapshot(), [
      // The steps go with their routes: a database node outside a route body has nowhere to run.
      { type: 'removeNode', nodeId: 'nd_write' },
      { type: 'removeNode', nodeId: 'nd_insert' },
      { type: 'removeNode', nodeId: 'nd_edit' },
      { type: 'removeNode', nodeId: 'nd_upd' },
      { type: 'removeNode', nodeId: 'nd_remove' },
      { type: 'removeNode', nodeId: 'nd_del' },
      // And the buttons that fired them: `applyOp` is the raw edit, so nothing scrubs a handler
      // pointing at a node that has gone. The editor's `removeNode` does that for a designer.
      { type: 'removeComponent', componentId: 'cp_save' },
      { type: 'removeComponent', componentId: 'cp_edit' },
      { type: 'removeComponent', componentId: 'cp_remove' },
    ]);
    expect(home(readOnly)).not.toContain('rows_notes');
  });
});

describe('paging a list', () => {
  it('renders every row when no page size is set', () => {
    const code = home(crudSnapshot());
    expect(code).not.toContain('Previous');
  });

  it('slices the rows and offers the controls', () => {
    const code = home(crudSnapshot({ pageSize: 2 }));
    expect(code).toContain('.slice(current * 2, current * 2 + 2)');
    expect(code).toContain('Previous');
    expect(code).toContain('Next');
  });

  it('never strands you on a page that no longer exists', () => {
    // Deleting the last row of the last page is the case that breaks a naive counter.
    expect(home(crudSnapshot({ pageSize: 2 }))).toContain(
      'Math.min(page_cp_list, pages_page_cp_list - 1)',
    );
  });
});

describe('the four operations are one vocabulary', () => {
  it('names each node after what it does to the table', () => {
    for (const [operation, label] of [
      ['select', 'Read'],
      ['insert', 'Insert'],
      ['update', 'Update'],
      ['delete', 'Delete'],
    ] as const) {
      const node = createDbNode('nd_x', { x: 0, y: 0 }, 'cn', NOTES_TABLE, operation);
      expect(node.name, operation).toBe(`${label} notes`);
      expect(node.kind, operation).toBe(operation);
    }
  });
});
