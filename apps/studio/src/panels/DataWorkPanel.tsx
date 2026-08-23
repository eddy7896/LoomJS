import { useState } from 'react';
import { useEditor } from '../state/useEditor';
import {
  addDbStep,
  addQueryStep,
  canRunSql,
  connectedTables,
  routeContaining,
} from '../state/connectors';
import { addGraphNode } from '../state/graph';
import { generateForm, generateTable } from '../state/forms';

/**
 * The work you do *with* data, in the tab that holds the data (D9).
 *
 * These lived in the Nodes palette, next to Compute and Compare, which put reading a table three
 * clicks and one mode switch away from the schema that says what the tables are. A designer
 * thinking about data was reading one panel and clicking in another.
 *
 * The Nodes palette keeps what is not about a table — API routes, logic, values — so nothing here
 * duplicates it. What moved is the seven things you can do to a table, the written statement, and
 * the two elements that are generated *from* a table.
 */

/** The seven, in the order they get reached for. */
const OPERATIONS = [
  ['select', 'Read rows'],
  ['insert', 'Insert row'],
  ['update', 'Update row'],
  ['delete', 'Delete row'],
  ['count', 'Count rows'],
  ['upsert', 'Save row'],
  ['aggregate', 'Total a column'],
] as const;

export function DataWorkPanel() {
  const snapshot = useEditor((s) => s.snapshot);
  const selection = useEditor((s) => s.selection);
  const tables = connectedTables(snapshot);
  const [table, setTable] = useState('');
  const [unwired, setUnwired] = useState<{ column: string; reason: string }[]>([]);

  if (tables.length === 0) return null;
  const chosen = table || tables[0]!.name;

  /**
   * The route a step joins.
   *
   * A selected route, or the route holding whatever step is selected — adding a step selects that
   * step, so without the second case a second step would start a second route, and two routes
   * doing one job is not what anybody drew.
   */
  const currentRoute = ((): string | undefined => {
    if (selection?.kind !== 'node') return undefined;
    if (snapshot.nodes[selection.id]?.category === 'api') return selection.id;
    return routeContaining(snapshot, selection.id);
  })();

  // Server work lives inside an API route. A designer who has not made one yet is not doing
  // something wrong, so the step brings its own rather than refusing — the route is the same node
  // it would have been, made one click earlier.
  const routeFor = (): string => currentRoute ?? addGraphNode('api', 'route');

  const inRoute = currentRoute ? (snapshot.nodes[currentRoute]?.name ?? 'the route') : undefined;

  return (
    <>
      <section className="palette__section" data-testid="data-steps">
        <div className="palette__head">Steps</div>
        <select
          className="palette__select"
          value={table}
          onChange={(event) => setTable(event.target.value)}
          aria-label="Table"
        >
          {tables.map((candidate) => (
            <option key={candidate.name} value={candidate.name}>
              {candidate.name}
            </option>
          ))}
        </select>

        <p className="panel__hint">
          {inRoute
            ? `Goes into ${inRoute}, which runs on the server.`
            : 'Makes an API route to run it on the server.'}
        </p>

        {OPERATIONS.map(([operation, label]) => (
          <button
            key={operation}
            className="palette__item"
            onClick={() => addDbStep(routeFor(), chosen, operation)}
          >
            + {label}
          </button>
        ))}

        {/* Where the seven stop: a join, a group-by, anything the vocabulary would have to become
            SQL to say. Only offered on a connection that can run a statement. */}
        {canRunSql(snapshot) ? (
          <button className="palette__item" onClick={() => addQueryStep(routeFor())}>
            + Query (SQL)
          </button>
        ) : null}
      </section>

      <section className="palette__section" data-testid="data-elements">
        <div className="palette__head">On the screen</div>
        <button
          className="palette__item"
          data-testid="generate-table"
          onClick={() => generateTable(chosen)}
        >
          + Table of {chosen}
        </button>
        <button
          className="palette__item"
          data-testid="generate-form"
          onClick={() => setUnwired(generateForm(chosen)?.unwired ?? [])}
        >
          + Form for {chosen}
        </button>

        {/* A field wired to nothing looks finished and is not, so what could not be wired is said
            here rather than left to be discovered by an empty column (D8). */}
        {unwired.length > 0 ? (
          <p className="panel__hint" data-testid="form-unwired">
            {unwired.map((entry) => entry.column).join(', ')} could not be wired: {unwired[0]!.reason}{' '}
            Wire it by hand in Nodes, or store it as text.
          </p>
        ) : null}
      </section>
    </>
  );
}
