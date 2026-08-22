# Spec 10 — App Auth (v1)

> Gates P5 (`docs/10-interaction-plan.md`). Terminology follows `06-glossary.md`. Spec 8 stays
> reserved for lineage; spec 9 is Problems.

## Two universes, one wall

The person who signs in to **loom** and the person who signs in to the **app loom built** are not
the same person, do not share a session, and are never stored in the same place. Guardrail 3 and
`04-hallucination-check.md` both say so, and this spec is the place it becomes code:

| | Platform auth | App auth (this spec) |
| --- | --- | --- |
| Who | the designer building the app | the app's own users |
| Where | loom's own Supabase | the **user's** Supabase, which loom never hosts |
| Lives in | the studio | the emitted repo |
| Ends up in | nothing emitted | `api/auth/*`, `src/state/auth.tsx` |

Nothing in this document touches the studio's own login, and nothing here can. The emitted app
talks to the project's connector; the studio talks to loom.

## What a designer gets

Three things, and the rest is machinery that already existed:

1. **Three actions** — sign up, sign in, sign out. The catalogue goes from eight to eleven, which
   `specs/actions.md` already argued for.
2. **A Current user node** — outputs `signed in`, `email`, `id` and `error`. It is a value like any
   other, so binding it to a Text shows who is here, and using it in `visibleWhen` (spec 6) is
   auth-gated visibility with **no new mechanism at all**.
3. **A guard on a screen** — "only for signed-in people, send everyone else to «Sign in»".

That is the whole surface. There is no "auth panel", no login component, and no user table to
configure: a sign-in form is a Text field, a Text field and a Button, wired the way every other
form is wired.

## Where the session lives, and why it is not localStorage

**The session lives in `HttpOnly` cookies the browser cannot read.**

The obvious alternative — `@supabase/supabase-js` in the browser, tokens in `localStorage` — is
what most tutorials do, and it means any script that gets into the page can read the token and use
it from anywhere until it expires. loom emits `noopener,noreferrer` on every new-tab link for a
smaller version of the same reason. Choosing the weaker option here, in the one feature whose whole
job is to keep one person's data theirs, would be indefensible.

So sign-in is a request to the app's **own** server:

```
POST /api/auth/signin  ->  Supabase /auth/v1/token?grant_type=password
                       <-  Set-Cookie: loom_at=…; HttpOnly; SameSite=Lax; Path=/
                           Set-Cookie: loom_rt=…; HttpOnly; SameSite=Lax; Path=/
```

`SameSite=Lax` is also the CSRF answer: another site's form cannot make the browser send these
cookies on a POST. `Secure` is added whenever the request arrived over HTTPS, so it is on in
production and absent on `http://localhost`, where it would stop the cookie being set at all.

The browser never holds a token. It asks `GET /api/auth/session` once on mount and gets back a
user or `null` — which is exactly what the Current user node reads.

Access tokens last an hour. The server refreshes them: any request that needs the token checks its
`exp`, spends the refresh token when it has passed, and sets the new pair on the way out. Reading
a JWT's own payload without verifying it is fine here — the signature is checked by the only party
whose opinion matters, which is Supabase.

## "Their own rows" is row-level security, not a filter

Once a project has auth, **the database answers as the person asking**: the caller's access token
goes on the PostgREST request, and RLS decides what comes back. The service-role key is not used by
those routes at all.

The alternative was to let a designer wire the Current user's `id` into a filter. It is rejected,
and the reason is worth writing down: that id would travel from the browser, so anyone could send
someone else's. It would look right in the editor, pass every test written against it, and hand out
other people's rows. A rule enforced where it cannot be edited beats a rule drawn on the canvas.

Signed out, the same routes run with the anon key — again as themselves, again with RLS deciding.
A project **without** auth keeps the service-role key it has always used: nothing changes for it,
because there is no one to be.

This does mean a project's RLS policies matter. That is Supabase's model, not loom's invention, and
loom's job is to send the right identity rather than to invent a second permission system beside
the one the database already has.

## The guard

A screen may declare `guard: { redirectTo }`. The router wraps it:

```tsx
<Route path="/notes" element={<RequireSignIn redirectTo="/signin"><Notes /></RequireSignIn>} />
```

`RequireSignIn` renders nothing while the session is still being fetched — a flash of a protected
screen before the redirect is a leak, however brief — then either the screen or a `<Navigate>`.

Two guards are refused at compile time rather than at runtime: a redirect to a screen that does not
exist, and a redirect to a screen that is **itself** guarded, which is a bounce with no floor.

The guard is a router-level convenience, not a security boundary. The security boundary is the
server: a screen someone reaches by typing the URL still shows nothing, because every request it
makes is answered as whoever they are.

## Failure, and what a designer does with it

An action sequence stops where it fails, the same rule `trigger` follows: "sign in, then go to the
dashboard" must not reach the dashboard when the password was wrong. The failure lands on the
Current user node's `error` port, so showing it is a binding to a Text — the same thing a designer
does with a pipeline's error.

Sign-up with email confirmation turned on **succeeds without signing anyone in**: Supabase returns
a user and no session. The app is told so honestly rather than being left looking signed-out for no
reason, and the designer's next step is a message saying to check their email.

## What is deliberately not here

- **Third-party providers** (Google, GitHub, magic links). Each is a redirect round trip with its
  own callback route and its own failure modes. Email and password proves the shape; the rest is
  additive and unblocked by anything here.
- **Password reset.** Same reason, and it needs email templates the designer configures in
  Supabase.
- **Roles and permissions in the editor.** A role is a database concept here. Showing an admin
  panel is `visibleWhen` over a value read from a table, which already works.
- **Reading the session on the server as a value a node can see.** Nothing needs it yet: RLS uses
  the token without a designer naming it.
