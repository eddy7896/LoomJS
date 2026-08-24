import { useEffect, useState } from 'react';
import { TOOL_FAMILIES, isRequestTool, type ToolManifest } from '@loom/connectors';
import { useEditor } from '../state/useEditor';
import { readServerEnv, routeContaining, type ServerEnv } from '../state/connectors';
import { addGraphNode } from '../state/graph';
import {
  addToolStep,
  attachTool,
  detachTool,
  knownTools,
  operationsOf,
  toolAttached,
} from '../state/tools';

/**
 * Tools (T1–T3, `docs/22-api-connectors.md`).
 *
 * The tab for everything that is not a database: a model, a payment provider, an endpoint someone
 * else runs. Beside Data because it is the same kind of thing — connections this project has, and
 * what it can do with them.
 *
 * A tool's key never appears here after it is typed. The panel can say the server holds one; it
 * cannot show it, and neither the document nor this browser keeps a copy.
 */
export function ToolsPanel() {
  const snapshot = useEditor((s) => s.snapshot);
  const selection = useEditor((s) => s.selection);
  const [serverEnv, setServerEnv] = useState<ServerEnv>({ names: [], values: {} });
  const [open, setOpen] = useState<string | undefined>();

  useEffect(() => {
    void readServerEnv().then(setServerEnv);
  }, []);

  /** The route a call joins: a selected one, the route holding a selected step, or a new one. */
  const routeFor = (): string => {
    if (selection?.kind === 'node') {
      if (snapshot.nodes[selection.id]?.category === 'api') return selection.id;
      const holder = routeContaining(snapshot, selection.id);
      if (holder) return holder;
    }
    return addGraphNode('api', 'route');
  };

  return (
    <section className="panel tools" data-testid="tools-panel">
      <div className="panel__head">
        <h2 className="panel__title">Tools</h2>
      </div>

      <p className="panel__hint">
        Everything that is not a database. A call runs on the server, so the key never reaches the
        browser.
      </p>

      {TOOL_FAMILIES.map((family) => {
        const tools = knownTools().filter((tool) => tool.family === family.id);
        if (tools.length === 0) return null;

        return (
          <div key={family.id} data-testid={`tool-family-${family.id}`}>
            <div className="palette__head">{family.label}</div>
            {tools.map((tool) => (
              <ToolRow
                key={tool.id}
                tool={tool}
                attached={Boolean(toolAttached(snapshot, tool.id))}
                held={tool.credentials.filter((entry) => serverEnv.names.includes(entry.name))}
                open={open === tool.id}
                onToggle={() => setOpen((current) => (current === tool.id ? undefined : tool.id))}
                onAdd={(operationId) => addToolStep(routeFor(), tool.id, operationId)}
              />
            ))}
          </div>
        );
      })}
    </section>
  );
}

function ToolRow({
  tool,
  attached,
  held,
  open,
  onToggle,
  onAdd,
}: {
  tool: ToolManifest;
  attached: boolean;
  /** Which of this tool's names the dev server already holds. Never their values. */
  held: readonly { name: string }[];
  open: boolean;
  onToggle: () => void;
  onAdd: (operationId: string) => void;
}) {
  // One box per name the tool needs: Twilio wants an account SID beside its token, and a
  // self-hosted service wants its own address.
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const operations = operationsOf(tool.id);
  const heldNames = held.map((entry) => entry.name);
  const missing = tool.credentials.filter(
    (credential) =>
      !credential.optional && !heldNames.includes(credential.name) && !values[credential.name]?.trim(),
  );

  return (
    <div className="provider" data-testid={`tool-${tool.id}`}>
      <button
        className="provider__head"
        aria-expanded={open}
        data-testid={`tool-${tool.id}-toggle`}
        onClick={onToggle}
      >
        <span className={`dot ${attached ? 'dot--ok' : 'dot--off'}`} />
        <span className="provider__name">{tool.label}</span>
        <span className="provider__state">{attached ? 'attached' : 'not attached'}</span>
      </button>

      {open ? (
        <div className="provider__body">
          {attached ? (
            <>
              <p className="panel__hint">
                {heldNames.length > 0
                  ? `${heldNames.join(', ')} held by the dev server; the project keeps only the names.`
                  : `Nothing on the dev server yet — calls will be refused until there is.`}
              </p>

              {isRequestTool(tool.id) ? (
                <button
                  className="palette__item"
                  data-testid={`tool-${tool.id}-add`}
                  onClick={() => onAdd('')}
                >
                  + Request
                </button>
              ) : (
                operations.map((operation) => (
                  <button
                    key={operation.id}
                    className="palette__item"
                    data-testid={`tool-${tool.id}-add-${operation.id}`}
                    onClick={() => onAdd(operation.id)}
                  >
                    + {operation.label}
                  </button>
                ))
              )}

              <button data-testid={`tool-${tool.id}-detach`} onClick={() => detachTool(tool.id)}>
                Remove
              </button>
            </>
          ) : (
            <>
              {tool.credentials.map((credential, index) => (
                <label key={credential.name} className="field field--stacked">
                  <span className="field__label">{credential.label}</span>
                  <input
                    // An address is not a secret, and masking it would only make it hard to check.
                    type={credential.name.endsWith('_URL') ? 'text' : 'password'}
                    data-testid={
                      index === 0 ? `tool-${tool.id}-key` : `tool-${tool.id}-key-${credential.name}`
                    }
                    value={values[credential.name] ?? ''}
                    placeholder={
                      heldNames.includes(credential.name) ? 'Already on the dev server' : ''
                    }
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [credential.name]: event.target.value }))
                    }
                  />
                  {credential.hint ? <span className="panel__hint">{credential.hint}</span> : null}
                </label>
              ))}

              {error ? <p className="connect-form__error">{error}</p> : null}

              <button
                // A tool whose names are all optional, or already on the server, attaches with
                // nothing typed: some endpoints want no key at all.
                disabled={busy || missing.length > 0}
                data-testid={`tool-${tool.id}-attach`}
                onClick={() => {
                  setBusy(true);
                  setError(undefined);
                  void attachTool(tool.id, values).then((result) => {
                    setBusy(false);
                    if (result.ok) setValues({});
                    else setError(result.error);
                  });
                }}
              >
                {busy
                  ? 'Attaching…'
                  : heldNames.length === tool.credentials.length
                    ? 'Use what the server holds'
                    : 'Attach'}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
