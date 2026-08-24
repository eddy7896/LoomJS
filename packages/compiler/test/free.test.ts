import { describe, expect, it } from 'vitest';
import { applyOps, type Op, type Snapshot } from '@loom/ir';
import { compile } from '../src/index';
import { trivialSnapshot } from './fixtures';

/**
 * Free placement (`docs/12-canvas.md`).
 *
 * A frame either arranges its children or holds them where they were put. The second one emits
 * absolute positions inside a relative parent — real CSS a developer would recognise — and the
 * document never carries both descriptions at once.
 */

const home = (snapshot: Snapshot): string => {
  const file = compile(snapshot).files.find((entry) => entry.path.startsWith('src/artboards/'));
  if (!file) throw new Error('no screen emitted');
  return file.content;
};

function freeHome(children: { id: string; x: number; y: number }[] = []): Snapshot {
  const base = trivialSnapshot();
  const root = Object.values(base.artboards)[0]!.root;

  const ops: Op[] = [
    { type: 'setLayout', componentId: root, layout: { mode: 'free' } },
    ...children.map(
      (child): Op => ({
        type: 'addComponent',
        parentId: root,
        component: {
          id: child.id,
          type: 'Text',
          name: child.id,
          props: { content: { kind: 'static', value: child.id } },
          position: { x: child.x, y: child.y },
        },
      }),
    ),
  ];
  return applyOps(base, ops);
}

describe('a free frame', () => {
  it('is a positioning context, not a flex container', () => {
    const code = home(freeHome());
    expect(code).toContain('position: "relative"');
    // A flex container whose children are all out of flow describes nothing.
    expect(code).not.toContain('flexDirection');
    expect(code).not.toContain('gap:');
  });

  it('keeps its padding, which still means something', () => {
    expect(home(freeHome())).toContain('padding: 24');
  });

  it('places each child where it was put', () => {
    const code = home(freeHome([{ id: 'cp_a', x: 40, y: 120 }]));
    expect(code).toContain('position: "absolute"');
    expect(code).toContain('left: 40');
    expect(code).toContain('top: 120');
  });

  it('places a child that has never been moved at the origin', () => {
    const base = freeHome();
    const root = Object.values(base.artboards)[0]!.root;
    const added = applyOps(base, [
      {
        type: 'addComponent',
        parentId: root,
        component: { id: 'cp_new', type: 'Text', props: {} },
      },
    ]);
    expect(home(added)).toContain('left: 0');
  });
});

describe('a stacked frame', () => {
  it('ignores a position, rather than describing two layouts at once', () => {
    // A document can carry a leftover position after a frame is handed back to auto layout; the
    // frame's own arrangement is the one that counts.
    const base = trivialSnapshot();
    const root = Object.values(base.artboards)[0]!.root;
    const stacked = applyOps(base, [
      {
        type: 'addComponent',
        parentId: root,
        component: {
          id: 'cp_a',
          type: 'Text',
          props: { content: { kind: 'static', value: 'a' } },
          position: { x: 400, y: 400 },
        },
      },
    ]);

    const code = home(stacked);
    expect(code).toContain('flexDirection');
    expect(code).not.toContain('position: "absolute"');
    expect(code).not.toContain('left: 400');
  });
});

describe('what a document written before free placement means', () => {
  it('still stacks, because absent is not free', () => {
    expect(home(trivialSnapshot())).toContain('flexDirection: "column"');
  });
});
