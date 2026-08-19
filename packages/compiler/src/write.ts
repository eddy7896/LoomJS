import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { EmittedFile } from './types';

export interface WriteOptions {
  /** Delete the directory before writing. Emission is the source of truth, not the disk. */
  clean?: boolean;
}

/** Write an emitted file set to disk. Paths are POSIX-relative and never escape `outDir`. */
export async function writeFiles(
  files: EmittedFile[],
  outDir: string,
  options: WriteOptions = {},
): Promise<void> {
  const root = resolve(outDir);
  if (options.clean) await rm(root, { recursive: true, force: true });

  for (const file of files) {
    const target = resolve(root, ...file.path.split('/'));
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`Emitted path escapes the output directory: ${file.path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}

/** Convenience: compile result -> disk. */
export async function writeTo(
  files: EmittedFile[],
  outDir: string,
  options?: WriteOptions,
): Promise<string> {
  await writeFiles(files, outDir, options);
  return join(resolve(outDir));
}
