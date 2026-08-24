-- Paste into your Supabase project's SQL editor (Dashboard -> SQL Editor -> New query).
--
-- This is the table M5's inference expects to find: `title` is required, `body` is optional,
-- `id` and `created_at` are filled in by the database. Name your form's fields "Title" and
-- "Body" and loom will match them to these columns.

create table if not exists public.notes (
  id         bigint generated always as identity primary key,
  title      text        not null,
  body       text,
  created_at timestamptz not null default now()
);

-- RLS on, with no policy: nothing reaches this table through the anon key. loom's emitted
-- functions use the service role key on the server, which bypasses RLS by design — that is why
-- the key never leaves the dev server (docs/specs/connector-credentials.md).
alter table public.notes enable row level security;
