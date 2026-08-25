import type { Artboard, Page, Snapshot } from '@loom/ir';

/**
 * Documents — screens meant for paper (`docs/V1-COMPLETION.md` L2).
 *
 * An invoice, a report card, a statement, a purchase order. Every one of the target app classes
 * eventually asks for one, and until now a project that needed one needed a developer.
 *
 * ## Printed, not generated
 *
 * There is no PDF library here, and that is the same decision the charts made: a dependency whose
 * whole job is drawing is one the emitted app should not carry. `pdfmake` and friends are hundreds
 * of kilobytes, a second layout engine with its own opinions about text, and a second place your
 * invoice can look different from the screen you designed.
 *
 * The browser already has a typesetter, and it is the one that drew the screen. `@page` tells it
 * the paper size and the margins; a print stylesheet drops the parts that are not the document;
 * "Save as PDF" is in every print dialog on every platform. What comes out is what was designed,
 * because it *is* what was designed.
 *
 * The honest cost, and it is worth stating rather than hiding: the person sees a print dialog. A
 * silent `invoice.pdf` in the downloads folder would need the library, and the library would mean
 * a second renderer that does not agree with the first.
 *
 * ## A document is still a route
 *
 * It takes params like any other artboard, so "invoice #123" is the flow payload that already
 * existed at M2 — not a second way to say which record a page is about.
 */

/** Paper, in millimetres. `@page` speaks mm, and so does everyone who buys paper. */
export const PAGE_PRESETS = {
  a4: { width: 210, height: 297 },
  a5: { width: 148, height: 210 },
  letter: { width: 216, height: 279 },
  legal: { width: 216, height: 356 },
} as const;

export type PagePreset = keyof typeof PAGE_PRESETS;

/** The default page, for a document nobody has told anything about yet. */
export const DEFAULT_PAGE: Page = {
  preset: 'a4',
  width: PAGE_PRESETS.a4.width,
  height: PAGE_PRESETS.a4.height,
  orientation: 'portrait',
  margin: 12,
};

export function isDocument(artboard: Artboard): boolean {
  return artboard.kind === 'document';
}

/** The page an artboard is laid out on, with the default filled in. */
export function pageOf(artboard: Artboard): Page {
  return artboard.page ?? DEFAULT_PAGE;
}

/** Width and height the way round the orientation asks for. */
export function pageSize(page: Page): { width: number; height: number } {
  return page.orientation === 'landscape'
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

/** The class a document's root carries, so the print stylesheet can find it. */
export const DOCUMENT_CLASS = 'loom-document';

/**
 * The print stylesheet, emitted once when a project has any document at all.
 *
 * Three jobs, and nothing beyond them:
 *
 *  1. **`@page`** — the paper size and the margin, so the browser paginates to the right sheet
 *     rather than to whatever the print dialog last remembered.
 *  2. **Only the document prints.** Everything outside it is hidden, because a sidebar printed
 *     down the side of an invoice is the failure everybody has seen.
 *  3. **Rows do not break across pages**, and a table's header repeats on each one. Both are one
 *     line of CSS and both are what makes a multi-page report readable rather than merely long.
 */
export function printCss(snapshot: Snapshot): string | undefined {
  const documents = Object.values(snapshot.artboards).filter(isDocument);
  if (documents.length === 0) return undefined;

  /**
   * One `@page` rule per distinct paper, named after it, so a project with an A4 invoice and an
   * A5 receipt gets both rather than whichever was written last.
   */
  const papers = new Map<string, Page>();
  for (const artboard of documents) {
    const page = pageOf(artboard);
    const { width, height } = pageSize(page);
    papers.set(`${width}x${height}x${page.margin}`, page);
  }

  const rules = [...papers.values()].map((page) => {
    const { width, height } = pageSize(page);
    return `@page {
  size: ${width}mm ${height}mm;
  margin: ${page.margin}mm;
}`;
  });

  return `/* Documents (docs/V1-COMPLETION.md L2). Printed by the browser that drew them. */
${rules.join('\n\n')}

/* On screen a document shows its own page, so what is being designed is what will print. */
.${DOCUMENT_CLASS} {
  margin: 0 auto;
  background: #ffffff;
}

@media print {
  /* Only the document. A sidebar down the side of an invoice is the failure everybody has seen. */
  body * {
    visibility: hidden;
  }

  .${DOCUMENT_CLASS},
  .${DOCUMENT_CLASS} * {
    visibility: visible;
  }

  .${DOCUMENT_CLASS} {
    position: absolute;
    inset: 0;
    /* The @page margin already holds the paper's edge; a second one here would double it. */
    margin: 0;
    padding: 0;
    width: auto;
    box-shadow: none;
  }

  /* A row split down the middle by a page break is the other thing nobody wants to read. */
  tr,
  li {
    break-inside: avoid;
  }

  /* A table running over two pages keeps its headings on both. */
  thead {
    display: table-header-group;
  }

  /* Ink on paper: a link's address is worth nothing to someone holding a sheet of it. */
  a {
    text-decoration: none;
    color: inherit;
  }
}
`;
}

/**
 * The inline style a document's root carries on screen.
 *
 * The page's own size in millimetres, so the designer is looking at the sheet rather than at a
 * browser-width approximation of it that will paginate differently.
 */
export function documentStyle(page: Page): Record<string, string | number> {
  const { width, height } = pageSize(page);
  return {
    width: `${width}mm`,
    minHeight: `${height}mm`,
    padding: `${page.margin}mm`,
  };
}
