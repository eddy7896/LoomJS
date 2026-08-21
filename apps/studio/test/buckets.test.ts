import { beforeEach, describe, expect, it } from 'vitest';
import { compile } from '@loom/compiler';
import {
  __resetStore,
  addArtboard,
  addComponent,
  getState,
  rootComponentId,
  selectComponent,
  selectedComponentId,
  setActiveArtboard,
} from '../src/state/store';
import {
  addGlobalNode,
  addGraphNode,
  connect,
  ensureMirror,
  setNodeConfig,
} from '../src/state/graph';

/**
 * Building the calculator through the same calls the editor makes.
 *
 * The bug this covers was not in the compiler: `connect` replaced whatever was already wired into
 * an input port, so drawing the second operation into a bucket silently unwired the first. A
 * screen bucket's `set` port is the one fan-in port in the language, and this is where that is
 * enforced end to end — the graph the editor produces has to be the graph that compiles.
 */

const snapshot = () => getState().snapshot;
const root = () => rootComponentId(snapshot());

function place(type: string): string {
  selectComponent(root());
  addComponent(type);
  return selectedComponentId()!;
}

/** Two number fields, `operators.length` buttons and Math nodes, one bucket, one Text. */
function buildCalculator(operators: string[]): { bucketId: string; outputId: string } {
  const a = place('NumberField');
  const b = place('NumberField');
  const mirrorA = ensureMirror(a, { x: 0, y: 0 })!;
  const mirrorB = ensureMirror(b, { x: 0, y: 80 })!;

  const bucketId = addGraphNode('state', 'write');
  const outputId = place('Text');
  const outputMirror = ensureMirror(outputId, { x: 400, y: 0 })!;

  for (const [index, operator] of operators.entries()) {
    const button = place('Button');
    const buttonMirror = ensureMirror(button, { x: 0, y: 200 + index * 80 })!;

    const math = addGraphNode('fn', 'math');
    setNodeConfig(math, { operator, inputs: 2 });

    connect({ nodeId: mirrorA, portId: 'pt_value' }, { nodeId: math, portId: 'pt_in_0' });
    connect({ nodeId: mirrorB, portId: 'pt_value' }, { nodeId: math, portId: 'pt_in_1' });
    connect({ nodeId: buttonMirror, portId: 'pt_click' }, { nodeId: math, portId: 'pt_run' });
    connect({ nodeId: math, portId: 'pt_result' }, { nodeId: bucketId, portId: 'pt_set' });
  }

  connect({ nodeId: bucketId, portId: 'pt_value' }, { nodeId: outputMirror, portId: 'pt_content' });
  return { bucketId, outputId };
}

describe('a calculator built through the editor', () => {
  beforeEach(() => __resetStore());

  it('keeps every operation wired into the bucket', () => {
    const { bucketId } = buildCalculator(['add', 'subtract', 'multiply', 'divide']);

    const writes = Object.values(snapshot().wires).filter(
      (wire) => wire.to.nodeId === bucketId && wire.to.portId === 'pt_set',
    );
    expect(writes).toHaveLength(4);
  });

  it('still replaces on an ordinary input port', () => {
    // The exception is the bucket's `set` port and nothing else — a Math input still takes one
    // value, so rewiring it replaces rather than stacks.
    const { bucketId } = buildCalculator(['add']);
    const math = Object.values(snapshot().nodes).find((node) => node.kind === 'math')!;
    const spare = ensureMirror(place('NumberField'), { x: 0, y: 400 })!;

    connect({ nodeId: spare, portId: 'pt_value' }, { nodeId: math.id, portId: 'pt_in_0' });

    const into = Object.values(snapshot().wires).filter(
      (wire) => wire.to.nodeId === math.id && wire.to.portId === 'pt_in_0',
    );
    expect(into).toHaveLength(1);
    expect(into[0]!.from.nodeId).toBe(spare);
    expect(bucketId).toBeTruthy();
  });

  it('binds the output Text to the bucket when the wire is drawn', () => {
    const { bucketId, outputId } = buildCalculator(['add']);
    expect(snapshot().components[outputId]!.props.content).toEqual({
      kind: 'bound',
      source: { nodeId: bucketId, portId: 'pt_value' },
    });
  });

  it('compiles to one bucket that four operations answer into', () => {
    buildCalculator(['add', 'subtract', 'multiply', 'divide']);

    const home = compile(snapshot()).files.find((file) =>
      file.path.startsWith('src/artboards/'),
    )!.content;

    expect(home.match(/= useState<number \| null>\(null\)/g)).toHaveLength(1);
    expect(home.match(/set_state_[a-zA-Z0-9_]+\(/g)).toHaveLength(4);
  });
});

/**
 * The same merge point, one scope wider.
 *
 * A screen variable cannot answer "what did the other screen work out?", because it is one
 * screen's `useState`. Building the global through the editor is the check that matters: the
 * graph a designer draws — a Global node on each screen, one name — has to be the graph that
 * compiles.
 */
describe('a global variable built through the editor', () => {
  beforeEach(() => __resetStore());

  it('shares one value between the screen that fills it and the screen that shows it', () => {
    const { bucketId } = buildCalculator(['add']);
    setNodeConfig(bucketId, { scope: 'global', key: 'answer' });

    // A second screen with its own Global node of the same name, and a Text reading it.
    const report = addArtboard('Report');
    setActiveArtboard(report);
    const total = place('Text');
    const totalMirror = ensureMirror(total, { x: 800, y: 0 })!;
    const mirrorOfSameGlobal = addGlobalNode();
    setNodeConfig(mirrorOfSameGlobal, { key: 'answer' });
    connect(
      { nodeId: mirrorOfSameGlobal, portId: 'pt_value' },
      { nodeId: totalMirror, portId: 'pt_content' },
    );

    const files = compile(snapshot()).files;
    const globals = files.find((file) => file.path === 'src/state/globals.tsx')!.content;
    expect(globals).toContain('const [answer, set_answer] = useState');

    const screens = files.filter((file) => file.path.startsWith('src/artboards/'));
    expect(screens).toHaveLength(2);
    // One writes it, the other reads it, and neither owns it.
    expect(screens.some((file) => file.content.includes('set_answer: set_global_answer'))).toBe(
      true,
    );
    expect(screens.some((file) => file.content.includes('const { answer: global_answer }'))).toBe(
      true,
    );
  });

  it('adds a global already scoped, so the palette button means what it says', () => {
    const id = addGlobalNode();
    expect(snapshot().nodes[id]!.config).toMatchObject({ scope: 'global' });
  });
});
