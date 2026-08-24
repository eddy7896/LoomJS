import type { CredentialSpec } from './module';

/**
 * Buckets: somewhere for uploaded files to live (`docs/29-storage.md`).
 *
 * A bucket is not a data connector. It has no tables, no columns and nothing to introspect — what
 * it has is a place to put bytes and a credential that must never leave the server. So it is its
 * own manifest rather than a `ModuleManifest` wearing a disguise: a Files panel that offered
 * "tables" would be lying about what a bucket is.
 *
 * **Every credential here is server-scoped, without exception.** A bucket key in a browser is a
 * bucket anyone can write to — it is in the bundle, it is in the network tab, and it does not
 * expire. The compiler refuses to emit one into client code, and the studio never puts one in the
 * document; the document carries the *name*, and the value lives in the env bucket.
 *
 * Endpoints and SDK calls were read from each vendor's own material and are pinned in a test that
 * says where they came from.
 */

/** How the browser is told to send the file. Every provider ends up as one of these. */
export type TicketKind =
  /** A URL the app itself answers, signed so it is not an open dropbox. */
  | 'self'
  /** A presigned `PUT` straight at the provider. */
  | 'put';

export interface BucketConfigField {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

export interface BucketManifest {
  id: string;
  label: string;
  kind: 'bucket';
  /** One line, for the panel: what this is and where the files end up. */
  summary: string;
  /** How the browser sends the bytes once the server has answered. */
  ticket: TicketKind;
  /** What has to be configured. None of it is secret — secrets are credentials. */
  fields: readonly BucketConfigField[];
  /** Names only. The values live in the env bucket and never reach the document. */
  credentials: readonly CredentialSpec[];
  /** npm packages the emitted project needs to talk to it, if any. */
  dependencies?: Readonly<Record<string, string>>;
  /** True when the project can reach it with no account anywhere. */
  local?: boolean;
}

const server = (name: string, label: string, hint?: string): CredentialSpec => ({
  name,
  label,
  scope: 'server',
  ...(hint ? { hint } : {}),
});

/**
 * A folder the app owns.
 *
 * For development, and for a container with a volume. It does **not** survive on a serverless
 * host, where the filesystem is temporary and per-invocation — the emitted README says so, rather
 * than letting someone find out when their users' files disappear.
 */
export const LOCAL_BUCKET: BucketManifest = {
  id: 'local',
  label: 'Local disk',
  kind: 'bucket',
  summary: 'A folder this app owns. Good on a laptop or in a container with a volume.',
  ticket: 'self',
  local: true,
  fields: [
    {
      key: 'directory',
      label: 'Folder',
      placeholder: '.data/uploads',
      hint: 'Relative to the project. Created if it is not there.',
    },
    { key: 'prefix', label: 'Key prefix', placeholder: 'uploads' },
  ],
  // Not a bucket credential — a signing key. Without it the upload route would accept anything
  // anyone posted at it, which is an open dropbox on the public internet.
  credentials: [
    server('UPLOAD_SECRET', 'Upload signing secret', 'Any long random string. Signs upload tickets.'),
  ],
};

/**
 * Cloudflare R2, over the S3 API.
 *
 * Endpoint format and the `auto` region are from Cloudflare's S3 compatibility page; the presigned
 * `PutObjectCommand` flow is from their presigned URL page. Their own note is why `ContentType` is
 * signed into every ticket: it "restricts uploads to a specific file type, helping prevent abuse".
 */
export const R2_BUCKET: BucketManifest = {
  id: 'r2',
  label: 'Cloudflare R2',
  kind: 'bucket',
  summary: 'S3-compatible, with no charge for reading the files back out.',
  ticket: 'put',
  fields: [
    { key: 'bucket', label: 'Bucket', placeholder: 'my-bucket', required: true },
    {
      key: 'accountId',
      label: 'Account ID',
      placeholder: '0a1b2c…',
      hint: 'From the Cloudflare dashboard. The endpoint is built from it.',
      required: true,
    },
    { key: 'prefix', label: 'Key prefix', placeholder: 'uploads' },
    {
      key: 'publicBaseUrl',
      label: 'Public address',
      placeholder: 'https://files.example.com',
      hint: 'The domain the bucket is served on, if it is public. Leave blank if it is not.',
    },
  ],
  credentials: [
    server('R2_ACCESS_KEY_ID', 'Access key ID'),
    server('R2_SECRET_ACCESS_KEY', 'Secret access key'),
  ],
  dependencies: {
    '@aws-sdk/client-s3': '^3.712.0',
    '@aws-sdk/s3-request-presigner': '^3.712.0',
  },
};

export const S3_BUCKET: BucketManifest = {
  id: 's3',
  label: 'Amazon S3',
  kind: 'bucket',
  summary: 'The original. Same presigned upload as R2, with a real region.',
  ticket: 'put',
  fields: [
    { key: 'bucket', label: 'Bucket', placeholder: 'my-bucket', required: true },
    { key: 'region', label: 'Region', placeholder: 'eu-west-2', required: true },
    { key: 'prefix', label: 'Key prefix', placeholder: 'uploads' },
    {
      key: 'publicBaseUrl',
      label: 'Public address',
      placeholder: 'https://files.example.com',
      hint: 'A CloudFront domain, or the bucket website. Leave blank for a private bucket.',
    },
  ],
  credentials: [
    server('AWS_ACCESS_KEY_ID', 'Access key ID'),
    server('AWS_SECRET_ACCESS_KEY', 'Secret access key'),
  ],
  dependencies: {
    '@aws-sdk/client-s3': '^3.712.0',
    '@aws-sdk/s3-request-presigner': '^3.712.0',
  },
};

/**
 * Supabase Storage.
 *
 * `createSignedUploadUrl(path)` answers `{ signedUrl, token, path }`, and the browser `PUT`s the
 * file straight at `signedUrl` — the token travels in the query string, so there is no header for
 * the browser to get wrong and no credential in it.
 */
export const SUPABASE_BUCKET: BucketManifest = {
  id: 'supabase-storage',
  label: 'Supabase Storage',
  kind: 'bucket',
  summary: 'The storage half of Supabase, beside the database.',
  ticket: 'put',
  fields: [
    { key: 'bucket', label: 'Bucket', placeholder: 'avatars', required: true },
    { key: 'prefix', label: 'Key prefix', placeholder: 'uploads' },
  ],
  credentials: [
    server('SUPABASE_URL', 'Project URL'),
    server(
      'SUPABASE_SERVICE_ROLE_KEY',
      'Service role key',
      'Bypasses row-level security. Server only, never in a browser.',
    ),
  ],
  dependencies: { '@supabase/supabase-js': '^2.47.10' },
};

/**
 * Firebase Storage, which is Google Cloud Storage underneath.
 *
 * The signed URL is the V4 `write` URL from Google's own sample: the content type is part of the
 * signature, so the `PUT` has to send the same one.
 */
export const FIREBASE_BUCKET: BucketManifest = {
  id: 'firebase-storage',
  label: 'Firebase Storage',
  kind: 'bucket',
  summary: 'Google Cloud Storage, through the Firebase admin SDK.',
  ticket: 'put',
  fields: [
    {
      key: 'bucket',
      label: 'Bucket',
      placeholder: 'my-project.appspot.com',
      hint: 'The bucket name, not the project id.',
      required: true,
    },
    { key: 'prefix', label: 'Key prefix', placeholder: 'uploads' },
  ],
  credentials: [
    server(
      'FIREBASE_SERVICE_ACCOUNT',
      'Service account JSON',
      'The whole file, as one value. It signs the upload tickets.',
    ),
  ],
  dependencies: { 'firebase-admin': '^13.0.0' },
};

export const BUCKETS: readonly BucketManifest[] = [
  LOCAL_BUCKET,
  R2_BUCKET,
  S3_BUCKET,
  SUPABASE_BUCKET,
  FIREBASE_BUCKET,
];

const BY_ID = new Map(BUCKETS.map((bucket) => [bucket.id, bucket]));

export function bucketManifest(id: string): BucketManifest | undefined {
  return BY_ID.get(id);
}

/** True when this module id names a bucket rather than a database. */
export function isBucket(moduleId: string): boolean {
  return BY_ID.has(moduleId);
}

/** What a configured bucket carries in the document. None of it is secret. */
export interface BucketConfig {
  /** What the designer calls it — how a field picks one. */
  label?: string;
  bucket?: string;
  region?: string;
  accountId?: string;
  prefix?: string;
  directory?: string;
  publicBaseUrl?: string;
  /** Refused above this, on the server, where it cannot be skipped. */
  maxMb?: number;
  /**
   * The content types this bucket accepts, comma separated — `image/*, application/pdf`.
   *
   * Empty means anything, which is a decision rather than an oversight: a bucket for attachments
   * genuinely does take anything, and a builder that made that impossible would be in the way.
   */
  accept?: string;
}

/** Every credential name a set of buckets needs, so `.env.example` can list them. */
export function bucketCredentials(moduleIds: readonly string[]): string[] {
  const names = new Set<string>();
  for (const id of moduleIds) {
    for (const credential of bucketManifest(id)?.credentials ?? []) names.add(credential.name);
  }
  return [...names].sort();
}

/** The npm packages a set of buckets needs in the emitted project. */
export function bucketDependencies(moduleIds: readonly string[]): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const id of moduleIds) Object.assign(deps, bucketManifest(id)?.dependencies ?? {});
  return deps;
}

/**
 * A file name reduced to something safe to put in a key.
 *
 * Not decoration: a name is attacker-controlled text that is about to become part of a path. What
 * survives is letters, digits, dot, dash and underscore — so `../../etc/passwd` becomes
 * `.._.._etc_passwd`, which is a file name and not a path.
 */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(-80);
  // "///" survives as "_", which is safe but is not a name. Anything with no letter or digit left
  // in it is given one.
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : 'file';
}

/**
 * Whether a bucket accepts this content type.
 *
 * `image/*` matches a whole family, which is how an `accept` attribute already reads, so a designer
 * writing one is writing the thing they already know.
 */
export function accepts(pattern: string | undefined, contentType: string): boolean {
  const rules = (pattern ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;

  const type = contentType.trim().toLowerCase();
  return rules.some((rule) => {
    if (rule === '*/*' || rule === '*') return true;
    if (rule.endsWith('/*')) return type.startsWith(`${rule.slice(0, -1)}`);
    return rule === type;
  });
}
