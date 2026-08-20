import { beforeEach, describe, expect, it } from 'vitest';
import { compile } from '@loom/compiler';
import {
  __resetStore,
  addComponent,
  getState,
  rootComponentId,
  selectComponent,
  selectedComponentId,
  setStaticProp,
} from '../src/state/store';
import {
  addBodyStep,
  addGraphNode,
  connect,
  ensureMirror,
  mirrorNodeFor,
  removeNode,
  setNodeConfig,
} from '../src/state/graph';

const snapshot = () => getState().snapshot;
const root = () => rootComponentId(snapshot());

/** The M3 shape, built through the same calls the UI makes. */
function buildPipeline(): { apiId: string; fieldId: string; buttonId: string; outputId: string } {
  selectComponent(root());
  addComponent('TextField');
  const fieldId = selectedComponentId()!;

  selectComponent(root());
  addComponent('Button');
  const buttonId = selectedComponentId()!;

  selectComponent(root());
  addComponent('Text');
  const outputId = selectedComponentId()!;

  const apiId = addGraphNode('api', 'route');
  addBodyStep(apiId, 'compute');

  const fieldMirror = ensureMirror(fieldId, { x: 0, y: 0 })!;
  const buttonMirror = ensureMirror(buttonId, { x: 0, y: 100 })!;

  connect({ nodeId: buttonMirror, portId: 'pt_click' }, { nodeId: apiId, portId: 'pt_run' });
  connect({ nodeId: fieldMirror, portId: 'pt_value' }, { nodeId: apiId, portId: 'pt_input' });

  setStaticProp(outputId, 'content', '');
  getState().snapshot.components[outputId]!.props.content = {
    kind: 'bound',
    source: { nodeId: apiId, portId: 'pt_result' },
  };

  return { apiId, fieldId, buttonId, outputId };
}

beforeEach(() => __resetStore());

describe('nodes-mode graph', () => {
  it('materialises a mirror only once, and only when wired', () => {
    selectComponent(root());
    addComponent('Button');
    const buttonId = selectedComponentId()!;

    expect(mirrorNodeFor(snapshot(), buttonId)).toBeUndefined();
    const first = ensureMirror(buttonId, { x: 0, y: 0 });
    const second = ensureMirror(buttonId, { x: 50, y: 50 });
    expect(first).toBe(second);
    expect(Object.keys(snapshot().nodes)).toHaveLength(1);
  });

  it('puts a function node inside the API route body, not loose on the canvas', () => {
    const apiId = addGraphNode('api', 'route');
    const stepId = addBodyStep(apiId, 'compute')!;
    expect((snapshot().nodes[apiId]!.config as { body: string[] }).body).toEqual([stepId]);
  });

  it('wiring a trigger also wires the component handler', () => {
    const { apiId, buttonId } = buildPipeline();
    expect(snapshot().components[buttonId]!.props.onClick).toEqual({
      kind: 'event',
      handler: { kind: 'trigger', target: { nodeId: apiId, portId: 'pt_run' } },
    });
  });

  it('refuses a wire the type system rejects, and adds nothing', () => {
    const apiId = addGraphNode('api', 'route');
    selectComponent(root());
    addComponent('Button');
    const mirror = ensureMirror(selectedComponentId()!, { x: 0, y: 0 })!;

    const result = connect(
      { nodeId: mirror, portId: 'pt_click' },
      { nodeId: apiId, portId: 'pt_input' },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/trigger port to a data port/);
    expect(Object.keys(snapshot().wires)).toHaveLength(0);
  });

  it('replaces rather than stacks when an input is rewired', () => {
    const { apiId, fieldId } = buildPipeline();
    selectComponent(root());
    addComponent('TextField');
    const second = ensureMirror(selectedComponentId()!, { x: 0, y: 0 })!;

    connect({ nodeId: second, portId: 'pt_value' }, { nodeId: apiId, portId: 'pt_input' });

    const intoInput = Object.values(snapshot().wires).filter((w) => w.to.portId === 'pt_input');
    expect(intoInput).toHaveLength(1);
    expect(intoInput[0]!.from.nodeId).toBe(mirrorNodeFor(snapshot(), fieldId)!.id === second ? second : intoInput[0]!.from.nodeId);
  });

  it('retypes ports when a Compute node changes operation, dropping wires that no longer fit', () => {
    const apiId = addGraphNode('api', 'route');
    const stepId = addBodyStep(apiId, 'compute')!;
    // By id, not by index: a Compute also carries a `run` port, and the order is not the contract.
    const inputType = () =>
      snapshot().nodes[stepId]!.ports.find((port) => port.id === 'pt_input')!.type;

    expect(inputType()).toEqual({ kind: 'text' });
    setNodeConfig(stepId, { op: 'double' });
    expect(inputType()).toEqual({ kind: 'number' });
  });

  it('deleting a node takes its wires and the handlers pointing at it', () => {
    const { apiId, buttonId } = buildPipeline();
    removeNode(apiId);
    expect(snapshot().nodes[apiId]).toBeUndefined();
    expect(Object.keys(snapshot().wires)).toHaveLength(0);
    expect(snapshot().components[buttonId]!.props.onClick).toBeUndefined();
  });
});

describe('editor -> compiler (M3 backend)', () => {
  it('compiles the graph the editor built into a function and a pipeline', () => {
    const { apiId } = buildPipeline();
    const { files } = compile(snapshot());

    const api = files.find((f) => f.path.startsWith('api/'))!;
    expect(api.content).toContain('value = String(value).toUpperCase();');

    const home = files.find((f) => f.path.startsWith('src/artboards/'))!.content;
    expect(home).toContain(`run_${apiId.replace(/[^a-zA-Z0-9_]/g, '_')}`);
    expect(home).toContain('await fetch("/api/run"');
  });
});
