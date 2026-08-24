import type { Artboard, Snapshot } from '@loom/ir';
import { CompileError, type CompileResult, type EmittedFile } from './types';
import { emitArtboardModule } from './emit/artboard';
import { planRoutes, type RouteInfo } from './emit/routes';
import { planPipelines, validateWires } from './emit/pipeline';
import { emitApiFunction } from './emit/server';
import { scaffoldFiles } from './emit/project';
import { emitGlobalsModule, GLOBALS_MODULE_PATH } from './emit/globals';
import { emitMessagesModule, MESSAGES_MODULE_PATH, usesMessages } from './emit/messages';
import { dialectOf, isDocumentStore } from '@loom/connectors';
import { migrationFile } from './emit/migrations';
import { emitContainerFiles } from './emit/container';
import { emitReadme } from './emit/readme';
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

/**
 * Compile a snapshot into the file set of a runnable Vite + React + TS app.
 *
 * M0 emitted static UI; M2 added the router; M3 adds the backend: an API route node becomes a
 * Vercel serverless function, and the pipelines around it become state, handlers and fetches
 * inside the artboard module. Connectors (M4) plug in here later. Nothing in the snapshot carries
 * a secret (guardrail 1), so nothing secret can reach the emitted repo.
 */
const NEWLINE = String.fromCharCode(10);

export function compile(snapshot: Snapshot): CompileResult {
  const entry = resolveEntryArtboard(snapshot);
  const routes = planRoutes(snapshot, entry);

  validateFlows(snapshot);
  validateWires(snapshot);
  validateServerOnlyWork(snapshot);
  validateGuards(snapshot);

  // A project with users emits an auth server and stops using the service-role key for its data:
  // the database answers as the person asking, and row-level security decides
  // (`docs/specs/app-auth.md`).
  const auth = usesAuth(snapshot);
  if (auth) requireAuthConnector(snapshot);

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

  const files: EmittedFile[] = scaffoldFiles(snapshot.name, snapshot.name, {
    usesDatabase,
    usesSql: usesSql && !usesMysql,
    usesMysql,
    usesFirestore,
    theme: snapshot.theme,
  });

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
      usesSql,
      gotrueProviders: ownAuthServer ? ssoProvidersUsed(snapshot) : [],
      credentials: [
        ...(usesSql ? ['DATABASE_URL'] : []),
        ...(usesFirestore ? ['FIREBASE_SERVICE_ACCOUNT'] : []),
        ...(usesDatabase ? ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] : []),
        ...(auth ? ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] : []),
        ...toolCredentials(snapshot),
      ].filter((name, index, all) => all.indexOf(name) === index),
    }),
  );

  const messages = usesMessages(snapshot);
  files.push({
    path: 'src/App.tsx',
    content: emitApp(snapshot, entry, routes, globals, messages, auth),
  });

  if (auth) {
    files.push({ path: AUTH_MODULE_PATH, content: emitAuthModule() });
    files.push(...emitAuthFunctions(ssoProvidersUsed(snapshot)));
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
    envNames.push(...(auth ? ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] : ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']));
  }

  // A tool's key is the same kind of secret as a database password, and the fact that it belongs
  // to a fashionable service does not make it a different kind (`docs/22-api-connectors.md`).
  envNames.push(...toolCredentials(snapshot));

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
): string {
  const ordered = [...routes.values()].sort((a, b) => {
    if (a.artboardId === entry.id) return -1;
    if (b.artboardId === entry.id) return 1;
    return a.componentName.localeCompare(b.componentName);
  });

  const imports = ordered
    .map((route) => `import ${route.componentName} from './artboards/${route.componentName}';`)
    .join('\n');

  const routeElements = ordered
    .map((route) => {
      const artboard = snapshot.artboards[route.artboardId]!;
      // A guarded screen is wrapped where the router mounts it, so there is no moment where the
      // screen has rendered and the redirect has not happened yet (`emit/auth.ts`).
      const element = guardedElement(artboard, `<${route.componentName} />`, routes);
      return `        <Route path="${route.path}" element={${element}} />`;
    })
    .join('\n');

  // An app-wide variable has to outlive the screen that wrote it, so its provider sits above the
  // router — the one place every route is inside (`emit/globals.ts`).
  const router = `    <BrowserRouter>
      <Routes>
${routeElements}
      </Routes>
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
import { BrowserRouter, Route, Routes } from 'react-router-dom';
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
    if (!snapshot.artboards[flow.from]) {
      throw new CompileError(`Flow "${flow.id}" starts at an unknown artboard.`, flow.id);
    }
    const destination = snapshot.artboards[flow.to];
    if (!destination) {
      throw new CompileError(`Flow "${flow.id}" ends at an unknown artboard.`, flow.id);
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
    throw new CompileError('Project has no artboards; nothing to compile.', snapshot.id);
  }

  const entryId = snapshot.entryArtboard ?? ids[0]!;
  const entry = snapshot.artboards[entryId];
  if (!entry) {
    throw new CompileError(`entryArtboard "${entryId}" does not exist.`, snapshot.id);
  }
  return entry;
}
