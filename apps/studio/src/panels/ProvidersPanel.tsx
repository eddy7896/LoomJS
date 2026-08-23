import { useEffect, useState } from 'react';
import {
  callbackUrl,
  canManage,
  dashboardUrl,
  gotrueEnvExample,
  ssoProvider,
  type SsoProvider,
} from '@loom/connectors';
import { actionsOf, type Snapshot } from '@loom/ir';
import { useEditor } from '../state/useEditor';
import {
  connection,
  connectionUrl,
  enableProvider,
  readAuthProviders,
  selfHostedAuth,
  setSelfHostedAuth,
} from '../state/connectors';

/**
 * Setting a sign-in provider up (A3, `docs/20-provider-setup.md`).
 *
 * Dragging a "Continue with Google" button onto a screen is half of signing in. The other half is
 * a client id and a secret that live somewhere loom mostly cannot reach — and the panel's job is
 * to be honest about that rather than to imply the button is finished.
 *
 * So it shows, per provider the project actually uses: whether the auth server says it is **on**,
 * the callback URL to paste into the provider's console, and whichever way of supplying the
 * secret applies to how this project's auth is run.
 */

/** The providers this project's buttons ask for, in the order they were added. */
function providersUsed(snapshot: Snapshot): SsoProvider[] {
  const ids = new Set<string>();
  for (const component of Object.values(snapshot.components)) {
    for (const value of Object.values(component.props)) {
      if (value.kind !== 'event') continue;
      for (const action of actionsOf(value.handler)) {
        if (action.kind === 'signInWith') ids.add(String(action.provider));
      }
    }
  }
  return [...ids].map((id) => ssoProvider(id)).filter((entry): entry is SsoProvider => Boolean(entry));
}

/** A value worth copying rather than retyping — a callback URL nobody should transcribe by hand. */
function Copyable({ value, testId }: { value: string; testId: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="provider__copy">
      <code className="mono" data-testid={testId}>
        {value}
      </code>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function ProvidersPanel() {
  const snapshot = useEditor((s) => s.snapshot);
  const attached = connection(snapshot);
  const url = attached?.moduleId === 'supabase' ? (connectionUrl(snapshot) ?? '') : '';

  const used = providersUsed(snapshot);
  const selfHosted = selfHostedAuth(snapshot);

  const [state, setState] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState<string | undefined>();

  useEffect(() => {
    if (used.length === 0 || !url) return;
    void readAuthProviders().then((answer) => {
      setState(answer);
      setChecked(true);
    });
    // The set of providers is what makes this worth asking again; the snapshot changes constantly.
  }, [used.map((provider) => provider.id).join(','), url]);

  if (used.length === 0) return null;

  return (
    <section className="palette__section" data-testid="providers">
      <div className="palette__head">Sign-in providers</div>

      {!url ? (
        <p className="panel__hint">
          These need a Supabase connection. Connect one above and loom can tell you which providers
          are already on.
        </p>
      ) : null}

      {url ? (
        <label className="schema-edit__check">
          <input
            type="checkbox"
            data-testid="self-hosted-auth"
            checked={selfHosted}
            onChange={(event) => setSelfHostedAuth(event.target.checked)}
          />
          This project runs its own auth server
        </label>
      ) : null}

      {used.map((provider) => {
        const on = state[provider.id];
        return (
          <div key={provider.id} className="provider" data-testid={`provider-${provider.id}`}>
            <button
              className="provider__head"
              aria-expanded={open === provider.id}
              data-testid={`provider-${provider.id}-toggle`}
              onClick={() => setOpen((current) => (current === provider.id ? undefined : provider.id))}
            >
              <span className={`dot ${on ? 'dot--ok' : 'dot--off'}`} />
              <span className="provider__name">{provider.label}</span>
              <span className="provider__state">
                {!url || !checked ? 'not checked' : on ? 'on' : 'not turned on'}
              </span>
            </button>

            {open === provider.id ? (
              <ProviderSetup provider={provider} url={url} selfHosted={selfHosted} />
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

/** What to do about one provider, which depends on where its secret is allowed to live. */
function ProviderSetup({
  provider,
  url,
  selfHosted,
}: {
  provider: SsoProvider;
  url: string;
  selfHosted: boolean;
}) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | undefined>();

  const callback = url ? callbackUrl(url) : '';
  const dashboard = url ? dashboardUrl(url) : undefined;
  const manageable = url ? canManage(url) && !selfHosted : false;

  return (
    <div className="provider__body">
      {provider.note ? <p className="panel__hint">{provider.note}</p> : null}

      {callback ? (
        <>
          <span className="field__label">Callback URL — paste this into {provider.label}</span>
          {/* The one people get wrong: it points at the auth server, not at the app. */}
          <Copyable value={callback} testId={`provider-${provider.id}-callback`} />
        </>
      ) : null}

      {selfHosted ? (
        <>
          <span className="field__label">Your auth server reads these</span>
          <p className="panel__hint">
            loom never holds them: they are environment variables of the server you run, and the
            deployment supplies the values.
          </p>
          <pre className="provider__env" data-testid={`provider-${provider.id}-env`}>
            {gotrueEnvExample(provider.id, callback)}
          </pre>
        </>
      ) : manageable ? (
        <>
          <span className="field__label">Set it up from here</span>
          <input
            data-testid={`provider-${provider.id}-client-id`}
            placeholder="Client ID"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          />
          <input
            type="password"
            data-testid={`provider-${provider.id}-secret`}
            placeholder="Client secret"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
          {/* Said before anything is typed, not after: these pass through and are kept nowhere. */}
          <p className="panel__hint">
            These go straight to your Supabase project and are stored nowhere in loom — not in this
            browser, and not in the project file. It needs a SUPABASE_ACCESS_TOKEN on the dev
            server.
          </p>
          <button
            disabled={busy || !clientId.trim() || !secret.trim()}
            data-testid={`provider-${provider.id}-enable`}
            onClick={() => {
              setBusy(true);
              setResult(undefined);
              void enableProvider({ provider: provider.id, clientId, secret }).then((answer) => {
                setBusy(false);
                setResult(answer.ok ? 'Turned on.' : answer.error);
                if (answer.ok) {
                  setClientId('');
                  setSecret('');
                }
              });
            }}
          >
            {busy ? 'Setting up…' : `Turn on ${provider.label}`}
          </button>
          {result ? <p className="panel__hint">{result}</p> : null}
        </>
      ) : (
        <p className="panel__hint">
          Set the client id and secret in your Supabase project. loom holds neither.
        </p>
      )}

      {dashboard ? (
        <a className="provider__link" href={dashboard} target="_blank" rel="noopener noreferrer">
          Open Auth → Providers ↗
        </a>
      ) : null}
    </div>
  );
}
