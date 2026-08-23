import { beforeEach, describe, expect, it } from 'vitest';
import {
  addComponent,
  getState,
  isHiddenInEditor,
  moveComponent,
  rootComponentId,
  selectComponent,
  selectedComponentId,
  toggleEditorVisibility,
  undo,
} from '../src/state/store';
import { resetWithScreen } from './helpers';

/**
 * The elements tree (S2, `docs/11-editor-shell.md`).
 *
 * The two claims worth testing are structural, not visual: a reparent is **one op** so it is one
 * undo, and hiding something while designing **never touches the document** — it is a view
 * concern, and a design-time convenience that silently changed the emitted app would be the worst
 * kind of bug.
 */

const snapshot = () => getState().snapshot;
const root = () => rootComponentId(snapshot());
const childrenOf = (id: string) => snapshot().components[id]?.children ?? [];

function place(type: string, into?: string): string {
  selectComponent(into ?? root());
  addComponent(type);
  return selectedComponentId()!;
}

describe('reparenting from the tree', () => {
  beforeEach(() => resetWithScreen());

  it('moves a component into a different frame', () => {
    const frame = place('Frame');
    const text = place('Text', root());
    expect(childrenOf(root())).toContain(text);

    moveComponent(text, frame);

    expect(childrenOf(frame)).toEqual([text]);
    expect(childrenOf(root())).not.toContain(text);
  });

  it('is one undo, not two', () => {
    // A move that took two steps back would leave the document in a state nobody drew — the same
    // rule `connect` follows for a wire and its binding.
    const frame = place('Frame');
    const text = place('Text', root());
    const before = childrenOf(root());

    moveComponent(text, frame);
    expect(childrenOf(frame)).toEqual([text]);

    undo();

    expect(childrenOf(root())).toEqual(before);
    expect(childrenOf(frame)).toEqual([]);
  });

  it('places a component at a given position among its new siblings', () => {
    const frame = place('Frame');
    const first = place('Text', frame);
    const second = place('Text', frame);
    const outsider = place('Button', root());

    moveComponent(outsider, frame, 1);

    expect(childrenOf(frame)).toEqual([first, outsider, second]);
  });

  it('refuses to move a container into its own subtree', () => {
    const outer = place('Frame');
    const inner = place('Frame', outer);

    // The op guards this too; the tree refuses before dispatching so a bad drag never becomes one.
    expect(() => moveComponent(outer, inner)).toThrow();
  });
});

describe('hiding while designing', () => {
  beforeEach(() => resetWithScreen());

  it('never touches the document', () => {
    const text = place('Text');
    const before = JSON.stringify(snapshot());

    toggleEditorVisibility(text);

    expect(JSON.stringify(snapshot())).toBe(before);
    expect(snapshot().components[text]!.visibleWhen).toBeUndefined();
    expect(getState().hiddenInEditor.has(text)).toBe(true);
  });

  it('toggles back', () => {
    const text = place('Text');
    toggleEditorVisibility(text);
    toggleEditorVisibility(text);
    expect(getState().hiddenInEditor.has(text)).toBe(false);
  });

  it('takes the subtree with it, the way the canvas would', () => {
    const frame = place('Frame');
    const inside = place('Text', frame);

    toggleEditorVisibility(frame);

    const hidden = getState().hiddenInEditor;
    expect(isHiddenInEditor(snapshot(), hidden, frame)).toBe(true);
    expect(isHiddenInEditor(snapshot(), hidden, inside)).toBe(true);
  });

  it('starts over with the project', () => {
    const text = place('Text');
    toggleEditorVisibility(text);
    resetWithScreen();
    expect(getState().hiddenInEditor.size).toBe(0);
  });
});
