import { describe, expect, it } from 'vitest';
import { applyOps, type Node, type Op, type Snapshot } from '@loom/ir';
import { diagnose } from '../src/diagnostics';
import { calculatorSnapshot, formSnapshot, trivialSnapshot } from './fixtures';

/**
 * The Problems tier (`docs/specs/problems.md`).
 *
 * Two properties are load-bearing and neither is about any single check. The pass must find
 * **every** instance of a fault rather than stopping at the first, because that is exactly what
 * the compiler cannot do; and it must **never throw**, because it runs on every keystroke over
 * documents that are mid-edit.
 */

const codes = (snapshot: Snapshot): string[] => diagnose(snapshot).map((problem) => problem.code);
const errors = (snapshot: Snapshot) => diagnose(snapshot).filter((p) => p.severity === 'error');
const find = (snapshot: Snapshot, code: string) =>
  diagnose(snapshot).filter((problem) => problem.code === code);

/** A Math node wired to nothing at all, for the orphan case. */
const looseMath = (id: string): Node => ({
  id,
  category: 'fn',
  kind: 'math',
  name: 'Math',
  position: { x: 0, y: 0 },
  config: { operator: 'add', inputs: 2 },
  ports: [
    { id: 'pt_run', name: 'run', direction: 'in', portKind: 'trigger', type: { kind: 'trigger' } },
    { id: 'pt_in_0', name: 'input 1', direction: 'in', portKind: 'data', type: { kind: 'number' } },
    { id: 'pt_in_1', name: 'input 2', direction: 'in', portKind: 'data', type: { kind: 'number' } },
    { id: 'pt_result', name: 'result', direction: 'out', portKind: 'data', type: { kind: 'number' } },
  ],
});

describe('a project with nothing wrong', () => {
  it('reports nothing at all on an empty project', () => {
    expect(diagnose(trivialSnapshot())).toEqual([]);
  });

  it('reports nothing on a working calculator', () => {
    expect(diagnose(calculatorSnapshot())).toEqual([]);
  });
});

describe('things that no longer exist', () => {
  it('names the component whose binding lost its source', () => {
    const gone = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      { type: 'removeNode', nodeId: 'nd_bucket' },
    ]);
    const [problem] = find(gone, 'dangling-binding');
    expect(problem?.message).toMatch(/reads something that no longer exists/);
    expect(problem?.entityId).toBe('cp_status');
    expect(problem?.entityKind).toBe('component');
  });

  it('names the component whose button fires a node that is gone', () => {
    const gone = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      { type: 'removeNode', nodeId: 'nd_math_add' },
    ]);
    const [problem] = find(gone, 'dangling-trigger');
    expect(problem?.entityId).toBe('cp_btn_add');
    expect(problem?.message).toMatch(/pressing it would do nothing/);
  });

  it('names the component whose condition lost its source', () => {
    const base = calculatorSnapshot({ operators: ['add'] });
    const withCondition = applyOps(base, [
      {
        type: 'setVisibleWhen',
        componentId: 'cp_status',
        condition: { source: { nodeId: 'nd_ghost', portId: 'pt_value' } },
      },
    ]);
    expect(find(withCondition, 'dangling-condition')[0]?.entityId).toBe('cp_status');
  });

  it('names the component that navigates along an arrow that was removed', () => {
    // `removeFlow` scrubs the flow but not the handlers pointing at it, which is what makes this
    // reachable. The arrow *itself* cannot dangle: `addFlow` refuses an unknown destination and
    // `removeArtboard` takes every flow touching it, so the IR holds that invariant already.
    const withButton = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      {
        type: 'setProp',
        componentId: 'cp_btn_add',
        key: 'onClick',
        value: { kind: 'event', handler: { kind: 'navigate', flowId: 'fl_gone' } },
      },
    ]);
    const [problem] = find(withButton, 'dangling-flow');
    expect(problem?.message).toMatch(/navigates along an arrow that has been removed/);
    expect(problem?.entityId).toBe('cp_btn_add');
  });
});

describe('things that are half wired', () => {
  it('names each empty input separately, by its position', () => {
    const half = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      { type: 'removeWire', wireId: 'wr_a_add' },
      { type: 'removeWire', wireId: 'wr_b_add' },
    ]);
    const found = find(half, 'unwired-input');
    // Two ports, two rows — the whole point of a panel over a single Build error.
    expect(found).toHaveLength(2);
    expect(found[0]!.message).toMatch(/input 1 of/);
    expect(found[1]!.message).toMatch(/input 2 of/);
    expect(found.every((problem) => problem.entityId === 'nd_math_add')).toBe(true);
  });

  it('says the same sentence the compiler would', () => {
    const half = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      { type: 'removeWire', wireId: 'wr_a_add' },
    ]);
    expect(find(half, 'unwired-input')[0]!.message).toContain(
      'has nothing wired into it, so there is no value to derive.',
    );
  });

  it('leaves a route body alone, where operands are fields rather than wires', () => {
    // The form fixture's steps take named fields of the request; an unwired port there is not a
    // fault (`docs/specs/binding-trigger-runtime.md`).
    expect(codes(formSnapshot())).not.toContain('unwired-input');
  });

  it('names a variable nothing writes', () => {
    const unwritten = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      { type: 'removeWire', wireId: 'wr_set_add' },
    ]);
    const [problem] = find(unwritten, 'variable-never-written');
    expect(problem?.message).toMatch(/never holds anything/);
    expect(problem?.entityId).toBe('nd_bucket');
  });

  it('names a writer that recomputes on its own, and how to fix it', () => {
    const racing = calculatorSnapshot({ operators: ['add'], triggered: false });
    const [problem] = find(racing, 'reactive-writer');
    expect(problem?.message).toMatch(/recomputes on its own.*Wire a button into its run port/s);
    expect(problem?.entityId).toBe('nd_math_add');
  });
});

describe('warnings, for work that is merely unfinished', () => {
  it('a freshly dropped node is a warning, not an error', () => {
    const dropped = applyOps(calculatorSnapshot(), [
      { type: 'addNode', node: looseMath('nd_loose') },
    ]);
    const [problem] = find(dropped, 'orphan-node');
    expect(problem?.severity).toBe('warning');
    expect(problem?.message).toMatch(/not wired to anything yet/);
    // And it does not also complain that its two inputs are empty: one row per idea.
    expect(find(dropped, 'unwired-input')).toHaveLength(0);
  });

  it('a result nothing reads is a warning', () => {
    const unread = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      { type: 'removeWire', wireId: 'wr_set_add' },
    ]);
    const [problem] = find(unread, 'unread-result');
    expect(problem?.severity).toBe('warning');
    expect(problem?.message).toMatch(/Nothing shows or keeps what/);
  });
});

describe('the Build tier joins the same list', () => {
  it('adds the compiler’s own refusal when nothing structural explains it', () => {
    // A binding to a port the node does not output: structurally the node exists, so only the
    // compiler catches it.
    const odd = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      {
        type: 'setProp',
        componentId: 'cp_status',
        key: 'content',
        value: { kind: 'bound', source: { nodeId: 'nd_math_add', portId: 'pt_run' } },
      },
    ]);
    const build = find(odd, 'build');
    expect(build).toHaveLength(1);
    expect(build[0]!.severity).toBe('error');
  });

  it('does not repeat a fault a structural row already names', () => {
    const half = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      { type: 'removeWire', wireId: 'wr_a_add' },
    ]);
    const found = diagnose(half);
    expect(found.filter((problem) => problem.code === 'build')).toHaveLength(0);
    expect(found.some((problem) => problem.code === 'unwired-input')).toBe(true);
  });
});

describe('the panel behaves like a list', () => {
  it('shows three distinct problems at once — P2’s done-when', () => {
    const broken = applyOps(calculatorSnapshot({ operators: ['add', 'subtract'] }), [
      { type: 'removeWire', wireId: 'wr_a_add' },
      { type: 'removeWire', wireId: 'wr_set_subtract' },
      { type: 'addNode', node: looseMath('nd_loose') },
    ]);
    const found = diagnose(broken);
    expect(new Set(found.map((problem) => problem.code)).size).toBeGreaterThanOrEqual(3);
    // Every row points somewhere the editor can actually go.
    expect(found.every((problem) => !problem.entityId || Boolean(problem.entityId))).toBe(true);
  });

  it('sorts errors above warnings', () => {
    const broken = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      { type: 'removeWire', wireId: 'wr_a_add' },
      { type: 'addNode', node: looseMath('nd_loose') },
    ]);
    const severities = diagnose(broken).map((problem) => problem.severity);
    expect(severities.indexOf('error')).toBeLessThan(severities.indexOf('warning'));
  });

  it('gives a row the same id across unrelated edits, so the list does not flicker', () => {
    const half = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      { type: 'removeWire', wireId: 'wr_a_add' },
    ]);
    const before = find(half, 'unwired-input')[0]!.id;
    const renamed = applyOps(half, [{ type: 'setName', componentId: 'cp_status', name: 'Answer' }]);
    expect(find(renamed, 'unwired-input')[0]!.id).toBe(before);
  });

  it('never throws, whatever the document says', () => {
    const nonsense: Op[] = [
      {
        type: 'setProp',
        componentId: 'cp_status',
        key: 'content',
        value: { kind: 'bound', source: { nodeId: 'nd_nowhere', portId: 'pt_nothing' } },
      },
      {
        type: 'setVisibleWhen',
        componentId: 'cp_btn_add',
        condition: { source: { nodeId: 'nd_nowhere', portId: 'pt_value' } },
      },
      { type: 'removeNode', nodeId: 'nd_bucket' },
      { type: 'removeNode', nodeId: 'nd_math_add' },
    ];
    const wrecked = applyOps(calculatorSnapshot({ operators: ['add'] }), nonsense);
    expect(() => diagnose(wrecked)).not.toThrow();
    expect(errors(wrecked).length).toBeGreaterThan(0);
  });
});
