import { describe, expect, it } from 'vitest';
import { createComponent } from '@loom/components';
import { accepts, safeFileName } from '@loom/connectors';
import type { Component, Snapshot } from '@loom/ir';
import { compile, diagnose } from '../src';
import { trivialSnapshot } from './fixtures';

/**
 * Uploads and buckets (`docs/29-storage.md`).
 *
 * Most of what is checked here is a **security property**, not a feature: that no credential
 * reaches the browser, that the server decides the key, and that a limit exists somewhere a form
 * cannot skip. Those are exactly the things that look fine when they are broken.
 */

function withBucket(
  moduleId: string,
  config: Record<string, unknown>,
  field?: { type: string; props?: Record<string, unknown> },
): { files: { path: string; content: string }[]; file: (path: string) => string } {
  const base = trivialSnapshot();
  const root = base.components.cp_root000001!;

  const components: Record<string, Component> = { ...base.components };
  const children = [...(root.children ?? [])];

  if (field) {
    const component = createComponent(field.type, 'cp_upload');
    component.props.bucket = { kind: 'static', value: 'cn_files' };
    for (const [key, value] of Object.entries(field.props ?? {})) {
      component.props[key] = { kind: 'static', value: value as string };
    }
    components[component.id] = component;
    children.push(component.id);
  }

  const snapshot: Snapshot = {
    ...base,
    connectors: { cn_files: { id: 'cn_files', moduleId, config } },
    components: { ...components, cp_root000001: { ...root, children } },
  };

  const result = compile(snapshot);
  return {
    files: result.files,
    file: (path: string) => result.files.find((entry) => entry.path === path)?.content ?? '',
  };
}

describe('the browser never holds a bucket credential', () => {
  it('keeps every key out of everything the browser downloads', () => {
    const { files } = withBucket('r2', { bucket: 'shots', accountId: 'acc123', prefix: 'up' }, {
      type: 'ImageField',
    });

    const secrets = [
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'UPLOAD_SECRET',
    ];

    // src/ is the bundle, minus the server folder the API routes import from. A credential name in
    // any of it is a credential in the bundle: it is in the network tab, and it does not expire.
    for (const file of files) {
      if (!file.path.startsWith('src/') || file.path.startsWith('src/server/')) continue;
      for (const secret of secrets) {
        expect(file.content, `${file.path} names ${secret}`).not.toContain(secret);
      }
    }
  });

  it('names them in .env.example instead, so a deployment knows what to set', () => {
    const { file } = withBucket('r2', { bucket: 'shots', accountId: 'acc123' });
    expect(file('.env.example')).toContain('R2_ACCESS_KEY_ID=');
    expect(file('.env.example')).toContain('R2_SECRET_ACCESS_KEY=');
    // A name, and never a value.
    expect(file('.env.example')).not.toMatch(/R2_ACCESS_KEY_ID=.+/);
  });
});

describe('the server decides, not the browser', () => {
  it('builds the key itself, from a name it has sanitised', () => {
    const { file } = withBucket('local', { directory: '.data/uploads', prefix: 'docs' });
    const buckets = file('src/server/buckets.ts');

    expect(buckets).toContain('export function storageKey');
    // A client-chosen path is a client that can overwrite anyone's file.
    expect(buckets).toContain('safeFileName');
    expect(buckets).toMatch(/Math\.random/);
  });

  it('checks the size and the type where it cannot be skipped', () => {
    const { file } = withBucket('local', { maxMb: 5, accept: 'image/*' });
    const buckets = file('src/server/buckets.ts');

    expect(buckets).toContain('export function checkUpload');
    expect(buckets).toContain(String(5 * 1024 * 1024));
    // The route asks before it signs anything, so a refusal costs no upload at all.
    expect(file('api/upload.ts')).toContain('checkUpload(settings, contentType');
  });

  it('signs the content type into the ticket', () => {
    // Cloudflare's own note is the reason: specifying ContentType "restricts uploads to a specific
    // file type, helping prevent abuse" — a ticket for a PNG cannot upload a script.
    const { file } = withBucket('r2', { bucket: 'shots', accountId: 'acc123' });
    expect(file('src/server/storage.ts')).toContain('ContentType: contentType');
  });
});

describe('each provider, as its own material describes it', () => {
  it('R2: the account endpoint and the auto region', () => {
    // https://developers.cloudflare.com/r2/api/s3/api/ and /presigned-urls/
    const { file } = withBucket('r2', { bucket: 'shots', accountId: 'acc123' });
    const storage = file('src/server/storage.ts');
    expect(storage).toContain(".r2.cloudflarestorage.com");
    expect(storage).toContain("'auto'");
    expect(storage).toContain('@aws-sdk/s3-request-presigner');
    expect(file('package.json')).toContain('@aws-sdk/client-s3');
  });

  it('S3: the same call with a real region and no endpoint override', () => {
    const { file } = withBucket('s3', { bucket: 'shots', region: 'eu-west-2' });
    const storage = file('src/server/storage.ts');
    expect(storage).toContain('PutObjectCommand');
    expect(storage).toContain('settings.region');
    expect(storage).toContain('AWS_SECRET_ACCESS_KEY');
  });

  it('Supabase: createSignedUploadUrl, then a PUT at the URL it answers with', () => {
    // https://github.com/supabase/storage-js — createSignedUploadUrl(path) -> { signedUrl, token,
    // path }; uploadToSignedUrl PUTs at that URL with the token in the query string.
    const { file } = withBucket('supabase-storage', { bucket: 'avatars' });
    const storage = file('src/server/storage.ts');
    expect(storage).toContain('createSignedUploadUrl(key)');
    expect(storage).toContain('data.signedUrl');
    expect(storage).toContain('getPublicUrl(key)');
  });

  it('Firebase: the V4 write URL from Google’s own sample', () => {
    // https://docs.cloud.google.com/storage/docs/samples/storage-generate-upload-signed-url-v4
    const { file } = withBucket('firebase-storage', { bucket: 'app.appspot.com' });
    const storage = file('src/server/storage.ts');
    expect(storage).toContain("version: 'v4'");
    expect(storage).toContain("action: 'write'");
    expect(storage).toContain('contentType,');
  });

  it('installs only the SDK the attached bucket needs', () => {
    // A project storing files on disk should not install an AWS SDK to do it.
    const local = withBucket('local', { directory: '.data/uploads' });
    expect(local.file('package.json')).not.toContain('@aws-sdk');
    expect(local.file('src/server/storage.ts')).not.toContain('@aws-sdk');
  });
});

describe('local disk', () => {
  it('signs its own tickets, so the route is not an open dropbox', () => {
    const { file } = withBucket('local', { directory: '.data/uploads' });
    expect(file('src/server/storage.ts')).toContain('createHmac');
    expect(file('src/server/storage.ts')).toContain('UPLOAD_SECRET');

    const route = file('api/upload.ts');
    expect(route).toContain('signLocal(key, contentType, expires)');
    // Comparing signatures with === leaks where they start to differ.
    expect(route).toContain('timingSafeEqual');
    expect(route).toContain('expired');
  });

  it('refuses a key that climbs out of the folder', () => {
    const route = withBucket('local', { directory: '.data/uploads' }).file('api/upload.ts');
    // On the *resolved* path: '..' segments and an encoded separator both end up somewhere, and
    // where they end up is the only thing worth testing.
    expect(route).toContain('resolve(root, key)');
    expect(route).toContain("target.startsWith(root + sep)");
  });

  it('serves what it stored, from the server a container runs', () => {
    const { file } = withBucket('local', { directory: '.data/uploads' });
    const server = file('server.ts');
    expect(server).toContain("'/files/'");
    expect(server).toContain('uploadFor');
  });

  it('leaves the server alone when nothing is stored locally', () => {
    const { file } = withBucket('r2', { bucket: 'shots', accountId: 'acc123' });
    expect(file('server.ts')).not.toContain('uploadFor');
  });
});

describe('the fields', () => {
  it('upload through the app’s own server and nowhere else', () => {
    const { file } = withBucket('local', { directory: '.data/uploads' }, { type: 'FileField' });
    const home = file('src/artboards/Home.tsx');

    expect(home).toContain("uploadFile(\"cn_files\", file)");
    expect(file('src/upload.ts')).toContain("fetch('/api/upload'");
    // The whole browser half: ask, send, report. Nothing in it decides anything.
    expect(file('src/upload.ts')).not.toContain('ACCESS_KEY');
  });

  it('keep “busy” out of the value that reaches a database', () => {
    const home = withBucket('local', {}, { type: 'FileField' }).file('src/artboards/Home.tsx');
    expect(home).toContain('busy: true');
    // The value is the stored key and only ever that.
    expect(home).toContain('set_field_cp_upload(stored.url || stored.key)');
  });

  it('say what went wrong, in the words the server used', () => {
    const home = withBucket('local', {}, { type: 'FileField' }).file('src/artboards/Home.tsx');
    expect(home).toContain('role="alert"');
  });

  it('show what was chosen, for an image', () => {
    const home = withBucket('local', {}, { type: 'ImageField' }).file('src/artboards/Home.tsx');
    expect(home).toContain('loom-upload__preview');
  });

  it('render disabled with no bucket rather than breaking the build or guessing one', () => {
    // Refusing the whole build was the first attempt and it was wrong: dragging an element out of
    // the palette would break the running app until a bucket was attached. Guessing a bucket would
    // be worse — it would put a customer's documents somewhere nobody decided on.
    const base = trivialSnapshot();
    const root = base.components.cp_root000001!;
    const field = createComponent('FileField', 'cp_upload');

    const result = compile({
      ...base,
      components: {
        ...base.components,
        cp_root000001: { ...root, children: [...(root.children ?? []), field.id] },
        [field.id]: field,
      },
    });

    const home = result.files.find((file) => file.path.startsWith('src/artboards/'))!.content;
    expect(home).toContain('Uploads are not set up yet.');
    expect(home).toContain('aria-disabled="true"');
    expect(home).not.toContain('uploadFile(');
  });

  it('are reported in Problems, where a designer will see them', () => {
    const base = trivialSnapshot();
    const root = base.components.cp_root000001!;
    const field = createComponent('ImageField', 'cp_upload');

    const problems = diagnose({
      ...base,
      components: {
        ...base.components,
        cp_root000001: { ...root, children: [...(root.children ?? []), field.id] },
        [field.id]: field,
      },
    });

    expect(problems.map((problem) => problem.code)).toContain('upload-no-bucket');
  });

  it('are reported when the bucket they point at has been removed', () => {
    const base = trivialSnapshot();
    const root = base.components.cp_root000001!;
    const field = createComponent('FileField', 'cp_upload');
    field.props.bucket = { kind: 'static', value: 'cn_gone' };

    const problems = diagnose({
      ...base,
      components: {
        ...base.components,
        cp_root000001: { ...root, children: [...(root.children ?? []), field.id] },
        [field.id]: field,
      },
    });

    expect(problems.map((problem) => problem.code)).toContain('upload-missing-bucket');
  });
});

describe('a file name is not a path', () => {
  it('keeps a name from climbing anywhere', () => {
    // Separators become underscores and leading dots go, so a traversal ends up as a file name
    // and a name cannot start a hidden file either.
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('.env')).toBe('env');
    expect(safeFileName('report 2024.pdf')).toBe('report_2024.pdf');
    // A name that is nothing but separators still has to become something.
    expect(safeFileName('///')).toBe('file');
    expect(safeFileName('')).toBe('file');
  });

  it('reads accept the way an accept attribute reads', () => {
    expect(accepts('image/*', 'image/png')).toBe(true);
    expect(accepts('image/*', 'application/pdf')).toBe(false);
    expect(accepts('image/png, application/pdf', 'application/pdf')).toBe(true);
    // Blank means anything, which is a decision: a bucket for attachments genuinely takes anything.
    expect(accepts('', 'application/zip')).toBe(true);
    expect(accepts(undefined, 'application/zip')).toBe(true);
  });
});

describe('the sanitising rule exists twice, and says the same thing twice', () => {
  it('emits the same guard the studio uses', () => {
    // One is TypeScript in this repo, the other is text in someone else's. They cannot import each
    // other, so the thing to protect is that they do not drift: a name that is safe in the studio
    // and unsafe in the emitted app would be the worst possible arrangement.
    const emitted = withBucket('local', {}).file('src/server/buckets.ts');
    expect(emitted).toContain("replace(/[^A-Za-z0-9._-]+/g, '_')");
    expect(emitted).toContain("/[A-Za-z0-9]/.test(cleaned) ? cleaned : 'file'");
  });
});

describe('a project with no bucket', () => {
  it('carries none of it', () => {
    const files = compile(trivialSnapshot()).files.map((file) => file.path);
    expect(files).not.toContain('api/upload.ts');
    expect(files).not.toContain('src/upload.ts');
    expect(files).not.toContain('src/server/storage.ts');
  });
});
