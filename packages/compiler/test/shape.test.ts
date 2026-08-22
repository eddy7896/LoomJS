import { describe, expect, it } from 'vitest';
import { applyOps, type Component, type Op, type Snapshot } from '@loom/ir';
import { createComponent } from '@loom/components';
import { compile } from '../src/index';
import { trivialSnapshot } from './fixtures';

/**
 * Shapes — the vector primitives (`docs/12-canvas.md` C3).
 *
 * The claim under test: a shape is an ordinary element that happens to draw itself. It takes the
 * same style block, the same conditions and the same layout as everything else, and it emits
 * inline SVG with no runtime behind it.
 */

function withShape(patch: Partial<Component> = {}, shape = 'rectangle'): Snapshot {
  const base = trivialSnapshot();
  const root = Object.values(base.artboards)[0]!.root;
  const component = createComponent('Shape', 'cp_shape');
  component.props.shape = { kind: 'static', value: shape };

  const ops: Op[] = [
    { type: 'addComponent', parentId: root, component: { ...component, ...patch } },
  ];
  return applyOps(base, ops);
}

const home = (snapshot: Snapshot): string => {
  const file = compile(snapshot).files.find((entry) =>
    entry.path.startsWith('src/artboards/'),
  );
  if (!file) throw new Error('no screen emitted');
  return file.content;
};

describe('the three primitives', () => {
  it('draws a rectangle at the size it was given', () => {
    const code = home(withShape());
    expect(code).toContain('<rect');
    // Placed with a size, because a shape has no content to hug.
    expect(code).toContain('width: 160');
    expect(code).toContain('height: 120');
  });

  it('draws an ellipse from the centre, not a rounded box', () => {
    const code = home(withShape({}, 'ellipse'));
    expect(code).toContain('<ellipse cx="50%" cy="50%"');
    expect(code).not.toContain('<rect');
  });

  it('draws a line corner to corner, with no fill', () => {
    const code = home(withShape({}, 'line'));
    expect(code).toContain('<line x1="0" y1="0" x2="100%" y2="100%"');
    expect(code).toContain('fill={"none"}');
  });

  it('refuses a kind it cannot draw', () => {
    expect(() => compile(withShape({}, 'hexagon'))).toThrow(/unknown kind "hexagon"/);
  });
});

describe('paint comes from the style block, not a second vocabulary', () => {
  it('turns background into fill, as a token variable', () => {
    const code = home(withShape({ style: { background: { kind: 'token', token: 'color.brand' } } }));
    expect(code).toContain('fill={"var(--loom-color-brand)"}');
  });

  it('turns the border into a stroke, and insets the box so it is not clipped', () => {
    const code = home(
      withShape({
        style: { borderColor: { kind: 'token', token: 'color.ink' }, borderWidth: 4 },
      }),
    );
    expect(code).toContain('stroke={"var(--loom-color-ink)"}');
    expect(code).toContain('strokeWidth={4}');
    expect(code).toContain('x="2" y="2"');
    expect(code).toContain('width="calc(100% - 4px)"');
  });

  it('rounds a rectangle from the radius token', () => {
    const code = home(withShape({ style: { radius: { kind: 'token', token: 'radius.lg' } } }));
    expect(code).toContain('rx={"var(--loom-radius-lg)"}');
  });

  it('fills with something visible when nothing was chosen', () => {
    // An unstyled, unstroked shape that painted nothing would be a rectangle you cannot see.
    expect(home(withShape())).toContain('fill={"var(--loom-color-brand-tint)"}');
  });
});

describe('a shape is an element like any other', () => {
  it('changes fill on a condition rather than ignoring it', () => {
    // The style block became SVG attributes, so a conditional override had to be carried across;
    // a fill that quietly refuses to change is the canvas-disagrees-with-app failure.
    const snapshot = withShape({
      style: { background: { kind: 'token', token: 'color.surface' } },
      conditionalStyles: [
        {
          when: { source: { nodeId: 'nd_state', portId: 'pt_value' } },
          style: { background: { kind: 'token', token: 'color.ok' } },
        },
      ],
    });

    // The condition reads a checkbox on the same screen — the simplest boolean the language has.
    const withCheckbox = applyOps(snapshot, [
      {
        type: 'addComponent',
        parentId: Object.values(snapshot.artboards)[0]!.root,
        component: {
          id: 'cp_done',
          type: 'Checkbox',
          name: 'Done',
          props: { label: { kind: 'static', value: 'Done' }, value: { kind: 'static', value: false } },
        },
      },
      {
        type: 'addNode',
        node: {
          id: 'nd_state',
          category: 'ui',
          kind: 'mirror',
          mirrorOf: 'cp_done',
          position: { x: 0, y: 0 },
          ports: [
            {
              id: 'pt_value',
              name: 'checked',
              direction: 'out',
              portKind: 'data',
              type: { kind: 'boolean' },
            },
          ],
        },
      },
    ]);

    const code = home(withCheckbox);
    expect(code).toContain('var(--loom-color-ok)');
    expect(code).toContain('var(--loom-color-surface)');
  });

  it('is decorative unless it was named, and then it is announced', () => {
    expect(home(withShape())).toContain('aria-hidden="true"');
    expect(home(withShape({ name: 'Progress ring' }))).toContain('aria-label="Progress ring"');
  });
});
