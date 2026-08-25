import { describe, expect, it } from 'vitest';
import { compile } from '../src/index';
import { crudSnapshot, trivialSnapshot } from './fixtures';
import { BOUNDARY_MODULE_PATH } from '../src/emit/boundary';

/**
 * Error boundaries (L1, `docs/V1-COMPLETION.md`).
 *
 * The gate: **a row that throws shows a row-level error and the other rows still render.**
 *
 * Without a boundary, a component that throws while rendering takes the whole tree with it — not
 * the row, the page. One record with a null where a date was promised and the app is a white
 * screen with a stack trace in a console nobody is watching. A forty-screen ERP that does that
 * once is unshippable.
 */

const filesOf = (snapshot = trivialSnapshot()) => compile(snapshot).files;
const fileAt = (path: string, snapshot = trivialSnapshot()) =>
  filesOf(snapshot).find((file) => file.path === path);

describe('the boundary itself', () => {
  /**
   * The one thing the compiler emits whether or not the project asks for it. Everything else is
   * demand-driven; insurance added after the crash is not insurance.
   */
  it('is emitted for every project, including the most trivial one', () => {
    expect(fileAt(BOUNDARY_MODULE_PATH)).toBeDefined();
  });

  it('costs no dependency', () => {
    const pkg = JSON.parse(fileAt('package.json')!.content);
    // `react-error-boundary` is the usual answer, and it is a package to carry for a class
    // component React has supported since 16.
    expect(JSON.stringify(pkg.dependencies)).not.toContain('error-boundary');
  });

  it('is a class, because this is the one thing hooks cannot do', () => {
    const module = fileAt(BOUNDARY_MODULE_PATH)!.content;
    expect(module).toContain('class ErrorBoundary');
    expect(module).toContain('getDerivedStateFromError');
    expect(module).toContain('componentDidCatch');
  });

  /** A boundary that hides the cause is worse than no boundary. */
  it('reports what broke rather than swallowing it', () => {
    const module = fileAt(BOUNDARY_MODULE_PATH)!.content;
    expect(module).toContain('console.error');
    expect(module).toContain('componentStack');
    // And the person sees something, not a blank.
    expect(module).toContain('role="alert"');
  });
});

describe('around a screen', () => {
  it('wraps every route, so one broken page does not take the app with it', () => {
    const app = fileAt('src/App.tsx')!.content;
    expect(app).toContain('<ErrorBoundary');
    expect(app).toContain("import { ErrorBoundary } from './state/boundary';");
  });

  it('names the screen, so the message says which one', () => {
    expect(fileAt('src/App.tsx')!.content).toContain('Home did not load.');
  });
});

describe('around a row', () => {
  /**
   * The one that earns its keep. The whole point of a list is that the other rows are still
   * useful — a table of five hundred blanked by one bad record is the failure this prevents.
   */
  it('wraps each row of a list', () => {
    const screen = filesOf(crudSnapshot()).find((file) => file.path.includes('/artboards/'))!;
    expect(screen.content).toContain('<ErrorBoundary label="This row did not load.">');
    expect(screen.content).toContain("import { ErrorBoundary } from '../state/boundary';");
  });

  it('wraps rows on a paged list too, not just an unpaged one', () => {
    const paged = filesOf(crudSnapshot({ pageSize: 10 })).find((file) =>
      file.path.includes('/artboards/'),
    )!;
    expect(paged.content).toContain('This row did not load.');
  });

  /** A screen with no list has no rows to catch, so it carries no import for one. */
  it('does not import one into a screen that has no list', () => {
    const plain = filesOf().find((file) => file.path.includes('/artboards/'))!;
    expect(plain.content).not.toContain('state/boundary');
  });
});
