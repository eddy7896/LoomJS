# 23 — Logs

> What the running app said, in the studio rather than in a terminal. Companion to
> `specs/binding-trigger-runtime.md` (the three tiers) and `11-editor-shell.md` (the rail).

## Why a fourth tab

The rail carried three sections and a note saying more would arrive "when they have something
behind them". This is that: until now, everything the running app said went to whichever terminal
the dev server was started from — a window most designers never open, and could not read if they
did. A React warning, a route answering 500, a build that landed: all of it invisible.

## It is not Problems

Problems is **what is wrong with the document now**. It clears itself as things are fixed, and it
points at the entity to fix. That is the Build tier doing its job.

Logs is **what happened, in order, including the parts that are over**. "It worked a minute ago"
is a question only a history can answer, and Problems deliberately has no history.

## What lands in it

| Source    | What it is                                                                  |
| --------- | --------------------------------------------------------------------------- |
| `compile` | every compile, with how long it took — or why it was refused                  |
| `build`   | what the Preview was actually handed: files delivered, new modules, re-deliveries |
| `route`   | every API route call: method, path, status, milliseconds — and anything it threw |
| `app`     | the previewed app's own `console`, its uncaught errors and rejected promises  |
| `env`     | credential **names** the dev server holds; never a value                     |

Together those answer the question this project has spent the most time on: *did my edit arrive?*
A compile line, a delivery line and the app's own console, in one column, in order.

## How the app's console gets here

The previewed app runs in an iframe on **another port**, so nothing in the studio can read its
console — the same origin rule that protects every other page. So the app forwards instead: a small
script is injected into its HTML which wraps `console`, listens for `error` and
`unhandledrejection`, and posts what it sees with `sendBeacon`.

Three details that matter:

- it **calls the original console** afterwards, so the browser devtools still show everything;
- it is wrapped in `try`/`catch` throughout, because a log that breaks the app it is logging is
  worse than a missing line;
- the endpoint answers `204` and reads nothing back — `sendBeacon` wants no reply, and waiting for
  one would hold the app up for the sake of a log line.

## The buffer, and the cursor

The preview server and the studio server run in the **same Node process**, so the log is a plain
module holding a ring buffer of the last 500 lines. No socket between them, no file to tail, no
second source of truth.

The studio reads it by **cursor** — "everything after 41" — rather than as a stream. That survives
a reload, a paused panel, and a studio that was not open when something was logged. When lines fell
off the end before anyone read them, the reader is told how many: a log that silently loses the
middle is worse than one that admits to a gap.

Local lines (a compile happens in the browser) and server lines are numbered by different counters,
so they are merged **by time** rather than by sequence — what a reader wants is the order things
happened. Local lines take negative numbers, which cannot collide with the server's.

Both bounds are deliberate: a render loop can write thousands of lines a second, and the answer to
that is a bounded buffer rather than a studio that runs out of memory while showing you why.

## In the panel

Newest at the bottom, following by default, because the interesting line is almost always the
newest — but following is a **toggle**, since reading anything while lines arrive is otherwise
impossible. A level filter, an error count in the header, and Clear, which empties both sides: the
panel and the server, so the next poll does not bring it all back.

Only errors and warnings get colour. A log where every line is coloured has none.

## What the tests cover

The unit tests are about the merge and the cursor: order by time, no collision between the two
numberings, asking from where it got to, and the gap being reported. The end-to-end specs drive a
real preview — a compile line, a delivery line, a refused build naming its reason, the filter, Clear,
and the app's own console arriving through the forwarding seam.

One thing they had to be taught: the server's buffer belongs to the **process**, so it holds
whatever the previous test did. That is right for a designer with one server and wrong for a test,
so each one clears it first.
