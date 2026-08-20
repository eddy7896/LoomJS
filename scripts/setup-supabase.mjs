#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * Point loom at a Supabase project, without Docker and without pasting a secret anywhere but a
 * gitignored file.
 *
 * It asks for the three values the dashboard shows, proves they work by reading the project's
 * PostgREST schema, writes `apps/studio/.env.local`, and (optionally, over a connection string
 * you supply) applies the table M5's inference expects. Nothing here is stored outside that file
 * — the same rule the product follows: credentials by name, never in the document
 * (`docs/specs/connector-credentials.md`).
 *
 *   pnpm setup:supabase                          guided
 *   pnpm setup:supabase --start                  guided, then start the studio
 *   pnpm setup:supabase --url=… --anon=… --service=…   non-interactive
 *
 * Node's readline delivers only the first question when stdin is a pipe, so a scripted run uses
 * the flags rather than piped answers — the prompts are for a human at a terminal.
 */

const run = promisify(execFile);

const ENV_FILE = fileURLToPath(new URL('../apps/studio/.env.local', import.meta.url));
const SQL_FILE = fileURLToPath(new URL('../apps/studio/supabase-setup.sql', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

let muted = false;

/**
 * Readline writes the echo, so muting the output stream is what hides a typed secret — a service
 * role key does not belong in your scrollback, and a pipe (CI, a test) still works unchanged.
 */
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});

// `terminal` drives the echo: on a real terminal readline echoes (so muting hides a secret),
// and on a pipe it must stay off or the whole buffered input is echoed back at the first prompt.
const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });

const say = (line = '') => process.stdout.write(`${line}\n`);
const ask = (question) =>
  new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

const askSecret = (question) =>
  new Promise((resolve) => {
    process.stdout.write(question);
    muted = true;
    rl.question('', (answer) => {
      muted = false;
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });

const mask = (value) => (value.length <= 8 ? '•'.repeat(value.length) : `${value.slice(0, 4)}…${value.slice(-4)}`);

/**
 * Connecting *is* validating (the studio does the same thing): the schema read proves the URL and
 * the key together, so a typo surfaces here rather than at the first query.
 */
async function introspect(url, key) {
  const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}/rest/v1/`);
  }
  const document = await response.json();
  return Object.keys(document.definitions ?? {});
}

async function applySchema(connectionString) {
  const sql = await readFile(SQL_FILE, 'utf8');
  await run('psql', [connectionString, '-v', 'ON_ERROR_STOP=1', '-c', sql], { shell: false });
}

/** `--url=https://…` / `--anon=…` / `--service=…`, for a run nobody is watching. */
function flag(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  const given = { url: flag('url'), anon: flag('anon'), service: flag('service') };
  const scripted = Boolean(given.url && given.anon);

  say();
  say('loom → Supabase');
  say('───────────────');
  say('Dashboard → your project → Project Settings → API. Three values, none of which');
  say('reach the project document: the URL and a credential name do, values never do.');
  say();

  const url = given.url ?? (await ask('Project URL (https://<ref>.supabase.co): '));
  if (!/^https?:\/\/.+/.test(url)) throw new Error('That is not a URL.');

  const anonKey = given.anon ?? (await askSecret('Anon / publishable key (client-scoped): '));
  if (!anonKey) throw new Error('The anon key is required — the studio reads your schema with it.');

  const serviceKey = given.service ?? (scripted ? '' : await askSecret('Service role / secret key (server-only, may be blank): '));

  say();
  say('Checking the connection…');
  let tables;
  try {
    tables = await introspect(url, anonKey);
  } catch (error) {
    // `fetch failed` alone says nothing; the cause carries the reason a URL did not answer.
    const cause = error.cause?.code ? ` (${error.cause.code})` : '';
    say(`  ✗ ${error.message}${cause}`);
    say('  The URL and the anon key have to match the same project. Nothing was written.');
    process.exitCode = 1;
    return;
  }
  say(`  ✓ ${url} answered. Tables visible: ${tables.length > 0 ? tables.join(', ') : '(none yet)'}`);

  // The table M5's inference matches a form against. Missing is normal on a fresh project.
  if (!tables.includes('notes') && !scripted) {
    say();
    say('No `notes` table yet — that is the one the inference demo expects.');
    say('Dashboard → Connect → copy the connection string (it contains your database password).');
    say('Leave blank to skip and paste apps/studio/supabase-setup.sql into the SQL editor instead.');
    const connectionString = scripted ? '' : await askSecret('Connection string (postgresql://…): ');

    if (connectionString) {
      try {
        await applySchema(connectionString);
        say('  ✓ notes table created, row-level security on.');
      } catch (error) {
        say(`  ✗ psql failed: ${(error.stderr ?? error.message).toString().trim().split('\n')[0]}`);
        say('  Paste apps/studio/supabase-setup.sql into the SQL editor instead — nothing else is blocked.');
      }
    }
  }

  // Written last, so a failed check never leaves a half-configured file behind.
  try {
    await copyFile(ENV_FILE, `${ENV_FILE}.bak`);
  } catch {
    /* no previous file to keep */
  }

  await writeFile(
    ENV_FILE,
    `# Written by pnpm setup:supabase. Gitignored; never enters the project document.
SUPABASE_URL=${url.replace(/\/+$/, '')}
SUPABASE_ANON_KEY=${anonKey}
SUPABASE_SERVICE_ROLE_KEY=${serviceKey}
`,
    'utf8',
  );

  say();
  say(`Wrote apps/studio/.env.local`);
  say(`  SUPABASE_URL               ${url}`);
  say(`  SUPABASE_ANON_KEY          ${mask(anonKey)}   (client-scoped: the studio reads your schema with it)`);
  say(
    serviceKey
      ? `  SUPABASE_SERVICE_ROLE_KEY  ${mask(serviceKey)}   (server-only: the dev server holds it, the browser never sees it)`
      : '  SUPABASE_SERVICE_ROLE_KEY  (empty — reads and writes from the Preview will fail)',
  );
  say();
  say('Next:');
  say('  pnpm --filter @loom/studio dev      then Data → Connect → "Use .env.local"');
  say();
}

try {
  await main();
} catch (error) {
  say(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}

if (process.argv.includes('--start') && process.exitCode !== 1) {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const child = (await import('node:child_process')).spawn(
    pnpm,
    ['--filter', '@loom/studio', 'dev'],
    { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  child.on('exit', (code) => process.exit(code ?? 0));
}
