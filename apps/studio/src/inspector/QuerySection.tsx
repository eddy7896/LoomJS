import { useEffect, useState } from 'react';
import { queryParamNames, type TableSchema } from '@loom/connectors';
import { useEditor } from '../state/useEditor';
import { connectedTables, setQuerySql } from '../state/connectors';
import { SchemaTable } from '../panels/SchemaTable';

/**
 * The query editor (D2).
 *
 * A statement is written here rather than assembled from dropdowns, because past a join or a
 * group-by the dropdowns become a worse SQL. What the editor keeps is the rule that matters:
 * `:name` is a **parameter**, and it becomes an input port on the node — so the value arrives
 * from the request at run time and never as text inside the statement.
 *
 * The schema sits underneath it, because the thing you need while writing a statement is the
 * column names, and going to another panel to read them is how typos get made.
 */
export function QuerySection({ nodeId }: { nodeId: string }) {
  const snapshot = useEditor((s) => s.snapshot);
  const node = snapshot.nodes[nodeId];
  const config = (node?.config ?? {}) as { sql?: string; returns?: string };
  const stored = config.sql ?? '';

  // Typed locally and committed on blur: retyping ports on every keystroke would renumber the
  // route's inputs while a half-written `:na` was still on screen.
  const [draft, setDraft] = useState(stored);
  useEffect(() => setDraft(stored), [stored]);

  const tables = connectedTables(snapshot);
  const [showing, setShowing] = useState<string | undefined>();
  const params = queryParamNames(draft);
  const table: TableSchema | undefined = tables.find((candidate) => candidate.name === showing);

  if (!node) return null;

  return (
    <section className="field-group">
      <h3 className="field-group__title">Statement</h3>

      <textarea
        className="query-editor mono"
        data-testid="query-sql"
        spellCheck={false}
        rows={6}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== stored) setQuerySql(nodeId, draft);
        }}
      />

      <p className="panel__hint">
        {params.length > 0 ? (
          <>
            Asks for{' '}
            {params.map((name, index) => (
              <span key={name}>
                {index > 0 ? ', ' : ''}
                <code className="mono">:{name}</code>
              </span>
            ))}
            . Each one is an input on this step, sent as a parameter.
          </>
        ) : (
          <>
            Write <code className="mono">:name</code> where a value goes — it becomes an input on
            this step and travels as a parameter.
          </>
        )}
      </p>

      <label className="field">
        <span className="field__label">Answers with</span>
        <select
          data-testid="query-returns"
          value={config.returns === 'one' ? 'one' : 'many'}
          onChange={(event) => setQuerySql(nodeId, draft, event.target.value as 'one' | 'many')}
        >
          <option value="many">All rows</option>
          <option value="one">The first row</option>
        </select>
      </label>

      {tables.length > 0 ? (
        <>
          <label className="field">
            <span className="field__label">Schema</span>
            <select
              data-testid="query-schema-table"
              value={showing ?? ''}
              onChange={(event) => setShowing(event.target.value || undefined)}
            >
              <option value="">Pick a table…</option>
              {tables.map((candidate) => (
                <option key={candidate.name} value={candidate.name}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          {table ? <SchemaTable table={table} /> : null}
        </>
      ) : null}
    </section>
  );
}

/** The table a database step works on, shown where the step is edited rather than a panel away. */
export function TableSchemaSection({ tableName }: { tableName: string }) {
  const snapshot = useEditor((s) => s.snapshot);
  const [open, setOpen] = useState(false);
  const table = connectedTables(snapshot).find((candidate) => candidate.name === tableName);
  if (!table) return null;

  return (
    <section className="field-group">
      <h3 className="field-group__title">
        <button
          className="field-group__toggle"
          data-testid="toggle-schema"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '▾' : '▸'} {table.name} · {table.columns.length} columns
        </button>
      </h3>
      {open ? <SchemaTable table={table} /> : null}
    </section>
  );
}
