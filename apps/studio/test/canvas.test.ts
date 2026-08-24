import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetStore,
  addComponent,
  getState,
  isFree,
  moveTo,
  placeComponent,
  placeScreen,
  setArtboardGuides,
  setLayoutMode,
  rootComponentId,
  selectComponent,
  selectedComponentId,
  setMode,
  setTool,
  toolPlaces,
} from '../src/state/store';
import { resetWithScreen } from './helpers';

/**
 * The canvas as a design tool (`docs/12-canvas.md`).
 *
 * The claim these hold to is the reconciliation: free placement is an **input method**. A gesture
 * ends as a parent, an index and a size — never as an x and a y — which is what lets the canvas
 * feel free while the app still emits flex.
 */

const snapshot = () => getState().snapshot;
const root = () => rootComponentId(snapshot());
const children = () => snapshot().components[root()]!.children ?? [];

beforeEach(() => resetWithScreen());

describe('a new project', () => {
  it('has nothing on it at all — not even a screen', () => {
    // A seeded screen is a decision made on someone's behalf: its size, its name, that there is
    // one of it. Drawing the first frame is how every screen after it gets made anyway.
    __resetStore();
    expect(Object.keys(snapshot().artboards)).toHaveLength(0);
  });

  it('places nothing while there is nowhere to place it', () => {
    __resetStore();
    addComponent('Text');
    expect(Object.keys(snapshot().components)).toHaveLength(0);
  });

  it('calls the first screen Home, because that is the one the app opens on', () => {
    __resetStore();
    const id = placeScreen();
    expect(snapshot().artboards[id]?.name).toBe('Home');
    expect(snapshot().entryArtboard).toBe(id);
    // And the one after it is not.
    const second = placeScreen();
    expect(snapshot().artboards[second]?.name).toBe('Screen 2');
  });

  it('opens a drawn screen on a blank canvas', () => {
    expect(children()).toHaveLength(0);
  });
});

describe('the tool', () => {
  it('starts as the pointer', () => {
    expect(getState().tool).toBe('move');
    expect(toolPlaces('move')).toBeUndefined();
  });

  it('names a component type, with a variant after a colon', () => {
    expect(toolPlaces('Frame')).toEqual({ type: 'Frame' });
    expect(toolPlaces('Shape:ellipse')).toEqual({ type: 'Shape', variant: 'ellipse' });
  });

  it('goes back to the pointer when the canvas is left behind', () => {
    // A half-drawn rectangle has nowhere to land in the node graph.
    setTool('Shape:rectangle');
    setMode('nodes');
    expect(getState().tool).toBe('move');
  });
});

describe('what a drawn gesture becomes', () => {
  it('is a parent, a place and a size', () => {
    const id = placeComponent('Shape', root(), 0, {
      variant: 'ellipse',
      size: { width: 220.4, height: 90.6 },
      position: { x: 60, y: 90 },
    })!;

    const shape = snapshot().components[id]!;
    expect(children()).toEqual([id]);
    expect(shape.props.shape).toEqual({ kind: 'static', value: 'ellipse' });
    expect(shape.layout?.size).toEqual({
      width: { mode: 'fixed', px: 220 },
      height: { mode: 'fixed', px: 91 },
    });
    expect(shape.position).toEqual({ x: 60, y: 90 });
  });

  it('carries no coordinate at all into a frame that arranges its own children', () => {
    // Two layouts described at once is how a document starts lying about itself.
    setLayoutMode(root(), 'stack');
    const id = placeComponent('Shape', root(), 0, { position: { x: 60, y: 90 } })!;
    expect(JSON.stringify(snapshot().components[id])).not.toMatch(/"x"|"y"/);
  });

  it('lands in the slot it was dropped into, not at the end', () => {
    selectComponent(root());
    addComponent('Text');
    const first = selectedComponentId()!;
    const drawn = placeComponent('Shape', root(), 0, {})!;
    expect(children()).toEqual([drawn, first]);
  });

  it('keeps the natural size when nothing was drawn out', () => {
    // A click, rather than a drag: the element decides its own size.
    const id = placeComponent('Text', root(), 0, {})!;
    expect(snapshot().components[id]!.layout?.size).toBeUndefined();
  });

  it('gives a shape a size to start from, because it has no content to hug', () => {
    const id = placeComponent('Shape', root(), 0, {})!;
    expect(snapshot().components[id]!.layout?.size).toEqual({
      width: { mode: 'fixed', px: 160 },
      height: { mode: 'fixed', px: 120 },
    });
  });

  it('selects what it just drew', () => {
    const id = placeComponent('Frame', root(), 0, {})!;
    expect(selectedComponentId()).toBe(id);
  });
});

describe('a screen is a frame with a route', () => {
  it('makes one from a gesture on the open canvas, at the size drawn', () => {
    const before = Object.keys(snapshot().artboards).length;
    const id = placeScreen({ width: 900.4, height: 600.6 });

    expect(Object.keys(snapshot().artboards)).toHaveLength(before + 1);
    expect(snapshot().artboards[id]?.size).toEqual({ width: 900, height: 601 });
    // It owns a root frame like every other screen: there is no second kind of screen.
    expect(snapshot().components[snapshot().artboards[id]!.root]?.type).toBe('Frame');
  });

  it('takes a preset size when one was chosen', () => {
    const id = placeScreen({ width: 390, height: 844, preset: 'phone-sm' });
    expect(snapshot().artboards[id]?.size).toEqual({
      width: 390,
      height: 844,
      preset: 'phone-sm',
    });
  });

  it('gives a frame placed inside a screen the same preset size, as a frame', () => {
    // The same choice means the same shape either way; only the route differs.
    const id = placeComponent('Frame', root(), 0, { variant: 'phone-sm' })!;
    expect(snapshot().components[id]?.layout?.size).toEqual({
      width: { mode: 'fixed', px: 390 },
      height: { mode: 'fixed', px: 844 },
    });
    expect(snapshot().components[id]?.name).toBe('Phone');
  });
});

describe('a screen is a drawing board', () => {
  it('starts free, so what you put somewhere stays there', () => {
    expect(isFree(snapshot(), root())).toBe(true);
    const id = placeScreen();
    expect(isFree(snapshot(), snapshot().artboards[id]!.root)).toBe(true);
  });

  it('keeps where a component was drawn', () => {
    const id = placeComponent('Shape', root(), 0, { position: { x: 120.6, y: 40.2 } })!;
    expect(snapshot().components[id]?.position).toEqual({ x: 121, y: 40 });
  });

  it('drops the position when the frame is handed back to auto layout', () => {
    // Two layouts described at once is how a document starts lying about itself.
    const id = placeComponent('Text', root(), 0, { position: { x: 100, y: 100 } })!;
    setLayoutMode(root(), 'stack');
    expect(snapshot().components[id]?.position).toBeUndefined();
    expect(isFree(snapshot(), root())).toBe(false);
  });

  it('moves a component without touching the tree', () => {
    const id = placeComponent('Text', root(), 0, { position: { x: 10, y: 10 } })!;
    moveTo(id, { x: 200, y: 300 });
    expect(snapshot().components[id]?.position).toEqual({ x: 200, y: 300 });
    expect(snapshot().components[root()]?.children).toEqual([id]);
  });

  it('ignores a position in a frame that arranges its own children', () => {
    setLayoutMode(root(), 'stack');
    const id = placeComponent('Text', root(), 0, { position: { x: 100, y: 100 } })!;
    expect(snapshot().components[id]?.position).toBeUndefined();
  });
});

describe('guides belong to the screen', () => {
  it('are kept in the document, so they are still there tomorrow', () => {
    const id = Object.keys(snapshot().artboards)[0]!;
    setArtboardGuides(id, { x: [120], y: [64, 320] });
    expect(snapshot().artboards[id]?.guides).toEqual({ x: [120], y: [64, 320] });
  });

  it('leave nothing behind when the last one is dragged away', () => {
    const id = Object.keys(snapshot().artboards)[0]!;
    setArtboardGuides(id, { x: [120], y: [] });
    setArtboardGuides(id, { x: [], y: [] });
    expect(snapshot().artboards[id]).not.toHaveProperty('guides');
  });
});
