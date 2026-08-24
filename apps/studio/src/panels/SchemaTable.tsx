import { useState } from 'react';
import type { TableSchema } from '@loom/connectors';
import { TableEditor } from './SchemaEditor';

/**
 * A table's columns, as a table.
 *
 * The schema is the vocabulary a designer builds against — which columns exist, what each one
 * holds, which one is the identity, and which ones a form has to ask for. A list of names with a
 * count beside it said none of that, so every question got answered by opening a node and
 * reading a dropdown.
 *
 * A key and a generated column are marked rather than merely typed: those two facts decide what
 * an insert form contains, so they are the ones worth seeing without clicking.
 */
export function SchemaTable({ table }: { table: TableSchema }) {
  return (
    <table className="schema" data-testid={`schema-${table.name}`}>
      <thead>
        <tr>
          <th>Column</th>
          <th>Type</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {table.columns.map((column) => (
          <tr key={column.name}>
            <td className="schema__name">{column.name}</td>
            <td className="schema__type mono">{column.type.kind}</td>
            <td className="schema__flags">
              {column.primaryKey ? (
                <span className="schema__flag" title="Primary key">
                  key
                </span>
              ) : null}
              {column.generated ? (
                <span className="schema__flag" title="The database fills this in">
                  auto
                </span>
              ) : null}
              {column.required && !column.generated ? (
                <span className="schema__flag schema__flag--required" title="Required">
                  req
                </span>
              ) : null}
              {column.unique && !column.primaryKey ? (
                <span className="schema__flag" title="No two rows share this">
                  uniq
                </span>
              ) : null}
              {/* An index is what makes a filter on this column a search rather than a scan. */}
              {column.indexed && !column.primaryKey ? (
                <span className="schema__flag" title="Indexed">
                  idx
                </span>
              ) : null}
              {column.references ? (
                <span
                  className="schema__flag schema__flag--link"
                  title={`Points at ${column.references.table}.${column.references.column}`}
                >
                  → {column.references.table}
                </span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The connected tables, each one opening to show its columns — and, where the connection allows
 * it, to change them (`docs/15-schema.md`).
 */
export function SchemaList({
  tables,
  editing,
}: {
  tables: readonly TableSchema[];
  editing?: 'sql' | 'shape';
}) {
  const [open, setOpen] = useState<string | undefined>();

  return (
    <ul className="tables">
      {tables.map((table) => (
        <li key={table.name}>
          <button
            className="table-row table-row--button"
            data-testid={`table-${table.name}`}
            aria-expanded={open === table.name}
            onClick={() => setOpen((current) => (current === table.name ? undefined : table.name))}
          >
            <span>
              <span className="table-row__caret">{open === table.name ? '▾' : '▸'}</span>{' '}
              {table.name}
            </span>
            <span className="mono id">{table.columns.length} cols</span>
          </button>
          {open === table.name ? (
            <>
              <SchemaTable table={table} />
              {editing ? <TableEditor table={table} shape={editing === 'shape'} /> : null}
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
