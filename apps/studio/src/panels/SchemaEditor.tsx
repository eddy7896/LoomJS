import { useState } from 'react';
import {
  COLUMN_TYPES,
  KEY_STYLES,
  ON_DELETE,
  blankTable,
  checkRelation,
  type ColumnSchema,
  type ColumnSpec,
  type ColumnType,
  type KeyStyle,
  type OnDelete,
  type SchemaChange,
  type TableSchema,
} from '@loom/connectors';
import { useEditor } from '../state/useEditor';
import { applySchemaChange, connectedTables, seedTable } from '../state/connectors';

/**
 * Making the data structure (`docs/15-schema.md`).
 *
 * A designer with an idea should not have to leave loom, open a database console and work out what
 * a `timestamptz` is. So tables and columns are made here, in the words the rest of the panel uses
 * — and the types on offer are the closed set the emitter can address, not a text box that accepts
 * anything Postgres has ever had.
 *
 * Dropping something asks for its name to be typed. No dialog with an OK button has ever stopped a
 * column of real data being deleted by a mis-click.
 */

const TYPE_ENTRIES = Object.entries(COLUMN_TYPES) as [ColumnType, (typeof COLUMN_TYPES)[ColumnType]][];

/** The loom type a column already has, mapped back to the choice that produced it. */
function typeOf(column: ColumnSchema): ColumnType {
  const kind = column.type.kind;
  if (kind === 'number') return 'wholeNumber';
  if (kind === 'boolean') return 'boolean';
  if (kind === 'date') return 'timestamp';
  if (kind === 'record' || kind === 'list') return 'structured';
  return 'text';
}

/** Shared plumbing: apply a change, keep the error where it can be read. */
function useApply() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const apply = async (change: SchemaChange): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    const result = await applySchemaChange(change);
    setBusy(false);
    if (!result.ok) setError(result.error);
    return result.ok;
  };

  return { apply, busy, error, setError };
}

/** The name-and-type row that both the new-table form and add-column use. */
function ColumnFields({
  column,
  onChange,
  prefix,
}: {
  column: ColumnSpec;
  onChange: (next: ColumnSpec) => void;
  prefix: string;
}) {
  return (
    <>
      <input
        data-testid={`${prefix}-name`}
        placeholder="Column name"
        value={column.name}
        onChange={(event) => onChange({ ...column, name: event.target.value })}
      />
      <select
        data-testid={`${prefix}-type`}
        value={column.type}
        onChange={(event) => onChange({ ...column, type: event.target.value as ColumnType })}
      >
        {TYPE_ENTRIES.map(([key, entry]) => (
          <option key={key} value={key}>
            {entry.label}
          </option>
        ))}
      </select>
      <label className="schema-edit__check">
        <input
          type="checkbox"
          data-testid={`${prefix}-required`}
          checked={Boolean(column.required)}
          onChange={(event) => onChange({ ...column, required: event.target.checked })}
        />
        Required
      </label>
      <label className="schema-edit__check">
        <input
          type="checkbox"
          data-testid={`${prefix}-unique`}
          checked={Boolean(column.unique)}
          onChange={(event) => onChange({ ...column, unique: event.target.checked })}
        />
        No duplicates
      </label>
      <input
        data-testid={`${prefix}-default`}
        placeholder="Default (optional)"
        value={column.defaultValue ?? ''}
        onChange={(event) => onChange({ ...column, defaultValue: event.target.value })}
      />
    </>
  );
}

const blankColumn = (): ColumnSpec => ({ name: '', type: 'text' });

/** A new table: its name, how it identifies rows, and the columns it starts with. */
export function NewTable({ shape, onDone }: { shape: boolean; onDone: () => void }) {
  const [table, setTable] = useState(blankTable());
  const { apply, busy, error } = useApply();

  return (
    <div className="schema-edit" data-testid="new-table">
      <label className="field field--stacked">
        <span className="field__label">{shape ? 'Collection name' : 'Table name'}</span>
        <input
          data-testid="new-table-name"
          value={table.name}
          placeholder="notes"
          onChange={(event) => setTable({ ...table, name: event.target.value })}
        />
      </label>

      {shape ? null : (
        <label className="field field--stacked">
          <span className="field__label">Row id</span>
          <select
            data-testid="new-table-key"
            value={table.key}
            onChange={(event) => setTable({ ...table, key: event.target.value as KeyStyle })}
          >
            {Object.entries(KEY_STYLES).map(([key, entry]) => (
              <option key={key} value={key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {table.columns.map((column, index) => (
        <div key={index} className="schema-edit__row">
          <ColumnFields
            prefix={`new-column-${index}`}
            column={column}
            onChange={(next) =>
              setTable({
                ...table,
                columns: table.columns.map((entry, at) => (at === index ? next : entry)),
              })
            }
          />
          <button
            title="Remove"
            onClick={() =>
              setTable({ ...table, columns: table.columns.filter((_, at) => at !== index) })
            }
          >
            ×
          </button>
        </div>
      ))}

      <button
        data-testid="new-table-add-column"
        onClick={() => setTable({ ...table, columns: [...table.columns, blankColumn()] })}
      >
        + Column
      </button>

      {error ? <p className="connect-form__error">{error}</p> : null}

      <div className="row-actions">
        <button
          disabled={busy}
          data-testid="create-table"
          onClick={() => {
            void apply({ kind: 'createTable', table }).then((ok) => {
              if (ok) onDone();
            });
          }}
        >
          {busy ? 'Making…' : shape ? 'Add collection' : 'Create table'}
        </button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * What a column points at, and whether the database has an index on it (D6).
 *
 * A relation is the fact that makes a picker possible instead of asking someone to paste a uuid,
 * and an index is the difference between a search and a table scan — so both are edited where the
 * column is, rather than in a diagram somewhere else.
 */
function ColumnLinks({
  table,
  column,
  onApply,
  busy,
}: {
  table: string;
  column: ColumnSchema;
  onApply: (change: SchemaChange) => void;
  busy: boolean;
}) {
  const snapshot = useEditor((s) => s.snapshot);
  const [onDelete, setOnDelete] = useState<OnDelete>('restrict');

  // Only a column that identifies one row can be pointed at, so only those tables are offered.
  const targets = connectedTables(snapshot)
    .filter((candidate) => candidate.name !== table)
    .map((candidate) => ({
      table: candidate,
      key: candidate.columns.find((entry) => entry.primaryKey),
    }))
    .filter((entry): entry is { table: TableSchema; key: ColumnSchema } => Boolean(entry.key));

  if (column.references) {
    return (
      <span className="schema-edit__link">
        → {column.references.table}.{column.references.column}
        <button
          data-testid={`column-${column.name}-unlink`}
          disabled={busy}
          title="Remove the link"
          onClick={() => onApply({ kind: 'dropRelation', table, column: column.name })}
        >
          ×
        </button>
      </span>
    );
  }

  if (targets.length === 0) return null;

  return (
    <span className="schema-edit__link">
      <select
        data-testid={`column-${column.name}-link`}
        value=""
        disabled={busy}
        onChange={(event) => {
          const target = targets.find((entry) => entry.table.name === event.target.value);
          if (!target) return;
          onApply({
            kind: 'addRelation',
            table,
            column: column.name,
            target: target.table.name,
            targetColumn: target.key.name,
            onDelete,
          });
        }}
      >
        <option value="">Links to…</option>
        {targets.map((entry) => (
          <option key={entry.table.name} value={entry.table.name}>
            {entry.table.name}
          </option>
        ))}
      </select>
      <select
        data-testid={`column-${column.name}-ondelete`}
        value={onDelete}
        disabled={busy}
        title="When the row it points at is deleted"
        onChange={(event) => setOnDelete(event.target.value as OnDelete)}
      >
        {Object.entries(ON_DELETE).map(([key, entry]) => (
          <option key={key} value={key}>
            {entry.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Everything that can be done to a table that already exists. */
export function TableEditor({ table, shape }: { table: TableSchema; shape: boolean }) {
  const { apply, busy, error, setError } = useApply();
  const [adding, setAdding] = useState<ColumnSpec | undefined>();
  const [renaming, setRenaming] = useState<string | undefined>();
  const [dropping, setDropping] = useState<{ column?: string } | undefined>();
  const [typed, setTyped] = useState('');
  const [seeding, setSeeding] = useState(false);

  const target = dropping?.column ?? table.name;
  const change: SchemaChange | undefined = dropping
    ? dropping.column
      ? { kind: 'dropColumn', table: table.name, column: dropping.column }
      : { kind: 'dropTable', table: table.name }
    : undefined;

  return (
    <div className="schema-edit" data-testid={`edit-${table.name}`}>
      {adding ? (
        <div className="schema-edit__row">
          <ColumnFields prefix="add-column" column={adding} onChange={setAdding} />
          <button
            disabled={busy}
            data-testid="save-column"
            onClick={() => {
              void apply({ kind: 'addColumn', table: table.name, column: adding }).then((ok) => {
                if (ok) setAdding(undefined);
              });
            }}
          >
            Add
          </button>
          <button onClick={() => setAdding(undefined)}>×</button>
        </div>
      ) : null}

      {renaming !== undefined ? (
        <div className="schema-edit__row">
          <input
            data-testid="rename-table-name"
            value={renaming}
            onChange={(event) => setRenaming(event.target.value)}
          />
          <button
            disabled={busy}
            data-testid="save-rename"
            onClick={() => {
              void apply({ kind: 'renameTable', from: table.name, to: renaming }).then((ok) => {
                if (ok) setRenaming(undefined);
              });
            }}
          >
            Rename
          </button>
          <button onClick={() => setRenaming(undefined)}>×</button>
        </div>
      ) : null}

      {/* Losing data on purpose: the name has to be typed, and what goes with it is said out
          loud rather than implied by an icon. */}
      {dropping ? (
        <div className="schema-edit__danger" data-testid="confirm-drop">
          <p>
            {dropping.column
              ? `Dropping “${dropping.column}” deletes what every row holds in it.`
              : `Dropping “${table.name}” deletes the table and every row in it.`}{' '}
            Type its name to confirm.
          </p>
          <input
            data-testid="confirm-name"
            value={typed}
            placeholder={target}
            onChange={(event) => setTyped(event.target.value)}
          />
          <div className="row-actions">
            <button
              disabled={busy || typed.trim() !== target || !change}
              data-testid="confirm-drop-go"
              onClick={() => {
                if (!change) return;
                void apply(change).then((ok) => {
                  if (ok) {
                    setDropping(undefined);
                    setTyped('');
                  }
                });
              }}
            >
              Drop {target}
            </button>
            <button
              onClick={() => {
                setDropping(undefined);
                setTyped('');
                setError(undefined);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="connect-form__error">{error}</p> : null}

      <div className="row-actions">
        <button data-testid="add-column" onClick={() => setAdding(blankColumn())}>
          + Column
        </button>
        {/* A blank table makes every screen look broken while it is being designed (D7). */}
        {shape ? null : (
          <button
            data-testid="seed-table"
            disabled={busy}
            title="Add five rows to design against"
            onClick={() => {
              setSeeding(true);
              void seedTable(table.name).then((result) => {
                setSeeding(false);
                if (!result.ok) setError(result.error);
              });
            }}
          >
            {seeding ? 'Filling…' : '+ Sample rows'}
          </button>
        )}
        <button data-testid="rename-table" onClick={() => setRenaming(table.name)}>
          Rename
        </button>
        <button data-testid="drop-table" onClick={() => setDropping({})}>
          Drop {shape ? 'collection' : 'table'}
        </button>
      </div>

      <div className="schema-edit__columns">
        {table.columns
          .filter((column) => !column.primaryKey)
          .map((column) => (
            <ColumnControls
              key={column.name}
              table={table.name}
              column={column}
              shape={shape}
              onDrop={() => setDropping({ column: column.name })}
            />
          ))}
      </div>
    </div>
  );
}

/** One existing column: what can be changed about it without retyping the whole table. */
function ColumnControls({
  table,
  column,
  shape,
  onDrop,
}: {
  table: string;
  column: ColumnSchema;
  shape: boolean;
  onDrop: () => void;
}) {
  const { apply, busy, error } = useApply();
  const [name, setName] = useState(column.name);
  const [linkError, setLinkError] = useState<string | undefined>();
  const tables = connectedTables(useEditor((s) => s.snapshot));

  return (
    <div className="schema-edit__row" data-testid={`column-${column.name}`}>
      <input
        data-testid={`column-${column.name}-name`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name.trim() && name.trim() !== column.name) {
            void apply({ kind: 'renameColumn', table, from: column.name, to: name.trim() }).then(
              (ok) => {
                if (!ok) setName(column.name);
              },
            );
          }
        }}
      />

      {/* A shape loom keeps has no rules to enforce, so it offers none. */}
      {shape ? null : (
        <>
          <select
            data-testid={`column-${column.name}-type`}
            value={typeOf(column)}
            disabled={busy}
            onChange={(event) => {
              void apply({
                kind: 'retypeColumn',
                table,
                column: column.name,
                to: event.target.value as ColumnType,
              });
            }}
          >
            {TYPE_ENTRIES.map(([key, entry]) => (
              <option key={key} value={key}>
                {entry.label}
              </option>
            ))}
          </select>

          <label className="schema-edit__check">
            <input
              type="checkbox"
              data-testid={`column-${column.name}-required`}
              checked={column.required}
              disabled={busy}
              onChange={(event) => {
                void apply({
                  kind: 'setRequired',
                  table,
                  column: column.name,
                  required: event.target.checked,
                });
              }}
            />
            Required
          </label>
        </>
      )}

      {shape ? null : (
        <>
          <label className="schema-edit__check">
            <input
              type="checkbox"
              data-testid={`column-${column.name}-indexed`}
              checked={Boolean(column.indexed)}
              disabled={busy}
              onChange={(event) => {
                void apply({
                  kind: event.target.checked ? 'addIndex' : 'dropIndex',
                  table,
                  column: column.name,
                });
              }}
            />
            Indexed
          </label>

          <ColumnLinks
            table={table}
            column={column}
            busy={busy}
            onApply={(change) => {
              // The database's refusal is about operator classes; this one is in words.
              if (change.kind === 'addRelation') {
                const target = tables
                  .find((candidate) => candidate.name === change.target)
                  ?.columns.find((entry) => entry.name === change.targetColumn);
                if (target) {
                  try {
                    checkRelation(column, target);
                  } catch (problem) {
                    setLinkError((problem as Error).message);
                    return;
                  }
                }
              }
              setLinkError(undefined);
              void apply(change);
            }}
          />
        </>
      )}

      <button data-testid={`column-${column.name}-drop`} onClick={onDrop} title="Drop column">
        ×
      </button>

      {error || linkError ? (
        <p className="connect-form__error">{error ?? linkError}</p>
      ) : null}
    </div>
  );
}
