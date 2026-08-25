import { describe, expect, it } from 'vitest';
import { createComponent } from '@loom/components';
import { applyOp, createEmptyProject, type Artboard, type Snapshot } from '@loom/ir';
import { compile, diagnose, planRoutes } from '../src/index';
import { metaTags, prerenderable } from '../src/emit/seo';

/**
 * Public pages (L4, `docs/V1-COMPLETION.md`).
 *
 * The gate: **`curl` on a public route returns the heading text in the HTML body.** A Vite SPA
 * serves an empty `<div id="root">`, and a marketing site whose pages return no words is not a
 * marketing site.
 *
 * The decision under test is that this is done by prerendering at build time rather than by
 * adding a server-rendering framework — so the tests assert the build produces the machinery and,
 * just as importantly, that it added no dependency to do it.
 */

function site(overrides: Partial<Artboard> = {}, extra: Artboard[] = []): Snapshot {
  const root = createComponent('Frame', 'cp_root');
  const snapshot = applyOp(createEmptyProject('Acme'), {
    type: 'addArtboard',
    artboard: { id: 'ab_home', name: 'Home', root: root.id, public: true, ...overrides },
    root,
  });

  let out: Snapshot = { ...snapshot, components: { ...snapshot.components, [root.id]: root } };
  for (const artboard of extra) {
    const artboardRoot = createComponent('Frame', `cp_${artboard.id}`);
    out = {
      ...out,
      components: { ...out.components, [artboardRoot.id]: artboardRoot },
      artboards: { ...out.artboards, [artboard.id]: { ...artboard, root: artboardRoot.id } },
    };
  }
  return out;
}

const routesOf = (snapshot: Snapshot) =>
  planRoutes(snapshot, snapshot.artboards[snapshot.entryArtboard ?? 'ab_home']!);

describe('a page a stranger can read', () => {
  it('builds the prerender machinery when something is public', () => {
    const result = compile(site());
    const paths = result.files.map((file) => file.path);

    expect(paths).toContain('src/entry-server.tsx');
    expect(paths).toContain('scripts/prerender.mjs');
    // The same tree without BrowserRouter, so the build can supply a URL it knows.
    expect(paths).toContain('src/AppRoutes.tsx');
  });

  /** The decision the whole phase rests on: no framework, no plugin, no new package. */
  it('adds no dependency to do it', () => {
    const before = compile(site({ public: undefined }));
    const after = compile(site());

    const deps = (result: typeof before): string =>
      result.files.find((file) => file.path === 'package.json')!.content;

    expect(JSON.parse(deps(after)).dependencies).toEqual(JSON.parse(deps(before)).dependencies);
    expect(JSON.parse(deps(after)).devDependencies).toEqual(
      JSON.parse(deps(before)).devDependencies,
    );
  });

  it('runs the prerender as part of the ordinary build', () => {
    const pkg = JSON.parse(
      compile(site()).files.find((file) => file.path === 'package.json')!.content,
    );
    expect(pkg.scripts.build).toContain('vite build');
    expect(pkg.scripts.build).toContain('--ssr');
    expect(pkg.scripts.build).toContain('scripts/prerender.mjs');
  });

  it('renders the same tree, with the router supplied instead of mounted', () => {
    const files = compile(site()).files;
    const entry = files.find((file) => file.path === 'src/entry-server.tsx')!;
    expect(entry.content).toContain('StaticRouter');
    expect(entry.content).toContain('renderToString');

    const appRoutes = files.find((file) => file.path === 'src/AppRoutes.tsx')!;
    expect(appRoutes.content).not.toContain('BrowserRouter');
    // The real App still mounts one; the two come from one emitter, not two hand-kept copies.
    expect(files.find((file) => file.path === 'src/App.tsx')!.content).toContain('BrowserRouter');
  });

  it('emits nothing at all when nothing is public', () => {
    const result = compile(site({ public: undefined }));
    const paths = result.files.map((file) => file.path);
    expect(paths).not.toContain('scripts/prerender.mjs');
    expect(paths).not.toContain('src/AppRoutes.tsx');
    expect(
      JSON.parse(result.files.find((file) => file.path === 'package.json')!.content).scripts.build,
    ).toBe('tsc --noEmit && vite build');
  });
});

describe('what a crawler and a share card are told', () => {
  it('carries the title, description and card image the screen declares', () => {
    const artboard: Artboard = {
      id: 'ab_home',
      name: 'Home',
      root: 'cp_root',
      public: true,
      meta: { title: 'Acme — invoicing', description: 'Bills, sent.', image: 'https://a/og.png' },
    };
    const head = metaTags(artboard, 'Acme');

    expect(head).toContain('<title>Acme — invoicing</title>');
    expect(head).toContain('name="description" content="Bills, sent."');
    expect(head).toContain('property="og:title"');
    expect(head).toContain('property="og:image"');
    expect(head).toContain('name="twitter:card"');
  });

  it('falls back to the screen name rather than to nothing', () => {
    const head = metaTags({ id: 'ab_home', name: 'Pricing', root: 'cp_root' }, 'Acme');
    expect(head).toContain('<title>Pricing — Acme</title>');
  });

  it('escapes what someone typed, so a quote cannot break out of an attribute', () => {
    const head = metaTags(
      { id: 'ab_home', name: 'X', root: 'cp_root', meta: { description: 'a "b" <c>' } },
      'Acme',
    );
    expect(head).toContain('a &quot;b&quot; &lt;c&gt;');
  });
});

describe('what will not be published, and why', () => {
  /**
   * The guard exists because the content is for a particular person. Writing it into a file
   * anyone can fetch would turn a router-level convenience into a disclosure.
   */
  it('never prerenders a guarded screen, even when it is marked public', () => {
    const snapshot = site({ guard: { redirectTo: 'ab_home' } });
    expect(prerenderable(snapshot, routesOf(snapshot))).toEqual([]);

    const problems = diagnose(snapshot);
    const refused = problems.find((problem) => problem.code === 'public-screen-is-guarded');
    expect(refused?.severity).toBe('error');
  });

  /** One page per record, and the build does not know the records. It works; it is not indexed. */
  it('leaves a route with a param client-rendered, and says so', () => {
    const snapshot = site({ params: [{ name: 'id', type: { kind: 'text' } }] });
    expect(prerenderable(snapshot, routesOf(snapshot))).toEqual([]);

    const problems = diagnose(snapshot);
    const noted = problems.find((problem) => problem.code === 'public-route-has-params');
    // A warning: it still works, it just cannot be rendered ahead of time.
    expect(noted?.severity).toBe('warning');
  });

  it('publishes only the screens actually marked public', () => {
    const snapshot = site({}, [
      { id: 'ab_admin', name: 'Admin', root: 'cp_admin' },
      { id: 'ab_pricing', name: 'Pricing', root: 'cp_pricing', public: true },
    ]);
    const published = prerenderable(snapshot, routesOf(snapshot)).map((route) => route.path);

    expect(published).toContain('/');
    expect(published).toContain('/pricing');
    expect(published).not.toContain('/admin');
  });
});
