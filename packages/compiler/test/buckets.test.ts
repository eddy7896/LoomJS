import { describe, expect, it } from 'vitest';
import { applyOps, type Snapshot } from '@loom/ir';
import { compile } from '../src/index';
import { calculatorSnapshot, CALCULATOR_OPERATORS as OPERATORS } from './fixtures';

/**
 * Screen buckets — the merge point (`packages/compiler/src/emit/state.ts`).
 *
 * The shape under test is the calculator: two number fields, four operation buttons, and **one**
 * answer. Before buckets the only way to show four results was four Texts, because every property
 * binds exactly one port. A bucket is the one place in the language where many producers meet one
 * consumer, and everything here is about keeping that meeting predictable.
 */

const home = (snapshot: Snapshot): string => {
  const file = compile(snapshot).files.find((f) => f.path === 'src/artboards/Home.tsx');
  if (!file) throw new Error('no Home artboard emitted');
  return file.content;
};

describe('four operations, one answer', () => {
  const code = home(calculatorSnapshot());

  it('declares exactly one bucket for four writers', () => {
    expect(code.match(/const \[state_nd_bucket, set_state_nd_bucket\] = useState/g)).toHaveLength(1);
  });

  it('types the bucket from writers that agree', () => {
    expect(code).toContain('useState<number | null>(null)');
  });

  it('gives every operation its own run, each setting the same bucket', () => {
    for (const operator of OPERATORS) {
      expect(code).toContain(`const run_derived_nd_math_${operator} = () =>`);
    }
    expect(code.match(/set_state_nd_bucket\(/g)).toHaveLength(OPERATORS.length);
  });

  it('emits no local for a derivation that only feeds the bucket', () => {
    // The value is never read by name, and the emitted app builds with `noUnusedLocals`.
    expect(code).not.toContain('const [derived_nd_math_add');
    expect(code).not.toContain('set_derived_nd_math_add(');
  });

  it('computes each answer where the button is pressed', () => {
    expect(code).toContain(
      'set_state_nd_bucket((Number(field_cp_a) + Number(field_cp_b)))',
    );
    expect(code).toContain('set_state_nd_bucket(safeDivide(Number(field_cp_a), Number(field_cp_b)))');
  });

  it('reads the bucket once, in the one Text that displays it', () => {
    expect(code.match(/state_nd_bucket \?\? ""/g)).toHaveLength(1);
  });

  it('shows nothing before any button is pressed', () => {
    // A bucket nobody has written is genuinely empty; "null" on screen would be a lie.
    expect(code).toContain('useState<number | null>(null)');
    expect(code).toContain('?? ""');
  });

  it('wires each button to its own operation', () => {
    for (const operator of OPERATORS) {
      expect(code).toContain(`onClick={() => run_derived_nd_math_${operator}()}`);
    }
  });
});

describe('a bucket read by name as well as kept', () => {
  it('computes once into `next` when a run has two destinations', () => {
    const code = home(calculatorSnapshot({ operators: ['add'], bindMathDirectly: true }));
    expect(code).toContain('const next = (Number(field_cp_a) + Number(field_cp_b));');
    expect(code).toContain('set_derived_nd_math_add(next);');
    expect(code).toContain('set_state_nd_bucket(next);');
    // The expression appears once, not once per setter.
    expect(code.match(/Number\(field_cp_a\) \+ Number\(field_cp_b\)/g)).toHaveLength(1);
  });
});

describe('what a bucket refuses', () => {
  it('refuses a writer that recomputes on its own, and says how to fix it', () => {
    expect(() => compile(calculatorSnapshot({ operators: ['add'], triggered: false }))).toThrow(
      /recomputes on its own.*Wire a button into its run port/s,
    );
  });

  it('refuses a bucket nothing is wired into', () => {
    const empty = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      { type: 'removeWire', wireId: 'wr_set_add' },
    ]);
    expect(() => compile(empty)).toThrow(/never holds anything/);
  });

  it('refuses a button whose answer nothing displays, rather than emitting a dead handler', () => {
    // Dropping the one binding makes the bucket dead, which makes the Math dead, which makes the
    // button do nothing. Silently emitting a button that does nothing is the worse outcome.
    const unread = applyOps(calculatorSnapshot({ operators: ['add'] }), [
      { type: 'setProp', componentId: 'cp_status', key: 'content', value: { kind: 'static', value: '' } },
    ]);
    expect(() => compile(unread)).toThrow(/nothing on this screen shows or keeps its result/i);
  });

  it('refuses reading a variable that this screen does not hold', () => {
    // The read is real, but the value lives on the screen that displays it. Naming that is more
    // use than an "unknown node" further down the emitter.
    const orphan = applyOps(calculatorSnapshot({ operators: ['add'], runningTotal: true }), [
      {
        type: 'setProp',
        componentId: 'cp_status',
        key: 'content',
        value: { kind: 'static', value: '' },
      },
    ]);
    expect(() => compile(orphan)).toThrow(/nothing on this screen shows or keeps its result/i);
  });
});

/**
 * Reading a variable back — the running total.
 *
 * `total = total + amount` is the shape every "add to cart", "score", and "balance" screen needs,
 * and it is the reason a variable has an output port at all. It stays predictable because a write
 * is always triggered: the read happens inside the handler the button already calls, so there is
 * one answer at one moment rather than a render loop.
 */
describe('a variable read by the node that writes it', () => {
  const code = home(calculatorSnapshot({ operators: ['add'], runningTotal: true }));

  it('reads the variable as the operand, inside the handler that writes it', () => {
    expect(code).toContain(
      'const run_derived_nd_math_add = () => set_state_nd_bucket((Number((state_nd_bucket ?? "")) + Number(field_cp_b)));',
    );
  });

  it('declares the variable before the run that closes over it', () => {
    expect(code.indexOf('const [state_nd_bucket')).toBeLessThan(
      code.indexOf('const run_derived_nd_math_add'),
    );
  });
});

/**
 * Global variables — one value, every screen.
 *
 * A screen variable is a `useState` in one module, which is exactly why it cannot answer "what did
 * the other screen work out?". A global is the same merge point lifted above the router: same
 * fan-in `set`, same last-write-wins, one context instead of one `useState`.
 */
describe('a global variable shared by two screens', () => {
  const project = calculatorSnapshot({ operators: ['add'], scope: 'global', secondScreen: true });
  const files = compile(project).files;
  const file = (path: string): string => {
    const found = files.find((entry) => entry.path === path);
    if (!found) throw new Error(`no ${path} emitted`);
    return found.content;
  };

  it('emits one context module holding the variable', () => {
    const globals = file('src/state/globals.tsx');
    expect(globals).toContain('export interface Globals');
    expect(globals).toContain('answer: number | null;');
    expect(globals).toContain('set_answer: (value: number | null) => void;');
    expect(globals).toContain('const [answer, set_answer] = useState<number | null>(null);');
  });

  it('wraps the router in the provider, so every route is inside it', () => {
    const app = file('src/App.tsx');
    expect(app).toContain("import { GlobalsProvider } from './state/globals';");
    expect(app.indexOf('<GlobalsProvider>')).toBeLessThan(app.indexOf('<BrowserRouter>'));
  });

  it('writes it from the screen holding the button', () => {
    const write = file('src/artboards/Home.tsx');
    expect(write).toContain("import { useGlobals } from '../state/globals';");
    expect(write).toContain('const { answer: global_answer, set_answer: set_global_answer } = useGlobals();');
    expect(write).toContain('const run_derived_nd_math_add = () => set_global_answer(');
    // The provider owns the state, so the screen declares none of its own for it.
    expect(write).not.toContain('const [global_answer');
  });

  it('reads it on a screen that never writes it, through a node of the same name', () => {
    const read = file('src/artboards/Report.tsx');
    // Only the half this screen uses: it displays the total, so it takes the value and not the
    // setter. An unused setter would fail the emitted app's own `noUnusedLocals` build.
    expect(read).toContain('const { answer: global_answer } = useGlobals();');
    expect(read).toContain('global_answer ?? ""');
    // The other screen's Math node reads fields that do not exist here; it must not be emitted.
    expect(read).not.toContain('field_cp_a');
    expect(read).not.toContain('run_derived_nd_math_add');
  });

  it('emits no context at all for a project with only screen variables', () => {
    const plain = compile(calculatorSnapshot({ operators: ['add'] })).files;
    expect(plain.some((entry) => entry.path === 'src/state/globals.tsx')).toBe(false);
    expect(plain.find((entry) => entry.path === 'src/App.tsx')!.content).not.toContain(
      'GlobalsProvider',
    );
  });

  it('drops a global nothing reads rather than emitting dead state', () => {
    const unread = applyOps(
      calculatorSnapshot({ operators: ['add'], scope: 'global', secondScreen: true }),
      [
        {
          type: 'setProp',
          componentId: 'cp_status',
          key: 'content',
          value: { kind: 'static', value: '' },
        },
        {
          type: 'setProp',
          componentId: 'cp_report_total',
          key: 'content',
          value: { kind: 'static', value: '' },
        },
      ],
    );
    // Nothing reads it anywhere, so the button that fills it is the real mistake, and that is
    // what the message names.
    expect(() => compile(unread)).toThrow(/nothing on this screen shows or keeps its result/i);
  });
});
