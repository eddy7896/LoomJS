import type { ComponentEmitter } from '../types';
import { styleAttr } from '../emit/style';
import { indent } from '../emit/text';
import { staticString, valueExpr } from '../emit/props';

/**
 * A Table (D8, `docs/15-schema.md`).
 *
 * A List with a Frame inside it can be made to look like a table, and every project ended up
 * doing exactly that — badly, because columns lining up across rows is the one thing a List
 * cannot promise. So this is a real `<table>`: the columns are named once, the header comes from
 * those names, and every row is the same cells in the same order.
 *
 * The columns are **named**, not discovered from the first row. A row missing a field would
 * otherwise reorder every column after it, and a table whose columns move between rows is worse
 * than no table.
 */

/** The column names a designer typed, as a list. Blank means "whatever the rows carry". */
export function columnNames(raw: string): string[] {
  return raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

export const tableEmitter: ComponentEmitter = {
  type: 'Table',
  emit(component, ctx, depth) {
    const items = component.props.items;
    const rowsExpr = items ? valueExpr(items, ctx, component.id, 'items') : '[]';
    const attrs = styleAttr(component, ctx, { display: 'block' });

    const empty = staticString(component, 'empty');
    const named = columnNames(staticString(component, 'columns'));

    // Nothing named yet: the keys of the first row, worked out once so every row uses the same
    // list. It is the honest fallback — the table still lines up, it just cannot promise which
    // columns appear until the data arrives.
    const columnsExpr =
      named.length > 0
        ? JSON.stringify(named)
        : `Object.keys(((${rowsExpr})[0] ?? {}) as Record<string, unknown>)`;

    const rowVar = `row_${component.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const colVar = `column_${component.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const listVar = `columns_${component.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;

    return `${indent(depth)}<div${attrs}>
${indent(depth + 1)}{(() => {
${indent(depth + 2)}const ${listVar}: string[] = ${columnsExpr};
${indent(depth + 2)}const rows = (${rowsExpr}) as Record<string, unknown>[];
${indent(depth + 2)}if (rows.length === 0) return <span>{${JSON.stringify(empty)}}</span>;
${indent(depth + 2)}return (
${indent(depth + 3)}<table style={{ width: '100%', borderCollapse: 'collapse' }}>
${indent(depth + 4)}<thead>
${indent(depth + 5)}<tr>
${indent(depth + 6)}{${listVar}.map((${colVar}: string) => (
${indent(depth + 7)}<th key={${colVar}} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #E8EAEE' }}>
${indent(depth + 8)}{${colVar}}
${indent(depth + 7)}</th>
${indent(depth + 6)}))}
${indent(depth + 5)}</tr>
${indent(depth + 4)}</thead>
${indent(depth + 4)}<tbody>
${indent(depth + 5)}{rows.map((${rowVar}: Record<string, unknown>, index: number) => (
${indent(depth + 6)}<tr key={index}>
${indent(depth + 7)}{${listVar}.map((${colVar}: string) => (
${indent(depth + 8)}<td key={${colVar}} style={{ padding: '6px 8px', borderBottom: '1px solid #F1F2F5' }}>
${indent(depth + 9)}{${rowVar}[${colVar}] === null || ${rowVar}[${colVar}] === undefined
${indent(depth + 10)}? ''
${indent(depth + 10)}: String(${rowVar}[${colVar}])}
${indent(depth + 8)}</td>
${indent(depth + 7)}))}
${indent(depth + 6)}</tr>
${indent(depth + 5)}))}
${indent(depth + 4)}</tbody>
${indent(depth + 3)}</table>
${indent(depth + 2)});
${indent(depth + 1)}})()}
${indent(depth)}</div>`;
  },
};
