import type { EmittedFile } from '../types';

/**
 * The README every emitted project carries (`docs/25-readme.md`).
 *
 * A repo with no README is a repo that assumes whoever opens it already knows what it is. That is
 * exactly wrong here: the person opening it may be a developer a designer handed it to, and the
 * only thing they can be assumed to know is `npm`.
 *
 * It is **written from the project**, not pasted into it: the screens it lists are the screens
 * that exist, the routes are the routes that were emitted, and the environment variables are the
 * ones this build actually reads. A template that said "your routes go here" would be a file that
 * starts out true and stays that way by saying nothing.
 */

const NEWLINE = String.fromCharCode(10);

export interface ReadmeFacts {
  name: string;
  /** Screen component names and the paths they answer on. */
  screens: readonly { name: string; path: string }[];
  /** Emitted API routes, by file path. */
  routes: readonly string[];
  /** Environment variable names this build reads. */
  env: readonly string[];
  /** Schema changes carried along, oldest first. */
  migrations: number;
  /** True when the project talks to a database directly and compose brings one. */
  usesSql: boolean;
  /** True when the project signs people in. */
  usesAuth: boolean;
  /** True when people can upload files (`docs/29-storage.md`). */
  usesUploads?: boolean;
  /** True when at least one bucket writes to the app's own disk. */
  usesLocalUploads?: boolean;
}

/** What each name is for, so a deployment is not filling in blanks by guesswork. */
const ENV_NOTES: Record<string, string> = {
  DATABASE_URL: 'Postgres connection string — use the pooled one.',
  SUPABASE_URL: 'Your Supabase project URL.',
  SUPABASE_ANON_KEY: 'The publishable key. Safe in a browser; this app keeps it server-side anyway.',
  SUPABASE_SERVICE_ROLE_KEY: 'Bypasses row-level security. Server only, never in a browser.',
  FIREBASE_SERVICE_ACCOUNT: 'The whole service-account JSON, as one value.',
  ANTHROPIC_API_KEY: 'Claude API key.',
  OPENAI_API_KEY: 'OpenAI API key.',
  RESEND_API_KEY: 'Resend API key, for sending email.',
  STRIPE_SECRET_KEY: 'Stripe secret key — the one starting sk_.',
  TWILIO_ACCOUNT_SID: 'Twilio account SID, starting AC.',
  TWILIO_AUTH_TOKEN: 'Twilio auth token.',
  SLACK_BOT_TOKEN: 'Slack bot token, starting xoxb-.',
  HOME_ASSISTANT_URL: 'Where your Home Assistant lives, e.g. http://homeassistant.local:8123',
  HOME_ASSISTANT_TOKEN: 'A long-lived access token from your Home Assistant profile.',
  TOOL_API_KEY: 'Sent as a bearer token by requests that need one.',
  UPLOAD_SECRET:
    'Any long random string. Signs upload tickets so the upload route is not an open dropbox.',
  R2_ACCESS_KEY_ID: 'Cloudflare R2 access key ID.',
  R2_SECRET_ACCESS_KEY: 'Cloudflare R2 secret access key. Server only.',
  AWS_ACCESS_KEY_ID: 'AWS access key ID, for the S3 bucket uploads go to.',
  AWS_SECRET_ACCESS_KEY: 'AWS secret access key. Server only.',
};

const list = (lines: readonly string[]): string => lines.join(NEWLINE);

export function emitReadme(facts: ReadmeFacts): EmittedFile {
  const sections: string[] = [];

  sections.push(
    `# ${facts.name}`,
    '',
    'Built with loom. This is an ordinary Vite + React + TypeScript repo: nothing in it depends on',
    'loom at run time, and it builds, runs and deploys without loom being involved.',
    '',
  );

  // ---- running it ----------------------------------------------------------------------
  sections.push(
    '## Run it',
    '',
    '```bash',
    'npm install',
    'npm run dev',
    '```',
    '',
    'The app is on http://localhost:5173 — or whatever port Vite reports, if that one is taken.',
    '',
    '## Build it',
    '',
    '```bash',
    'npm run build   # type-checks, then builds into dist/',
    'npm start       # serves dist/ and the API routes on :3000',
    '```',
    '',
    '`npm run build` runs `tsc --noEmit` first, so a type error stops the build rather than',
    'shipping. `npm start` is what a container runs.',
    '',
    '## Run it in a container',
    '',
    '```bash',
    'docker compose up --build',
    '```',
    '',
  );

  // ---- what it needs -------------------------------------------------------------------
  if (facts.env.length > 0) {
    sections.push(
      '## What it needs',
      '',
      'Copy `.env.example` to `.env` and fill these in. **No value is ever committed** — the repo',
      'carries the names, the deployment carries the values.',
      '',
      '| Name | What it is |',
      '| --- | --- |',
      ...facts.env.map((name) => `| \`${name}\` | ${ENV_NOTES[name] ?? 'Required by this project.'} |`),
      '',
    );
  }

  if (facts.migrations > 0) {
    sections.push(
      '## The database',
      '',
      `\`migrations/\` holds ${facts.migrations} schema change${facts.migrations === 1 ? '' : 's'}, oldest first, as plain SQL.`,
      'Apply them in order against a fresh database — with `psql`, the Supabase CLI, or any runner',
      'that reads a directory of numbered files. There is no migration tool bundled: that is a',
      'choice your team makes, and most teams have made it already.',
      '',
    );

    if (facts.usesSql) {
      sections.push(
        '`docker compose up` brings a Postgres alongside the app, so a fresh checkout has somewhere',
        'to apply them.',
        '',
      );
    }
  }

  if (facts.usesUploads) {
    sections.push(
      '## Files people upload',
      '',
      'The browser never holds a bucket key. It asks `/api/upload` for a ticket, this server signs',
      'one with the credentials above, and the file goes straight to the bucket — so the key stays',
      'here and the ticket expires in minutes.',
      '',
    );

    if (facts.usesLocalUploads) {
      sections.push(
        '**Files are stored on disk**, under the folder configured for the bucket, and served back',
        'at `/files/…`. That works on a laptop and in a container with a volume. It does **not**',
        'work on a serverless host — that filesystem is temporary and per-invocation, so uploads',
        'would disappear. Point the bucket at object storage before deploying there.',
        '',
      );
    }
  }

  // ---- where things are ----------------------------------------------------------------
  const map = [
    '| Path | What is in it |',
    '| --- | --- |',
    '| `src/artboards/` | One component per screen |',
    '| `src/App.tsx` | The router, and any app-wide state |',
    '| `src/theme.css` | Design tokens as custom properties |',
  ];
  if (facts.routes.length > 0) map.push('| `api/` | One serverless function per route |');
  if (facts.usesUploads) map.push('| `src/server/` | Bucket settings and upload signing |');
  if (facts.usesAuth) map.push('| `src/server/auth.ts` | Sessions, in HttpOnly cookies |');
  if (facts.migrations > 0) map.push('| `migrations/` | Schema changes, oldest first |');
  map.push('| `server.ts` | The server a container runs |');

  sections.push('## Where things are', '', list(map), '');

  if (facts.screens.length > 0) {
    sections.push(
      '### Screens',
      '',
      list(facts.screens.map((screen) => `- \`${screen.path}\` → \`src/artboards/${screen.name}.tsx\``)),
      '',
    );
  }

  if (facts.routes.length > 0) {
    sections.push(
      '### API routes',
      '',
      'Each of these runs **on the server**. Anything secret — database credentials, API keys —',
      'is read here and never reaches the browser.',
      '',
      list(facts.routes.map((route) => `- \`/${route.replace(/^api\//, 'api/').replace(/\.ts$/, '')}\` → \`${route}\``)),
      '',
    );
  }

  // ---- the part people actually need to be told ------------------------------------------
  sections.push(
    '## Editing this code',
    '',
    'It is yours — fork it, rewrite it, take it somewhere else. Two things worth knowing first:',
    '',
    '- **Regenerating overwrites it.** If this project is still being edited in loom, the next',
    '  compile rewrites the files it manages. Edit in loom, or take the repo and stop regenerating',
    '  — both are fine, and doing both at once is the one that loses work.',
    '- **`.env` is git-ignored.** Keep it that way. `.env.example` is the file that gets committed,',
    '  and it holds names only.',
    '',
    '## Deploying',
    '',
    'Anywhere that runs a Node app or a container:',
    '',
    '- **Vercel** — the `api/` files are already in the shape Vercel expects, and `dist/` is static.',
    '- **A container** — `docker compose up --build`, or build the `Dockerfile` and run it anywhere.',
    '- **A VM** — `npm install && npm run build && npm start`.',
    '',
    'Set the environment variables above wherever it runs. That is the whole checklist.',
    '',
  );

  return { path: 'README.md', content: sections.join(NEWLINE) };
}
