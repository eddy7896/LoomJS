import type { Artboard, Snapshot } from '@loom/ir';
import { CompileError, type CompileResult, type EmittedFile } from './types';
import { emitArtboardModule } from './emit/artboard';
import { planRoutes, type RouteInfo } from './emit/routes';
import { planPipelines, validateWires } from './emit/pipeline';
import { emitApiFunction } from './emit/server';
import { scaffoldFiles } from './emit/project';
import { emitStorage, localDirectories, type BucketPlan } from './emit/storage';
import { emitChartRuntime } from './emit/charts';
import { emitCalendarRuntime } from './emit/calendar';
import { emitGlobalsModule, GLOBALS_MODULE_PATH } from './emit/globals';
import { emitMessagesModule, MESSAGES_MODULE_PATH, usesMessages } from './emit/messages';
import {
  bucketCredentials,
  bucketDependencies,
  dialectOf,
  isBucket,
  isDocumentStore,
  type BucketConfig,
} from '@loom/connectors';
import { migrationFile } from './emit/migrations';
import { emitContainerFiles } from './emit/container';
import { emitReadme } from './emit/readme';
import { responsiveCss } from './emit/responsive';
import { printCss } from './emit/document';
import {
  definitionComponentName,
  definitionPath,
  groupByShell,
  isShell,
  orderDefinitions,
  validateShells,
} from './emit/definition';

import {
  APP_ROUTES_PATH,
  ENTRY_SERVER_PATH,
  PRERENDER_SCRIPT_PATH,
  entryServerSource,
  metaTags,
  prerenderScript,
  prerenderable,
} from './emit/seo';
import { toolCredentials } from './emit/tools';
import { planGlobals, type GlobalPlan } from './emit/state';
import {
  ssoProvidersUsed,
  AUTH_MODULE_PATH,
  emitAuthModule,
  guardedElement,
  requireAuthConnector,
  usesAuth,
  validateGuards,
} from './emit/auth';
import { emitAuthFunctions } from './emit/authServer';
import { TENANCY_MODULE_PATH, emitTenancyModule, tenancyOf, validateTenancy } from './emit/tenancy';
import { emitRlsFiles, validateRls } from './emit/rls';

/**
 * Compile a snapshot into the file set of a runnable Vite + React + TS app.
 *
 * M0 emitted static UI; M2 added the router; M3 adds the backend: an API route node becomes a
 * Vercel serverless function, and the pipelines around it become state, handlers and fetches
 * inside the artboard module. Connectors (M4) plug in here later. Nothing in the snapshot carries
 * a secret (guardrail 1), so nothing secret can reach the emitted repo.
 */
const NEWLINE = String.fromCharCode(10);

/** The elements that draw themselves from the chart runtime. */
const CHART_TYPES = new Set(['BarChart', 'LineChart', 'PieChart', 'Stat']);

export function compile(snapshot: Snapshot): CompileResult {
  const entry = resolveEntryArtboard(snapshot);
  const routes = planRoutes(snapshot, entry);

  validateFlows(snapshot);
  validateWires(snapshot);
  validateServerOnlyWork(snapshot);
  validateGuards(snapshot);
  validateShells(snapshot);

  // A project with users emits an auth server and stops using the service-role key for its data:
  // the database answers as the person asking, and row-level security decides
  // (`docs/specs/app-auth.md`).
  const auth = usesAuth(snapshot);
  if (auth) requireAuthConnector(snapshot);

  /**
   * Organisations (O1). A project says which tables hold them; the emitted app resolves the
   * current one **server-side** from the membership table on every session request.
   */
  const tenancy = tenancyOf(snapshot);
  validateTenancy(snapshot, auth);
  validateRls(snapshot);

  // App-wide variables are planned once for the whole project: a global's identity is its name,
  // and the screen that writes it is rarely the screen that reads it (`emit/state.ts`).
  const globals = planGlobals(snapshot);

  const dbNodes = Object.values(snapshot.nodes).filter((node) => node.category === 'db');
  const modules = new Set(
    dbNodes
      .map((node) => (node.config as { connectorId?: string } | undefined)?.connectorId)
      .map((id) => (id ? snapshot.connectors[id]?.moduleId : undefined))
      .filter((id): id is string => Boolean(id)),
  );
  const usesSql = [...modules].some((id) => dialectOf(id));
  const usesMysql = [...modules].some((id) => dialectOf(id) === 'mysql');
  const usesFirestore = [...modules].some((id) => isDocumentStore(id));
  const usesDatabase = dbNodes.length > 0 && !usesSql && !usesFirestore;

  /**
   * The buckets this project has attached (`docs/29-storage.md`).
   *
   * Every one of them is emitted, whether or not a field points at it yet: a bucket is a *place*
   * the project has, and half-emitting it would mean the upload route existed only once somebody
   * had already drawn the field that needs it.
   */
  const buckets: BucketPlan[] = Object.values(snapshot.connectors)
    .filter((connector) => isBucket(connector.moduleId))
    .map((connector) => ({
      id: connector.id,
      moduleId: connector.moduleId,
      config: (connector.config ?? {}) as BucketConfig,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const files: EmittedFile[] = scaffoldFiles(snapshot.name, snapshot.name, {
    usesDatabase,
    usesSql: usesSql && !usesMysql,
    usesMysql,
    usesFirestore,
    theme: snapshot.theme,
    responsiveCss: responsiveCss(snapshot),
    printCss: printCss(snapshot),
    prerender: prerenderable(snapshot, routes).length > 0,
    extraDependencies: bucketDependencies(buckets.map((bucket) => bucket.moduleId)),
  });

  files.push(...emitStorage(buckets));

  /**
   * The chart arithmetic, once, when anything draws one (`docs/30-charts.md`).
   *
   * One module the charts import rather than a copy pasted into each artboard: a project with four
   * charts should have one copy of the maths, and a person reading the repo one place to check what
   * the axis does.
   */
  if (Object.values(snapshot.components).some((component) => CHART_TYPES.has(component.type))) {
    files.push(emitChartRuntime());
  }

  // The same arrangement for the month arithmetic (`docs/31-calendar-chat.md`).
  if (Object.values(snapshot.components).some((component) => component.type === 'Calendar')) {
    files.push(emitCalendarRuntime());
  }

  // One serverless function per API route node, emitted once even if several screens call it.
  const emittedRoutes = new Set<string>();
  for (const [, artboard] of sortedArtboards(snapshot)) {
    for (const plan of planPipelines(snapshot, artboard)) {
      if (emittedRoutes.has(plan.routePath)) continue;
      emittedRoutes.add(plan.routePath);
      files.push(emitApiFunction(plan, snapshot, auth));
    }
  }

  for (const [artboardId, artboard] of sortedArtboards(snapshot)) {
    const route = routes.get(artboardId)!;
    files.push({
      path: `src/artboards/${route.componentName}.tsx`,
      content: emitArtboardModule(snapshot, artboard, routes, route.componentName, globals),
    });
  }

  // Somewhere to run it that is not a platform (`docs/18-containers.md`). The route table is
  // written out from what was actually emitted, so a route that fails to load is a compile error
  // rather than a 404 nobody can explain.
  // Provider secrets belong to whoever runs the auth server. On hosted Supabase that is Supabase,
  // and naming the variables here would be telling someone to set something nothing reads; a
  // project that runs its own gets them by name (`docs/20-provider-setup.md`).
  const ownAuthServer = Object.values(snapshot.connectors).some(
    (connector) => ((connector.config ?? {}) as { selfHostedAuth?: boolean }).selfHostedAuth,
  );

  files.push(
    ...emitContainerFiles({
      routes: files.filter((file) => file.path.startsWith('api/')).map((file) => file.path),
      // A local-disk bucket's folder is served back at /files by the server a container runs.
      uploadFolders: localDirectories(buckets),
      usesSql,
      gotrueProviders: ownAuthServer ? ssoProvidersUsed(snapshot) : [],
      credentials: [
        ...(usesSql ? ['DATABASE_URL'] : []),
        ...(usesFirestore ? ['FIREBASE_SERVICE_ACCOUNT'] : []),
        ...(usesDatabase ? ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] : []),
        ...(auth ? ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] : []),
        ...toolCredentials(snapshot),
        ...bucketCredentials(buckets.map((bucket) => bucket.moduleId)),
      ].filter((name, index, all) => all.indexOf(name) === index),
    }),
  );

  /**
   * Reusable components (R1), before the screens that place them.
   *
   * Emitted through the **same walker** as an artboard, with the definition passed as a synthetic
   * artboard whose params are its params. One tree renderer, so a Frame cannot be right on a
   * screen and wrong inside a component.
   */
  for (const definition of orderDefinitions(snapshot)) {
    /**
     * A definition holding a screen slot is a **shell** (R2), and the only thing that changes is
     * that its links know which page is showing. One loop, because a shell is one of these.
     */
    const kind = isShell(snapshot, definition) ? 'shell' : 'definition';

    files.push({
      path: definitionPath(definition),
      content: emitArtboardModule(
        snapshot,
        {
          id: definition.id,
          name: definition.name,
          root: definition.root,
          params: definition.params,
        },
        routes,
        definitionComponentName(definition),
        globals,
        kind,
      ),
    });
  }

  const messages = usesMessages(snapshot);
  files.push({
    path: 'src/App.tsx',
    content: emitApp(snapshot, entry, routes, globals, messages, auth),
  });

  /**
   * Public pages (L4). A second module holding the same tree without `BrowserRouter`, so the
   * prerender can supply a URL the build knows instead of one a browser is at.
   *
   * The two files are generated by **one function with one flag**, so they cannot drift the way
   * hand-maintained duplication does. Only a project with something public to prerender gets it.
   */
  const publicRoutes = prerenderable(snapshot, routes);
  if (publicRoutes.length > 0) {
    files.push({
      path: APP_ROUTES_PATH,
      content: emitApp(snapshot, entry, routes, globals, messages, auth, true),
    });
    files.push({ path: ENTRY_SERVER_PATH, content: entryServerSource() });

    const heads: Record<string, string> = {};
    for (const route of publicRoutes) {
      heads[route.path] = metaTags(snapshot.artboards[route.artboardId]!, snapshot.name);
    }
    files.push({ path: PRERENDER_SCRIPT_PATH, content: prerenderScript(publicRoutes, heads) });
  }

  if (auth) {
    files.push({ path: AUTH_MODULE_PATH, content: emitAuthModule(Boolean(tenancy)) });
    files.push(...emitAuthFunctions(ssoProvidersUsed(snapshot), Boolean(tenancy)));
    if (tenancy) {
      files.push({ path: TENANCY_MODULE_PATH, content: emitTenancyModule(tenancy) });

      /**
       * The rules the database enforces (O3). Everything else about tenancy is the app being
       * careful; this is the only part that refuses.
       */
      // The policies, and the script that tries to get past them (O3).
      files.push(...emitRlsFiles(snapshot));
    }
  }

  if (globals.length > 0) {
    files.push({ path: GLOBALS_MODULE_PATH, content: emitGlobalsModule(globals) });
  }

  if (messages) {
    files.push({ path: MESSAGES_MODULE_PATH, content: emitMessagesModule() });
  }

  // Every schema change this project made, as numbered SQL the user owns. The studio applied
  // them against one database; a second environment gets them from here (`docs/15-schema.md`).
  for (const migration of snapshot.migrations ?? []) {
    files.push(migrationFile(migration));
  }

  /**
   * Every name the deployment has to set — one file, whatever mix of things this project reaches.
   *
   * It used to be a chain of `else if`, which meant a project that talked to a database *and*
   * called a tool was told about one of them. Names only, always: the values live in the env
   * bucket and are injected at deploy (`docs/specs/connector-credentials.md`).
   */
  const envNames: string[] = [];

  if (usesFirestore) {
    // The whole key file, as one value: it holds a private key, so it is a name here and a value
    // only in the deployment.
    envNames.push('FIREBASE_SERVICE_ACCOUNT');
  } else if (usesSql) {
    // One name, and it carries the password in the middle of it — which is exactly why it is a
    // name here and a value only in the deployment.
    envNames.push('DATABASE_URL');
  } else if (usesDatabase || auth) {
    // Which names depends on who the routes are. With users, every request is answered as the
    // person asking, so the publishable key is what the server needs — and the service-role key,
    // which bypasses the rules keeping one person's rows theirs, is not asked for at all.
    envNames.push(
      ...(auth
        ? ['SUPABASE_URL', 'SUPABASE_ANON_KEY']
        : ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']),
    );
  }

  // A tool's key is the same kind of secret as a database password, and the fact that it belongs
  // to a fashionable service does not make it a different kind (`docs/22-api-connectors.md`).
  envNames.push(...toolCredentials(snapshot));

  // A bucket key is the same kind of secret again — and the one that would be worst to leak into a
  // browser, because a bucket anyone can write to is a bucket anyone can fill (`docs/29-storage.md`).
  for (const name of bucketCredentials(buckets.map((bucket) => bucket.moduleId))) {
    if (!envNames.includes(name)) envNames.push(name);
  }

  if (envNames.length > 0) {
    files.push({
      path: '.env.example',
      content: `${envNames.map((name) => `${name}=`).join(NEWLINE)}${NEWLINE}`,
    });
  }

  /**
   * A README, written from this project rather than pasted into it.
   *
   * A repo with none assumes whoever opens it already knows what it is — and the person opening
   * this one may be a developer a designer handed it to (`docs/25-readme.md`).
   */
  files.push(
    emitReadme({
      name: snapshot.name,
      screens: [...routes.values()].map((route) => ({
        name: route.componentName,
        path: route.path,
      })),
      routes: files
        .filter((file) => file.path.startsWith('api/') && !file.path.startsWith('api/auth/'))
        .map((file) => file.path),
      env: envNames,
      migrations: (snapshot.migrations ?? []).length,
      usesSql,
      usesAuth: auth,
      usesUploads: buckets.length > 0,
      usesLocalUploads: buckets.some((bucket) => bucket.moduleId === 'local'),
    }),
  );

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files };
}

/** The router module: one `<Route>` per artboard, entry first, inside the globals provider. */
function emitApp(
  snapshot: Snapshot,
  entry: Artboard,
  routes: Map<string, RouteInfo>,
  globals: GlobalPlan[],
  messages: boolean,
  auth: boolean,
  /**
   * Supply the router instead of mounting `BrowserRouter` (L4).
   *
   * The prerender renders the same tree against a URL the build knows rather than one a browser
   * is at, so `App` accepts a router from outside. There is one app rendered twice, not two apps
   * to keep in agreement — which is the only version of this worth having.
   */
  routerless = false,
): string {
  const ordered = [...routes.values()].sort((a, b) => {
    if (a.artboardId === entry.id) return -1;
    if (b.artboardId === entry.id) return 1;
    return a.componentName.localeCompare(b.componentName);
  });

  const imports = ordered
    .map((route) => `import ${route.componentName} from './artboards/${route.componentName}';`)
    .join('\n');

  const routeFor = (route: RouteInfo, pad: number): string => {
    const artboard = snapshot.artboards[route.artboardId]!;
    // A guarded screen is wrapped where the router mounts it, so there is no moment where the
    // screen has rendered and the redirect has not happened yet (`emit/auth.ts`).
    const element = guardedElement(artboard, `<${route.componentName} />`, routes);
    return `${' '.repeat(pad)}<Route path="${route.path}" element={${element}} />`;
  };

  /**
   * Screens inside a shell become **children of a pathless layout route** (R2).
   *
   * That nesting is the whole feature: react-router keeps the shell mounted and swaps only what is
   * inside its `<Outlet />`, so a sidebar survives navigation instead of being torn down and
   * rebuilt — keeping its scroll position, its open sections, and anything it does on mount. A
   * shell every screen merely *placed* would look identical and do none of that.
   *
   * Screens in no shell stay where they were, as siblings.
   */
  const { shells, loose } = groupByShell(
    snapshot,
    ordered.map((route) => route.artboardId),
  );
  const byArtboard = new Map(ordered.map((route) => [route.artboardId, route]));

  const blocks: string[] = [];
  for (const [layoutId, artboardIds] of shells) {
    const name = definitionComponentName(snapshot.definitions![layoutId]!);
    const children = artboardIds.map((id) => routeFor(byArtboard.get(id)!, 10)).join('\n');
    blocks.push(`        <Route element={<${name} />}>\n${children}\n        </Route>`);
  }
  for (const id of loose) blocks.push(routeFor(byArtboard.get(id)!, 8));

  const routeElements = blocks.join('\n');

  // An app-wide variable has to outlive the screen that wrote it, so its provider sits above the
  // router — the one place every route is inside (`emit/globals.ts`).
  const inner = `      <Routes>
${routeElements}
      </Routes>`;
  const router = routerless
    ? inner.replace(/^ {2}/gm, '')
    : `    <BrowserRouter>
${inner}
    </BrowserRouter>`;

  // Providers wrap outward-in, each indenting what it holds. The message host is outermost: a
  // confirmation has to survive the navigation a sequence performs right after it
  // (`emit/messages.ts`).
  const wrap = (inner: string, tag: string): string => {
    const indented = inner
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');
    return `    <${tag}>\n${indented}\n    </${tag}>`;
  };

  let tree = router;
  if (globals.length > 0) tree = wrap(tree, 'GlobalsProvider');
  // Who is signed in sits above the router as well: the guard reads it while deciding whether a
  // route may mount at all.
  if (auth) tree = wrap(tree, 'AuthProvider');
  if (messages) tree = wrap(tree, 'MessagesProvider');

  const globalsImport =
    globals.length > 0 ? `import { GlobalsProvider } from './state/globals';\n` : '';
  const messagesImport = messages ? `import { MessagesProvider } from './state/messages';\n` : '';
  const guarded = ordered.some((route) => snapshot.artboards[route.artboardId]?.guard);
  const authImport = auth
    ? `import { AuthProvider${guarded ? ', RequireSignIn' : ''} } from './state/auth';\n`
    : '';

  return `// Generated by @loom/compiler. Entry artboard: "${entry.name}".
// Routes come from the artboards and the flow arrows between them — never hand-authored.
import { ${routerless ? '' : 'BrowserRouter, '}Route, Routes } from 'react-router-dom';
${globalsImport}${messagesImport}${authImport}${imports}

export default function App() {
  return (
${tree}
  );
}
`;
}

/**
 * Database work runs on the server, full stop. A db node outside an API route's body would mean
 * a service-role key in the browser, so the compiler refuses rather than warns — security is a
 * build-time gate (`docs/specs/connector-credentials.md`, guardrails 1-4).
 */
function validateServerOnlyWork(snapshot: Snapshot): void {
  const insideAnApiBody = new Set<string>();
  for (const node of Object.values(snapshot.nodes)) {
    if (node.category !== 'api') continue;
    for (const id of ((node.config ?? {}) as { body?: string[] }).body ?? []) {
      insideAnApiBody.add(id);
    }
  }

  for (const node of Object.values(snapshot.nodes)) {
    // A screen bucket is React local state; inside a stateless function it would vanish the
    // moment the response was sent, which is a lie rather than a limitation.
    if (node.category === 'state' && insideAnApiBody.has(node.id)) {
      throw new CompileError(
        `"${node.name ?? node.id}" writes a variable, so it cannot sit inside an API route. ` +
          'A variable lives in the browser.',
        node.id,
      );
    }

    if (node.category === 'db' && !insideAnApiBody.has(node.id)) {
      throw new CompileError(
        `"${node.name ?? node.id}" reads the database, so it must sit inside an API route. ` +
          'Database work never runs in the browser.',
        node.id,
      );
    }
  }

  // A secret has no place in the document; a connector carries a name, never a value.
  for (const connector of Object.values(snapshot.connectors)) {
    const config = (connector.config ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(config)) {
      if (/key|secret|token|password/i.test(key) && typeof value === 'string' && value.length > 0) {
        throw new CompileError(
          `Connector "${connector.id}" carries "${key}" in the document. Credentials are referenced by name, never stored.`,
          connector.id,
        );
      }
    }
  }
}

/** Structural checks a flow must pass before any template touches it. */
function validateFlows(snapshot: Snapshot): void {
  for (const flow of Object.values(snapshot.flows)) {
    /**
     * A flow may start from an **app shell** as well as a screen (R2) — a shell is a component
     * definition, so this accepts one of those as a source.
     *
     * A shell's whole job is navigation — it is the thing holding the sidebar — so refusing it as
     * a source would mean the one place that navigates most could not say where it goes. It is
     * still an arrow from here to there; a shell is simply another "here".
     *
     * It may never *end* at one: a shell is not a destination, it is what a destination renders
     * inside.
     */
    if (!snapshot.artboards[flow.from] && !snapshot.definitions?.[flow.from]) {
      throw new CompileError(`Flow "${flow.id}" starts at an unknown screen.`, flow.id);
    }
    const destination = snapshot.artboards[flow.to];
    if (!destination) {
      throw new CompileError(`Flow "${flow.id}" ends at an unknown screen.`, flow.id);
    }

    const declared = new Set((destination.params ?? []).map((p) => p.name));
    for (const entry of flow.payload ?? []) {
      if (!declared.has(entry.param)) {
        throw new CompileError(
          `Flow "${flow.id}" carries "${entry.param}", which "${destination.name}" does not declare.`,
          flow.id,
        );
      }
    }
  }
}

function sortedArtboards(snapshot: Snapshot): [string, Artboard][] {
  return Object.entries(snapshot.artboards).sort(([a], [b]) => a.localeCompare(b));
}

function resolveEntryArtboard(snapshot: Snapshot): Artboard {
  const ids = Object.keys(snapshot.artboards);
  if (ids.length === 0) {
    throw new CompileError(
      'This project has no screens yet, so there is nothing to compile.',
      snapshot.id,
    );
  }

  const entryId = snapshot.entryArtboard ?? ids[0]!;
  const entry = snapshot.artboards[entryId];
  if (!entry) {
    throw new CompileError(`The entry screen "${entryId}" does not exist.`, snapshot.id);
  }
  return entry;
}
