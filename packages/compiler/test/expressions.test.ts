import { describe, expect, it } from 'vitest';
import { applyOp, applyOps, type Node, type Snapshot } from '@loom/ir';
import { createComponent, gateMessage, mirrorPortsFor } from '@loom/components';
import { compile } from '../src/index';
import { formSnapshot, inferredSnapshot } from './fixtures';

/**
 * The expression vocabulary: typed inputs, booleans, and the Gate.
 *
 * The theme is that a value keeps its type from the input that produced it all the way to the
 * column it lands in — a number field's state is a number, a checkbox's is a boolean — so nothing
 * downstream has to guess what a string meant.
 */

const home = (snapshot: Snapshot): string => {
  const file = compile(snapshot).files.find((f) => f.path === 'src/artboards/Home.tsx');
  if (!file) throw new Error('no Home artboard emitted');
  return file.content;
};

/** Put one component of `type` on the fixture's form and compile. */
function withInput(type: string, props: Record<string, unknown> = {}): string {
  const component = createComponent(type, `cp_${type.toLowerCase()}`);
  for (const [key, value] of Object.entries(props)) {
    component.props[key] = { kind: 'static', value };
  }
  return home(applyOp(formSnapshot(), { type: 'addComponent', component, parentId: 'cp_form' }));
}

describe('typed inputs', () => {
  it('a number field holds a number, not a string', () => {
    const code = withInput('NumberField', { value: 7 });
    expect(code).toContain('const [field_cp_numberfield, set_field_cp_numberfield] = useState(7)');
    expect(code).toContain('type="number"');
    // An empty box is 0, never NaN travelling down a wire.
    expect(code).toContain('event.target.value === "" ? 0 : Number(event.target.value)');
  });

  it('a checkbox holds a boolean', () => {
    const code = withInput('Checkbox', { value: true, label: 'Agreed' });
    expect(code).toContain('useState(true)');
    expect(code).toContain('type="checkbox"');
    expect(code).toContain('event.target.checked');
    expect(code).toContain('"Agreed"');
  });

  it('a select renders its options and starts on one of them', () => {
    const code = withInput('Select', { options: 'Low, High , ', value: 'High' });
    expect(code).toContain('useState("High")');
    expect(code).toContain('<option value={"Low"}>');
    expect(code).toContain('<option value={"High"}>');
    // A blank entry between commas is dropped rather than emitted as an empty option.
    expect(code.match(/<option/g)).toHaveLength(2);
  });

  it('a select whose value is not among its options starts on the first', () => {
    expect(withInput('Select', { options: 'Low, High', value: 'Gone' })).toContain('useState("Low")');
  });

  it('mirrors carry each input type into the graph', () => {
    expect(mirrorPortsFor('NumberField')[0]!.type).toEqual({ kind: 'number' });
    expect(mirrorPortsFor('Checkbox')[0]!.type).toEqual({ kind: 'boolean' });
    expect(mirrorPortsFor('Checkbox')[0]!.name).toBe('checked');
    expect(mirrorPortsFor('Select')[0]!.type).toEqual({ kind: 'text' });
  });
});

/** Drop a Gate into the inferred pipeline's body, between Validate and the insert. */
function withGate(config: Record<string, unknown>): string {
  const { snapshot } = inferredSnapshot();
  const route = Object.values(snapshot.nodes).find((node) => node.category === 'api')!;
  const body = (route.config as { body: string[] }).body;

  const gate: Node = {
    id: 'nd_gate',
    category: 'fn',
    kind: 'gate',
    name: 'Gate',
    ports: [
      { id: 'pt_input', name: 'input', direction: 'in', portKind: 'data', type: { kind: 'any' } },
      { id: 'pt_result', name: 'result', direction: 'out', portKind: 'data', type: { kind: 'any' } },
    ],
    position: { x: 0, y: 0 },
    config,
  };

  const next = applyOps(snapshot, [
    { type: 'addNode', node: gate },
    {
      type: 'setNodeConfig',
      nodeId: route.id,
      config: { ...(route.config as object), body: [body[0]!, gate.id, body[1]!] },
    },
  ]);

  const file = compile(next).files.find((f) => f.path === 'api/createnotes.ts');
  if (!file) throw new Error('no api file emitted');
  return file.content;
}

describe('Gate — the conditional', () => {
  it('stops the pipeline before the write when the condition does not hold', () => {
    const api = withGate({ field: 'title', condition: 'isFilled', value: '', message: '' });
    expect(api).toContain('const subject: unknown = ((value ?? {}) as Record<string, unknown>)["title"]');
    expect(api).toContain("if (!(subject !== undefined && subject !== null && subject !== ''))");
    // Order matters: a Gate that ran after the insert would be a comment, not a condition.
    expect(api.indexOf('const subject')).toBeLessThan(api.indexOf('.insert(row)'));
  });

  it('compares against the value the designer typed', () => {
    expect(withGate({ field: 'title', condition: 'equals', value: 'draft' })).toContain(
      'String(subject) === "draft"',
    );
    expect(withGate({ field: 'count', condition: 'greaterThan', value: '3' })).toContain(
      'Number(subject) > Number("3")',
    );
  });

  it('tests a checkbox as a boolean, not as a string', () => {
    expect(withGate({ field: 'agreed', condition: 'isTrue' })).toContain(
      "subject === true || subject === 'true'",
    );
  });

  it('carries a message a person can read, written or generated', () => {
    expect(withGate({ field: 'title', condition: 'isFilled', message: 'Give it a title.' })).toContain(
      '"Give it a title."',
    );
    expect(gateMessage({ field: 'count', condition: 'greaterThan', value: '3' })).toBe(
      'count is greater than 3 is required.',
    );
  });

  it('refuses a condition it cannot emit rather than passing everything', () => {
    expect(() => withGate({ field: 'title', condition: 'sortOf' })).toThrow(/unknown condition/);
  });
});

describe('booleans and queries', () => {
  it('Compute derives a boolean', () => {
    const { snapshot } = inferredSnapshot();
    const route = Object.values(snapshot.nodes).find((node) => node.category === 'api')!;
    const body = (route.config as { body: string[] }).body;

    const next = applyOps(snapshot, [
      {
        type: 'addNode',
        node: {
          id: 'nd_not',
          category: 'fn',
          kind: 'compute',
          ports: [
            { id: 'pt_input', name: 'input', direction: 'in', portKind: 'data', type: { kind: 'boolean' } },
            { id: 'pt_result', name: 'result', direction: 'out', portKind: 'data', type: { kind: 'boolean' } },
          ],
          position: { x: 0, y: 0 },
          config: { op: 'not' },
        },
      },
      {
        type: 'setNodeConfig',
        nodeId: route.id,
        config: { ...(route.config as object), body: [body[0]!, 'nd_not', body[1]!] },
      },
    ]);

    const api = compile(next).files.find((f) => f.path === 'api/createnotes.ts')!.content;
    expect(api).toContain('value = !(value === true || value === "true");');
  });

  it('a read is a query: sorted and limited, with no loop anywhere', () => {
    const { snapshot } = inferredSnapshot();
    const insert = Object.values(snapshot.nodes).find((node) => node.category === 'db')!;

    const asRead = applyOp(snapshot, {
      type: 'setNodeConfig',
      nodeId: insert.id,
      config: { ...(insert.config as object), operation: 'select', limit: 5, orderBy: 'created_at', descending: true },
    });

    const api = compile(asRead).files.find((f) => f.path === 'api/createnotes.ts')!.content;
    expect(api).toContain('.order("created_at", { ascending: false })');
    expect(api).toContain('.limit(5)');
    expect(api).not.toContain('for (');
  });
});
