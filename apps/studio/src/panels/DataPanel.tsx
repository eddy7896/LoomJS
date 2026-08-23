import { useEffect, useState } from 'react';
import {
  FIREBASE_MANIFEST,
  MODULES,
  POSTGRES_MANIFEST,
  SAMPLE_SIZE,
  SUPABASE_MANIFEST,
} from '@loom/connectors';
import { useEditor } from '../state/useEditor';
import {
  connectFirestore,
  connectPostgres,
  connectSupabase,
  connectedTables,
  connection,
  connectionUrl,
  disconnect,
  hasEnv,
  readServerEnv,
  schemaEditing,
  type ServerEnv,
} from '../state/connectors';
import { SchemaList } from './SchemaTable';
import { NewTable } from './SchemaEditor';

/**
 * Connections live here. The panel can write credentials and prove they work; it can never read
 * a stored value back out (`docs/specs/connector-credentials.md`).
 *
 * Three ways to reach data. Two of them differ only in *reach* — PostgREST over HTTP, or a socket
 * to the database itself — and the third, Firestore, is a different model mapped onto the same
 * vocabulary. Whichever is chosen, what comes back is tables with typed columns, and every node
 * downstream is the same.
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
  const [serviceAccount, setServiceAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [serverEnv, setServerEnv] = useState<ServerEnv>({ names: [], values: {} });
  const [making, setMaking] = useState(false);

  // Schema editing needs a connection that can run statements; Firestore keeps a shape instead.
  const editing = schemaEditing(snapshot, serverEnv.names);

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
  const hasServiceAccount = serverEnv.names.includes('FIREBASE_SERVICE_ACCOUNT');

  const finish = (result: { ok: boolean; error?: string }): void => {
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setForm({ url: '', anonKey: '', serviceKey: '' });
    setSql({ connectionString: '', schema: '' });
    setServiceAccount('');
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

  const connectDocuments = async (key = serviceAccount): Promise<void> => {
    setBusy(true);
    setError(undefined);
    finish(await connectFirestore({ serviceAccount: key }));
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
            {attached.moduleId === 'firestore'
              ? hasServiceAccount
                ? `Service account held by the dev server. Columns are what ${SAMPLE_SIZE} documents ` +
                  `per collection carried — a field none of them had is not listed.`
                : 'No service account on the dev server — reads and writes will fail until you reconnect.'
              : attached.moduleId === 'postgres'
                ? hasDatabaseUrl || hasEnv('DATABASE_URL')
                  ? 'Connection string held by the dev server; the project keeps only its name.'
                  : 'No connection string on the dev server — reads and writes will fail until you reconnect.'
                : serverEnv.names.includes('SUPABASE_SERVICE_ROLE_KEY') ||
                    hasEnv('SUPABASE_SERVICE_ROLE_KEY')
                  ? 'Service role key held by the dev server; the project keeps only its name.'
                  : 'No service role key — reads and writes will fail until you reconnect.'}
          </p>
          {editing === 'sql' || editing === 'shape' ? (
            <div className="row-actions">
              <button data-testid="new-table" onClick={() => setMaking((value) => !value)}>
                + {editing === 'shape' ? 'Collection' : 'Table'}
              </button>
            </div>
          ) : null}

          {editing === 'needs-connection-string' ? (
            <p className="panel__hint">
              To make tables from here, loom needs this project's Postgres connection string —
              PostgREST cannot change a schema. Add it as DATABASE_URL in .env.local.
            </p>
          ) : null}

          {making && (editing === 'sql' || editing === 'shape') ? (
            <NewTable shape={editing === 'shape'} onDone={() => setMaking(false)} />
          ) : null}

          <SchemaList
            tables={tables}
            editing={editing === 'sql' || editing === 'shape' ? editing : undefined}
          />
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

          {moduleId === 'firestore' ? (
            <>
              {hasServiceAccount ? (
                <>
                  <button
                    disabled={busy}
                    data-testid="use-service-account"
                    onClick={() => void connectDocuments('')}
                  >
                    Use FIREBASE_SERVICE_ACCOUNT from .env.local
                  </button>
                  <p className="panel__hint">
                    The dev server holds it and reads the project for you; it never reaches this
                    browser.
                  </p>
                </>
              ) : null}

              {FIREBASE_MANIFEST.credentials.map((credential) => (
                <label key={credential.name} className="field field--stacked">
                  <span className="field__label">{credential.label}</span>
                  <textarea
                    className="query-editor mono"
                    data-testid="service-account"
                    rows={4}
                    spellCheck={false}
                    placeholder='{"type":"service_account","project_id":"…"}'
                    value={serviceAccount}
                    onChange={(event) => setServiceAccount(event.target.value)}
                  />
                  <span className="panel__hint">{credential.hint}</span>
                </label>
              ))}

              <p className="panel__hint">
                Firestore has no schema to read, so loom looks at the first {SAMPLE_SIZE} documents
                of each collection to see what they hold.
              </p>

              {error ? <p className="connect-form__error">{error}</p> : null}

              <button disabled={busy} onClick={() => void connectDocuments()}>
                {busy ? 'Reading…' : 'Connect and read collections'}
              </button>
            </>
          ) : moduleId === 'postgres' ? (
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
