# 17 — Signing in with a provider

> Apple, Google, GitHub and the rest. Companion to `specs/app-auth.md` (sessions and cookies) and
> `05-guardrails.md` #1 (secrets are server-only, always).

## These are not connectors

Nothing here is a data source, and none of them puts a credential in loom's hands. A provider's
client id and secret are configured **in the Supabase project**, by whoever owns it. loom's side
only ever says *which* provider a button asks for — a name, never a setting. That is the whole
security story, and it is why the provider list is a list of names.

Every id is one the auth server actually implements, checked against the provider directory in
`supabase/auth` rather than remembered. An id it does not know fails at `/authorize` with
"Unsupported provider", which is a runtime failure on a button, so the list is closed and the
compiler checks against it — and the emitted route checks again, because the value ends up in a
URL and "whatever was in the query string" is not something to forward to an auth server.

## The flow, on the server

The whole exchange happens server-side, so the tokens land in the same HttpOnly cookies a password
sign-in uses. What the browser sees is two redirects.

1. A button runs `signInWith`, which **navigates** to `/api/auth/start?provider=…`. It is a
   navigation and not a fetch, because OAuth leaves the page.
2. `start` makes a PKCE **verifier**, keeps it in an HttpOnly cookie, and redirects to
   `${SUPABASE_URL}/auth/v1/authorize` with `provider`, `redirect_to`, `code_challenge` and
   `code_challenge_method=s256`. The secret half never appears in a URL.
3. The provider sends the browser back through the auth server, which redirects to
   `/api/auth/callback?code=…`.
4. `callback` exchanges it: `POST /token?grant_type=pkce` with `{ auth_code, code_verifier }`,
   then sets the session cookies and clears the verifier — spent whether the exchange worked or
   not.

Every endpoint and parameter above was read out of `supabase/auth` and `supabase/auth-js`, not
recalled: `internal/api/external.go` for what `/authorize` accepts, `verify.go` for the `code`
parameter on the way back, `token.go` for the pkce grant's body, and `GoTrueClient` for the fact
that the authorize URL carries **no apikey**.

## Decisions worth keeping

**Nothing can follow it.** A sequence that signs in with a provider and then does something else
is refused at compile time. The page is gone by the second step; emitting it would be dead code
that looks like behaviour. What comes after belongs on the screen it returns to.

**The app works out where it is from the request.** `redirect_to` is built from the incoming
host, not from configuration, because the same build runs on localhost, on a preview URL and in
production — and a `redirect_to` naming the wrong one sends someone's browser to another
deployment.

**Demand-driven, like everything else.** A project whose only sign-in is a password form emits no
redirect routes at all, and one that offers three providers names exactly those three in the route
that checks them.

## What this found

Two things the emitted project's own `tsc` caught, both real:

- `messageOf` takes a fallback, and the callback was calling it with one argument.
- A route whose **trigger wire** existed but whose button no longer had the matching `trigger`
  **action** was still planned, emitting a `run_…` function nothing called — and the emitted app
  builds with `noUnusedLocals`. A wire and its action are one fact in two views, but they can come
  apart when the action is deleted in the inspector, so the compiler now requires both.
