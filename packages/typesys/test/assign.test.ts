import { describe, expect, it } from 'vitest';
import type { Port, TypeRef } from '@loom/ir';
import { canConnect, formatType, inferType, isAssignable, tsTypeOf } from '../src/index';

const text: TypeRef = { kind: 'text' };
const number: TypeRef = { kind: 'number' };

const port = (over: Partial<Port>): Port => ({
  id: 'pt_1',
  name: 'value',
  direction: 'out',
  portKind: 'data',
  type: text,
  ...over,
});

describe('assignability', () => {
  it('matches identical primitives and rejects different ones', () => {
    expect(isAssignable(text, text)).toBe(true);
    expect(isAssignable(text, number)).toBe(false);
  });

  it('widens T into optional<T> but never narrows back', () => {
    const optionalText: TypeRef = { kind: 'optional', of: text };
    expect(isAssignable(text, optionalText)).toBe(true);
    expect(isAssignable(optionalText, text)).toBe(false);
  });

  it('is covariant in lists', () => {
    expect(isAssignable({ kind: 'list', of: text }, { kind: 'list', of: text })).toBe(true);
    expect(isAssignable({ kind: 'list', of: text }, { kind: 'list', of: number })).toBe(false);
    expect(isAssignable(text, { kind: 'list', of: text })).toBe(false);
  });

  it('accepts an enum subset and widens an enum to text, never the other way', () => {
    const small: TypeRef = { kind: 'enum', values: ['a'] };
    const big: TypeRef = { kind: 'enum', values: ['a', 'b'] };
    expect(isAssignable(small, big)).toBe(true);
    expect(isAssignable(big, small)).toBe(false);
    expect(isAssignable(small, text)).toBe(true);
    expect(isAssignable(text, small)).toBe(false);
  });

  it('treats unknown as inert and any as the marked escape hatch', () => {
    const unknown: TypeRef = { kind: 'unknown' };
    const any: TypeRef = { kind: 'any' };
    expect(isAssignable(unknown, text)).toBe(false);
    expect(isAssignable(text, unknown)).toBe(false);
    expect(isAssignable(unknown, unknown)).toBe(true);
    expect(isAssignable(any, text)).toBe(true);
    expect(isAssignable(text, any)).toBe(true);
  });

  it('keeps triggers apart from data', () => {
    const trigger: TypeRef = { kind: 'trigger' };
    expect(isAssignable(trigger, trigger)).toBe(true);
    expect(isAssignable(trigger, text)).toBe(false);
    expect(isAssignable(text, trigger)).toBe(false);
  });
});

describe('canConnect', () => {
  it('runs out -> in only', () => {
    expect(canConnect(port({ direction: 'out' }), port({ direction: 'in' })).ok).toBe(true);
    expect(canConnect(port({ direction: 'in' }), port({ direction: 'out' })).ok).toBe(false);
  });

  it('refuses to mix data and trigger ports', () => {
    const result = canConnect(
      port({ direction: 'out', portKind: 'trigger', type: { kind: 'trigger' } }),
      port({ direction: 'in', portKind: 'data' }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/trigger port to a data port/);
  });

  it('explains a type mismatch in vocabulary terms', () => {
    const result = canConnect(
      port({ direction: 'out', type: { kind: 'optional', of: text } }),
      port({ direction: 'in', type: text }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Type optional<text> is not assignable to text.');
  });
});

describe('inference and TS mapping', () => {
  it('infers the vocabulary from literals', () => {
    expect(inferType('a')).toEqual({ kind: 'text' });
    expect(inferType(1)).toEqual({ kind: 'number' });
    expect(inferType(true)).toEqual({ kind: 'boolean' });
    expect(inferType([1])).toEqual({ kind: 'list', of: { kind: 'number' } });
    expect(inferType([])).toEqual({ kind: 'list', of: { kind: 'unknown' } });
    expect(inferType({ a: 1 })).toEqual({ kind: 'record' });
    expect(inferType(null)).toEqual({ kind: 'unknown' });
  });

  it('maps the vocabulary into TypeScript for the emitted code', () => {
    expect(tsTypeOf(text)).toBe('string');
    expect(tsTypeOf({ kind: 'optional', of: text })).toBe('string | null');
    expect(tsTypeOf({ kind: 'list', of: number })).toBe('number[]');
    expect(tsTypeOf({ kind: 'enum', values: ['a', 'b'] })).toBe('"a" | "b"');
  });

  it('formats types the way the canvas labels them', () => {
    expect(formatType({ kind: 'list', of: { kind: 'optional', of: text } })).toBe(
      'list<optional<text>>',
    );
  });
});
