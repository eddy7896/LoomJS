import { beforeEach, describe, expect, it } from 'vitest';
import { compile } from '@loom/compiler';
import {
  __resetStore,
  addComponent,
  getState,
  nudgeOrder,
  redo,
  removeComponent,
  rootComponentId,
  select,
  setLayout,
  setStaticProp,
  undo,
} from '../src/state/store';

const snapshot = () => getState().snapshot;
const root = () => rootComponentId(snapshot());
const children = () => snapshot().components[root()]!.children ?? [];

beforeEach(() => __resetStore());

describe('editor store', () => {
  it('starts with an artboard, a root frame and one text', () => {
    expect(Object.keys(snapshot().artboards)).toHaveLength(1);
    expect(children()).toHaveLength(1);
  });

  it('adds a component into the selected container', () => {
    select(root());
    addComponent('Frame');
    const frameId = getState().selectedId!;
    expect(children()).toContain(frameId);

    // A new component lands *inside* the selected container, not beside it.
    addComponent('Text');
    expect(snapshot().components[frameId]!.children).toContain(getState().selectedId);
  });

  it('adds beside a leaf when the selection cannot hold children', () => {
    const textId = children()[0]!;
    select(textId);
    addComponent('Text');
    expect(children()).toHaveLength(2);
  });

  it('undo and redo walk the snapshot history', () => {
    const before = children().length;
    addComponent('Text');
    expect(children()).toHaveLength(before + 1);
    undo();
    expect(children()).toHaveLength(before);
    redo();
    expect(children()).toHaveLength(before + 1);
  });

  it('refuses to delete the artboard root', () => {
    removeComponent(root());
    expect(snapshot().components[root()]).toBeDefined();
  });

  it('reorders siblings', () => {
    addComponent('Text');
    const [first, second] = children();
    nudgeOrder(second!, -1);
    expect(children()).toEqual([second, first]);
  });

  it('edits props and layout through ops', () => {
    const textId = children()[0]!;
    setStaticProp(textId, 'content', 'Edited');
    setLayout(root(), { gap: 40, direction: 'row' });
    expect(snapshot().components[textId]!.props.content).toEqual({
      kind: 'static',
      value: 'Edited',
    });
    expect(snapshot().components[root()]!.layout).toMatchObject({ gap: 40, direction: 'row' });
  });
});

describe('editor -> compiler', () => {
  it('compiles whatever the editor currently holds', () => {
    const textId = children()[0]!;
    setStaticProp(textId, 'content', 'From the editor');
    setLayout(root(), { gap: 32 });

    const { files } = compile(snapshot());
    const home = files.find((f) => f.path.startsWith('src/artboards/'))!.content;

    expect(home).toContain('{"From the editor"}');
    expect(home).toContain('gap: 32');
  });

  it('surfaces an unsupported edit as a Build error rather than emitting nonsense', () => {
    const textId = children()[0]!;
    // A binding cannot compile until M3; the studio shows this as the Build error tier.
    getState().snapshot.components[textId]!.props.content = {
      kind: 'bound',
      source: { nodeId: 'nd_x', portId: 'pt_x' },
    };
    expect(() => compile(snapshot())).toThrow(/not supported yet/);
  });
});
