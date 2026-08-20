import { useEffect, useState } from 'react';
import { SUPABASE_MANIFEST } from '@loom/connectors';
import { useEditor } from '../state/useEditor';
import {
  connectSupabase,
  connectedTables,
  connectionUrl,
  disconnect,
  hasEnv,
  readServerEnv,
  type ServerEnv,
} from '../state/connectors';

/**
 * Connections live here. The panel can write credentials and prove they work; it can never read
 * a stored value back out (`docs/specs/connector-credentials.md`).
 */
export function DataPanel() {
  const snapshot = useEditor((s) => s.snapshot);
  const url = connectionUrl(snapshot);
  const tables = connectedTables(snapshot);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ url: '', anonKey: '', serviceKey: '' });
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

  const connect = async (input = form): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const result = await connectSupabase(input);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setForm({ url: '', anonKey: '', serviceKey: '' });
  };

  return (
    <section className="data-panel">
      <div className="panel__head">
        <h2 className="panel__title">Data</h2>
        {url ? null : (
          <button onClick={() => setOpen((v) => !v)} data-testid="connect-supabase">
            Connect
          </button>
        )}
      </div>

      {url ? (
        <>
          <div className="connection">
            <span className="dot dot--ok" />
            <span className="connection__url mono">{url.replace(/^https?:\/\//, '')}</span>
            <button title="Disconnect" onClick={disconnect}>
              ×
            </button>
          </div>
          <p className="panel__hint">
            {serverEnv.names.includes('SUPABASE_SERVICE_ROLE_KEY') ||
            hasEnv('SUPABASE_SERVICE_ROLE_KEY')
              ? 'Service role key held by the dev server; the project keeps only its name.'
              : 'No service role key — reads and writes will fail until you reconnect.'}
          </p>
          <ul className="tables">
            {tables.map((table) => (
              <li key={table.name} className="table-row">
                <span>{table.name}</span>
                <span className="mono id">{table.columns.length} cols</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {open && !url ? (
        <div className="connect-form">
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
        </div>
      ) : null}
    </section>
  );
}
