import type { Action, ActionKind, Component, Id, Snapshot } from '@loom/ir';
import { useEditor } from '../state/useEditor';
import { setFlowPayload } from '../state/store';
import {
  ACTION_LABELS,
  ACTION_ORDER,
  actionsFor,
  addAction,
  canAdd,
  fieldChoices,
  moveAction,
  removeAction,
  retargetNavigate,
  screenChoices,
  triggerChoices,
  updateAction,
  variableChoices,
  type Choice,
} from '../state/actions';
import { conditionFromKey, conditionKey, conditionSources } from '../state/conditions';

/**
 * The action sequence, edited inline (P3, `docs/specs/actions.md`).
 *
 * loom's protection against workflow spaghetti is that behaviour is visible and wired, and that
 * protection dies the moment an action list hides in a modal. So this is a plain ordered list in
 * the Inspector, always visible when the component is selected, with the order it will actually
 * run in — no dialog, no separate editor, no second place to look.
 */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  );
}

function Picker({
  label,
  value,
  choices,
  onPick,
  testId,
}: {
  label: string;
  value: string;
  choices: Choice[];
  onPick: (next: string) => void;
  testId: string;
}) {
  return (
    <Field label={label}>
      <select data-testid={testId} value={value} onChange={(event) => onPick(event.target.value)}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** One input per param the destination screen declares, carried along the arrow. */
function payloadFields(snapshot: Snapshot, flowId: Id) {
  const flow = snapshot.flows[flowId];
  const destination = flow ? snapshot.artboards[flow.to] : undefined;
  if (!flow || !destination) return null;

  return (destination.params ?? []).map((param) => {
    const entry = (flow.payload ?? []).find((p) => p.param === param.name);
    const value = entry?.kind === 'static' ? String(entry.value ?? '') : '';
    return (
      <Field key={param.name} label={param.name}>
        <input
          data-testid={`payload-${param.name}`}
          value={value}
          placeholder="value to carry"
          onChange={(event) =>
            setFlowPayload(flow.id, [
              ...(flow.payload ?? []).filter((p) => p.param !== param.name),
              { kind: 'static', param: param.name, value: event.target.value },
            ])
          }
        />
      </Field>
    );
  });
}

export function ActionsSection({ component }: { component: Component }) {
  const snapshot = useEditor((s) => s.snapshot);
  const activeArtboardId = useEditor((s) => s.activeArtboardId);

  const actions = actionsFor(snapshot, component.id);
  const conditions = conditionSources(snapshot, activeArtboardId);
  const available = ACTION_ORDER.filter((kind) => canAdd(snapshot, component.id, kind));

  const fields = fieldChoices(snapshot, component.id);
  const variables = variableChoices(snapshot);
  const triggers = triggerChoices(snapshot);
  const screens = screenChoices(snapshot, component.id);

  const patch = (index: number, next: Action): void => updateAction(component.id, index, next);

  return (
    <section className="field-group" data-testid="actions-section">
      <h3 className="field-group__title">On click</h3>

      {actions.length === 0 ? (
        <p className="panel__hint">Nothing happens yet. Add a step below.</p>
      ) : null}

      {actions.map((action, index) => (
        <div key={index} className="action-row" data-testid={`action-${index}`}>
          <div className="field-group__head">
            {/* The number is the contract: steps run top to bottom, always. */}
            <span className="badge" data-testid={`action-${index}-kind`}>
              {index + 1}. {ACTION_LABELS[action.kind]}
            </span>
            <button
              title="Move up"
              data-testid={`action-${index}-up`}
              disabled={index === 0}
              onClick={() => moveAction(component.id, index, -1)}
            >
              ↑
            </button>
            <button
              title="Move down"
              data-testid={`action-${index}-down`}
              disabled={index === actions.length - 1}
              onClick={() => moveAction(component.id, index, 1)}
            >
              ↓
            </button>
            <button
              title="Remove"
              data-testid={`action-${index}-remove`}
              onClick={() => removeAction(component.id, index)}
            >
              ×
            </button>
          </div>

          {action.kind === 'trigger' ? (
            <Picker
              label="Run"
              testId={`action-${index}-target`}
              value={action.target.nodeId}
              choices={triggers}
              onPick={(nodeId) => patch(index, { ...action, target: { nodeId, portId: 'pt_run' } })}
            />
          ) : null}

          {action.kind === 'navigate' ? (
            <>
              <Picker
                label="Screen"
                testId={`action-${index}-screen`}
                value={snapshot.flows[action.flowId]?.to ?? ''}
                choices={screens}
                onPick={(artboardId) => retargetNavigate(component.id, index, artboardId)}
              />
              {/* A dynamic destination needs a value per declared param, or the emitted path
                  matches no route — a Build error rather than a wrong screen. */}
              {payloadFields(snapshot, action.flowId)}
            </>
          ) : null}

          {action.kind === 'setVariable' ? (
            <>
              <Picker
                label="Variable"
                testId={`action-${index}-variable`}
                value={action.nodeId}
                choices={variables}
                onPick={(nodeId) => patch(index, { ...action, nodeId })}
              />
              <Field label="Value">
                <input
                  data-testid={`action-${index}-value`}
                  value={action.value.kind === 'static' ? String(action.value.value ?? '') : ''}
                  onChange={(event) =>
                    patch(index, {
                      ...action,
                      value: { kind: 'static', value: event.target.value },
                    })
                  }
                />
              </Field>
            </>
          ) : null}

          {action.kind === 'setField' ? (
            <>
              <Picker
                label="Field"
                testId={`action-${index}-field`}
                value={action.componentId}
                choices={fields}
                onPick={(componentId) => patch(index, { ...action, componentId })}
              />
              <Field label="Value">
                <input
                  data-testid={`action-${index}-value`}
                  value={action.value.kind === 'static' ? String(action.value.value ?? '') : ''}
                  onChange={(event) =>
                    patch(index, {
                      ...action,
                      value: { kind: 'static', value: event.target.value },
                    })
                  }
                />
              </Field>
            </>
          ) : null}

          {action.kind === 'clearField' ? (
            <Picker
              label="Field"
              testId={`action-${index}-field`}
              value={action.componentId}
              choices={fields}
              onPick={(componentId) => patch(index, { ...action, componentId })}
            />
          ) : null}

          {action.kind === 'message' ? (
            <>
              <Field label="Text">
                <input
                  data-testid={`action-${index}-text`}
                  value={action.text}
                  onChange={(event) => patch(index, { ...action, text: event.target.value })}
                />
              </Field>
              <Field label="Tone">
                <select
                  data-testid={`action-${index}-tone`}
                  value={action.tone ?? 'ok'}
                  onChange={(event) =>
                    patch(index, { ...action, tone: event.target.value === 'error' ? 'error' : 'ok' })
                  }
                >
                  <option value="ok">Confirmation</option>
                  <option value="error">Problem</option>
                </select>
              </Field>
            </>
          ) : null}

          {action.kind === 'openUrl' ? (
            <Field label="Address">
              <input
                data-testid={`action-${index}-url`}
                value={action.url}
                onChange={(event) => patch(index, { ...action, url: event.target.value })}
              />
            </Field>
          ) : null}

          {action.kind === 'copy' ? (
            <Field label="Text">
              <input
                data-testid={`action-${index}-value`}
                value={action.value.kind === 'static' ? String(action.value.value ?? '') : ''}
                onChange={(event) =>
                  patch(index, { ...action, value: { kind: 'static', value: event.target.value } })
                }
              />
            </Field>
          ) : null}

          {conditions.length > 0 ? (
            <Field label="Only when">
              <select
                data-testid={`action-${index}-when`}
                value={conditionKey(action.when)}
                onChange={(event) => {
                  const when = conditionFromKey(event.target.value, action.when?.test);
                  patch(index, { ...action, when });
                }}
              >
                <option value="">Always</option>
                {conditions.map((source) => (
                  <option key={source.key} value={source.key}>
                    {source.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
      ))}

      <div className="field__row">
        <select
          data-testid="add-action"
          value=""
          onChange={(event) => {
            if (event.target.value) addAction(component.id, event.target.value as ActionKind);
          }}
        >
          <option value="">+ Add a step…</option>
          {available.map((kind) => (
            <option key={kind} value={kind}>
              {ACTION_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
