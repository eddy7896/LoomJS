import { describe, expect, it } from 'vitest';
import { compile } from '@loom/compiler';
import {
  __resetStore,
  addArtboard,
  addComponent,
  extendSelection,
  getState,
  selectComponent,
  selectedComponents,
  setLayout,
  moveTo,
  resizeTo,
} from '../src/state/store';
import { groupSelection, groupingProblem, ungroup } from '../src/state/grouping';
import { addGraphNode, groupNodes, removeNode, removeNodeGroup } from '../src/state/graph';

/**
 * Grouping (G1, `docs/16-grouping.md`).
 *
 * A group is a Frame, so most of what could go wrong is geometry: wrapping has to move children
 * into the new frame's coordinate space and unwrapping has to move them back, or everything jumps
 * the moment you group it. That is the bug every home-made grouping has, so it is what these are
 * mostly about.
 */

function freeScreen(): { root: string } {
  __resetStore();
  const artboardId = addArtboard('Home');
  const root = getState().snapshot.artboards[artboardId]!.root;
  setLayout(root, { mode: 'free' });
  return { root };
}

/** Place a component at a spot, and hand back its id. */
function placeAt(type: string, x: number, y: number): string {
  addComponent(type);
  const id = getState().selection!.id;
  moveTo(id, { x, y });
  // A drawn element carries a size; a placed one does not, and the bounds maths is about sizes.
  resizeTo(id, { width: 50, height: 20 });
  return id;
}

const componentAt = (id: string) => getState().snapshot.components[id]!;

describe('picking more than one thing', () => {
  it('adds with shift and takes away with shift again', () => {
    freeScreen();
    const first = placeAt('Text', 0, 0);
    const second = placeAt('Text', 40, 40);

    selectComponent(first);
    extendSelection(second);
    expect(selectedComponents()).toEqual([first, second]);

    extendSelection(second);
    expect(selectedComponents()).toEqual([first]);
  });

  it('promotes the next one rather than emptying the selection', () => {
    freeScreen();
    const first = placeAt('Text', 0, 0);
    const second = placeAt('Text', 40, 40);

    selectComponent(first);
    extendSelection(second);
    // Shift-clicking the one being edited hands the inspector to the next, which is an
    // adjustment; clearing everything would be undoing work.
    extendSelection(first);
    expect(selectedComponents()).toEqual([second]);
  });

  it('forgets the extras when something else is selected outright', () => {
    freeScreen();
    const first = placeAt('Text', 0, 0);
    const second = placeAt('Text', 40, 40);

    selectComponent(first);
    extendSelection(second);
    selectComponent(first);
    expect(selectedComponents()).toEqual([first]);
  });
});

describe('what cannot be grouped, and why', () => {
  it('says so in words rather than by a button that does nothing', () => {
    freeScreen();
    const only = placeAt('Text', 0, 0);
    const snapshot = getState().snapshot;

    expect(groupingProblem(snapshot, [only])).toMatch(/two or more/);
    expect(groupingProblem(snapshot, [getState().snapshot.artboards[
      Object.keys(snapshot.artboards)[0]!
    ]!.root])).toMatch(/two or more/);
  });

  it('refuses things that do not live in the same frame', () => {
    const { root } = freeScreen();
    const outside = placeAt('Text', 0, 0);

    selectComponent(root);
    addComponent('Frame');
    const frame = getState().selection!.id;
    selectComponent(frame);
    addComponent('Text');
    const inside = getState().selection!.id;

    expect(groupingProblem(getState().snapshot, [outside, inside])).toMatch(/same frame/);
  });
});

describe('grouping in a free frame', () => {
  it('puts the frame around them and leaves everything where it looked', () => {
    freeScreen();
    const first = placeAt('Text', 200, 100);
    const second = placeAt('Text', 260, 180);

    selectComponent(first);
    extendSelection(second);
    const group = groupSelection()!;

    // The frame lands on the bounding box…
    expect(componentAt(group).position).toEqual({ x: 200, y: 100 });
    // …and each child moves into its space, so nothing shifts on screen.
    expect(componentAt(first).position).toEqual({ x: 0, y: 0 });
    expect(componentAt(second).position).toEqual({ x: 60, y: 80 });
    expect(componentAt(group).children).toEqual([first, second]);
  });

  it('gives the group a size, so it can be seen and grabbed', () => {
    freeScreen();
    const first = placeAt('Text', 0, 0);
    const second = placeAt('Text', 150, 50);

    selectComponent(first);
    extendSelection(second);
    const group = groupSelection()!;

    const size = componentAt(group).layout?.size;
    expect(size?.width.mode).toBe('fixed');
    expect(size?.height.mode).toBe('fixed');
  });

  it('ungroups back to exactly where things were', () => {
    freeScreen();
    const first = placeAt('Text', 200, 100);
    const second = placeAt('Text', 260, 180);

    selectComponent(first);
    extendSelection(second);
    const group = groupSelection()!;
    expect(ungroup(group)).toBe(true);

    expect(componentAt(first).position).toEqual({ x: 200, y: 100 });
    expect(componentAt(second).position).toEqual({ x: 260, y: 180 });
    expect(getState().snapshot.components[group]).toBeUndefined();
  });

  it('keeps the order they were drawn in, not the order they were clicked', () => {
    freeScreen();
    const first = placeAt('Text', 0, 0);
    const second = placeAt('Text', 40, 40);

    // Clicked back to front.
    selectComponent(second);
    extendSelection(first);
    const group = groupSelection()!;

    expect(componentAt(group).children).toEqual([first, second]);
  });
});

describe('grouping in a stacked frame', () => {
  it('keeps the direction, so the contents go on reading the same way', () => {
    // A screen is free-placement, so the stacked parent here is a frame inside it.
    freeScreen();
    addComponent('Frame');
    const stack = getState().selection!.id;
    setLayout(stack, { mode: 'stack', direction: 'row', gap: 12 });

    selectComponent(stack);
    addComponent('Text');
    const first = getState().selection!.id;
    selectComponent(stack);
    addComponent('Text');
    const second = getState().selection!.id;

    selectComponent(first);
    extendSelection(second);
    const group = groupSelection()!;

    expect(componentAt(group).layout?.direction).toBe('row');
    expect(componentAt(group).children).toEqual([first, second]);
  });
});

describe('what a group is', () => {
  it('is a Frame, so it compiles like one', () => {
    freeScreen();
    const first = placeAt('Text', 10, 10);
    const second = placeAt('Text', 90, 90);

    selectComponent(first);
    extendSelection(second);
    const group = groupSelection()!;

    expect(componentAt(group).type).toBe('Frame');
    // And the project still emits: a group is nothing the compiler has to learn about.
    const home = compile(getState().snapshot).files.find((file) =>
      file.path.startsWith('src/artboards/'),
    )!;
    expect(home.content).toContain('position: "absolute"');
  });
});

describe('grouping nodes in the graph', () => {
  it('draws a box around them, and changes nothing that runs', () => {
    __resetStore();
    addArtboard('Home');
    const first = addGraphNode('api', 'route');
    const second = addGraphNode('fn', 'compute');

    const group = groupNodes([first, second], 'Sign up')!;
    const stored = getState().snapshot.nodeGroups![group]!;
    expect(stored.title).toBe('Sign up');
    expect(stored.nodeIds).toEqual([first, second]);

    // The nodes are untouched: a box is how the graph reads, not what it does.
    expect(getState().snapshot.nodes[first]!.config).toEqual(
      getState().snapshot.nodes[first]!.config,
    );
    expect(compile(getState().snapshot).files.some((file) => file.content.includes('Sign up'))).toBe(
      false,
    );
  });

  it('needs two nodes, because one node is not a group', () => {
    __resetStore();
    addArtboard('Home');
    const only = addGraphNode('fn', 'compute');
    expect(groupNodes([only])).toBeUndefined();
  });

  it('removing the box leaves the nodes where they are', () => {
    __resetStore();
    addArtboard('Home');
    const first = addGraphNode('fn', 'compute');
    const second = addGraphNode('fn', 'compute');
    const group = groupNodes([first, second])!;

    removeNodeGroup(group);
    expect(getState().snapshot.nodeGroups?.[group]).toBeUndefined();
    expect(getState().snapshot.nodes[first]).toBeDefined();
    expect(getState().snapshot.nodes[second]).toBeDefined();
  });

  it('a group whose last node is deleted goes with it', () => {
    __resetStore();
    addArtboard('Home');
    const first = addGraphNode('fn', 'compute');
    const second = addGraphNode('fn', 'compute');
    const group = groupNodes([first, second])!;

    removeNode(first);
    expect(getState().snapshot.nodeGroups![group]!.nodeIds).toEqual([second]);
    removeNode(second);
    // A box around nothing is not a box.
    expect(getState().snapshot.nodeGroups?.[group]).toBeUndefined();
  });
});
