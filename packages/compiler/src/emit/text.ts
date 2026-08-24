const INDENT = '  ';

export const indent = (depth: number): string => INDENT.repeat(depth);

/** A JS string literal safe to drop into emitted source. */
export const literal = (value: string): string => JSON.stringify(value);

/** JSX text content: escape the characters that would break out of the expression. */
export const jsxText = (value: string): string => `{${literal(value)}}`;

/** Serialize a style object as a plain JS object literal, key order preserved. */
export function styleObject(style: Record<string, string | number>): string {
  const body = Object.entries(style)
    .map(([k, v]) => `${k}: ${typeof v === 'number' ? v : literal(v)}`)
    .join(', ');
  return body ? `{ ${body} }` : '{}';
}

/** Serialize a style object as a JSX inline-style expression, key order preserved. */
export function styleExpr(style: Record<string, string | number>): string {
  const entries = Object.entries(style);
  if (entries.length === 0) return '';
  const body = entries
    .map(([k, v]) => `${k}: ${typeof v === 'number' ? v : literal(v)}`)
    .join(', ');
  return `{{ ${body} }}`;
}

/** `Home page` -> `HomePage`; always a valid, non-empty TS identifier. */
export function pascalCase(input: string): string {
  const parts = input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const joined = parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join('');
  if (joined.length === 0) return 'Artboard';
  return /^[0-9]/.test(joined) ? `A${joined}` : joined;
}
