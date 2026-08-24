import { describe, expect, it } from 'vitest';
import { applyOps, type Component, type Snapshot } from '@loom/ir';
import { componentDefs, createComponent, hasFieldState, mirrorPortsFor } from '@loom/components';
import { compile } from '../src/index';
import { formSnapshot, masterDetailSnapshot } from './fixtures';

/**
 * The seven elements added in S3 (`docs/11-editor-shell.md`).
 *
 * Each earned its place by being something the existing vocabulary could not say. The assertions
 * are mostly about the parts a designer cannot see and would not think to check: alt text, link
 * targets, radio grouping, and the type each input carries into the graph.
 */

const home = (snapshot: Snapshot): string => {
  const file = compile(snapshot).files.find((f) => f.path === 'src/artboards/Home.tsx');
  if (!file) throw new Error('no Home artboard emitted');
  return file.content;
};

/** Put one component of `type` on the form fixture and compile. */
function place(type: string, props: Record<string, unknown> = {}): string {
  const component = createComponent(type, `cp_${type.toLowerCase()}`);
  for (const [key, value] of Object.entries(props)) {
    component.props[key] = { kind: 'static', value };
  }
  return home(applyOps(formSnapshot(), [{ type: 'addComponent', component, parentId: 'cp_form' }]));
}

describe('the palette and the templates agree', () => {
  it('every definition has a category and something to search by', () => {
    for (const def of componentDefs()) {
      expect(def.category, def.type).toBeDefined();
      expect(def.label.length, def.type).toBeGreaterThan(0);
    }
  });

  it('a freshly placed element of every type compiles', () => {
    // The same rule an action follows: what you just placed must not break the build.
    for (const def of componentDefs()) {
      if (def.type === 'Frame') continue;
      expect(() => place(def.type), def.type).not.toThrow();
    }
  });
});

describe('image', () => {
  it('always writes an alt attribute, even when it is empty', () => {
    // Empty alt is a decision — "this picture carries no meaning" — but it has to be written.
    const code = place('Image', { src: '/logo.png', alt: '' });
    expect(code).toContain('<img');
    expect(code).toContain('alt={""}');
    expect(code).toContain('src={"/logo.png"}');
  });

  it('carries the alt text a designer typed', () => {
    expect(place('Image', { src: '/a.png', alt: 'A cat' })).toContain('alt={"A cat"}');
  });
});

describe('link', () => {
  it('emits a real anchor, not a div that moves the page', () => {
    const code = place('Link', { label: 'Docs', href: 'https://example.com' });
    expect(code).toContain('<a');
    expect(code).toContain('href={"https://example.com"}');
  });

  it('adds noopener and noreferrer to a new tab, always', () => {
    // Without it the opened page can reach back through `window.opener`.
    const code = place('Link', { href: 'https://example.com', newTab: true });
    expect(code).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it('uses the router when it points at a screen, not a page load', () => {
    // A full load would throw away the app state to reach a route it already has.
    const link: Component = {
      id: 'cp_link',
      type: 'Link',
      name: 'Open',
      props: {
        label: { kind: 'static', value: 'Open' },
        onClick: { kind: 'event', handler: { kind: 'navigate', flowId: 'fl_1' } },
      },
    };
    const code = home(
      applyOps(masterDetailSnapshot(), [
        { type: 'addComponent', component: link, parentId: 'cp_root000001' },
      ]),
    );

    expect(code).toContain("from 'react-router-dom'");
    expect(code).toContain('<Link');
    expect(code).toContain('to={');
  });

  it('refuses a link with nowhere to go, and says both ways to fix it', () => {
    expect(() => place('Link', { href: '   ' })).toThrow(/has nowhere to go/);
  });
});

describe('icon', () => {
  it('inlines the path — no font, no package', () => {
    const code = place('Icon', { name: 'trash', size: 16 });
    expect(code).toContain('<svg');
    expect(code).toContain('width={16}');
    expect(code).toContain('<path d={"M4 7h16');
    // Beside a label it would otherwise be announced twice.
    expect(code).toContain('aria-hidden="true"');
  });

  it('falls back rather than emitting an empty shape', () => {
    expect(place('Icon', { name: 'not-a-real-icon' })).toContain('<path d={"');
  });
});

describe('the new inputs hold the right type', () => {
  it('a multiline field is a textarea', () => {
    const code = place('MultilineField', { value: 'hi', rows: 6 });
    expect(code).toContain('<textarea');
    expect(code).toContain('rows={6}');
    expect(code).toContain('useState("hi")');
  });

  it('a slider holds a number, and its change is coerced to one', () => {
    const code = place('Slider', { value: 30, min: 10, max: 90, step: 5 });
    expect(code).toContain('type="range"');
    expect(code).toContain('useState(30)');
    expect(code).toContain('min={10}');
    expect(code).toContain('step={5}');
    // `event.target.value` is a string; holding "30" would poison a numeric column.
    expect(code).toContain('Number(event.target.value)');
  });

  it('a date field holds the string a date column accepts', () => {
    const code = place('DateField', { value: '2026-01-01', min: '2020-01-01' });
    expect(code).toContain('type="date"');
    expect(code).toContain('useState("2026-01-01")');
    expect(code).toContain('min={"2020-01-01"}');
  });

  it('radio buttons share one name, so two groups cannot clear each other', () => {
    const code = place('RadioGroup', { options: 'Low, High', label: 'Priority' });
    expect(code).toContain('<fieldset');
    expect(code).toContain('<legend>{"Priority"}</legend>');
    expect(code.match(/name=\{"field_cp_radiogroup"\}/g)).toHaveLength(2);
    expect(code).toContain('type="radio"');
  });

  it('a radio group starts on nothing, because nothing chosen is a real answer', () => {
    // Unlike a Select, which always shows something.
    expect(place('RadioGroup', { options: 'Low, High' })).toContain('useState("")');
  });

  it('each new input carries its type into the graph', () => {
    expect(portsOf('MultilineField')[0]!.type).toEqual({ kind: 'text' });
    expect(portsOf('Slider')[0]!.type).toEqual({ kind: 'number' });
    // Typed by the options it carries, rather than as bare text (N0).
    expect(portsOf('RadioGroup')[0]!.type).toEqual({ kind: 'enum', values: ['One', 'Two'] });
    // The browser hands back `YYYY-MM-DD`; typing it `date` would promise a conversion nothing does.
    expect(portsOf('DateField')[0]!.type).toEqual({ kind: 'text' });
  });

  it('knows which of the new elements own a value', () => {
    for (const type of ['MultilineField', 'Slider', 'RadioGroup', 'DateField']) {
      expect(hasFieldState(type), type).toBe(true);
    }
    for (const type of ['Image', 'Link', 'Icon']) {
      expect(hasFieldState(type), type).toBe(false);
    }
  });
});

/**
 * A fresh component of `type`, and the ports it shows in Nodes mode.
 *
 * Ports depend on the element's static props now — a Select types its port by the options it
 * actually carries — so this builds the real thing rather than asking about a bare type string.
 */
const portsOf = (type: string) => mirrorPortsFor(createComponent(type, 'cp_probe'));

describe('the visual elements can be bound', () => {
  it('an image source and a link address take a wire', () => {
    expect(portsOf('Image')[0]!.id).toBe('pt_src');
    expect(portsOf('Link')[0]!.id).toBe('pt_href');
  });
});
