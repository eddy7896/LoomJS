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

/** Drop any FN step into the inferred pipeline's body, between Validate and the insert. */
function withStep(kind: string, config: Record<string, unknown>): string {
  const { snapshot } = inferredSnapshot();
  const route = Object.values(snapshot.nodes).find((node) => node.category === 'api')!;
  const body = (route.config as { body: string[] }).body;

  const step: Node = {
    id: 'nd_step',
    category: 'fn',
    kind,
    name: kind,
    ports: [
      { id: 'pt_input', name: 'input', direction: 'in', portKind: 'data', type: { kind: 'any' } },
      { id: 'pt_result', name: 'result', direction: 'out', portKind: 'data', type: { kind: 'any' } },
    ],
    position: { x: 0, y: 0 },
    config,
  };

  const next = applyOps(snapshot, [
    { type: 'addNode', node: step },
    {
      type: 'setNodeConfig',
      nodeId: route.id,
      config: { ...(route.config as object), body: [body[0]!, step.id, body[1]!] },
    },
  ]);

  return compile(next).files.find((f) => f.path === 'api/createnotes.ts')!.content;
}

describe('Math', () => {
  it('operates on two fields and writes the answer into a third', () => {
    const api = withStep('math', {
      left: 'price',
      operator: 'multiply',
      rightKind: 'field',
      right: 'quantity',
      into: 'total',
    });
    expect(api).toContain('const left = Number(source["price"]);');
    expect(api).toContain('const right = Number(source["quantity"]);');
    expect(api).toContain('const answer = left * right;');
    expect(api).toContain('value = { ...source, ["total"]: answer };');
  });

  it('takes a typed value on the right, and replaces the whole value when no field is named', () => {
    const api = withStep('math', { left: 'count', operator: 'add', rightKind: 'value', right: '10', into: '' });
    expect(api).toContain('const right = Number("10");');
    expect(api).toContain('value = answer;');
  });

  it('refuses to divide by zero rather than writing Infinity into a column', () => {
    const api = withStep('math', { left: 'total', operator: 'divide', rightKind: 'field', right: 'people' });
    expect(api).toContain('if (right === 0) throw new Error("Cannot divide total by zero.");');
  });

  it('names the fields that were not numbers', () => {
    const api = withStep('math', { left: 'price', operator: 'add', rightKind: 'field', right: 'quantity' });
    expect(api).toContain('"price and quantity must both be numbers."');
  });

  it('offers smaller-of and larger-of without a branch', () => {
    expect(withStep('math', { left: 'a', operator: 'min', rightKind: 'field', right: 'b' })).toContain(
      'Math.min(left, right)',
    );
    expect(withStep('math', { left: 'a', operator: 'max', rightKind: 'value', right: '5' })).toContain(
      'Math.max(left, right)',
    );
  });

  it('refuses an operation it cannot emit', () => {
    expect(() => withStep('math', { operator: 'exponentiate' })).toThrow(/unknown operation/);
  });
});

describe('Compare and Logic', () => {
  it('compares equality as text, so a form field matches a numeric column', () => {
    const api = withStep('compare', {
      left: 'status',
      operator: 'equals',
      rightKind: 'value',
      right: 'draft',
      into: 'is_draft',
    });
    expect(api).toContain('const answer = String(left) === String(right);');
    expect(api).toContain('value = { ...source, ["is_draft"]: answer };');
  });

  it('compares order as numbers, because "10" < "9" is true as text', () => {
    expect(
      withStep('compare', { left: 'count', operator: 'atLeast', rightKind: 'value', right: '9' }),
    ).toContain('Number(left) >= Number(right)');
  });

  it('where a Gate stops, a Compare hands the answer on', () => {
    const api = withStep('compare', { left: 'count', operator: 'greaterThan', rightKind: 'value', right: '0' });
    // No throw: the boolean travels down the pipeline instead of ending it.
    expect(api).toContain('Number(left) > Number(right)');
    expect(api).not.toContain('Cannot');
  });

  it('reads a checkbox as checked whether it arrives as a boolean or as "true"', () => {
    const api = withStep('logic', {
      left: 'agreed',
      operator: 'and',
      rightKind: 'field',
      right: 'confirmed',
      into: 'ok',
    });
    expect(api).toContain("input === true || input === 'true'");
    expect(api).toContain('const answer = left && right;');
  });

  it('supports or, and refuses anything else', () => {
    expect(withStep('logic', { left: 'a', operator: 'or', rightKind: 'field', right: 'b' })).toContain(
      'left || right',
    );
    expect(() => withStep('logic', { operator: 'nand' })).toThrow(/unknown operation/);
  });
});
