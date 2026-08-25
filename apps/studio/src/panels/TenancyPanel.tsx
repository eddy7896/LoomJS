import { useEditor } from '../state/useEditor';
import { setTenancy } from '../state/store';
import type { TableSchema } from '@loom/connectors';

/**
 * Organisations (O1, `docs/V1-COMPLETION.md`).
 *
 * It sits in Data because that is what it is about: which of *this project's* tables holds the
 * organisations, which says who belongs to which, and which rows belong to one. loom does not
 * invent a tenancy model — it names tables the project already has, the same way every connector
 * maps what is there rather than wrapping it.
 *
 * The scoped tables are **ticked, not guessed**. Inferring them from which tables happen to have
 * the column is the sort of magic that fails two ways, both of which look like a data problem and
 * neither of which is: guess too widely and a shared lookup table returns nothing for everybody;
 * guess too narrowly and one table quietly serves every organisation's rows to everyone.
 */
export function TenancyPanel({ tables }: { tables: readonly TableSchema[] }) {
  const snapshot = useEditor((s) => s.snapshot);
  const tenancy = snapshot.tenancy;

  const names = tables.map((table) => table.name).sort();
  if (names.length === 0) return null;

  if (!tenancy) {
    return (
      <section className="field-group" data-testid="tenancy-panel">
        <h3 className="field-group__title">Organisations</h3>
        <p className="panel__hint">
          For an app where rows belong to a school, a company or a workspace — and one organisation
          must never read another&apos;s.
        </p>
        <button
          data-testid="enable-tenancy"
          onClick={() =>
            setTenancy({
              orgTable: names[0]!,
              membershipTable: names[1] ?? names[0]!,
              tenantColumn: 'org_id',
              roleColumn: 'role',
              scopedTables: [],
            })
          }
        >
          Organise by tenant
        </button>
      </section>
    );
  }

  const scoped = tenancy.scopedTables ?? [];
  const toggle = (table: string): void =>
    setTenancy({
      ...tenancy,
      scopedTables: scoped.includes(table)
        ? scoped.filter((name) => name !== table)
        : [...scoped, table],
    });

  const pick = (key: 'orgTable' | 'membershipTable') => (value: string) =>
    setTenancy({ ...tenancy, [key]: value });

  return (
    <section className="field-group" data-testid="tenancy-panel">
      <h3 className="field-group__title">Organisations</h3>

      <div className="field">
        <span className="field__label">The organisations</span>
        <select
          data-testid="tenancy-org-table"
          value={tenancy.orgTable}
          onChange={(e) => pick('orgTable')(e.target.value)}
        >
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <span className="field__label">Who belongs to which</span>
        <select
          data-testid="tenancy-membership-table"
          value={tenancy.membershipTable}
          onChange={(e) => pick('membershipTable')(e.target.value)}
        >
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <span className="field__label">The column naming the owner</span>
        <input
          data-testid="tenancy-column"
          value={tenancy.tenantColumn}
          onChange={(e) => setTenancy({ ...tenancy, tenantColumn: e.target.value })}
        />
      </div>

      <p className="panel__hint">
        Rows in these tables belong to an organisation. A read returns only the current one&apos;s,
        and a new row is filed into it.
      </p>

      {names.map((name) => (
        <label className="field field--check" key={name}>
          <input
            type="checkbox"
            data-testid={`tenancy-scope-${name}`}
            checked={scoped.includes(name)}
            onChange={() => toggle(name)}
          />
          <span>{name}</span>
        </label>
      ))}

      {/*
        Said plainly rather than implied. Until the database itself refuses (O3), this narrows
        what the app asks for — it does not stop somebody asking the database directly.
      */}
      <p className="panel__hint">
        This scopes what the app asks for. It is not yet enforced by the database, so treat it as
        correct behaviour rather than as a boundary until row-level security is emitted.
      </p>

      <button data-testid="disable-tenancy" onClick={() => setTenancy(undefined)}>
        Not organised by tenant
      </button>
    </section>
  );
}
