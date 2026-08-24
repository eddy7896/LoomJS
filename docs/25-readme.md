# 25 — The README every project carries

> What the emitted repo says about itself. Companion to `24-code.md` (reading and downloading it)
> and `18-containers.md` (running it).

## Why

A repo with no README assumes whoever opens it already knows what it is. That is exactly the wrong
assumption here: the person opening this one is often a developer a designer handed it to, and the
only thing they can be assumed to know is `npm`.

## Written from the project, not pasted into it

The screens it lists are the screens that exist. The routes are the routes that were emitted. The
environment variables are the ones **this build actually reads**. The migration count is the number
of migrations in the folder beside it.

A template saying "your routes go here" would be a file that starts out true and stays that way by
saying nothing. This one can be wrong — which is why its claims are checked against the files
beside it:

- the commands it tells you to run are asserted to be scripts `package.json` really has;
- the names it tells you to set are asserted to be exactly what `.env.example` asks for;
- the routes it lists are asserted to be every emitted `api/` file;
- and `docker compose up` is only suggested because the compose file is emitted too.

## What it says

**What this is** — an ordinary Vite + React + TypeScript repo with no run-time dependency on loom.
That is the BYO-backend promise in the first paragraph, where someone deciding whether to trust the
thing will read it.

**How to run it** — install, dev, build, start, and `docker compose up --build`. Four commands and
the port.

**What it needs** — a table of environment variables with a line each saying what they are, so a
deployment is not filling in blanks by guesswork. `DATABASE_URL` says "use the pooled one";
`SUPABASE_SERVICE_ROLE_KEY` says it bypasses row-level security and is server-only.

**Where things are** — a path map, listing only the folders this project actually has: `api/` if it
has routes, `src/server/auth.ts` if it has users, `migrations/` if it has changed a schema.

**The two things that lose work** — regenerating from loom overwrites the files loom manages, and
`.env` stays git-ignored. Editing in loom or taking the repo are both fine; doing both at once is
the one that costs someone an afternoon.

**Where to deploy it** — Vercel, a container, or a VM, with the one-line reason each works.

## What it deliberately does not do

It does not bundle a migration runner, and says so: that is a choice a team makes, and most have
made it. It does not link to a marketing site — a URL nobody has verified is a broken link in every
generated repo forever. And it does not carry a credential value, which is asserted like everywhere
else rather than assumed.
