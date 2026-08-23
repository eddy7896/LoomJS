import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { componentDefs, createComponent, type ComponentDef } from '@loom/components';
import { createEmptyProject, newComponentId, type Component, type Snapshot } from '@loom/ir';
import { ComponentView } from '../src/canvas/ComponentView';

/**
 * Every element the palette offers has to *draw* on the canvas (`docs/21-canvas-parity.md`).
 *
 * The canvas is a second renderer: the compiler emits JSX for the app, and this file draws React
 * for the editor. Two renderers means a type can be added to one and forgotten in the other, and
 * what that looks like to a designer is an element that lands as an empty box — placed, selectable,
 * invisible. Eight of them were in exactly that state.
 *
 * So this walks the whole vocabulary rather than naming types: a new element that nobody taught
 * the canvas about fails here, on the day it is added.
 */

let host: HTMLDivElement | undefined;

afterEach(() => {
  host?.remove();
  host = undefined;
});

/** Draw one component on its own, and hand back the element the canvas made for it. */
function draw(component: Component): HTMLElement {
  const project: Snapshot = createEmptyProject('Parity');
  const snapshot: Snapshot = {
    ...project,
    components: { [component.id]: component },
  };

  host = document.createElement('div');
  document.body.append(host);

  const root = createRoot(host);
  act(() => {
    root.render(
      <ComponentView
        snapshot={snapshot}
        id={component.id}
        onSelect={() => undefined}
        registerNode={() => undefined}
        onPointerDown={() => undefined}
        draggingId={undefined}
        alsoSelected={[]}
        hidden={new Set()}
      />,
    );
  });

  const drawn = host.querySelector<HTMLElement>(`[data-loom-id="${component.id}"]`);
  if (!drawn) throw new Error(`${component.type} drew nothing at all`);
  return drawn;
}

/** A leaf that renders as a bare, empty box is the failure this file is about. */
function isEmptyBox(element: HTMLElement): boolean {
  return (
    element.tagName === 'DIV' &&
    element.children.length === 0 &&
    element.textContent?.trim() === '' &&
    !element.className.includes('canvas-placeholder')
  );
}

const leaves = componentDefs().filter((def) => !def.isContainer);

describe('every element draws something', () => {
  it.each(leaves.map((def) => [def.type, def] as const))('%s', (_type, def: ComponentDef) => {
    const component = createComponent(def.type, newComponentId());
    const drawn = draw(component);

    // Not a blank div: a designer who places one has to be able to see what they placed.
    expect(isEmptyBox(drawn)).toBe(false);
  });

  it('covers the whole vocabulary, so this cannot be passed by shrinking the list', () => {
    // If an element stops being counted here, the guard stops guarding.
    expect(leaves.length).toBeGreaterThanOrEqual(15);
  });
});

describe('what each one draws', () => {
  const drawType = (type: string, props: Record<string, unknown> = {}): HTMLElement => {
    const component = createComponent(type, newComponentId());
    for (const [key, value] of Object.entries(props)) {
      component.props[key] = { kind: 'static', value } as Component['props'][string];
    }
    return draw(component);
  };

  it('draws the control a person will actually use', () => {
    // These are the ones that were landing as empty boxes.
    expect(drawType('MultilineField').tagName).toBe('TEXTAREA');
    expect(drawType('DateField').getAttribute('type')).toBe('date');
    expect(drawType('Slider').getAttribute('type')).toBe('range');
    expect(drawType('RadioGroup', { options: 'Low, High' }).tagName).toBe('FIELDSET');
    expect(drawType('Link', { label: 'Read more' }).tagName).toBe('A');
    expect(drawType('Icon').tagName.toLowerCase()).toBe('svg');
  });

  it('gives a picture with no address a place rather than a broken icon', () => {
    const placeholder = drawType('Image', { src: '', alt: 'A cat' });
    expect(placeholder.tagName).toBe('DIV');
    expect(placeholder.textContent).toContain('A cat');

    const real = drawType('Image', { src: 'https://example.com/cat.png', alt: 'A cat' });
    expect(real.tagName).toBe('IMG');
    expect(real.getAttribute('alt')).toBe('A cat');
  });

  it('draws a Table as a table, with the columns that will ship', () => {
    const table = drawType('Table', { columns: 'title, body' });
    const headers = [...table.querySelectorAll('th')].map((cell) => cell.textContent);
    expect(headers).toEqual(['title', 'body']);
    // The rows are ghosts: the canvas has no data, and inventing values would be a screenshot of
    // an app that does not exist.
    expect(table.querySelectorAll('tbody td')).toHaveLength(4);
  });

  it('says where the columns will come from when none are named', () => {
    // The app works them out from the first row, so the canvas says that rather than drawing a
    // header it cannot know.
    const table = drawType('Table', { columns: '' });
    expect(table.textContent).toContain('Columns come from the first row');
  });

  it('draws a radio per option, and the question above them', () => {
    const group = drawType('RadioGroup', { options: 'Low, Medium, High', label: 'Priority' });
    expect(group.querySelector('legend')?.textContent).toBe('Priority');
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(3);
  });
});

describe('a value that only exists at run time', () => {
  const drawWith = (type: string, key: string, value: unknown): HTMLElement => {
    const component = createComponent(type, newComponentId());
    component.props[key] = value as Component['props'][string];
    return draw(component);
  };

  it('shows which column a row template reads', () => {
    // A Text inside a List reads a field of the current row. Drawing nothing made it look like an
    // empty box, which is how this whole phase started.
    const text = drawWith('Text', 'content', { kind: 'item', field: 'title' });
    expect(text.textContent).toBe('{title}');
  });

  it('shows a route parameter by name', () => {
    expect(drawWith('Text', 'content', { kind: 'param', name: 'id' }).textContent).toBe('{id}');
  });

  it('says a value comes from the graph rather than inventing one', () => {
    const bound = drawWith('Text', 'content', {
      kind: 'bound',
      source: { nodeId: 'nd_x', portId: 'pt_result' },
    });
    expect(bound.textContent).toBe('(bound)');
  });

  it('draws a number or a yes/no that was typed in, not an empty box', () => {
    expect(drawWith('Text', 'content', { kind: 'static', value: 0 }).textContent).toBe('0');
    expect(drawWith('Text', 'content', { kind: 'static', value: false }).textContent).toBe('false');
  });
});

describe('a List draws what a List renders', () => {
  /** A List holding some children, drawn with them. */
  function drawList(childCount: number): HTMLElement {
    const list = createComponent('List', 'cp_list');
    const children = Array.from({ length: childCount }, (_, index) => {
      const child = createComponent('Text', `cp_child_${index}`);
      child.props.content = { kind: 'static', value: `Child ${index}` };
      return child;
    });
    list.children = children.map((child) => child.id);

    const snapshot: Snapshot = {
      ...createEmptyProject('Parity'),
      components: Object.fromEntries(
        [list, ...children].map((component) => [component.id, component]),
      ),
    };

    host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <ComponentView
          snapshot={snapshot}
          id={list.id}
          onSelect={() => undefined}
          registerNode={() => undefined}
          onPointerDown={() => undefined}
          draggingId={undefined}
          alsoSelected={[]}
          hidden={new Set()}
        />,
      );
    });

    return host.querySelector<HTMLElement>('[data-loom-id="cp_list"]')!;
  }

  it('says so when the rest of the children will not appear', () => {
    // The app renders the first child once per row and nothing else. A canvas that drew three
    // children showed three things and shipped one.
    const list = drawList(3);
    expect(list.textContent).toContain('Only the first element repeats');
    expect(list.textContent).toContain('2 below will not appear');
  });

  it('says nothing when there is only a row template', () => {
    const list = drawList(1);
    expect(list.textContent).not.toContain('will not appear');
    expect(list.textContent).toContain('Child 0');
  });

  it('shows the empty text when there is no row template yet', () => {
    expect(drawList(0).textContent).toContain('Nothing yet');
  });

  it('keeps the extra children on the canvas, so they can be moved out', () => {
    // Hidden would be worse: a designer cannot fix what they cannot see.
    const list = drawList(3);
    expect(list.querySelector('[data-loom-id="cp_child_2"]')).not.toBeNull();
  });
});
