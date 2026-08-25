import { describe, expect, it } from 'vitest';
import { createComponent } from '@loom/components';
import {
  applyOp,
  createEmptyProject,
  type Artboard,
  type Component,
  type Snapshot,
} from '@loom/ir';
import { compile, diagnose } from '../src/index';
import { DEFAULT_PAGE, pageSize, printCss } from '../src/emit/document';

/**
 * Documents (L2, `docs/V1-COMPLETION.md`).
 *
 * The gate: **an invoice prints to a correct A4 PDF with a repeating header.** Everything below is
 * one clause of that sentence.
 *
 * There is no PDF library, and the tests are written against that decision rather than around it:
 * what makes the output correct is `@page`, a print stylesheet, and the browser's own typesetter —
 * the one that already drew the screen.
 */

function documentProject(overrides: Partial<Artboard> = {}): Snapshot {
  const root: Component = {
    ...createComponent('Frame', 'cp_page'),
    children: ['cp_title'],
  };
  const title = createComponent('Text', 'cp_title');

  const snapshot = applyOp(createEmptyProject('Billing'), {
    type: 'addArtboard',
    artboard: { id: 'ab_invoice', name: 'Invoice', root: root.id, kind: 'document', ...overrides },
    root,
  });
  return {
    ...snapshot,
    components: { ...snapshot.components, [root.id]: root, [title.id]: title },
  };
}

describe('a page meant for paper', () => {
  it('emits an @page rule at the paper it was given', () => {
    const css = printCss(documentProject({ page: DEFAULT_PAGE }))!;
    expect(css).toContain('@page');
    expect(css).toContain('size: 210mm 297mm');
    expect(css).toContain('margin: 12mm');
  });

  it('turns the paper the other way round for landscape', () => {
    const css = printCss(documentProject({ page: { ...DEFAULT_PAGE, orientation: 'landscape' } }))!;
    expect(css).toContain('size: 297mm 210mm');
  });

  /** A sidebar printed down the side of an invoice is the failure everybody has seen. */
  it('prints the document and nothing else on the page', () => {
    const css = printCss(documentProject())!;
    expect(css).toContain('@media print');
    expect(css).toContain('visibility: hidden');
    expect(css).toContain('.loom-document');
  });

  /** The "repeating header" half of the gate, and the row that must not split. */
  it('repeats a table header across pages and keeps rows whole', () => {
    const css = printCss(documentProject())!;
    expect(css).toContain('display: table-header-group');
    expect(css).toContain('break-inside: avoid');
  });

  it('writes the stylesheet into the project and imports it', () => {
    const result = compile(documentProject());
    expect(result.files.find((file) => file.path === 'src/print.css')).toBeDefined();
    expect(result.files.find((file) => file.path === 'src/index.css')!.content).toContain(
      "@import './print.css';",
    );
  });

  it('wraps the document in its own page, at its own size', () => {
    const result = compile(documentProject({ page: DEFAULT_PAGE }));
    const screen = result.files.find((file) => file.path.endsWith('Invoice.tsx'))!;
    expect(screen.content).toContain('loom-document');
    // Millimetres, because that is what the paper is measured in and what @page speaks.
    expect(screen.content).toContain('210mm');
  });

  /** Demand-driven: a project with no documents carries no print stylesheet. */
  it('emits nothing at all for a project that has no documents', () => {
    const plain = applyOp(createEmptyProject('Plain'), {
      type: 'addArtboard',
      artboard: { id: 'ab_1', name: 'Home', root: 'cp_root' },
      root: createComponent('Frame', 'cp_root'),
    });
    expect(printCss(plain)).toBeUndefined();
    expect(compile(plain).files.find((file) => file.path === 'src/print.css')).toBeUndefined();
  });

  it('gives one @page rule per distinct paper, not per document', () => {
    const base = documentProject({ page: DEFAULT_PAGE });
    const receiptRoot = createComponent('Frame', 'cp_receipt');
    const snapshot: Snapshot = {
      ...base,
      components: { ...base.components, [receiptRoot.id]: receiptRoot },
      artboards: {
        ...base.artboards,
        ab_receipt: {
          id: 'ab_receipt',
          name: 'Receipt',
          root: receiptRoot.id,
          kind: 'document',
          page: { preset: 'a5', width: 148, height: 210, margin: 6 },
        },
      },
    };

    const css = printCss(snapshot)!;
    expect(css).toContain('size: 210mm 297mm');
    expect(css).toContain('size: 148mm 210mm');
  });
});

describe('printing is an action, and it takes nothing', () => {
  /**
   * `pdf` prints the screen the person is on. Getting them to the invoice is what `navigate`
   * already does, and it already carries the params — a second mechanism for "which document,
   * with what data" would be the same decision made twice.
   */
  it('compiles to the browser print dialog, with no library behind it', () => {
    const snapshot = documentProject();
    const button = {
      ...createComponent('Button', 'cp_print'),
      props: {
        ...createComponent('Button', 'cp_print').props,
        onClick: {
          kind: 'event' as const,
          handler: {
            kind: 'actions' as const,
            actions: [{ kind: 'download' as const, format: 'pdf' as const }],
          },
        },
      },
    };
    const root = snapshot.components['cp_page']!;

    const withButton: Snapshot = {
      ...snapshot,
      components: {
        ...snapshot.components,
        [button.id]: button,
        [root.id]: { ...root, children: [...(root.children ?? []), button.id] },
      },
    };

    const result = compile(withButton);
    const screen = result.files.find((file) => file.path.endsWith('Invoice.tsx'))!;
    expect(screen.content).toContain('window.print()');
    // No dependency was added to carry it.
    const pkg = result.files.find((file) => file.path === 'package.json')!;
    expect(pkg.content).not.toMatch(/pdf|jspdf|pdfmake/i);
  });
});

describe('what a document is refused', () => {
  it('refuses a margin that leaves nothing to print on', () => {
    const problems = diagnose(documentProject({ page: { ...DEFAULT_PAGE, margin: 150 } }));
    expect(problems.some((problem) => problem.code === 'document-margin-too-wide')).toBe(true);
  });

  it('says so when nothing can reach the document', () => {
    // The project's own entry screen is reachable by definition; this is a second document that
    // no flow points at, which is the case worth a row.
    const base = documentProject({ page: DEFAULT_PAGE });
    const orphanRoot = createComponent('Frame', 'cp_orphan');
    const withOrphan: Snapshot = {
      ...base,
      components: { ...base.components, [orphanRoot.id]: orphanRoot },
      artboards: {
        ...base.artboards,
        ab_orphan: {
          id: 'ab_orphan',
          name: 'Statement',
          root: orphanRoot.id,
          kind: 'document',
          page: DEFAULT_PAGE,
        },
      },
    };

    const problems = diagnose(withOrphan);
    const unreachable = problems.find(
      (problem) => problem.code === 'document-unreachable' && problem.entityId === 'ab_orphan',
    );
    // A warning, not an error: the flow that opens it may be the next thing being drawn.
    expect(unreachable?.severity).toBe('warning');
    // And the entry document is not flagged, because it is reachable.
    expect(
      problems.some(
        (problem) => problem.code === 'document-unreachable' && problem.entityId === 'ab_invoice',
      ),
    ).toBe(false);
  });
});

describe('page size', () => {
  it('reads portrait as given and landscape the other way round', () => {
    expect(pageSize(DEFAULT_PAGE)).toEqual({ width: 210, height: 297 });
    expect(pageSize({ ...DEFAULT_PAGE, orientation: 'landscape' })).toEqual({
      width: 297,
      height: 210,
    });
  });
});
