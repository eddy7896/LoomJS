import { describe, expect, it } from 'vitest';
import {
  apiPortsFromBody,
  canMirror,
  createComponent,
  defFor,
  mirrorPortsFor,
  placeableDefs,
} from '../src/index';

/**
 * The Pager is reachable and connectable (Q2, `docs/V1-COMPLETION.md`).
 *
 * A control that emits perfect code and cannot be placed or wired is a control nobody has. R1
 * shipped exactly that — a palette section that never appeared while a thousand unit tests stayed
 * green — so the reachability of a new element is now something to assert rather than assume.
 */
describe('a designer can get to it', () => {
  it('is offered by the palette', () => {
    expect(placeableDefs().map((def) => def.type)).toContain('Pager');
  });

  it('appears in Nodes mode, because it has something to say', () => {
    expect(canMirror('Pager')).toBe(true);
    expect(defFor('Pager')?.node).not.toBeNull();
  });

  it('exposes the two ports the wiring needs', () => {
    const ports = mirrorPortsFor(createComponent('Pager', 'cp_probe'));
    expect(ports.map((port) => `${port.direction}:${port.name}`).sort()).toEqual([
      'in:total',
      'out:page',
    ]);
  });
});

/**
 * The other half of the connection, and the one that was missing: the route has to *have* a total
 * to wire from. It did not, so the Pager could be placed and never connected to anything.
 */
describe('the route it wires to', () => {
  const selectStep = {
    id: 'nd_read',
    category: 'db' as const,
    kind: 'read',
    position: { x: 0, y: 0 },
    config: { operation: 'select', table: 'notes' },
    ports: [
      {
        id: 'pt_page',
        name: 'page',
        direction: 'in' as const,
        portKind: 'data' as const,
        type: { kind: 'optional' as const, of: { kind: 'number' as const } },
      },
      {
        id: 'pt_rows',
        name: 'rows',
        direction: 'out' as const,
        portKind: 'data' as const,
        type: { kind: 'list' as const, of: { kind: 'record' as const } },
      },
      {
        id: 'pt_total',
        name: 'total',
        direction: 'out' as const,
        portKind: 'data' as const,
        type: { kind: 'number' as const },
      },
    ],
  };

  it('offers a total to read, and a page to supply', () => {
    const ports = apiPortsFromBody([selectStep]);
    const names = ports.map((port) => `${port.direction}:${port.name}`);

    expect(names).toContain('out:total');
    // The read's own page input becomes the route's, which is how the Pager reaches it.
    expect(names).toContain('in:page');
  });

  /**
   * Only a route that reads a page has one. A route that inserts a row has no total, and a port
   * that is always there and usually meaningless is a port people wire by mistake.
   */
  it('offers no total on a route that does not read a page', () => {
    const insertStep = {
      ...selectStep,
      config: { operation: 'insert', table: 'notes' },
      ports: [
        {
          id: 'pt_title',
          name: 'title',
          direction: 'in' as const,
          portKind: 'data' as const,
          type: { kind: 'text' as const },
        },
        {
          id: 'pt_row',
          name: 'row',
          direction: 'out' as const,
          portKind: 'data' as const,
          type: { kind: 'record' as const },
        },
      ],
    };

    const names = apiPortsFromBody([insertStep]).map((port) => port.name);
    expect(names).not.toContain('total');
  });
});
