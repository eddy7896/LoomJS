import { describe, expect, it } from 'vitest';
import { applyOps, type Op, type Snapshot } from '@loom/ir';
import { compile } from '../src/index';
import { formSnapshot } from './fixtures';

/**
 * Conditions (spec 6). The thing under test throughout is that a condition **removes the element**
 * rather than hiding it, and that a condition is only ever a reference to a boolean — never an
 * expression language growing inside a property.
 */

const home = (snapshot: Snapshot): string => {
  const file = compile(snapshot).files.find((f) => f.path === 'src/artboards/Home.tsx');
  if (!file) throw new Error('no Home artboard emitted');
  return file.content;
};

/** A checkbox on the form, mirrored, so there is a real boolean to condition on. */
function withCheckbox(extra: Op[] = []): Snapshot {
  return applyOps(formSnapshot(), [
    {
      type: 'addComponent',
      parentId: 'cp_form',
      component: {
        id: 'cp_agree',
        type: 'Checkbox',
        name: 'Agree',
        props: { value: { kind: 'static', value: false }, label: { kind: 'static', value: 'Agree' } },
      },
    },
    {
      type: 'addNode',
      node: {
        id: 'nd_m_agree',
        category: 'ui',
        kind: 'mirror',
        mirrorOf: 'cp_agree',
        ports: [
          { id: 'pt_value', name: 'checked', direction: 'out', portKind: 'data', type: { kind: 'boolean' } },
        ],
        position: { x: 0, y: 0 },
      },
    },
    ...extra,
  ]);
}

const showWhen = (componentId: string, test?: 'not'): Op => ({
  type: 'setVisibleWhen',
  componentId,
  condition: { source: { nodeId: 'nd_m_agree', portId: 'pt_value' }, ...(test ? { test } : {}) },
});

describe('visibility', () => {
  it('removes the element from the tree rather than hiding it', () => {
    const code = home(withCheckbox([showWhen('cp_status')]));
    expect(code).toContain('{isOn(field_cp_agree) ? (');
    expect(code).toContain(') : null}');
    // A hidden element that still occupies layout and still ships its contents is a leak.
    expect(code).not.toContain('display: "none"');
    expect(code).not.toContain('visibility');
  });

  it('inverts when the test is "off"', () => {
    expect(home(withCheckbox([showWhen('cp_status', 'not')]))).toContain('{!isOn(field_cp_agree) ? (');
  });

  it('takes the whole subtree with it', () => {
    const code = home(withCheckbox([showWhen('cp_form')]));
    // The form's fields are inside the conditional block, not beside it.
    const start = code.indexOf('{isOn(field_cp_agree) ? (');
    const end = code.indexOf(') : null}', start);
    expect(code.slice(start, end)).toContain('field_cp_title');
  });

  it('emits the truthiness helper once, and only when something conditions', () => {
    const conditioned = home(withCheckbox([showWhen('cp_status')]));
    expect(conditioned.match(/function isOn\(/g)).toHaveLength(1);
    expect(home(withCheckbox())).not.toContain('function isOn(');
  });

  it('refuses a condition reading something this screen does not produce', () => {
    const dangling = applyOps(formSnapshot(), [
      {
        type: 'setVisibleWhen',
        componentId: 'cp_status',
        condition: { source: { nodeId: 'nd_ghost', portId: 'pt_result' } },
      },
    ]);
    expect(() => compile(dangling)).toThrow(/does not produce a value from/);
  });
});

describe('conditional style', () => {
  const styled = (styles: unknown): Snapshot =>
    withCheckbox([
      { type: 'setStyle', componentId: 'cp_status', style: { textColor: { kind: 'token', token: 'color.ink' } } },
      { type: 'setConditionalStyles', componentId: 'cp_status', styles: styles as never },
    ]);

  it('spreads over the base while the condition holds', () => {
    const code = home(
      styled([
        {
          when: { source: { nodeId: 'nd_m_agree', portId: 'pt_value' } },
          style: { textColor: { kind: 'token', token: 'color.brand' } },
        },
      ]),
    );
    expect(code).toContain('color: "var(--loom-color-ink)"');
    expect(code).toContain('...(isOn(field_cp_agree) ? { color: "var(--loom-color-brand)" } : {})');
  });

  it('applies several overrides in order, so two conditions do not fight', () => {
    const code = home(
      styled([
        {
          when: { source: { nodeId: 'nd_m_agree', portId: 'pt_value' } },
          style: { background: { kind: 'token', token: 'color.brand-tint' } },
        },
        {
          when: { source: { nodeId: 'nd_m_agree', portId: 'pt_value' }, test: 'not' },
          style: { radius: { kind: 'token', token: 'radius.pill' } },
        },
      ]),
    );
    const first = code.indexOf('--loom-color-brand-tint');
    const second = code.indexOf('--loom-radius-pill');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it('holds the same token rules as the base style', () => {
    expect(() =>
      compile(
        styled([
          {
            when: { source: { nodeId: 'nd_m_agree', portId: 'pt_value' } },
            style: { background: { kind: 'token', token: 'color.puce' } },
          },
        ]),
      ),
    ).toThrow(/not in the design system/);
  });
});
