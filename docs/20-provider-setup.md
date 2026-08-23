# 20 — Setting a sign-in provider up

> Where a provider's client id and secret actually live. Companion to `17-sso.md` (what happens
> when the button is pressed) and `05-guardrails.md` #1 (secrets are server-only, always).

## The gap this closes

Dragging a "Continue with Google" button onto a screen is half of signing in. The other half is a
client id and a secret that mean something to Google and to the auth server, and to nobody else.
Without them the button compiles, ships, and fails at the provider — and until this phase nothing
in loom said so.

The **Sign-in providers** section in the Data tab lists every provider the project's buttons ask
for and, for each one, says what state it is really in and what is still needed.

## Three situations, kept apart

They are genuinely different, and pretending otherwise would mean lying in two of them.

**1 · Hosted Supabase.** The secret belongs in the Supabase project. loom holds nothing, and does
three useful things instead: it reads `GET /auth/v1/settings` — which answers with
`external: { google: true, … }` and takes only the anon key — so the panel can say *on* or *not
turned on* rather than guessing; it hands over the **callback URL**, which is the thing people get
wrong because it points at the auth server rather than at the app; and it links straight to the
project's Auth → Providers page.

**2 · Hosted Supabase, with a management token.** The designer types the id and secret into loom,
and loom writes them with `PATCH /v1/projects/{ref}/config/auth` — `external_google_enabled`,
`external_google_client_id`, `external_google_secret`. Those values go browser → dev server →
Supabase and are **kept nowhere**: not in the document, not in the env bucket, not in local
storage. They are not this app's credentials; they belong to the auth server, and loom is the
messenger. What *is* held is the account token, held the way every other credential is: by name,
on the server, from `.env.local`. The panel says all of this before anything is typed.

**3 · Its own auth server.** A checkbox on the connection says so, because it changes where the
secrets belong. Then the compose file gains an `auth` service and every provider's variables by
name — `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID`, `_SECRET`, `_REDIRECT_URI`, `_ENABLED` — with no values
in a file that gets committed. On hosted Supabase those variables are read by nothing, so they are
**not** emitted there: naming them would be telling someone to set something that has no effect.

## Names checked, not remembered

Every name in this phase has to match something in someone else's system exactly:

- the GoTrue variables come from that project's own `example.env`;
- the management fields from the Supabase Management API's OpenAPI document at
  `api.supabase.com/api/v1-json`;
- `slack_oidc` and `linkedin_oidc` keep their underscore, because the auth server spells them that
  way and a tidier name would simply not be read.

## What the endpoints refuse

The dev server route that writes to the Management API forwards **only** `external_*` fields. A
body that arrived with anything else in it is not passed on: this is a provider form, not a way to
rewrite a project's auth configuration. It also refuses a project reference that is not one, and
says plainly when there is no token rather than failing at Supabase.

A project that cannot be reached is reported as *not checked* rather than as every provider being
off. An unreachable project is not a project with no providers, and a panel that drew it that way
would be inventing bad news.
