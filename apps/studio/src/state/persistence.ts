import { SCHEMA_VERSION, deserializeSnapshot, serializeSnapshot, type Snapshot } from '@loom/ir';
import { getState, subscribe } from './store';

/**
 * Persistence (P0, `docs/10-interaction-plan.md`).
 *
 * The document is the save format, the compiler input and the versioning atom all at once
 * (`docs/specs/snapshot-schema.md`), so saving is `serializeSnapshot` and nothing else — the same
 * validation runs on the way out as on the way in, and a document that could not be reloaded can
 * never be written.
 *
 * Storage sits behind an interface on purpose. The platform layer saves the **R2 blob first, then
 * the Postgres pointer** (`docs/02-system-architecture.md`); swapping this store for that one must
 * not touch the editor.
 */

export interface ProjectStore {
  read(): string | undefined;
  write(json: string): void;
  clear(): void;
}

const KEY = 'loom.project';

/** The local store. A browser with storage disabled still runs the editor, it just cannot save. */
export const localProjectStore: ProjectStore = {
  read: () => localStorage.getItem(KEY) ?? undefined,
  write: (json) => localStorage.setItem(KEY, json),
  clear: () => localStorage.removeItem(KEY),
};

export type RestoreResult =
  | { status: 'empty' }
  | { status: 'restored'; snapshot: Snapshot }
  /** The document is real but this build cannot read it. Never a silent partial load. */
  | { status: 'refused'; reason: string };

/**
 * Read the saved document.
 *
 * The version is checked **before** parsing so the refusal can name both numbers. A zod failure on
 * a version mismatch would be technically correct and useless to read — and a half-loaded project
 * is worse than no project, because the designer would start editing a document missing pieces.
 */
export function restoreProject(store: ProjectStore = localProjectStore): RestoreResult {
  let raw: string | undefined;
  try {
    raw = store.read();
  } catch {
    return { status: 'refused', reason: 'This browser is not allowing local storage.' };
  }

  if (!raw) return { status: 'empty' };

  let version: unknown;
  try {
    version = (JSON.parse(raw) as { schemaVersion?: unknown }).schemaVersion;
  } catch {
    return { status: 'refused', reason: 'The saved project is not readable JSON.' };
  }

  if (version !== SCHEMA_VERSION) {
    return {
      status: 'refused',
      reason: `The saved project is version ${String(version)}; this build reads version ${SCHEMA_VERSION}.`,
    };
  }

  try {
    return { status: 'restored', snapshot: deserializeSnapshot(raw) };
  } catch (error) {
    return { status: 'refused', reason: `The saved project did not validate: ${(error as Error).message}` };
  }
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveHandle {
  stop: () => void;
  /** Write immediately, skipping the debounce — used when the tab is going away. */
  flush: () => void;
  subscribe: (listener: (state: SaveState, detail?: string) => void) => () => void;
}

/** Long enough that typing a name is one write, short enough that a closed tab keeps the work. */
const DEBOUNCE_MS = 400;

/**
 * Save on every change, debounced. Serialization is the validation, so a document that would not
 * round-trip fails here loudly rather than being written and discovered on the next reload.
 */
export function startAutosave(store: ProjectStore = localProjectStore): AutosaveHandle {
  const listeners = new Set<(state: SaveState, detail?: string) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Snapshot | undefined;

  const announce = (state: SaveState, detail?: string): void => {
    for (const listener of listeners) listener(state, detail);
  };

  const write = (): void => {
    const snapshot = pending;
    pending = undefined;
    timer = undefined;
    if (!snapshot) return;

    try {
      store.write(serializeSnapshot(snapshot));
      announce('saved');
    } catch (error) {
      announce('error', (error as Error).message);
    }
  };

  const unsubscribe = subscribe(() => {
    pending = getState().snapshot;
    announce('saving');
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, DEBOUNCE_MS);
  });

  // A tab closing mid-debounce would otherwise lose the last edit — the one most likely to matter.
  const onHide = (): void => {
    if (timer) {
      clearTimeout(timer);
      write();
    }
  };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onHide);

  return {
    stop: () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    },
    flush: onHide,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function clearProject(store: ProjectStore = localProjectStore): void {
  try {
    store.clear();
  } catch {
    /* nothing saved is nothing to clear */
  }
}
