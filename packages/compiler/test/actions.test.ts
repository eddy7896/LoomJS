import { describe, expect, it } from 'vitest';
import { actionsOf, applyOps, type Action, type Snapshot } from '@loom/ir';
import { compile } from '../src/index';
import { formSnapshot, inferredSnapshot, submitSequenceSnapshot } from './fixtures';

/**
 * Action sequences (spec 7).
 *
 * The load-bearing property is **order**: the order in the document is the order in the emitted
 * function, and a `trigger` is awaited so that everything after it genuinely happens after it.
 * Most of these assertions are about position, not presence.
 */

const home = (snapshot: Snapshot): string => {
  const file = compile(snapshot).files.find((f) => f.path === 'src/artboards/Home.tsx');
  if (!file) throw new Error('no Home artboard emitted');
  return file.content;
};

/** Put a sequence on the form fixture's Save button. */
function withActions(actions: Action[], base = formSnapshot()): Snapshot {
  return applyOps(base, [
    {
      type: 'setProp',
      componentId: 'cp_save',
      key: 'onClick',
      value: { kind: 'event', handler: { kind: 'actions', actions } },
    },
  ]);
}

describe('an old handler is a one-action sequence', () => {
  it('reads a bare navigate as one action', () => {
    expect(actionsOf({ kind: 'navigate', flowId: 'fl_1' })).toEqual([
      { kind: 'navigate', flowId: 'fl_1' },
    ]);
  });

  it('reads a bare trigger as one action', () => {
    const target = { nodeId: 'nd_a', portId: 'pt_run' };
    expect(actionsOf({ kind: 'trigger', target })).toEqual([{ kind: 'trigger', target }]);
  });

  it('still emits the one-line arrow it always did', () => {
    // No migration, and no ceremony: wrapping a single action in a block would be a block around
    // nothing, and every document written before spec 7 keeps compiling unchanged.
    const { snapshot } = inferredSnapshot();
    expect(home(snapshot)).toMatch(/onClick=\{\(\) => void run_[a-zA-Z0-9_]+\(\)\}/);
  });
});

/** Just the handler body — the prelude also mentions these setters, and order is the claim. */
function handlerBody(code: string): string {
  const start = code.indexOf('onClick={async () => {');
  if (start < 0) throw new Error('no async handler emitted');
  return code.slice(start, code.indexOf('}}', start));
}

describe('the done-when: save, clear, confirm, navigate', () => {
  const code = home(submitSequenceSnapshot());

  it('runs them in the order the document lists them', () => {
    const body = handlerBody(code);
    const save = body.indexOf('await run_');
    const clearTitle = body.indexOf('set_field_cp_title("")');
    const message = body.indexOf('showMessage(');
    const navigate = body.indexOf('navigate("/done")');

    expect(save).toBeGreaterThan(-1);
    expect(save).toBeLessThan(clearTitle);
    expect(clearTitle).toBeLessThan(message);
    expect(message).toBeLessThan(navigate);
  });

  it('awaits the save, so the rest happens after it', () => {
    expect(code).toContain('onClick={async () => {');
    expect(code).toMatch(/if \(!\(await run_[a-zA-Z0-9_]+\(\)\)\) return;/);
  });

  it('stops the sequence when the save failed', () => {
    // Navigating anyway would show someone a success they did not get.
    const body = handlerBody(code);
    expect(body.indexOf('return;')).toBeLessThan(body.indexOf('navigate("/done")'));
  });

  it('clears each field back to what it started as', () => {
    expect(code).toContain('set_field_cp_title("")');
    expect(code).toContain('set_field_cp_body("")');
  });
});

describe('each action compiles to what a developer would have written', () => {
  it('setField puts a literal in an input', () => {
    const code = home(
      withActions([
        { kind: 'setField', componentId: 'cp_title', value: { kind: 'static', value: 'draft' } },
        { kind: 'clearField', componentId: 'cp_body' },
      ]),
    );
    expect(code).toContain('set_field_cp_title("draft");');
  });

  it('clearField returns a number field to its initial number, not to ""', () => {
    const numbered = applyOps(formSnapshot(), [
      {
        type: 'addComponent',
        parentId: 'cp_form',
        component: {
          id: 'cp_qty',
          type: 'NumberField',
          name: 'Qty',
          props: { value: { kind: 'static', value: 3 } },
        },
      },
    ]);
    const code = home(
      withActions(
        [
          { kind: 'clearField', componentId: 'cp_qty' },
          { kind: 'openUrl', url: 'https://example.com' },
        ],
        numbered,
      ),
    );
    expect(code).toContain('set_field_cp_qty(3);');
  });

  it('openUrl always passes noopener,noreferrer', () => {
    // Without it the opened page can reach back through `window.opener`.
    const code = home(
      withActions([
        { kind: 'openUrl', url: 'https://example.com' },
        { kind: 'clearField', componentId: 'cp_title' },
      ]),
    );
    expect(code).toContain('window.open("https://example.com", "_blank", "noopener,noreferrer");');
  });

  it('copy is best-effort, so a refusal does not swallow what follows', () => {
    const code = home(
      withActions([
        { kind: 'copy', value: { kind: 'static', value: 'ABC123' } },
        { kind: 'message', text: 'Copied' },
      ]),
    );
    expect(code).toContain('void navigator.clipboard?.writeText(String("ABC123"));');
  });

  it('shows a message through the host above the router', () => {
    // Not the screen's own state: "save, confirm, navigate" unmounts the screen a frame after the
    // confirmation appears, so a per-screen toast would flash and vanish (`emit/messages.ts`).
    const project = compile(
      withActions([
        { kind: 'message', text: 'Saved', tone: 'ok' },
        { kind: 'clearField', componentId: 'cp_title' },
      ]),
    ).files;

    const screen = project.find((f) => f.path === 'src/artboards/Home.tsx')!.content;
    expect(screen).toContain("import { useMessages } from '../state/messages';");
    expect(screen).toContain('const { showMessage } = useMessages();');
    expect(screen).toContain('showMessage({ text: "Saved", tone: "ok" });');

    const host = project.find((f) => f.path === 'src/state/messages.tsx')!.content;
    expect(host).toContain('setTimeout(() => setMessage(null), 3000)');
    expect(host).toContain('role="status"');
    // Token variables, never hex: restyling a project stays one `:root` change.
    expect(host).toContain('var(--loom-color-ink)');
    expect(host).toContain('var(--loom-color-danger)');

    // Outermost, so it survives the navigation a sequence performs right after it.
    const app = project.find((f) => f.path === 'src/App.tsx')!.content;
    expect(app.indexOf('<MessagesProvider>')).toBeLessThan(app.indexOf('<BrowserRouter>'));
  });

  it('emits nothing at all when nothing shows a message', () => {
    const project = compile(formSnapshot()).files;
    expect(project.some((f) => f.path === 'src/state/messages.tsx')).toBe(false);
    expect(home(formSnapshot())).not.toContain('useMessages');
  });
});

describe('a conditional action', () => {
  it('guards just that step, not the whole sequence', () => {
    const code = home(submitSequenceSnapshot({ conditional: true }));
    expect(code).toMatch(/if \(isOn\([^)]*\)\) navigate\("\/done"\);/);
    // The steps before it are still unconditional.
    expect(code).toContain('set_field_cp_title("")');
  });
});

describe('what a sequence refuses', () => {
  it('refuses setting a component that holds no value of its own', () => {
    expect(() =>
      compile(
        withActions([
          { kind: 'setField', componentId: 'cp_save', value: { kind: 'static', value: 'x' } },
          { kind: 'clearField', componentId: 'cp_title' },
        ]),
      ),
    ).toThrow(/holds no value of its own/);
  });

  it('refuses setting a variable nothing on this screen reads', () => {
    const { snapshot } = inferredSnapshot();
    const orphan = applyOps(snapshot, [
      {
        type: 'setProp',
        componentId: 'cp_status',
        key: 'content',
        value: { kind: 'static', value: '' },
      },
    ]);
    expect(() =>
      compile(
        withActions(
          [
            { kind: 'setVariable', nodeId: 'nd_missing', value: { kind: 'static', value: true } },
            { kind: 'clearField', componentId: 'cp_title' },
          ],
          orphan,
        ),
      ),
    ).toThrow(/sets a variable nothing on this screen reads/);
  });

  it('refuses a component that no longer exists', () => {
    expect(() =>
      compile(
        withActions([
          { kind: 'clearField', componentId: 'cp_gone' },
          { kind: 'clearField', componentId: 'cp_title' },
        ]),
      ),
    ).toThrow(/no longer exists/);
  });
});

describe('a variable an action fills', () => {
  it('counts the action as its writer, so it is not "never written"', () => {
    // "Show the confirmation" is setVariable plus visibleWhen — the shape spec 7 argued for
    // instead of a show/hide action. It must not read as a variable nothing fills.
    const base = applyOps(formSnapshot(), [
      {
        type: 'addNode',
        node: {
          id: 'nd_done',
          category: 'state',
          kind: 'write',
          name: 'Done',
          position: { x: 0, y: 0 },
          config: { scope: 'screen', key: 'done' },
          ports: [
            { id: 'pt_set', name: 'set', direction: 'in', portKind: 'data', type: { kind: 'any' } },
            {
              id: 'pt_value',
              name: 'value',
              direction: 'out',
              portKind: 'data',
              type: { kind: 'any' },
            },
          ],
        },
      },
      {
        type: 'setVisibleWhen',
        componentId: 'cp_status',
        condition: { source: { nodeId: 'nd_done', portId: 'pt_value' } },
      },
    ]);

    const code = home(
      withActions(
        [
          { kind: 'setVariable', nodeId: 'nd_done', value: { kind: 'static', value: true } },
          { kind: 'message', text: 'Saved' },
        ],
        base,
      ),
    );

    expect(code).toContain('set_state_nd_done(true);');
    expect(code).toContain('const [state_nd_done, set_state_nd_done] = useState<boolean | null>(null);');
    expect(code).toContain('isOn(state_nd_done');
  });
});
