import { beforeEach, describe, expect, it } from 'vitest';
import { actionsOf } from '@loom/ir';
import {
  __resetStore,
  addArtboard,
  dispatch,
  addComponent,
  getState,
  rootComponentId,
  removeFlow,
  selectComponent,
  selectedComponentId,
} from '../src/state/store';
import { addGraphNode, connect, ensureMirror, removeNode, removeWire } from '../src/state/graph';
import {
  actionsFor,
  addAction,
  moveAction,
  removeAction,
  updateAction,
} from '../src/state/actions';

/**
 * Action sequences through the editor's own calls (P3, `docs/specs/actions.md`).
 *
 * The property under test throughout is that **the wire and the `trigger` action are one fact in
 * two views**. Drawing the wire appends the step; deleting the step removes the wire; deleting the
 * node removes only the steps that fired it, never the whole sequence.
 */

const snapshot = () => getState().snapshot;
const root = () => rootComponentId(snapshot());
const steps = (id: string) => actionsFor(snapshot(), id);

function place(type: string): string {
  selectComponent(root());
  addComponent(type);
  return selectedComponentId()!;
}

/** A button, a field, and a pipeline for it to fire. */
function setup(): { button: string; field: string; api: string } {
  const field = place('TextField');
  const button = place('Button');
  const api = addGraphNode('api', 'route');
  const mirror = ensureMirror(button, { x: 0, y: 0 })!;
  connect({ nodeId: mirror, portId: 'pt_click' }, { nodeId: api, portId: 'pt_run' });
  return { button, field, api };
}

describe('the wire and the step are one fact', () => {
  beforeEach(() => __resetStore());

  it('drawing a trigger wire appends a step', () => {
    const { button, api } = setup();
    expect(steps(button)).toEqual([{ kind: 'trigger', target: { nodeId: api, portId: 'pt_run' } }]);
  });

  it('appends rather than replacing what is already there', () => {
    const { button, field } = setup();
    addAction(button, 'clearField');
    expect(steps(button).map((a) => a.kind)).toEqual(['trigger', 'clearField']);

    const second = addGraphNode('api', 'route');
    const mirror = ensureMirror(button, { x: 0, y: 0 })!;
    connect({ nodeId: mirror, portId: 'pt_click' }, { nodeId: second, portId: 'pt_run' });

    // The clearField step in the middle survives the new wire.
    expect(steps(button).map((a) => a.kind)).toEqual(['trigger', 'clearField', 'trigger']);
    expect(field).toBeTruthy();
  });

  it('removing the step removes the wire', () => {
    const { button, api } = setup();
    expect(Object.values(snapshot().wires)).toHaveLength(1);

    removeAction(button, 0);
    expect(steps(button)).toHaveLength(0);
    expect(Object.values(snapshot().wires)).toHaveLength(0);
    expect(api).toBeTruthy();
  });

  it('removing the wire removes only that step', () => {
    const { button } = setup();
    addAction(button, 'clearField');
    addAction(button, 'message');

    const wire = Object.values(snapshot().wires)[0]!;
    removeWire(wire.id);

    // Two decisions survive; only the fired step went.
    expect(steps(button).map((a) => a.kind)).toEqual(['clearField', 'message']);
  });

  it('deleting the node removes only the steps that fired it', () => {
    const { button, api } = setup();
    addAction(button, 'message');

    removeNode(api);
    expect(steps(button).map((a) => a.kind)).toEqual(['message']);
  });

  it('deleting a flow removes only the navigate step', () => {
    const { button } = setup();
    addArtboard('Done');
    addAction(button, 'navigate');
    addAction(button, 'message');

    const navigate = steps(button).find((a) => a.kind === 'navigate');
    if (navigate?.kind !== 'navigate') throw new Error('no navigate step');
    removeFlow(navigate.flowId);

    expect(steps(button).map((a) => a.kind)).toEqual(['trigger', 'message']);
  });
});

describe('editing a sequence', () => {
  beforeEach(() => __resetStore());

  it('adds a step that already points at something real', () => {
    // A row that says "choose a thing" is a row that compiles to an error.
    const { button, field } = setup();
    addAction(button, 'clearField');

    const added = steps(button)[1];
    expect(added).toEqual({ kind: 'clearField', componentId: field });
  });

  it('offers no step that has nothing to point at', () => {
    const button = place('Button');
    // No screens but this one, no variables, no fields, no pipelines.
    addAction(button, 'navigate');
    addAction(button, 'setVariable');
    addAction(button, 'clearField');
    expect(steps(button)).toHaveLength(0);
  });

  it('moves a step, because order is the meaning of a sequence', () => {
    const { button } = setup();
    addAction(button, 'message');
    expect(steps(button).map((a) => a.kind)).toEqual(['trigger', 'message']);

    moveAction(button, 1, -1);
    expect(steps(button).map((a) => a.kind)).toEqual(['message', 'trigger']);
  });

  it('refuses to move a step off either end', () => {
    const { button } = setup();
    addAction(button, 'message');

    moveAction(button, 0, -1);
    moveAction(button, 1, 1);
    expect(steps(button).map((a) => a.kind)).toEqual(['trigger', 'message']);
  });

  it('drops the property entirely when the last step goes', () => {
    // An empty sequence is not a thing a document should say.
    const { button } = setup();
    removeAction(button, 0);
    expect(snapshot().components[button]!.props.onClick).toBeUndefined();
  });

  it('keeps a condition on just the step it was set on', () => {
    const { button } = setup();
    addAction(button, 'message');

    const message = steps(button)[1]!;
    updateAction(button, 1, {
      ...message,
      when: { source: { nodeId: 'nd_x', portId: 'pt_value' } },
    });

    expect(steps(button)[0]!.when).toBeUndefined();
    expect(steps(button)[1]!.when).toBeDefined();
  });
});

describe('documents written before sequences existed', () => {
  beforeEach(() => __resetStore());

  it('read a bare handler as a one-step sequence', () => {
    const button = place('Button');
    // Written the way a pre-spec-7 document says it: a bare handler, no sequence wrapper.
    dispatch({
      type: 'setProp',
      componentId: button,
      key: 'onClick',
      value: { kind: 'event', handler: { kind: 'navigate', flowId: 'fl_old' } },
    });

    expect(actionsOf({ kind: 'navigate', flowId: 'fl_old' })).toHaveLength(1);
    expect(steps(button)).toEqual([{ kind: 'navigate', flowId: 'fl_old' }]);
  });
});
