import { beforeEach, describe, expect, it } from 'vitest';
import { compile } from '@loom/compiler';
import {
  __resetStore,
  addArtboard,
  addComponent,
  flowFor,
  removeArtboard,
  setActiveArtboard,
  setArtboardParams,
  setClickFlow,
  setFlowPayload,
  setProp,
  setSize,
  getState,
  nudgeOrder,
  redo,
  removeComponent,
  rootComponentId,
  selectComponent,
  selectedComponentId,
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
    selectComponent(root());
    addComponent('Frame');
    const frameId = selectedComponentId()!;
    expect(children()).toContain(frameId);

    // A new component lands *inside* the selected container, not beside it.
    addComponent('Text');
    expect(snapshot().components[frameId]!.children).toContain(selectedComponentId());
  });

  it('adds beside a leaf when the selection cannot hold children', () => {
    const textId = children()[0]!;
    selectComponent(textId);
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

  it('surfaces a binding with no pipeline behind it as a Build error', () => {
    const textId = children()[0]!;
    getState().snapshot.components[textId]!.props.content = {
      kind: 'bound',
      source: { nodeId: 'nd_x', portId: 'pt_result' },
    };
    expect(() => compile(snapshot())).toThrow(/does not produce a value from/);
  });
});

describe('artboards and flows (M2)', () => {
  it('adds an artboard with its own root and makes it active', () => {
    const homeRoot = root();
    const detailId = addArtboard('Item Detail');
    expect(getState().activeArtboardId).toBe(detailId);
    expect(rootComponentId(snapshot(), detailId)).not.toBe(homeRoot);
    // New components now land in the new screen, not the old one.
    addComponent('Text');
    expect(snapshot().components[rootComponentId(snapshot(), detailId)]!.children).toHaveLength(1);
  });

  it('pointing a click at another screen creates the flow and wires the handler', () => {
    const detailId = addArtboard('Item Detail');
    setActiveArtboard(getState().snapshot.entryArtboard!);
    selectComponent(root());
    addComponent('Button');
    const buttonId = selectedComponentId()!;

    setClickFlow(buttonId, detailId);

    const flowId = flowFor(snapshot(), buttonId)!;
    expect(flowId).toBeDefined();
    expect(snapshot().flows[flowId]!.to).toBe(detailId);
    expect(snapshot().components[buttonId]!.props.onClick).toEqual({
      kind: 'event',
      handler: { kind: 'navigate', flowId },
    });
  });

  it('clearing the target removes the flow and the handler', () => {
    const detailId = addArtboard('Item Detail');
    setActiveArtboard(getState().snapshot.entryArtboard!);
    selectComponent(root());
    addComponent('Button');
    const buttonId = selectedComponentId()!;

    setClickFlow(buttonId, detailId);
    setClickFlow(buttonId, undefined);

    expect(Object.keys(snapshot().flows)).toHaveLength(0);
    expect(snapshot().components[buttonId]!.props.onClick).toBeUndefined();
  });

  it('deleting an artboard takes its flows with it', () => {
    const detailId = addArtboard('Item Detail');
    setActiveArtboard(getState().snapshot.entryArtboard!);
    selectComponent(root());
    addComponent('Button');
    setClickFlow(selectedComponentId()!, detailId);
    expect(Object.keys(snapshot().flows)).toHaveLength(1);

    removeArtboard(detailId);
    expect(Object.keys(snapshot().flows)).toHaveLength(0);
  });

  it('setSize keeps the other axis', () => {
    setSize(root(), 'width', { mode: 'fixed', px: 320 });
    setSize(root(), 'height', { mode: 'fill' });
    expect(snapshot().components[root()]!.layout!.size).toEqual({
      width: { mode: 'fixed', px: 320 },
      height: { mode: 'fill' },
    });
  });
});

describe('editor -> compiler (M2 routing)', () => {
  it('compiles two screens and a flow into two routes and a navigate call', () => {
    const detailId = addArtboard('Item Detail');
    setArtboardParams(detailId, [{ name: 'id', type: { kind: 'text' } }]);

    selectComponent(rootComponentId(snapshot(), detailId));
    addComponent('Text');
    setProp(selectedComponentId()!, 'content', { kind: 'param', name: 'id' });

    setActiveArtboard(getState().snapshot.entryArtboard!);
    selectComponent(root());
    addComponent('Button');
    const buttonId = selectedComponentId()!;
    setClickFlow(buttonId, detailId);
    setFlowPayload(flowFor(snapshot(), buttonId)!, [{ kind: 'static', param: 'id', value: '42' }]);

    const { files } = compile(snapshot());
    const app = files.find((f) => f.path === 'src/App.tsx')!.content;
    const detail = files.find((f) => f.path === 'src/artboards/ItemDetail.tsx')!.content;
    const home = files.find((f) => f.path === 'src/artboards/Home.tsx')!.content;

    expect(app).toContain('<Route path="/" element={<Home />} />');
    expect(app).toContain('<Route path="/item-detail/:id" element={<ItemDetail />} />');
    expect(home).toContain('useNavigate()');
    expect(home).toContain('encodeURIComponent(String("42"))');
    expect(detail).toContain('{params.id ?? ""}');
  });
});
