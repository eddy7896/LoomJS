import { beforeEach, describe, expect, it } from 'vitest';
import { compile } from '@loom/compiler';
import {
  __resetStore,
  addComponent,
  getState,
  rename,
  rootComponentId,
  selectComponent,
  selectedComponentId,
} from '../src/state/store';
import {
  addConditionalStyle,
  conditionFromKey,
  conditionSources,
  setVisibleWhen,
} from '../src/state/conditions';

const snapshot = () => getState().snapshot;
const root = () => rootComponentId(snapshot());

/** A checkbox and a Text on the default screen — the shape every condition test needs. */
function drawCheckboxAndText(): { checkboxId: string; textId: string } {
  selectComponent(root());
  addComponent('Checkbox');
  const checkboxId = selectedComponentId()!;
  rename(checkboxId, 'Agree');

  selectComponent(root());
  addComponent('Text');
  const textId = selectedComponentId()!;
  rename(textId, 'Secret');

  return { checkboxId, textId };
}

beforeEach(() => {
  __resetStore();
});

describe('what a condition may read', () => {
  it('offers a checkbox the moment it is drawn, before any wiring', () => {
    const { checkboxId } = drawCheckboxAndText();
    const sources = conditionSources(snapshot(), getState().activeArtboardId);
    expect(sources.map((s) => s.label)).toContain('Agree is checked');
    expect(sources.find((s) => s.label === 'Agree is checked')?.key).toBe(`component:${checkboxId}`);
  });

  it('materialises the mirror when that source is picked', () => {
    const { checkboxId } = drawCheckboxAndText();
    const before = Object.keys(snapshot().nodes).length;

    const condition = conditionFromKey(`component:${checkboxId}`, undefined)!;
    expect(Object.keys(snapshot().nodes).length).toBe(before + 1);
    expect(snapshot().nodes[condition.source.nodeId]!.mirrorOf).toBe(checkboxId);
  });

  it('offers nothing when the screen produces no boolean', () => {
    expect(conditionSources(snapshot(), getState().activeArtboardId)).toHaveLength(0);
  });
});

describe('conditions on a component', () => {
  it('records the condition and compiles it away when the condition is cleared', () => {
    const { checkboxId, textId } = drawCheckboxAndText();
    const condition = conditionFromKey(`component:${checkboxId}`, undefined)!;

    setVisibleWhen(textId, condition);
    expect(snapshot().components[textId]!.visibleWhen).toEqual(condition);
    expect(compileHome()).toContain('isOn(');

    setVisibleWhen(textId, undefined);
    expect(snapshot().components[textId]!.visibleWhen).toBeUndefined();
    expect(compileHome()).not.toContain('isOn(');
  });

  it('adds a style override already pointing at a real source', () => {
    const { checkboxId, textId } = drawCheckboxAndText();
    conditionFromKey(`component:${checkboxId}`, undefined);

    addConditionalStyle(textId);
    const [override] = snapshot().components[textId]!.conditionalStyles!;
    expect(override).toBeDefined();
    // An override row that points nowhere would be a row the designer has to repair first.
    expect(snapshot().nodes[override!.when.source.nodeId]).toBeDefined();
  });

  it('does not add an override when there is nothing to condition on', () => {
    selectComponent(root());
    addComponent('Text');
    const textId = selectedComponentId()!;

    addConditionalStyle(textId);
    expect(snapshot().components[textId]!.conditionalStyles).toBeUndefined();
  });
});

function compileHome(): string {
  return compile(snapshot()).files.find((f) => f.path.startsWith('src/artboards/'))!.content;
}
