import { beforeEach, describe, expect, it } from 'vitest';
import { diagnose, type Problem } from '@loom/compiler';
import {
  __resetStore,
  addArtboard,
  addComponent,
  getState,
  rootComponentId,
  selectComponent,
  selectedComponentId,
  setActiveArtboard,
  setMode,
} from '../src/state/store';
import { addGraphNode, connect, ensureMirror, removeNode } from '../src/state/graph';
import { revealProblem } from '../src/state/problems';
import { setVisibleWhen } from '../src/state/conditions';

/**
 * Revealing a problem (P2, `docs/specs/problems.md`).
 *
 * The done-when is that clicking a row selects the offending entity, and "selects" has to mean
 * *visibly* — on the right screen, in the right mode. Selecting something the person cannot see
 * reads as the click having done nothing.
 */

const snapshot = () => getState().snapshot;
const root = () => rootComponentId(snapshot());

function place(type: string): string {
  selectComponent(root());
  addComponent(type);
  return selectedComponentId()!;
}

const byCode = (code: string) => diagnose(snapshot()).find((problem) => problem.code === code);

/** A variable read by a Text: the smallest graph that produces a real problem. */
function unwrittenVariable(): { bucket: string; output: string } {
  const bucket = addGraphNode('state', 'write');
  const output = place('Text');
  connect(
    { nodeId: bucket, portId: 'pt_value' },
    { nodeId: ensureMirror(output, { x: 0, y: 0 })!, portId: 'pt_content' },
  );
  return { bucket, output };
}

describe('clicking a problem', () => {
  beforeEach(() => __resetStore());

  it('switches to Nodes mode and selects the node', () => {
    const { bucket } = unwrittenVariable();
    setMode('design');

    const problem = byCode('variable-never-written');
    expect(problem).toBeDefined();

    revealProblem(problem!);
    expect(getState().mode).toBe('nodes');
    expect(getState().selection).toEqual({ kind: 'node', id: bucket });
  });

  it('switches to Design mode and selects the component', () => {
    // Built by hand rather than provoked: the editor scrubs every reference when it deletes a
    // node, so a dangling binding only ever arrives in a document from somewhere else — a
    // restored save, or one edited outside this session. Revealing still has to work for it.
    const { output } = unwrittenVariable();
    setMode('nodes');

    const problem: Problem = {
      id: 'dangling-binding:cp',
      severity: 'error',
      code: 'dangling-binding',
      message: 'reads something that no longer exists',
      entityId: output,
      entityKind: 'component',
      artboardId: getState().activeArtboardId,
    };

    revealProblem(problem);
    expect(getState().mode).toBe('design');
    expect(getState().selection).toEqual({ kind: 'component', id: output });
  });

  it('switches to the screen that owns the component first', () => {
    const { output } = unwrittenVariable();
    const home = getState().activeArtboardId;

    // Look at a different screen, as someone would after drawing one.
    setActiveArtboard(addArtboard('Report'));
    expect(getState().activeArtboardId).not.toBe(home);

    revealProblem({
      id: 'dangling-binding:cp',
      severity: 'error',
      code: 'dangling-binding',
      message: 'reads something that no longer exists',
      entityId: output,
      entityKind: 'component',
      artboardId: home,
    });

    expect(getState().activeArtboardId).toBe(home);
    expect(getState().selection).toEqual({ kind: 'component', id: output });
  });

  it('does nothing for a row whose entity has since been deleted', () => {
    const { bucket } = unwrittenVariable();
    const stale = byCode('variable-never-written')!;
    expect(stale.entityId).toBe(bucket);

    removeNode(bucket);
    setMode('design');

    // A row can outlive its entity by a render. Revealing must not select a ghost.
    revealProblem(stale);
    expect(getState().mode).toBe('design');
    expect(getState().selection?.kind).not.toBe('node');
  });
});

describe('the editor does not leave references behind', () => {
  beforeEach(() => __resetStore());

  it('clears a condition when the node it reads is deleted', () => {
    const checkbox = place('Checkbox');
    const mirror = ensureMirror(checkbox, { x: 0, y: 0 })!;
    const secret = place('Text');

    setVisibleWhen(secret, { source: { nodeId: mirror, portId: 'pt_value' } });
    expect(snapshot().components[secret]?.visibleWhen).toBeDefined();

    removeNode(mirror);

    // Left behind, the condition could never hold and the Text would silently never appear again.
    expect(snapshot().components[secret]?.visibleWhen).toBeUndefined();
    expect(diagnose(snapshot()).some((p) => p.code === 'dangling-condition')).toBe(false);
  });
});
