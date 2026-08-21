import { describe, expect, it } from 'vitest';
import { applyOp, applyOps, type Node, type Op, type Snapshot } from '@loom/ir';
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

/**
 * The graph a designer draws first: a field, a Compute, a Text. Nothing here is inside an API
 * route, so all of it runs in the browser.
 */
function derivedSnapshot(op = 'length', extra: Op[] = []): Snapshot {
  const base = formSnapshot();
  const mirror = (id: string, componentId: string, port: Record<string, unknown>): Op => ({
    type: 'addNode',
    node: {
      id,
      category: 'ui',
      kind: 'mirror',
      name: 'mirror',
      mirrorOf: componentId,
      ports: [port as never],
      position: { x: 0, y: 0 },
    },
  });

  return applyOps(base, [
    mirror('nd_m_title', 'cp_title', {
      id: 'pt_value',
      name: 'value',
      direction: 'out',
      portKind: 'data',
      type: { kind: 'text' },
    }),
    mirror('nd_m_status', 'cp_status', {
      id: 'pt_content',
      name: 'content',
      direction: 'in',
      portKind: 'data',
      type: { kind: 'any' },
    }),
    {
      type: 'addNode',
      node: {
        id: 'nd_compute',
        category: 'fn',
        kind: 'compute',
        name: 'Compute',
        ports: [
          { id: 'pt_input', name: 'input', direction: 'in', portKind: 'data', type: { kind: 'text' } },
          // Ports follow the operation, exactly as the editor derives them.
          {
            id: 'pt_result',
            name: 'result',
            direction: 'out',
            portKind: 'data',
            type: op === 'length' ? { kind: 'number' } : { kind: 'text' },
          },
        ],
        position: { x: 0, y: 0 },
        config: { op },
      },
    },
    {
      type: 'addWire',
      wire: {
        id: 'wr_in',
        from: { nodeId: 'nd_m_title', portId: 'pt_value' },
        to: { nodeId: 'nd_compute', portId: 'pt_input' },
      },
    },
    {
      type: 'setProp',
      componentId: 'cp_status',
      key: 'content',
      value: { kind: 'bound', source: { nodeId: 'nd_compute', portId: 'pt_result' } },
    },
    ...extra,
  ]);
}

describe('function nodes outside an API route run in the browser', () => {
  it('compiles a field -> Compute -> Text graph to one local const', () => {
    const code = home(derivedSnapshot('length'));
    expect(code).toContain('const derived_nd_compute = String(field_cp_title).length;');
    // No request, no state, no effect: it is a derivation of what the person typed.
    expect(code).not.toContain('fetch(');
    expect(code).not.toContain('useEffect');
  });

  it('reads the derived value where the property is bound', () => {
    // The result is a number, so it goes through the text helper rather than into JSX raw.
    expect(home(derivedSnapshot('length'))).toContain('asText(derived_nd_compute)');
  });

  it('chains one derivation into the next, in dependency order', () => {
    const chained = derivedSnapshot('trim', [
      {
        type: 'addNode',
        node: {
          id: 'nd_upper',
          category: 'fn',
          kind: 'compute',
          name: 'Compute',
          ports: [
            { id: 'pt_input', name: 'input', direction: 'in', portKind: 'data', type: { kind: 'text' } },
            { id: 'pt_result', name: 'result', direction: 'out', portKind: 'data', type: { kind: 'text' } },
          ],
          position: { x: 0, y: 0 },
          config: { op: 'uppercase' },
        },
      },
      {
        type: 'addWire',
        wire: {
          id: 'wr_chain',
          from: { nodeId: 'nd_compute', portId: 'pt_result' },
          to: { nodeId: 'nd_upper', portId: 'pt_input' },
        },
      },
      {
        type: 'setProp',
        componentId: 'cp_status',
        key: 'content',
        value: { kind: 'bound', source: { nodeId: 'nd_upper', portId: 'pt_result' } },
      },
    ]);

    const code = home(chained);
    expect(code).toContain('const derived_nd_compute = String(field_cp_title).trim();');
    expect(code).toContain('const derived_nd_upper = String(derived_nd_compute).toUpperCase();');
    // Declared before it is used, or the emitted app would not run.
    expect(code.indexOf('derived_nd_compute =')).toBeLessThan(code.indexOf('derived_nd_upper ='));
  });

  it('emits nothing for a derivation no property reads', () => {
    const unread = applyOps(derivedSnapshot('length'), [
      { type: 'removeProp', componentId: 'cp_status', key: 'content' },
    ]);
    expect(home(unread)).not.toContain('derived_nd_compute');
  });

  it('says why a record-shaped step cannot run in the browser', () => {
    const base = derivedSnapshot('length');
    // Compare reads named fields of a request body, so outside a route it has nothing to read.
    const asCompare = {
      ...base,
      nodes: { ...base.nodes, nd_compute: { ...base.nodes.nd_compute!, kind: 'compare' } },
    };
    expect(() => compile(asCompare)).toThrow(/Compare works on the fields of a request body/);
  });

  it('refuses a Compute with nothing wired into it, naming the node', () => {
    const unwired = applyOps(derivedSnapshot('length'), [{ type: 'removeWire', wireId: 'wr_in' }]);
    expect(() => compile(unwired)).toThrow(/has nothing wired into it/);
  });
});

/** A canvas Math node folding N wired operands, optionally fired by a button. */
function mathSnapshot(options: {
  operator?: string;
  inputs?: number;
  triggered?: boolean;
} = {}): Snapshot {
  const inputs = options.inputs ?? 2;
  const base = formSnapshot();

  const numberFields = Array.from({ length: inputs }, (_, index) => `cp_n${index}`);
  const components: Op[] = numberFields.map((id) => ({
    type: 'addComponent',
    parentId: 'cp_form',
    component: {
      id,
      type: 'NumberField',
      name: `N${id}`,
      props: { value: { kind: 'static', value: 0 } },
    },
  }));

  const mirrors: Op[] = numberFields.map((componentId, index) => ({
    type: 'addNode',
    node: {
      id: `nd_m${index}`,
      category: 'ui',
      kind: 'mirror',
      mirrorOf: componentId,
      ports: [
        { id: 'pt_value', name: 'value', direction: 'out', portKind: 'data', type: { kind: 'number' } },
      ],
      position: { x: 0, y: 0 },
    },
  }));

  const wires: Op[] = numberFields.map((_, index) => ({
    type: 'addWire',
    wire: {
      id: `wr_in${index}`,
      from: { nodeId: `nd_m${index}`, portId: 'pt_value' },
      to: { nodeId: 'nd_math', portId: `pt_in_${index}` },
    },
  }));

  const trigger: Op[] = options.triggered
    ? [
        {
          type: 'addNode',
          node: {
            id: 'nd_m_go',
            category: 'ui',
            kind: 'mirror',
            mirrorOf: 'cp_save',
            ports: [
              {
                id: 'pt_click',
                name: 'onClick',
                direction: 'out',
                portKind: 'trigger',
                type: { kind: 'trigger' },
              },
            ],
            position: { x: 0, y: 0 },
          },
        },
        {
          type: 'addWire',
          wire: {
            id: 'wr_run',
            from: { nodeId: 'nd_m_go', portId: 'pt_click' },
            to: { nodeId: 'nd_math', portId: 'pt_run' },
          },
        },
        {
          type: 'setProp',
          componentId: 'cp_save',
          key: 'onClick',
          value: {
            kind: 'event',
            handler: { kind: 'trigger', target: { nodeId: 'nd_math', portId: 'pt_run' } },
          },
        },
      ]
    : [];

  return applyOps(base, [
    ...components,
    ...mirrors,
    {
      type: 'addNode',
      node: {
        id: 'nd_math',
        category: 'fn',
        kind: 'math',
        name: 'Math',
        ports: [
          { id: 'pt_run', name: 'run', direction: 'in', portKind: 'trigger', type: { kind: 'trigger' } },
          ...numberFields.map((_, index) => ({
            id: `pt_in_${index}`,
            name: `input ${index + 1}`,
            direction: 'in' as const,
            portKind: 'data' as const,
            type: { kind: 'number' as const },
          })),
          { id: 'pt_result', name: 'result', direction: 'out', portKind: 'data', type: { kind: 'number' } },
        ],
        position: { x: 0, y: 0 },
        config: { operator: options.operator ?? 'add', inputs },
      },
    },
    ...wires,
    ...trigger,
    {
      type: 'setProp',
      componentId: 'cp_status',
      key: 'content',
      value: { kind: 'bound', source: { nodeId: 'nd_math', portId: 'pt_result' } },
    },
  ]);
}

describe('Math on the canvas takes its operands from wires', () => {
  it('folds two wired inputs', () => {
    expect(home(mathSnapshot())).toContain(
      'const derived_nd_math = (Number(field_cp_n0) + Number(field_cp_n1));',
    );
  });

  it('folds more than two, so a + b + c is one node rather than a chain', () => {
    const code = home(mathSnapshot({ inputs: 4 }));
    expect(code).toContain(
      'Number(field_cp_n0) + Number(field_cp_n1) + Number(field_cp_n2) + Number(field_cp_n3)',
    );
  });

  it('folds min and max across every operand at once', () => {
    expect(home(mathSnapshot({ operator: 'max', inputs: 3 }))).toContain(
      'Math.max(Number(field_cp_n0), Number(field_cp_n1), Number(field_cp_n2))',
    );
  });

  it('divides through a helper, so a zero divisor is visibly wrong rather than Infinity', () => {
    const code = home(mathSnapshot({ operator: 'divide', inputs: 3 }));
    expect(code).toContain('safeDivide(safeDivide(Number(field_cp_n0), Number(field_cp_n1)), Number(field_cp_n2))');
    expect(code).toContain('return right === 0 ? Number.NaN : left / right;');
  });

  it('names which input is missing a wire', () => {
    const missing = applyOps(mathSnapshot({ inputs: 3 }), [{ type: 'removeWire', wireId: 'wr_in2' }]);
    expect(() => compile(missing)).toThrow(/input 3 of "Math" has nothing wired into it/);
  });
});

describe('a trigger turns a derivation from recomputed into held', () => {
  it('with nothing wired to run, the value is a const that follows its inputs', () => {
    const code = home(mathSnapshot());
    expect(code).toContain('const derived_nd_math = (');
    expect(code).not.toContain('set_derived_nd_math');
  });

  it('with a trigger wired, it holds its last answer in state', () => {
    const code = home(mathSnapshot({ triggered: true }));
    expect(code).toContain('const [derived_nd_math, set_derived_nd_math] = useState<number>(0);');
    expect(code).toContain(
      'const run_derived_nd_math = () => set_derived_nd_math((Number(field_cp_n0) + Number(field_cp_n1)));',
    );
  });

  it('the button that fires it calls that function', () => {
    const code = home(mathSnapshot({ triggered: true }));
    expect(code).toContain('run_derived_nd_math()');
  });

  it('is read the same way either way, so binding does not care', () => {
    expect(home(mathSnapshot({ triggered: true }))).toContain('asText(derived_nd_math)');
    expect(home(mathSnapshot())).toContain('asText(derived_nd_math)');
  });
});

describe('a Text wired straight to a field shows what the person typed', () => {
  /** The simplest wire on the canvas: an input's mirror into a Text's mirror. */
  const wired = (inputId = 'cp_title', type = 'text'): Snapshot =>
    applyOps(formSnapshot(), [
      {
        type: 'addNode',
        node: {
          id: 'nd_m_in',
          category: 'ui',
          kind: 'mirror',
          mirrorOf: inputId,
          ports: [
            { id: 'pt_value', name: 'value', direction: 'out', portKind: 'data', type: { kind: type } as never },
          ],
          position: { x: 0, y: 0 },
        },
      },
      {
        type: 'setProp',
        componentId: 'cp_status',
        key: 'content',
        value: { kind: 'bound', source: { nodeId: 'nd_m_in', portId: 'pt_value' } },
      },
    ]);

  it('reads the field’s own state, with nothing in between', () => {
    const code = home(wired());
    expect(code).toContain('<span>{field_cp_title}</span>');
    // No pipeline, no derivation, no request: it is the state the input already owns.
    expect(code).not.toContain('fetch(');
    expect(code).not.toContain('derived_');
  });

  it('coerces a non-text field so a number never lands in JSX raw', () => {
    const numeric = applyOps(wired('cp_title', 'number'), []);
    expect(home(numeric)).toContain('asText(field_cp_title)');
  });

  it('refuses to read a component that holds no value of its own', () => {
    const button = applyOps(formSnapshot(), [
      {
        type: 'addNode',
        node: {
          id: 'nd_m_btn',
          category: 'ui',
          kind: 'mirror',
          mirrorOf: 'cp_save',
          ports: [
            { id: 'pt_value', name: 'value', direction: 'out', portKind: 'data', type: { kind: 'text' } },
          ],
          position: { x: 0, y: 0 },
        },
      },
      {
        type: 'setProp',
        componentId: 'cp_status',
        key: 'content',
        value: { kind: 'bound', source: { nodeId: 'nd_m_btn', portId: 'pt_value' } },
      },
    ]);
    expect(() => compile(button)).toThrow(/holds no value of its own/);
  });
});
