# 22 — API connectors: a plan

> A tab and a node vocabulary for reaching things that are not databases — AI agents, payment
> providers, mail, search, anything with an HTTP endpoint. Companion to `14-data.md` (data
> connectors, which this deliberately does not copy) and `05-guardrails.md` #1.

## The gap

Every connector loom has ends up as **tables with typed columns and a primary key**. That claim is
what lets Supabase, Postgres, MySQL and Firestore share one node vocabulary, and it is also a wall:
an AI model is not a table, a payment intent is not a row, and a webhook is not a query.

Today the only way out is the Code node. That is the right escape hatch and the wrong default — a
designer wiring an assistant into a screen should not be writing `fetch` and remembering not to put
the key in the browser.

## The claim this phase makes

**A tool is a typed call.** It has a name, a request shape, a response shape, and a credential it
never shows anyone. That is a small enough idea to carry a node vocabulary, and a big enough one to
cover an LLM, a Stripe charge, a Slack message and a search index without four different mechanisms.

What it must not become is a visual HTTP client. If the answer to "how do I use this API" is "read
its documentation and fill in eleven boxes", loom has added a worse Postman. The bar: a **tool
preset** knows its own endpoints, and a designer picks an operation and fills in what is specific
to them.

## The tab

A **Tools** section on the rail, beside Data, because it is the same kind of thing: connections
this project has, and what it can do with them.

```
Tools
  ● OpenAI              gpt-4o-mini · key held by the server
      Ask                request: prompt → answer
      Classify           request: text, labels → label
  ○ Stripe              no key yet — add STRIPE_SECRET_KEY
  + Add a tool…
      From a preset      OpenAI · Anthropic · Stripe · Resend · Slack · Twilio
      From an OpenAPI document
      A single request   (url, method, headers, body)
```

Three ways in, in order of how much loom knows:

1. **A preset** — operations, request and response shapes already described. Nothing to read.
2. **An OpenAPI document** — a URL or a pasted file, from which operations are generated. Most
   serious APIs publish one, and this is how the list grows without loom shipping a preset per
   vendor.
3. **A single request** — the honest fallback, and what the Code node's users are doing by hand.

## The nodes

Three, and no more without a reason:

**Call** — one operation of one tool. Its input ports are the operation's parameters, typed; its
output is the response, typed. It runs **inside an API route**, always, like every database node:
the container boundary is the network boundary, and a key that reached the browser is a key that
leaked.

**Agent** — a model, a prompt, and optionally a set of tools it may call. Its output is text, or a
value shaped by a schema the designer chose. This is the node that earns the phase, and it is also
the one with the most ways to be dishonest — see the refusals below.

**Webhook** — the other direction: an endpoint in the emitted app that something else calls. It is
an API route with a verified signature and a typed body, which loom already almost has.

## What is typed, and how

A node's ports have to come from somewhere real, and loom already has three answers for this and
should not invent a fourth:

- a **preset** or an **OpenAPI operation** describes its parameters and its response — read them,
  the way the Supabase connector reads PostgREST's document;
- a **sampled response** types what a single request answered with, the way the Firestore connector
  samples documents, with the same honesty about it being a sample and not a schema;
- an **agent's output** is typed by the schema the designer picked — free text, or fields they
  named. A model that returns something else is a run-time failure the node has to surface, not
  swallow.

## Credentials

Unchanged, and this is the part with no room to negotiate. A tool's key is **server-only**, named,
and injected at deploy: it never enters the document, the snapshot, the browser's storage or the
repo. Nothing about an AI provider changes that — a model key is the same kind of secret as a
database password, and the fact that it is fashionable does not make it safer.

Every tool call is therefore emitted into a **server route**. A Call node on a screen with no route
is a compile error naming the fix, exactly as a database node is.

## Deliberate refusals, stated up front

These are the ways this phase could lie, so they are decided now rather than discovered:

**No streaming in the first pass.** A token-by-token response is a different runtime — it needs a
streaming route, a partial value on screen, and a way to cancel. Faking it by waiting for the whole
answer and revealing it gradually is a lie about latency. It is a phase of its own.

**No unbounded agent loops.** An agent that may call tools can call them forever. The first pass
allows a **fixed maximum number of steps**, declared on the node, and stops with an error the
designer can show. "It usually terminates" is not a runtime.

**No retries by default.** A retried `POST` is a second charge, a second email, a second row.
Retries are per-operation and opt-in, and a preset marks which of its operations are safe to repeat.

**No prompt in the credential.** A key belongs to the deployment; a prompt belongs to the document
and is *not* a secret. Mixing them means either a prompt nobody can edit or a key in the project
file.

**A timeout on every call.** A hung request in a serverless function is a bill and a hang, so a
default lives on the tool and can be raised, never removed.

## Phases

| Phase  | What it is                                                              | State |
| ------ | ----------------------------------------------------------------------- | ----- |
| **T1** | The Tools tab, a single-request tool, and the Call node against it       | done  |
| **T2** | Presets: models, email, payments, messaging and devices — each verified   | done  |
| **T3** | Asking a model: one model, one prompt, an answer, a length cap           | done  |
| **T4** | OpenAPI import — operations, parameters and responses read from the spec | next  |
| **T5** | Tools an agent may call, wired from the graph, with a step cap enforced  | next  |
| **T6** | Webhooks in: signature verification and a typed body                     | next  |
| **T7** | Streaming, if and when the runtime for it is designed                    | later |

## Gates

The same ones the data connectors are held to, because they are what caught the real bugs:

- the emitted project **installs and type-checks**, with the tool's own SDK or plain `fetch`;
- a **stub server** stands in for the vendor, so the emitted client is exercised end to end
  without a key or a bill — the pattern the Supabase gate already uses;
- **no credential appears** in the document, the snapshot, `localStorage` or any emitted file,
  asserted rather than assumed;
- a **refusal test** per stated refusal above: an agent with no step cap, a retry on a
  non-idempotent operation, a Call node outside a route.

## What has to be verified before any of it is written

Nothing in this document asserts a vendor's API shape, on purpose. Every endpoint, parameter name,
auth header and response field must be read from the vendor's current documentation or its OpenAPI
document at implementation time, and pinned in a test that quotes where it came from — the way the
Postgres, Firestore and GoTrue work in this repo was done. A plan that guessed at those names would
be a plan that compiled and failed.

## What T1–T3 turned out to be

**One node, not three.** The plan named Call, Agent and Webhook. Building it, Agent stopped
earning its own node: asking a model *is* a Call to an `ask` operation, with a model and a length
cap on the node and a prompt on a port. A second node would have been the same fetch with a
different label — and the vocabulary is small because things that are the same are one thing. The
Agent node earns itself at **T5**, where tools it may call and a step cap are genuinely new
behaviour rather than new wording.

**A manifest is data, not code.** A tool says: base URL, credential name, how the key is
presented, constant headers, and per operation a method, a path, a body *template* with `{{holes}}`
and where the answer sits — `['content', 0, 'text']`. The emitter walks that. Nothing is a
function, so a test can read a manifest and compare it against the vendor's own document, which is
exactly what the tests do.

**No vendor SDK.** Plain `fetch`. A manifest saying "POST here with these headers" is smaller than
a dependency and identical in shape across tools, which is what lets one node cover a model, a
payment provider and a webhook receiver.

**Every call goes through one helper**, which is where the three easily-forgotten things live: a
timeout, because a hung request in a serverless function is a bill and a hang; an error carrying
what the vendor actually said, because "request failed" is unactionable; and a response read as
JSON only when it claims to be, since an HTML error page parsed as JSON throws something about `<`
that tells nobody anything.

### What was verified, and where from

- **Claude** — `x-api-key`, `anthropic-version: 2023-06-01` and `content-type` on every request;
  `POST /v1/messages` with `model`, `max_tokens`, `messages`; the answer is a content block of type
  `text`, so `content[0].text`. Read from the Claude API overview.
- **OpenAI** — server `https://api.openai.com/v1`, HTTP bearer auth, `POST /chat/completions` with
  `model` and `messages`, answer at `choices[0].message.content`. Read from OpenAI's published
  OpenAPI document.

Both are pinned in tests whose comments say where the shape came from, so a vendor change breaks a
test rather than a user's app.

### The gate

A stub vendor stands in, and everything else is real: the emitted project is built, its dev server
started, a request made through the emitted route, and the stub asserts what arrived. The key
travelled as a **header from the environment**, and the request body contains the prompt and not
the key. No account, no bill, no network.

### What is refused, in code

A call with no model. An answer length of zero. An operation a tool does not have. A call not
attached to a tool. A body template naming something the operation does not take — which would
otherwise emit `undefined` into a request and come back as a confusing 400. And plain `http`,
which would carry the key in the open; `localhost` is the exception a developer actually needs.

### One thing this found

The emitted `.env.example` was a chain of `else if`, so a project that talked to a database *and*
called a tool was told about one of them. It is one list now, and every credential the project
needs is in it.

## The providers, and what each one needed

Seven presets, in five families, and adding them was mostly a lesson in how little vendors agree.

| Family    | Tool           | What it does                | What it needed that nothing before did      |
| --------- | -------------- | --------------------------- | ------------------------------------------- |
| Models    | Claude         | Ask                         | a version header, and a key in `x-api-key`  |
| Models    | OpenAI         | Ask                         | —                                            |
| Email     | Resend         | Send email                  | —                                            |
| Payments  | Stripe         | Start a checkout            | **form encoding** and **HTTP basic** auth   |
| Messaging | Twilio         | Send a message              | basic auth with two values, and the account SID **in the path** |
| Messaging | Slack          | Post a message              | —                                            |
| Devices   | Home Assistant | Turn on · Turn off          | an address only the **deployment** knows    |
| Anything  | HTTP request   | Whatever you describe       | —                                            |

Three of those forced the manifest to grow, and each growth is a fact about the world rather than
a preference:

**Not everything speaks JSON.** Stripe and Twilio take form encoding, with nested values written
`line_items[0][price]`. Sending either JSON is a 400 that says nothing useful. So a tool declares
its encoding, and a form encoder is emitted — **only into routes that need one**, because the
emitted app builds with `noUnusedLocals`.

**Not every key is a bearer token.** Stripe puts the key in the *username* of HTTP basic and leaves
the password blank; Twilio uses the account SID and the token. Guessing here is a 401 nobody can
read.

**Not every service has a fixed address.** Home Assistant runs on your own network, so its base URL
is `{{env:HOME_ASSISTANT_URL}}` — read on the server like every other name, so a shared project
does not carry somebody's house in it. The same mechanism puts Twilio's account SID into its path.

A tool therefore declares **every name it needs**, not just a key: naming one of Twilio's two would
be naming half, and the emitted `.env.example` would tell a deployment to set something that cannot
work alone.

### Capitals, and other things that are not details

Twilio's parameters are `To`, `From`, `Body`. Lowercase ones are ignored — silently. Slack answers
`200` even when it refused, so the answer is `ok` rather than the status code. Stripe's useful
answer is `url`, the page to send someone to, not the session id. Each of those is in a test whose
comment says where it came from.

### In the node viewer

A tool call is now its own kind of work: its own colour on the node, its own tint on the step
inside a route, and a label saying what it does — the operation for a tool, the table for a
database step, the op for a computation. A route's body reads at a glance, which it did not when
three different kinds of work all looked alike.

### What the gates caught

Two real bugs, both from the emitted project's own `tsc`:

- a basic-auth tool emitted `const key` that nothing read, because its header is built from the
  environment directly — a build failure, not untidiness;
- and the form encoder is now **run** rather than only read: the emitted function is pulled out of
  the emitted route, compiled, and executed against the nested shape Stripe parses, so a value
  containing an `&` cannot quietly become two fields.
