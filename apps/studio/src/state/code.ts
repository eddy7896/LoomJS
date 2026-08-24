import { zipSync, strToU8 } from 'fflate';
import { CompileError, compile, type EmittedFile } from '@loom/compiler';
import type { Snapshot } from '@loom/ir';
import { log } from './logs';

/**
 * The source code, as something you can read and take away (`docs/24-code.md`).
 *
 * loom's whole claim is that a project compiles to **a real repo the user owns**. Until now that
 * repo existed twice — inside the Preview's directory, and in whatever a deploy wrote — and never
 * anywhere a designer could look at it. "You own the code" is not a promise anyone can check if
 * they cannot see it.
 *
 * So: the same `compile()` the Preview runs, the same files, shown and downloadable. Not a second
 * generator, and not an export path that could drift from what actually runs.
 */

export interface CodeResult {
  files: readonly EmittedFile[];
  /** Why there is nothing to show, when a build is refused. */
  error?: string;
  /** The entity the refusal points at, so the panel can send someone to it. */
  entityId?: string;
}

/**
 * Compile for reading.
 *
 * A refusal is an *answer* here, not an exception: the panel says what is wrong in the same place
 * it would have shown the code, which is where somebody looking for the code will be.
 */
export function emittedCode(snapshot: Snapshot): CodeResult {
  try {
    return { files: compile(snapshot).files };
  } catch (error) {
    return {
      files: [],
      error: error instanceof Error ? error.message : String(error),
      entityId: error instanceof CompileError ? error.entityId : undefined,
    };
  }
}

export interface TreeEntry {
  /** The full path, which is what selects a file. */
  path: string;
  /** Just the last segment, which is what a person reads. */
  name: string;
  /** How deep it sits, for the indent. */
  depth: number;
  /** Absent on a folder. */
  file?: EmittedFile;
}

/**
 * The files as a tree, folders first and everything alphabetical.
 *
 * Flat paths are what the compiler emits and what a zip wants; a tree is what a person reads. The
 * conversion lives here rather than in the panel so it can be tested without a browser.
 */
export function fileTree(files: readonly EmittedFile[]): TreeEntry[] {
  const folders = new Set<string>();
  for (const file of files) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      folders.add(parts.slice(0, index).join('/'));
    }
  }

  const entries: TreeEntry[] = [
    ...[...folders].map((path) => ({
      path,
      name: path.split('/').at(-1)!,
      depth: path.split('/').length - 1,
    })),
    ...files.map((file) => ({
      path: file.path,
      name: file.path.split('/').at(-1)!,
      depth: file.path.split('/').length - 1,
      file,
    })),
  ];

  // Sorted by path, so a folder always lands immediately above what is inside it.
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/** A name a file system will accept, from whatever the project is called. */
export function projectFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'loom-project'}.zip`;
}

/** The whole project as a zip, in memory. */
export function zipProject(files: readonly EmittedFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.path] = strToU8(file.content);
  // No compression level tuning: a project is a few hundred kilobytes of text, and the default is
  // instant at that size.
  return zipSync(entries);
}

/**
 * Hand the project to the browser as a download.
 *
 * Everything happens here — no upload, no round trip, nothing sent anywhere. The code being
 * downloaded is code this browser just produced, and a project that only compiles locally is a
 * project you can take away without asking anyone.
 */
export function downloadProject(snapshot: Snapshot): { ok: boolean; error?: string } {
  const result = emittedCode(snapshot);
  if (result.error) {
    log({ source: 'compile', level: 'error', message: `Download refused: ${result.error}` });
    return { ok: false, error: result.error };
  }

  const zip = zipProject(result.files);
  // Copied into a plain ArrayBuffer: a Uint8Array can be backed by shared memory, which a Blob
  // will not take.
  const bytes = new Uint8Array(zip.length);
  bytes.set(zip);
  const url = URL.createObjectURL(new Blob([bytes.buffer], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = projectFileName(snapshot.name);
  document.body.append(link);
  link.click();
  link.remove();
  // Released on the next tick: revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);

  log({ source: 'compile', message: `Downloaded ${result.files.length} files` });
  return { ok: true };
}
