import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetStore,
  addComponent,
  getState,
  placeComponent,
  placeScreen,
  rootComponentId,
  selectComponent,
  selectedComponentId,
  setMode,
  setTool,
  toolPlaces,
} from '../src/state/store';

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

beforeEach(() => __resetStore());

describe('a new project', () => {
  it('opens on a blank canvas', () => {
    // The sample heading that used to live here existed because the first compiler needed
    // something to emit, and it became the first thing every designer deletes.
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
  it('is a parent, an index and a size — never a coordinate', () => {
    const id = placeComponent('Shape', root(), 0, {
      variant: 'ellipse',
      size: { width: 220.4, height: 90.6 },
    })!;

    const shape = snapshot().components[id]!;
    expect(children()).toEqual([id]);
    expect(shape.props.shape).toEqual({ kind: 'static', value: 'ellipse' });
    expect(shape.layout?.size).toEqual({
      width: { mode: 'fixed', px: 220 },
      height: { mode: 'fixed', px: 91 },
    });
    expect(JSON.stringify(shape)).not.toMatch(/"x"|"y"|left|top/);
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
