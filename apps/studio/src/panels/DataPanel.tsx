import { useEffect, useState } from 'react';
import { MODULES, POSTGRES_MANIFEST, SUPABASE_MANIFEST } from '@loom/connectors';
import { useEditor } from '../state/useEditor';
import {
  connectPostgres,
  connectSupabase,
  connectedTables,
  connection,
  connectionUrl,
  disconnect,
  hasEnv,
  readServerEnv,
  type ServerEnv,
} from '../state/connectors';
import { SchemaList } from './SchemaTable';

/**
 * Connections live here. The panel can write credentials and prove they work; it can never read
 * a stored value back out (`docs/specs/connector-credentials.md`).
 *
 * Two ways to reach data, and the choice is only about *reach*: PostgREST over HTTP, or a socket
 * to the database itself. Whichever is chosen, what comes back is tables with typed columns, and
 * every node downstream is the same.
 */
export function DataPanel() {
  const snapshot = useEditor((s) => s.snapshot);
  const attached = connection(snapshot);
  const url = connectionUrl(snapshot);
  const tables = connectedTables(snapshot);

  const [open, setOpen] = useState(false);
  const [moduleId, setModuleId] = useState('supabase');
  const [form, setForm] = useState({ url: '', anonKey: '', serviceKey: '' });
  const [sql, setSql] = useState({ connectionString: '', schema: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [serverEnv, setServerEnv] = useState<ServerEnv>({ names: [], values: {} });

  useEffect(() => {
    void readServerEnv().then(setServerEnv);
  }, []);

  // A `.env.local` on the dev server is enough to connect: the anon key reads the schema, and
  // the service role key stays where it is (docs/specs/connector-credentials.md).
  const fromFile = {
    url: serverEnv.values.SUPABASE_URL ?? '',
    anonKey: serverEnv.values.SUPABASE_ANON_KEY ?? '',
    hasServiceKey: serverEnv.names.includes('SUPABASE_SERVICE_ROLE_KEY'),
  };
  const canUseFile = Boolean(fromFile.url && fromFile.anonKey);
  // The value is never sent back to this browser — only the fact that the server has one.
  const hasDatabaseUrl = serverEnv.names.includes('DATABASE_URL');

  const finish = (result: { ok: boolean; error?: string }): void => {
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setForm({ url: '', anonKey: '', serviceKey: '' });
    setSql({ connectionString: '', schema: '' });
  };

  const connect = async (input = form): Promise<void> => {
    setBusy(true);
    setError(undefined);
    finish(await connectSupabase(input));
  };

  const connectSql = async (input = sql): Promise<void> => {
    setBusy(true);
    setError(undefined);
    finish(await connectPostgres(input));
  };

  return (
    <section className="data-panel">
      <div className="panel__head">
        <h2 className="panel__title">Data</h2>
        {attached ? null : (
          <button onClick={() => setOpen((v) => !v)} data-testid="connect-supabase">
            Connect
          </button>
        )}
      </div>

      {attached ? (
        <>
          <div className="connection">
            <span className="dot dot--ok" />
            <span className="connection__url mono">{(url ?? '').replace(/^https?:\/\//, '')}</span>
            <button title="Disconnect" onClick={disconnect}>
              ×
            </button>
          </div>
          <p className="panel__hint">
            {attached.moduleId === 'postgres'
              ? hasDatabaseUrl || hasEnv('DATABASE_URL')
                ? 'Connection string held by the dev server; the project keeps only its name.'
                : 'No connection string on the dev server — reads and writes will fail until you reconnect.'
              : serverEnv.names.includes('SUPABASE_SERVICE_ROLE_KEY') ||
                  hasEnv('SUPABASE_SERVICE_ROLE_KEY')
                ? 'Service role key held by the dev server; the project keeps only its name.'
                : 'No service role key — reads and writes will fail until you reconnect.'}
          </p>
          <SchemaList tables={tables} />
        </>
      ) : null}

      {open && !attached ? (
        <div className="connect-form">
          <div className="connect-form__modules" role="tablist">
            {MODULES.map((module) => (
              <button
                key={module.id}
                role="tab"
                aria-selected={moduleId === module.id}
                className={moduleId === module.id ? 'is-active' : undefined}
                data-testid={`module-${module.id}`}
                onClick={() => {
                  setModuleId(module.id);
                  setError(undefined);
                }}
              >
                {module.label}
              </button>
            ))}
          </div>

          {moduleId === 'postgres' ? (
            <>
              {hasDatabaseUrl ? (
                <>
                  <button
                    disabled={busy}
                    data-testid="use-database-url"
                    onClick={() => void connectSql({ connectionString: '', schema: sql.schema })}
                  >
                    Use DATABASE_URL from .env.local
                  </button>
                  <p className="panel__hint">
                    The dev server holds it and reads the schema for you; it never reaches this
                    browser.
                  </p>
                </>
              ) : null}

              {POSTGRES_MANIFEST.credentials.map((credential) => (
                <label key={credential.name} className="field field--stacked">
                  <span className="field__label">{credential.label}</span>
                  <input
                    type="password"
                    data-testid="connection-string"
                    placeholder="postgresql://user:password@host:5432/database"
                    value={sql.connectionString}
                    onChange={(e) =>
                      setSql((current) => ({ ...current, connectionString: e.target.value }))
                    }
                  />
                  <span className="panel__hint">{credential.hint}</span>
                </label>
              ))}

              {POSTGRES_MANIFEST.config.map((field) => (
                <label key={field.key} className="field field--stacked">
                  <span className="field__label">{field.label}</span>
                  <input
                    value={sql.schema}
                    placeholder={field.placeholder}
                    onChange={(e) => setSql((current) => ({ ...current, schema: e.target.value }))}
                  />
                </label>
              ))}

              {error ? <p className="connect-form__error">{error}</p> : null}

              <button disabled={busy} onClick={() => void connectSql()}>
                {busy ? 'Connecting…' : 'Connect and read schema'}
              </button>
            </>
          ) : (
            <>
              {canUseFile ? (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void connect({ url: fromFile.url, anonKey: fromFile.anonKey, serviceKey: '' })
                    }
                  >
                    Use .env.local ({fromFile.url.replace(/^https?:\/\//, '')})
                  </button>
                  <p className="panel__hint">
                    {fromFile.hasServiceKey
                      ? 'Service role key is loaded on the dev server and stays there.'
                      : 'No SUPABASE_SERVICE_ROLE_KEY in .env.local — reads and writes will fail.'}
                  </p>
                </>
              ) : null}

              {SUPABASE_MANIFEST.config.map((field) => (
                <label key={field.key} className="field field--stacked">
                  <span className="field__label">{field.label}</span>
                  <input
                    value={form.url}
                    placeholder={field.placeholder}
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  />
                </label>
              ))}

              {SUPABASE_MANIFEST.credentials.map((credential) => (
                <label key={credential.name} className="field field--stacked">
                  <span className="field__label">{credential.label}</span>
                  <input
                    type="password"
                    placeholder={credential.hint}
                    value={credential.scope === 'client' ? form.anonKey : form.serviceKey}
                    onChange={(e) =>
                      setForm((f) =>
                        credential.scope === 'client'
                          ? { ...f, anonKey: e.target.value }
                          : { ...f, serviceKey: e.target.value },
                      )
                    }
                  />
                </label>
              ))}

              {error ? <p className="connect-form__error">{error}</p> : null}

              <button disabled={busy} onClick={() => void connect()}>
                {busy ? 'Checking…' : 'Connect and read schema'}
              </button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
