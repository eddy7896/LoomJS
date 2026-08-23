# 18 — Containers

> Somewhere to run the emitted app that is not a platform. Companion to `09-implementation-plan.md`
> (M6, the Vercel path) and `01-system-context.md` (BYO-backend).

## Why at all

loom's own deploy path is Vercel: each file in `api/` becomes a function, and the built front end
is served from the edge. That is one good answer, and it is somebody else's.

"The repo is yours" has to mean it runs somewhere you choose — a colleague's laptop, a VM, Fly,
Railway, Cloud Run, a cluster, a Raspberry Pi. So every project also emits `server.ts`, a
`Dockerfile`, a `.dockerignore` and a `docker-compose.yml`. Four small files, and nothing about
them is loom-specific: delete them and the Vercel path is untouched.

## The server

The serverless path never needed one. In a container there is a single process, so `server.ts` is
the router that stands in for both halves:

- `/api/*` goes to the emitted handlers, which already have the shape Node hands you — `(req, res)`.
- everything else is the built front end, falling back to `index.html`, because the app routes in
  the browser and a deep link must not 404.
- a static path **never leaves `dist/`**. The check is on the resolved path rather than on the text
  of the request: `..` segments, an encoded separator and a symlinked name all end up somewhere,
  and where they end up is the only thing worth testing.

The route table is **written out** rather than discovered by scanning a directory at boot, so a
route that fails to load is a compile error instead of a 404 nobody can explain. Hashed assets are
cached forever and the HTML never, or a deploy would never be seen.

**It runs the TypeScript directly**, through `tsx`. The emitted handlers import each other without
file extensions, which Node's ESM loader requires and which a `tsc` build would have to rewrite.
One dependency beats a second build configuration that exists only to add `.js` to some imports.

## The image

Two stages, so the image that runs is not the image that compiled. The build stage runs the
project's **own** `npm run build` — `tsc --noEmit && vite build` — so a type error stops the image
rather than surfacing at run time. The runtime stage installs production dependencies only, copies
just what runs, and drops to the `node` user: a process that never writes to its own image should
not be able to.

`.dockerignore` keeps `node_modules`, `dist` and every `.env` out of the build context, with
`.env.example` deliberately let back in.

## Compose

The app service reads credentials **by name**: `SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}`
and nothing else, so a value never lands in a file that gets committed. Values come from `.env`,
which is git-ignored, or from whatever the host injects.

A project that talks to a database directly also gets a `postgres` service, because a project whose
schema exists only as migrations needs somewhere to apply them without signing up for anything. It
waits for a database that **answers** rather than one that has merely started. A project reaching
Supabase or Firestore gets no database service: those are already running somewhere.

## What is and is not verified

The server is checked for real in the smoke gates: the emitted project is built, `npm run start`
is run, and the test asks it for the page, for a screen that only exists in the browser's router,
for an API route, for a route that does not exist, and for a file outside `dist/`.

**The image build is not.** There is no Docker in the environment these tests run in, so the
Dockerfile and compose file are checked by reading them rather than by building them. That is the
honest limit of this phase: if `npm run start` serves the app, the Dockerfile is a wrapper around
something that works — but the wrapper itself has not been run here, and the first person to run
`docker build` is the one who will find out.
