# 24 — The code

> Reading the repo a project compiles to, and taking it away. Companion to
> `01-system-context.md` (BYO-backend, "the repo is yours") and `18-containers.md` (somewhere to
> run it).

## Why this had to exist

loom's central claim is that a project compiles to **a real repo the user owns** — not a locked-in
runtime, not an interpreter, not a proprietary format. Until now that repo existed in two places a
designer could not look at: inside the Preview's working directory, and in whatever a deploy would
write.

"You own the code" is not a promise anyone can check if they cannot see it. The Code tab is where
it becomes checkable.

## The same build, not an export

The panel calls the **same `compile()`** the Preview runs. There is no export path, no "generate
for download" mode, and nothing that could drift from what actually executes. What is on screen is
what the Preview is running and what a deploy would ship — a second generator would eventually
disagree with the first, and the disagreement would be discovered by whoever downloaded it.

## What is there

The whole repo, as files: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, the
screens as React components, the API routes, the auth module if the project has users, the
migrations if it has changed a schema, and the `Dockerfile` and compose file that let it run
somewhere that is not a platform.

The tree is built from the flat paths the compiler emits, sorted so a folder always sits
immediately above what is inside it. Wide code scrolls inside its own box; the panel never scrolls
sideways.

**Read-only, on purpose.** The document is the source. A file edited here would be overwritten by
the next compile, and offering an edit that silently disappears is a worse lie than not offering
one. Copy is there for the times you want to take one file somewhere else.

## The download

A zip, built in the browser, from files the browser just produced. No upload, no round trip,
nothing sent anywhere — a project that compiles locally is a project you can take away without
asking anyone for permission.

It carries **credential names and never values**, which is what makes it safe to hand to anyone:
`.env.example` lists what a deployment must set, and no emitted file has ever held a secret. That
is asserted rather than assumed, in a test that scans every emitted file.

## When it will not compile

A refused build is an **answer** here, not an exception. The panel says what is wrong in the place
somebody came to read the code, with a button that goes straight to the entity the compiler named
— reading a refusal and then hunting for what it is about is the half that wastes the time.

And the download button says no. Shipping a zip of the last build that happened to work, or of a
half-emitted project, would be worse than refusing: the whole point of the file is that it runs.

## What the tests check

That the tree puts folders above their contents. That the zip holds every file byte for byte,
which is checked by unzipping it. That a refusal carries the entity id the panel needs. And, end
to end in a real browser: that clicking Download produces a file which unzips to a `package.json`
whose build script is the real one, and a screen component containing the text that was typed into
the canvas.
