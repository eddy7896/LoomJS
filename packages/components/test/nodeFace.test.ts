import { describe, expect, it } from 'vitest';
import {
  canMirror,
  componentDefs,
  createComponent,
  mirrorPortsFor,
  hasFieldState,
  rendersPerRow,
} from '../src/index';

/**
 * The authoring vocabulary and the **node face** are two halves of one contract, the same way the
 * vocabulary and the code templates are (`packages/compiler/test/vocabulary.test.ts`).
 *
 * There was a test for the emission half and none for this one, and the drift it allowed is why
 * N0 exists (`docs/V1-COMPLETION.md` §3): three separate lists described the same elements — a
 * switch for the ports, a set for the field state, a flag for per-row rendering — and nothing kept
 * them in agreement. Charts said they rendered per row and had no port to receive rows. Upload
 * fields held state in the emitted app that the studio did not know about. An Image's port wrote a
 * property its template never read.
 *
 * Every rule below is one of those failures, turned into something that goes red.
 */
describe('every element declares its face in Nodes mode', () => {
  it('answers the question at all — `null` counts, absence does not', () => {
    for (const def of componentDefs()) {
      // `undefined` means somebody added an element and never decided. That is the whole defect.
      expect(def.node, `${def.type} has no node declaration`).not.toBeUndefined();
    }
  });

  it('names a real property for every port it exposes', () => {
    for (const def of componentDefs()) {
      if (!def.node) continue;
      for (const port of mirrorPortsFor(createComponent(def.type, 'cp_probe'))) {
        expect(port.propKey, `${def.type}.${port.name} binds nothing`).toBeTruthy();
      }
    }
  });

  it('gives every port on an element a distinct id and a distinct property', () => {
    for (const def of componentDefs()) {
      if (!def.node) continue;
      const ports = mirrorPortsFor(createComponent(def.type, 'cp_probe'));
      const ids = ports.map((port) => port.id);
      const keys = ports.map((port) => port.propKey);
      expect(new Set(ids).size, `${def.type} repeats a port id`).toBe(ids.length);
      expect(new Set(keys).size, `${def.type} binds one property twice`).toBe(keys.length);
    }
  });

  /**
   * The failure that motivated the phase: a chart declaring it drew one mark per row, with no way
   * for rows to reach it. Saying "I render per row" and offering no row input is a contradiction,
   * and it shipped for three elements.
   */
  it('can actually receive rows when it claims to render one per row', () => {
    for (const def of componentDefs()) {
      if (!rendersPerRow(def.type)) continue;
      const rows = mirrorPortsFor(createComponent(def.type, 'cp_probe')).find(
        (port) => port.direction === 'in' && port.type.kind === 'list',
      );
      expect(rows, `${def.type} renders per row and cannot be given rows`).toBeDefined();
    }
  });

  /** A value in local state is a value something can read. It needs a port to read it from. */
  it('exposes a value port when its value lives in local state', () => {
    for (const def of componentDefs()) {
      if (!hasFieldState(def.type)) continue;
      const value = mirrorPortsFor(createComponent(def.type, 'cp_probe')).find(
        (port) => port.direction === 'out' && port.portKind === 'data',
      );
      expect(value, `${def.type} holds a value nothing can read`).toBeDefined();
    }
  });

  it('offers no ports at all for an element that declared it has none', () => {
    for (const def of componentDefs()) {
      if (def.node !== null) continue;
      expect(mirrorPortsFor(createComponent(def.type, 'cp_probe')), def.type).toEqual([]);
    }
  });

  /**
   * `canMirror` answers "did this element declare a face", which is a fact about the vocabulary.
   * It deliberately does **not** answer "does this particular component have ports right now":
   * an Instance's ports are its definition's params, so one that points at nothing has none yet
   * and still belongs in Nodes mode the moment it points at something.
   */
  it('reports a face wherever one is declared', () => {
    for (const def of componentDefs()) {
      expect(canMirror(def.type), def.type).toBe(def.node !== null);
    }
  });

  /**
   * Every element whose ports do **not** depend on the project has some, or the face is a
   * declaration with nothing behind it. Instance is the one documented exception.
   */
  it('backs a declared face with real ports, unless the ports come from the project', () => {
    for (const def of componentDefs()) {
      if (def.node === null || def.type === 'Instance') continue;
      expect(
        mirrorPortsFor(createComponent(def.type, 'cp_probe')).length,
        `${def.type} declares a face and exposes nothing`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('the gaps N0 closed', () => {
  const portsOf = (type: string) => mirrorPortsFor(createComponent(type, 'cp_probe'));

  it('lets a query reach a chart, a calendar and a chat', () => {
    for (const type of ['BarChart', 'LineChart', 'PieChart', 'Calendar', 'Chat', 'Carousel']) {
      const rows = portsOf(type).find((port) => port.propKey === 'items');
      expect(rows, type).toBeDefined();
      expect(rows!.direction).toBe('in');
    }
  });

  it('lets an uploaded file reach a database column', () => {
    for (const type of ['FileField', 'ImageField']) {
      // The compiler already gave these field state (`templates/upload.ts`); the studio did not
      // know, so the URL had nowhere to go.
      expect(hasFieldState(type), type).toBe(true);
      expect(portsOf(type)[0]!.propKey, type).toBe('value');
    }
  });

  it('binds the property the emitter actually reads', () => {
    // Both of these wrote a property nothing rendered, because the key came from the port's name.
    expect(portsOf('Image')[0]!.propKey).toBe('src');
    expect(portsOf('Link')[0]!.propKey).toBe('href');
    // And the names people read on the canvas are still the human ones.
    expect(portsOf('Image')[0]!.name).toBe('source');
    expect(portsOf('Link')[0]!.name).toBe('address');
  });

  it('types a chosen value by the options it was given', () => {
    expect(portsOf('Select')[0]!.type).toEqual({ kind: 'enum', values: ['One', 'Two'] });
    // Bound or empty options are genuinely unknown until the app runs, and say so.
    expect(mirrorPortsFor({ type: 'Select', props: {} })[0]!.type).toEqual({ kind: 'text' });
  });

  it('leaves the elements with nothing to say out of the graph', () => {
    for (const type of ['Frame', 'Shape', 'Tiles']) {
      expect(portsOf(type), type).toEqual([]);
    }
  });

  /**
   * The case that made a node face take the project rather than a type string (R1). Nothing about
   * the word "Instance" says what it accepts; the answer is in the definition it points at.
   */
  it("takes an instance's ports from the definition it points at", () => {
    const snapshot = {
      definitions: {
        def_header: {
          id: 'def_header',
          name: 'Header',
          root: 'cp_x',
          params: [{ name: 'title', type: { kind: 'text' as const } }],
        },
      },
    } as never;

    const instance = {
      type: 'Instance',
      props: { defId: { kind: 'static' as const, value: 'def_header' } },
    };
    const ports = mirrorPortsFor(instance, snapshot);

    expect(ports).toHaveLength(1);
    expect(ports[0]!.name).toBe('title');
    expect(ports[0]!.propKey).toBe('title');
    expect(ports[0]!.direction).toBe('in');

    // Pointing at nothing yet is not an error; it is an instance with nothing to accept.
    expect(mirrorPortsFor(instance)).toEqual([]);
  });
});
