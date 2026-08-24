import type { Port, TypeRef } from '@loom/ir';

/**
 * The curated type vocabulary's assignability rules (`docs/specs/type-registry.md`). This is the
 * *canvas checker*: a fast approximation that decides whether a wire may exist. `tsc` over the
 * emitted repo remains the authority — when the two disagree, the rule here is the bug.
 */

export function formatType(type: TypeRef): string {
  switch (type.kind) {
    case 'list':
      return `list<${formatType(type.of)}>`;
    case 'optional':
      return `optional<${formatType(type.of)}>`;
    case 'enum':
      return `enum(${type.values.join('|')})`;
    default:
      return type.kind;
  }
}

export function isAssignable(from: TypeRef, to: TypeRef): boolean {
  // `unknown` is the untyped boundary marker: visibly inert until someone narrows it.
  if (from.kind === 'unknown' || to.kind === 'unknown') {
    return from.kind === 'unknown' && to.kind === 'unknown';
  }

  // A trigger carries no data and joins only a trigger.
  if (from.kind === 'trigger' || to.kind === 'trigger') {
    return from.kind === 'trigger' && to.kind === 'trigger';
  }

  // `any` is the Code-node / untyped-npm escape hatch. Permissive, but always rendered as untyped.
  if (from.kind === 'any' || to.kind === 'any') return true;

  // T -> optional<T> widens; optional<T> -> T does not. This is the nullable-column bug.
  if (to.kind === 'optional') {
    return from.kind === 'optional' ? isAssignable(from.of, to.of) : isAssignable(from, to.of);
  }
  if (from.kind === 'optional') return false;

  if (to.kind === 'list') {
    return from.kind === 'list' && isAssignable(from.of, to.of);
  }
  if (from.kind === 'list') return false;

  if (to.kind === 'enum') {
    // Only a subset of the same members satisfies an enum; free text does not.
    return from.kind === 'enum' && from.values.every((value) => to.values.includes(value));
  }
  if (from.kind === 'enum') return to.kind === 'text';

  return from.kind === to.kind;
}

export interface WireCheck {
  ok: boolean;
  reason?: string;
}

/** Whether one port may feed another: direction, port kind, then type. */
export function canConnect(from: Port, to: Port): WireCheck {
  if (from.direction !== 'out' || to.direction !== 'in') {
    return { ok: false, reason: 'A wire runs from an output port to an input port.' };
  }
  if (from.portKind !== to.portKind) {
    return {
      ok: false,
      reason: `Cannot wire a ${from.portKind} port to a ${to.portKind} port.`,
    };
  }
  if (!isAssignable(from.type, to.type)) {
    return {
      ok: false,
      reason: `Type ${formatType(from.type)} is not assignable to ${formatType(to.type)}.`,
    };
  }
  return { ok: true };
}

/** Infer a port type from a literal a designer typed into the inspector. */
export function inferType(value: unknown): TypeRef {
  if (typeof value === 'string') return { kind: 'text' };
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (value instanceof Date) return { kind: 'date' };
  if (Array.isArray(value)) {
    const first = value[0];
    return { kind: 'list', of: first === undefined ? { kind: 'unknown' } : inferType(first) };
  }
  if (value && typeof value === 'object') return { kind: 'record' };
  return { kind: 'unknown' };
}

/** The TypeScript type the emitted code should use for a port. */
export function tsTypeOf(type: TypeRef): string {
  switch (type.kind) {
    case 'text':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'string';
    case 'record':
      return 'Record<string, unknown>';
    case 'enum':
      return type.values.map((value) => JSON.stringify(value)).join(' | ');
    case 'list':
      return `${tsTypeOf(type.of)}[]`;
    case 'optional':
      return `${tsTypeOf(type.of)} | null`;
    case 'trigger':
      return 'void';
    case 'any':
      return 'any';
    case 'unknown':
      return 'unknown';
  }
}
