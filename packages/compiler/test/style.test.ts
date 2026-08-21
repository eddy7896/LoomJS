import { describe, expect, it } from 'vitest';
import { applyOps, type Snapshot } from '@loom/ir';
import { compile } from '../src/index';
import { formSnapshot, trivialSnapshot } from './fixtures';

/**
 * Style emission. The property under test in almost every case is the same one: the emitted code
 * must reference the **token**, not the colour it happens to resolve to today. That is what makes
 * restyling a project one change rather than a search-and-replace.
 */

const fileNamed = (snapshot: Snapshot, path: string): string => {
  const found = compile(snapshot).files.find((file) => file.path === path);
  if (!found) throw new Error(`no ${path} emitted`);
  return found.content;
};

const home = (snapshot: Snapshot): string => fileNamed(snapshot, 'src/artboards/Home.tsx');

/** Style the fixture's form frame and its status Text. */
function styled(style: Record<string, unknown>, componentId = 'cp_form'): Snapshot {
  return applyOps(formSnapshot(), [{ type: 'setStyle', componentId, style }]);
}

describe('styled properties emit token references', () => {
  it('emits var(--loom-…) rather than the value behind it', () => {
    const code = home(
      styled({
        background: { kind: 'token', token: 'color.brand-tint' },
        radius: { kind: 'token', token: 'radius.lg' },
      }),
    );
    expect(code).toContain('background: "var(--loom-color-brand-tint)"');
    expect(code).toContain('borderRadius: "var(--loom-radius-lg)"');
    // The value itself must not appear: that is the thing that would go stale.
    expect(code).not.toContain('#fdece8');
  });

  it('lets a literal through as the escape hatch', () => {
    expect(home(styled({ background: { kind: 'literal', value: 'papayawhip' } }))).toContain(
      'background: "papayawhip"',
    );
  });

  it('styles a leaf as well as a container', () => {
    const code = home(
      styled(
        { textColor: { kind: 'token', token: 'color.brand' }, fontSize: { kind: 'token', token: 'text.xl' } },
        'cp_status',
      ),
    );
    expect(code).toContain('color: "var(--loom-color-brand)"');
    expect(code).toContain('fontSize: "var(--loom-text-xl)"');
  });

  it('completes a border rather than emitting half of one', () => {
    // A colour with no width draws nothing; a width with no colour draws the browser's grey.
    expect(home(styled({ borderColor: { kind: 'token', token: 'color.brand' } }))).toContain(
      'border: "1px solid var(--loom-color-brand)"',
    );
    expect(home(styled({ borderWidth: 2 }))).toContain(
      'border: "2px solid var(--loom-color-hairline)"',
    );
  });

  it('refuses a token the design system does not define', () => {
    expect(() => compile(styled({ background: { kind: 'token', token: 'color.puce' } }))).toThrow(
      /not in the design system/,
    );
  });

  it('keeps layout and style on one element, style winning a collision', () => {
    const code = home(styled({ align: 'center' }));
    // A frame aligns its children; the same control on a leaf aligns its text.
    expect(code).toContain('alignItems: "center"');
    expect(code).toContain('textAlign: "center"');
  });
});

describe('the project theme', () => {
  it('emits loom’s defaults as the app’s own custom properties', () => {
    const css = fileNamed(trivialSnapshot(), 'src/theme.css');
    expect(css).toContain('--loom-color-brand: #ec3013;');
    expect(css).toContain('--loom-font-body:');
  });

  it('carries a project override into the stylesheet, and nowhere else', () => {
    const themed = { ...trivialSnapshot(), theme: { 'color.brand': '#0055ff' } };
    const css = fileNamed(themed, 'src/theme.css');
    expect(css).toContain('--loom-color-brand: #0055ff;');
    expect(css).toContain('--loom-color-ink: #1b1d21;');
  });

  it('loads the brand type faces in the emitted app', () => {
    const html = fileNamed(trivialSnapshot(), 'index.html');
    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('Archivo');
    expect(html).toContain('JetBrains+Mono');
  });

  it('styles the app body from the tokens rather than hard-coded colours', () => {
    const css = fileNamed(trivialSnapshot(), 'src/index.css');
    expect(css).toContain("@import './theme.css';");
    expect(css).toContain('color: var(--loom-color-ink)');
    expect(css).toContain('font-family: var(--loom-font-body)');
  });
});
