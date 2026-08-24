import { useEffect, useState } from 'react';
import { isRequestTool, type ToolManifest } from '@loom/connectors';
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

      {knownTools().map((tool) => (
        <ToolRow
          key={tool.id}
          tool={tool}
          attached={Boolean(toolAttached(snapshot, tool.id))}
          heldByServer={serverEnv.names.includes(tool.credential.name)}
          open={open === tool.id}
          onToggle={() => setOpen((current) => (current === tool.id ? undefined : tool.id))}
          onAdd={(operationId) => addToolStep(routeFor(), tool.id, operationId)}
        />
      ))}
    </section>
  );
}

function ToolRow({
  tool,
  attached,
  heldByServer,
  open,
  onToggle,
  onAdd,
}: {
  tool: ToolManifest;
  attached: boolean;
  heldByServer: boolean;
  open: boolean;
  onToggle: () => void;
  onAdd: (operationId: string) => void;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const operations = operationsOf(tool.id);

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
                {heldByServer
                  ? `${tool.credential.name} is held by the dev server; the project keeps only its name.`
                  : `No ${tool.credential.name} on the dev server — calls will be refused until there is one.`}
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
              <label className="field field--stacked">
                <span className="field__label">{tool.credential.label}</span>
                <input
                  type="password"
                  data-testid={`tool-${tool.id}-key`}
                  value={key}
                  placeholder={heldByServer ? 'Already on the dev server' : ''}
                  onChange={(event) => setKey(event.target.value)}
                />
                {tool.credential.hint ? (
                  <span className="panel__hint">{tool.credential.hint}</span>
                ) : null}
              </label>

              {error ? <p className="connect-form__error">{error}</p> : null}

              <button
                // A tool whose key is optional attaches with nothing typed: some endpoints want none.
                disabled={busy || (!key.trim() && !heldByServer && !tool.credential.optional)}
                data-testid={`tool-${tool.id}-attach`}
                onClick={() => {
                  setBusy(true);
                  setError(undefined);
                  void attachTool(tool.id, key).then((result) => {
                    setBusy(false);
                    if (result.ok) setKey('');
                    else setError(result.error);
                  });
                }}
              >
                {busy
                  ? 'Attaching…'
                  : heldByServer && !key.trim()
                    ? 'Use the key on the server'
                    : 'Attach'}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
