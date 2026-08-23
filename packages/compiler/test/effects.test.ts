import { describe, expect, it } from 'vitest';
import { applyOps, type Effect, type Snapshot, type StyleValue } from '@loom/ir';
import { compile } from '../src/index';
import { trivialSnapshot } from './fixtures';

/**
 * Effects and custom values (`docs/13-inspector.md`).
 *
 * Each effect is a **composition** — glass is a backdrop blur, a tint and an edge — and every one
 * of them emits ordinary CSS. Nothing here ships a library, and nothing needs a runtime: what a
 * developer opens the repo to find is the same thing they would have written.
 */

const home = (snapshot: Snapshot): string => {
  const file = compile(snapshot).files.find((entry) => entry.path.startsWith('src/artboards/'));
  if (!file) throw new Error('no screen emitted');
  return file.content;
};

function styled(patch: { effects?: Effect[]; radius?: StyleValue }): string {
  const base = trivialSnapshot();
  const root = Object.values(base.artboards)[0]!.root;
  return home(applyOps(base, [{ type: 'setStyle', componentId: root, style: patch }]));
}

describe('shadows', () => {
  it('emits the four numbers and the colour, in CSS order', () => {
    const code = styled({
      effects: [{ kind: 'shadow', x: 0, y: 8, blur: 24, spread: -4, color: 'rgb(0 0 0 / 18%)' }],
    });
    expect(code).toContain('boxShadow: "0px 8px 24px -4px rgb(0 0 0 / 18%)"');
  });

  it('stacks several in the order they were added', () => {
    const code = styled({
      effects: [
        { kind: 'shadow', x: 0, y: 1, blur: 2, spread: 0, color: '#000' },
        { kind: 'shadow', x: 0, y: 12, blur: 32, spread: 0, color: '#111' },
      ],
    });
    expect(code).toContain('boxShadow: "0px 1px 2px 0px #000, 0px 12px 32px 0px #111"');
  });

  it('turns an inner shadow into the same property with one word added', () => {
    const code = styled({
      effects: [{ kind: 'shadow', x: 0, y: 2, blur: 6, spread: 0, color: '#000', inset: true }],
    });
    expect(code).toContain('boxShadow: "inset 0px 2px 6px 0px #000"');
  });
});

describe('glass', () => {
  const code = styled({ effects: [{ kind: 'glass', blur: 12, tint: '#ffffff', opacity: 40 }] });

  it('blurs what is behind it', () => {
    expect(code).toContain('backdropFilter: "blur(12px)"');
  });

  it('tints translucently, or the blur would be invisible under it', () => {
    expect(code).toContain('background: "rgb(255 255 255 / 40%)"');
  });

  it('carries the edge that makes glass read as glass', () => {
    expect(code).toContain('border: "1px solid rgb(255 255 255 / 35%)"');
  });
});

describe('grain', () => {
  const code = styled({ effects: [{ kind: 'noise', opacity: 20, scale: 65 }] });

  it('is drawn by the browser rather than shipped as an image', () => {
    expect(code).toContain('feTurbulence');
    expect(code).toContain('data:image/svg+xml');
    // No request, and nothing to put in a repo.
    expect(code).not.toContain('.png');
  });

  it('sits over the fill rather than replacing it', () => {
    expect(code).toContain('backgroundBlendMode: "overlay"');
  });
});

describe('blur', () => {
  it('blurs the layer itself, which is a different property from glass', () => {
    const code = styled({ effects: [{ kind: 'blur', radius: 4 }] });
    expect(code).toContain('filter: "blur(4px)"');
    expect(code).not.toContain('backdropFilter');
  });
});

describe('values a designer typed', () => {
  it('takes any corner radius, including four different corners', () => {
    const code = styled({ radius: { kind: 'literal', value: '12px 12px 0px 0px' } });
    expect(code).toContain('borderRadius: "12px 12px 0px 0px"');
  });

  it('still emits a token as a variable, so the system keeps working', () => {
    const code = styled({ radius: { kind: 'token', token: 'radius.lg' } });
    expect(code).toContain('borderRadius: "var(--loom-radius-lg)"');
  });
});
