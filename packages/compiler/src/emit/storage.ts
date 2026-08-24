import { bucketManifest, type BucketConfig } from '@loom/connectors';
import type { EmittedFile } from '../types';

/**
 * Uploads: the ticket server and the browser half (`docs/29-storage.md`).
 *
 * **The browser never holds a bucket credential.** A key in a browser is a bucket anyone can write
 * to — it is in the bundle, it is in the network tab, and it does not expire. So an upload is three
 * steps: the browser asks this app's own server for a ticket, the server (which holds the
 * credentials) answers with a URL that expires, and the browser sends the bytes there.
 *
 * The server decides the key, the content type, the size limit and how long the ticket lasts.
 * None of those can be the browser's decision: a client-chosen key overwrites other people's files,
 * and a limit enforced in a form is a limit anyone can skip.
 */

export interface BucketPlan {
  /** The connector instance id — what a field names when it picks a bucket. */
  id: string;
  moduleId: string;
  config: BucketConfig;
}

const NEWLINE = String.fromCharCode(10);

/** A JS string literal, so a configured value can never end a quote and start code. */
const text = (value: string): string => JSON.stringify(value);

/**
 * The shared half: sanitising, limits, and the shape of a ticket.
 *
 * Written once and imported by the route rather than pasted per bucket — one place to read when
 * the question is "what can actually be uploaded here".
 */
function ticketModule(plans: readonly BucketPlan[]): string {
  const entries = plans
    .map((plan) => {
      const config = plan.config ?? {};
      return `  ${text(plan.id)}: {
    module: ${text(plan.moduleId)},
    bucket: ${text(config.bucket ?? '')},
    region: ${text(config.region ?? '')},
    accountId: ${text(config.accountId ?? '')},
    prefix: ${text(config.prefix ?? '')},
    directory: ${text(config.directory ?? '.data/uploads')},
    publicBaseUrl: ${text(config.publicBaseUrl ?? '')},
    maxBytes: ${Math.max(1, Math.round((config.maxMb ?? 10) * 1024 * 1024))},
    accept: ${text(config.accept ?? '')},
  },`;
    })
    .join(NEWLINE);

  return `/**
 * What this project may store, and where (generated — docs/29-storage.md).
 *
 * The limits live here, on the server, because a limit enforced in a form is a limit anyone can
 * skip: the form is the polite version, and this is the one that counts.
 */

export interface BucketSettings {
  module: string;
  bucket: string;
  region: string;
  accountId: string;
  prefix: string;
  directory: string;
  publicBaseUrl: string;
  maxBytes: number;
  accept: string;
}

export const BUCKETS: Record<string, BucketSettings> = {
${entries}
};

/**
 * A file name reduced to something safe to put in a key.
 *
 * A name is attacker-controlled text about to become part of a path. What survives is letters,
 * digits, dot, dash and underscore, so "../../etc/passwd" becomes a file name rather than a path.
 */
export function safeFileName(name: string): string {
  const cleaned = String(name ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\\.+/, '')
    .slice(-80);
  // "///" survives as "_", which is safe but is not a name. Anything with no letter or digit
  // left in it is given one. The same rule as @loom/connectors' safeFileName, deliberately.
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : 'file';
}

/** Whether a bucket accepts this content type. \`image/*\` matches a family, as an accept attribute does. */
export function accepts(pattern: string, contentType: string): boolean {
  const rules = String(pattern ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;

  const type = String(contentType ?? '').trim().toLowerCase();
  return rules.some((rule) => {
    if (rule === '*/*' || rule === '*') return true;
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return rule === type;
  });
}

/**
 * The key a file is stored under.
 *
 * Built here and never taken from the request: the random segment is what stops two people
 * uploading "photo.jpg" from overwriting each other, and building it here is what stops one person
 * overwriting another's on purpose.
 */
export function storageKey(settings: BucketSettings, name: string): string {
  const random = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const prefix = settings.prefix ? settings.prefix.replace(/^\\/+|\\/+$/g, '') + '/' : '';
  return prefix + random + '-' + safeFileName(name);
}

/** What the browser gets back: somewhere to send the file, and nothing it could misuse. */
export interface Ticket {
  url: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  key: string;
  /** Where the file will be readable, when the bucket is public. Empty when it is not. */
  publicUrl: string;
}

export function checkUpload(
  settings: BucketSettings | undefined,
  contentType: string,
  size: number,
): string | undefined {
  if (!settings) return 'No such bucket.';
  if (!accepts(settings.accept, contentType)) return 'That kind of file is not allowed here.';
  if (!Number.isFinite(size) || size <= 0) return 'That file is empty.';
  if (size > settings.maxBytes) {
    return 'That file is larger than ' + Math.round(settings.maxBytes / (1024 * 1024)) + ' MB.';
  }
  return undefined;
}
`;
}

/** The presigning half, per provider. Only the ones this project actually uses are emitted. */
function signerModule(modules: readonly string[]): string {
  const parts: string[] = [
    `import { createHmac } from 'node:crypto';`,
    `import { BUCKETS, storageKey, type BucketSettings, type Ticket } from './buckets';`,
    '',
  ];

  if (modules.includes('s3') || modules.includes('r2')) {
    parts.push(
      `import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';`,
      `import { getSignedUrl } from '@aws-sdk/s3-request-presigner';`,
    );
  }
  if (modules.includes('supabase-storage')) {
    parts.push(`import { createClient } from '@supabase/supabase-js';`);
  }
  if (modules.includes('firebase-storage')) {
    parts.push(
      `import { cert, getApps, initializeApp } from 'firebase-admin/app';`,
      `import { getStorage } from 'firebase-admin/storage';`,
    );
  }

  parts.push(
    '',
    `/** Minutes, not days: a ticket is for the upload happening now. */`,
    `const TICKET_SECONDS = 600;`,
    '',
    `function required(name: string): string {`,
    `  const value = process.env[name];`,
    `  if (!value) throw new Error('Missing ' + name + '. See README.md.');`,
    `  return value;`,
    `}`,
    '',
  );

  /**
   * Only where something calls it.
   *
   * Local disk answers with its own /files path, so a project storing only there never uses this —
   * and a function nothing calls fails the emitted app's own build, which is the check that caught
   * it.
   */
  if (modules.some((id) => id !== 'local')) {
    parts.push(
      `/** Where a stored file can be read, when the bucket is public at all. */`,
      `function publicUrl(settings: BucketSettings, key: string): string {`,
      `  if (!settings.publicBaseUrl) return '';`,
      `  return settings.publicBaseUrl.replace(/\\/+$/, '') + '/' + key;`,
      `}`,
    '',
    );
  }


  if (modules.includes('local')) {
    parts.push(
      `/**`,
      ` * A ticket back to this app.`,
      ` *`,
      ` * Signed, because the alternative is an upload route that accepts whatever anyone posts at`,
      ` * it — an open dropbox on the public internet. The signature covers the key, the type and the`,
      ` * expiry, so a ticket cannot be edited into one for a different file.`,
      ` */`,
      `export function signLocal(key: string, contentType: string, expires: number): string {`,
      `  return createHmac('sha256', required('UPLOAD_SECRET'))`,
      `    .update([key, contentType, String(expires)].join(':'))`,
      `    .digest('hex');`,
      `}`,
      '',
      `export function localTicket(bucketId: string, settings: BucketSettings, name: string, contentType: string): Ticket {`,
      `  const key = storageKey(settings, name);`,
      `  const expires = Math.floor(Date.now() / 1000) + TICKET_SECONDS;`,
      `  const signature = signLocal(key, contentType, expires);`,
      `  const query = new URLSearchParams({ bucket: bucketId, key, expires: String(expires), signature });`,
      `  return {`,
      `    url: '/api/upload?' + query.toString(),`,
      `    method: 'PUT',`,
      `    headers: { 'content-type': contentType },`,
      `    key,`,
      `    publicUrl: '/files/' + key,`,
      `  };`,
      `}`,
      '',
    );
  }

  if (modules.includes('s3') || modules.includes('r2')) {
    parts.push(
      `/**`,
      ` * A presigned PUT, for S3 and for R2.`,
      ` *`,
      ` * R2 speaks the S3 API: the difference is the endpoint — https://<ACCOUNT_ID>.r2.cloudflarestorage.com`,
      ` * — and the "auto" region. Both are from Cloudflare's own S3 compatibility page.`,
      ` *`,
      ` * ContentType is signed *into* the URL. Cloudflare's note says why: it "restricts uploads to a`,
      ` * specific file type, helping prevent abuse" — a ticket for a PNG cannot upload a script.`,
      ` */`,
      `export async function s3Ticket(settings: BucketSettings, name: string, contentType: string): Promise<Ticket> {`,
      `  const isR2 = settings.module === 'r2';`,
      `  const client = new S3Client({`,
      `    region: isR2 ? 'auto' : settings.region,`,
      `    ...(isR2 ? { endpoint: 'https://' + settings.accountId + '.r2.cloudflarestorage.com' } : {}),`,
      `    credentials: {`,
      `      accessKeyId: required(isR2 ? 'R2_ACCESS_KEY_ID' : 'AWS_ACCESS_KEY_ID'),`,
      `      secretAccessKey: required(isR2 ? 'R2_SECRET_ACCESS_KEY' : 'AWS_SECRET_ACCESS_KEY'),`,
      `    },`,
      `  });`,
      '',
      `  const key = storageKey(settings, name);`,
      `  const url = await getSignedUrl(`,
      `    client,`,
      `    new PutObjectCommand({ Bucket: settings.bucket, Key: key, ContentType: contentType }),`,
      `    { expiresIn: TICKET_SECONDS },`,
      `  );`,
      '',
      `  return { url, method: 'PUT', headers: { 'content-type': contentType }, key, publicUrl: publicUrl(settings, key) };`,
      `}`,
      '',
    );
  }

  if (modules.includes('supabase-storage')) {
    parts.push(
      `/**`,
      ` * Supabase Storage.`,
      ` *`,
      ` * createSignedUploadUrl answers { signedUrl, token, path }; the token travels in the query`,
      ` * string of that URL, so the browser PUTs the file straight at it with no header to get wrong`,
      ` * and no credential in it.`,
      ` */`,
      `export async function supabaseTicket(settings: BucketSettings, name: string, contentType: string): Promise<Ticket> {`,
      `  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'));`,
      `  const key = storageKey(settings, name);`,
      '',
      `  const { data, error } = await client.storage.from(settings.bucket).createSignedUploadUrl(key);`,
      `  if (error || !data) throw new Error(error?.message ?? 'Could not sign the upload.');`,
      '',
      `  const readable = client.storage.from(settings.bucket).getPublicUrl(key).data.publicUrl;`,
      `  return {`,
      `    url: data.signedUrl,`,
      `    method: 'PUT',`,
      `    headers: { 'content-type': contentType },`,
      `    key,`,
      `    publicUrl: settings.publicBaseUrl ? publicUrl(settings, key) : readable,`,
      `  };`,
      `}`,
      '',
    );
  }

  if (modules.includes('firebase-storage')) {
    parts.push(
      `/**`,
      ` * Firebase Storage, which is Google Cloud Storage underneath.`,
      ` *`,
      ` * The V4 "write" signed URL from Google's own sample. The content type is part of the`,
      ` * signature, so the PUT has to send the same one — which is the property that makes a ticket`,
      ` * for an image useless for anything else.`,
      ` */`,
      `export async function firebaseTicket(settings: BucketSettings, name: string, contentType: string): Promise<Ticket> {`,
      `  if (getApps().length === 0) {`,
      `    initializeApp({ credential: cert(JSON.parse(required('FIREBASE_SERVICE_ACCOUNT'))) });`,
      `  }`,
      '',
      `  const key = storageKey(settings, name);`,
      `  const [url] = await getStorage()`,
      `    .bucket(settings.bucket)`,
      `    .file(key)`,
      `    .getSignedUrl({`,
      `      version: 'v4',`,
      `      action: 'write',`,
      `      expires: Date.now() + TICKET_SECONDS * 1000,`,
      `      contentType,`,
      `    });`,
      '',
      `  return { url, method: 'PUT', headers: { 'content-type': contentType }, key, publicUrl: publicUrl(settings, key) };`,
      `}`,
      '',
    );
  }

  // The one door the route knocks on, so adding a provider is adding a branch here and nothing else.
  const branches: string[] = [];
  if (modules.includes('local')) branches.push(`  if (settings.module === 'local') return localTicket(bucketId, settings, name, contentType);`);
  if (modules.includes('s3') || modules.includes('r2')) {
    branches.push(`  if (settings.module === 's3' || settings.module === 'r2') return s3Ticket(settings, name, contentType);`);
  }
  if (modules.includes('supabase-storage')) branches.push(`  if (settings.module === 'supabase-storage') return supabaseTicket(settings, name, contentType);`);
  if (modules.includes('firebase-storage')) branches.push(`  if (settings.module === 'firebase-storage') return firebaseTicket(settings, name, contentType);`);

  parts.push(
    `export async function ticketFor(bucketId: string, name: string, contentType: string): Promise<Ticket> {`,
    `  const settings = BUCKETS[bucketId];`,
    `  if (!settings) throw new Error('No such bucket.');`,
    ...branches,
    `  throw new Error('No way to upload to ' + settings.module + '.');`,
    `}`,
    '',
  );

  return parts.join(NEWLINE);
}

/**
 * The route.
 *
 * `POST` asks for a ticket. `PUT` is the local-disk upload itself, which only exists because a
 * folder cannot presign anything — and it checks the signature before it writes a byte.
 */
function routeModule(usesLocal: boolean): string {
  const localHalf = usesLocal
    ? `
/**
 * The local-disk upload.
 *
 * Two things are checked before anything is written, and both matter: the **signature**, so this is
 * not an open dropbox, and the **resolved path**, so a key cannot climb out of the folder. The key
 * was built by the server and signed, which makes the second check a belt-and-braces one — and the
 * day someone changes how keys are made, it is the one that will still be true.
 */
async function receive(request: Request, url: URL): Promise<Response> {
  const bucketId = url.searchParams.get('bucket') ?? '';
  const key = url.searchParams.get('key') ?? '';
  const expires = Number(url.searchParams.get('expires') ?? '0');
  const signature = url.searchParams.get('signature') ?? '';
  const contentType = request.headers.get('content-type') ?? 'application/octet-stream';

  const settings = BUCKETS[bucketId];
  if (!settings) return json({ error: 'No such bucket.' }, 404);
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) {
    return json({ error: 'That upload ticket has expired.' }, 403);
  }

  const expected = signLocal(key, contentType, expires);
  // Constant time: comparing signatures with === leaks where they start to differ.
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature.padEnd(expected.length).slice(0, expected.length)))) {
    return json({ error: 'That upload ticket is not valid.' }, 403);
  }

  const body = Buffer.from(await request.arrayBuffer());
  const problem = checkUpload(settings, contentType, body.byteLength);
  if (problem) return json({ error: problem }, 400);

  const root = resolve(settings.directory);
  const target = resolve(root, key);
  if (target !== root && !target.startsWith(root + sep)) {
    return json({ error: 'That key is not allowed.' }, 400);
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);
  return json({ key, url: '/files/' + key });
}
`
    : '';

  const imports = usesLocal
    ? `import { timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { BUCKETS, checkUpload, type BucketSettings } from '../src/server/buckets';
import { signLocal, ticketFor } from '../src/server/storage';`
    : `import { BUCKETS, checkUpload, type BucketSettings } from '../src/server/buckets';
import { ticketFor } from '../src/server/storage';`;

  return `${imports}

/**
 * Uploads (generated — docs/29-storage.md).
 *
 * The browser asks here for somewhere to put a file; the credentials stay in this process. What
 * goes back is a ticket: a URL that expires, the method to use, and the key the file will have.
 * Nothing the browser sends decides where the file lands.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Ask {
  bucket?: string;
  name?: string;
  type?: string;
  size?: number;
}

async function issue(request: Request): Promise<Response> {
  let ask: Ask;
  try {
    ask = (await request.json()) as Ask;
  } catch {
    return json({ error: 'Expected JSON.' }, 400);
  }

  const settings: BucketSettings | undefined = BUCKETS[ask.bucket ?? ''];
  const contentType = String(ask.type ?? 'application/octet-stream');
  const problem = checkUpload(settings, contentType, Number(ask.size ?? 0));
  if (problem) return json({ error: problem }, 400);

  try {
    const ticket = await ticketFor(String(ask.bucket), String(ask.name ?? 'file'), contentType);
    return json(ticket);
  } catch (error) {
    // The message may name an environment variable; it must not carry a value.
    return json({ error: error instanceof Error ? error.message : 'Could not start the upload.' }, 500);
  }
}
${localHalf}
export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'POST') return issue(request);${
    usesLocal ? `\n  if (request.method === 'PUT') return receive(request, url);` : ''
  }
  return json({ error: 'Method not allowed.' }, 405);
}
`;
}

/**
 * The browser half.
 *
 * Small on purpose: ask, send, report. Everything that decides anything happens on the server, so
 * there is nothing here worth tampering with — a modified copy of this file can still only upload
 * what the server was willing to sign for.
 */
const CLIENT = `/**
 * Uploading a file (generated — docs/29-storage.md).
 *
 * Three steps, the same for every provider: ask this app's server for a ticket, send the bytes
 * where it says, report what happened. The field calling this does not know whether the file ends
 * up in R2 or in a folder, which is exactly the point.
 */

export interface Upload {
  key: string;
  url: string;
}

export async function uploadFile(bucket: string, file: File): Promise<Upload> {
  const contentType = file.type || 'application/octet-stream';

  const asked = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bucket, name: file.name, type: contentType, size: file.size }),
  });

  const ticket = (await asked.json()) as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    key?: string;
    publicUrl?: string;
    error?: string;
  };
  if (!asked.ok || !ticket.url) throw new Error(ticket.error ?? 'Could not start the upload.');

  const sent = await fetch(ticket.url, {
    method: ticket.method === 'POST' ? 'POST' : 'PUT',
    headers: ticket.headers ?? { 'content-type': contentType },
    body: file,
  });
  if (!sent.ok) throw new Error('The upload did not finish.');

  return { key: ticket.key ?? '', url: ticket.publicUrl || ticket.key || '' };
}
`;

/** Everything an app with at least one bucket needs. */
export function emitStorage(plans: readonly BucketPlan[]): EmittedFile[] {
  if (plans.length === 0) return [];

  const modules = [...new Set(plans.map((plan) => plan.moduleId))].filter((id) =>
    Boolean(bucketManifest(id)),
  );

  return [
    { path: 'src/server/buckets.ts', content: ticketModule(plans) },
    { path: 'src/server/storage.ts', content: signerModule(modules) },
    { path: 'api/upload.ts', content: routeModule(modules.includes('local')) },
    { path: 'src/upload.ts', content: CLIENT },
  ];
}

/** Where local-disk files are served from, for the server a container runs. */
export function localDirectories(plans: readonly BucketPlan[]): string[] {
  return [
    ...new Set(
      plans
        .filter((plan) => plan.moduleId === 'local')
        .map((plan) => plan.config?.directory ?? '.data/uploads'),
    ),
  ];
}
