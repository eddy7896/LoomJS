import { describe, expect, it } from 'vitest';
import { componentDefs, createComponent, defFor } from '../src/index';

describe('component definitions', () => {
  it('creates a container with its default layout and an empty child list', () => {
    const frame = createComponent('Frame', 'cp_1');
    expect(frame.layout).toBeDefined();
    expect(frame.children).toEqual([]);
  });

  it('creates a leaf with its schema defaults applied and no layout', () => {
    const text = createComponent('Text', 'cp_2');
    expect(text.props.content).toEqual({ kind: 'static', value: 'Text' });
    expect(text.layout).toBeUndefined();
    expect(text.children).toBeUndefined();
  });

  it('every declared field has a default, so a new component is always valid', () => {
    for (const def of componentDefs()) {
      for (const field of def.fields) {
        expect(field.default, `${def.type}.${field.key}`).toBeDefined();
      }
    }
  });

  it('rejects an unknown type', () => {
    expect(() => createComponent('Carousel', 'cp_3')).toThrow(/Unknown component type/);
    expect(defFor('Carousel')).toBeUndefined();
  });
});
