import { describe, expect, it } from 'vitest';
import { createFileNode } from '@loom/connectors';
import { compile } from '../src/index';
import { CompileError } from '../src/types';
import { supabaseSnapshot, uploadSnapshot } from './fixtures';
import { FILES_MODULE_PATH, supportsFileOps } from '../src/emit/files';
import type { Node, Snapshot } from '@loom/ir';

/**
 * File nodes (N3, `docs/V1-COMPLETION.md` §10).
 *
 * Five bucket providers shipped and the canvas could reach none of them: an upload field could put
 * a file somewhere and nothing could ever list it, delete it, or hand somebody a link. A connector
 * with no node is a connector nobody has.
 *
 * The rule these all turn on is the one the whole storage design turns on — **a bucket credential
 * in a browser is a bucket anyone can write to** — so every one of them is a step inside an API
 * route, and the compiler refuses them anywhere else.
 */

/** A project with a bucket attached and a route to put a file step in. */
function withBucket(): Snapshot {
  const base = supabaseSnapshot();
  return {
    ...base,
    connectors: {
      ...base.connectors,
      cn_files: { id: 'cn_files', moduleId: 'local', config: { directory: '.data/uploads' } },
    },
  };
}

/** That project, with a file step spliced into its route's body. */
function withFileStep(operation: string, config: Record<string, unknown> = {}): Snapshot {
  const base = withBucket();
  const route = Object.values(base.nodes).find((node) => node.category === 'api')!;
  const body = ((route.config ?? {}) as { body?: string[] }).body ?? [];

  const step: Node = {
    ...createFileNode('nd_file', { x: 0, y: 0 }, 'cn_files', operation),
    config: { bucketId: 'cn_files', operationId: operation, ...config },
  };

  return {
    ...base,
    nodes: {
      ...base.nodes,
      nd_file: step,
      [route.id]: { ...route, config: { ...(route.config as object), body: [...body, 'nd_file'] } },
    },
  };
}

const fileAt = (snapshot: Snapshot, path: string) =>
  compile(snapshot).files.find((file) => file.path === path);

const routeCode = (snapshot: Snapshot) =>
  compile(snapshot)
    .files.filter(
      (file) =>
        file.path.startsWith('api/') &&
        !file.path.startsWith('api/auth/') &&
        file.path !== 'api/upload.ts',
    )
    .map((file) => file.content)
    .join('\n');

describe('the module a file node calls', () => {
  it('is emitted for a project with a bucket', () => {
    expect(fileAt(withBucket(), FILES_MODULE_PATH)).toBeDefined();
  });

  it('offers the four things a project does to a file', () => {
    const module = fileAt(withBucket(), FILES_MODULE_PATH)!.content;
    for (const name of ['listFiles', 'deleteFile', 'signUrl', 'putFile']) {
      expect(module, name).toContain(`export async function ${name}`);
    }
  });

  /**
   * A project with one local bucket should not carry an S3 client, a Supabase client and the
   * Firebase admin SDK. Same demand-driven rule the signer follows, and the same reason: an SDK
   * imported for a provider nobody uses is weight in every cold start.
   */
  it('imports only the providers the project actually attached', () => {
    const module = fileAt(withBucket(), FILES_MODULE_PATH)!.content;
    const attached = Object.values(withBucket().connectors).map((entry) => entry.moduleId);

    if (!attached.includes('s3') && !attached.includes('r2')) {
      expect(module).not.toContain('@aws-sdk/client-s3');
    }
    if (!attached.includes('firebase-storage')) {
      expect(module).not.toContain('firebase-admin');
    }
  });

  /**
   * A key is text that came from somewhere. Anything climbing out of the bucket's folder is
   * refused where the path is built rather than trusted to have been cleaned earlier.
   */
  it('refuses a key that climbs out of a local bucket', () => {
    const module = fileAt(withBucket(), FILES_MODULE_PATH)!.content;
    if (!module.includes('localPath')) return;
    expect(module).toContain('not in this bucket');
  });

  /** "List a bucket" can answer with a hundred thousand rows; a step that does that times out. */
  it('caps a listing', () => {
    const module = fileAt(withBucket(), FILES_MODULE_PATH)!.content;
    expect(module).toContain('Math.min(Math.max(1, Math.trunc(limit)), 1000)');
  });

  it('emits nothing at all for a project with no buckets', () => {
    // No bucket attached, so no module — the same demand-driven rule the rest of the compiler
    // follows. The upload fixture is not the test here: it *has* one.
    const plain = compile(supabaseSnapshot());
    expect(plain.files.find((file) => file.path === FILES_MODULE_PATH)).toBeUndefined();
    expect(compile(uploadSnapshot()).files.find((f) => f.path === FILES_MODULE_PATH)).toBeDefined();
  });
});

describe('a file step in a route', () => {
  it('calls the operation it was configured with', () => {
    expect(routeCode(withFileStep('listFiles'))).toContain('await listFiles(');
    expect(routeCode(withFileStep('deleteFile'))).toContain('await deleteFile(');
    expect(routeCode(withFileStep('signUrl'))).toContain('await signUrl(');
  });

  /** Only what it uses: the emitted app builds with `noUnusedLocals`. */
  it('imports only the operation it uses', () => {
    const code = routeCode(withFileStep('signUrl'));
    expect(code).toContain("import { signUrl } from '../src/server/files'");
    expect(code).not.toContain('listFiles,');
  });

  /**
   * The bucket is **named**, never carried. A step holding a key would be a key in the document,
   * which guardrail 1 refuses outright.
   */
  it('names the bucket rather than carrying a credential', () => {
    const code = routeCode(withFileStep('listFiles'));

    // The step passes an id and nothing else. The route around it still reads its own database
    // credential by name, which is a different thing and is not what this is about.
    expect(code).toContain('await listFiles("cn_files"');

    const stepLines = code
      .split('\n')
      .filter((line) => line.includes('listFiles('))
      .join('\n');
    expect(stepLines).not.toMatch(/SECRET|ACCESS_KEY|SERVICE_ROLE/);
  });

  it('honours a smaller cap and a shorter link', () => {
    expect(routeCode(withFileStep('listFiles', { limit: 5 }))).toContain(', 5)');
    expect(routeCode(withFileStep('signUrl', { seconds: 60 }))).toContain(', 60)');
  });
});

describe('what a file step is refused', () => {
  it('refuses one with no bucket chosen', () => {
    expect(() => compile(withFileStep('listFiles', { bucketId: '' }))).toThrow(CompileError);
    expect(() => compile(withFileStep('listFiles', { bucketId: '' }))).toThrow(/no bucket chosen/);
  });

  it('refuses one pointing at a bucket that is gone', () => {
    expect(() => compile(withFileStep('listFiles', { bucketId: 'cn_missing' }))).toThrow(
      /no longer attached/,
    );
  });

  it('knows which providers it can actually do this for', () => {
    for (const id of ['local', 's3', 'r2', 'supabase-storage', 'firebase-storage']) {
      expect(supportsFileOps(id), id).toBe(true);
    }
    expect(supportsFileOps('postgres')).toBe(false);
  });
});
