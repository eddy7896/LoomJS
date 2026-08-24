import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrivialSnapshot, SCHEMA_VERSION, serializeSnapshot } from '@loom/ir';
import {
  clearProject,
  restoreProject,
  startAutosave,
  type ProjectStore,
} from '../src/state/persistence';
import {
  addComponent,
  getState,
  loadSnapshot,
  rename,
  resetProject,
  selectedComponentId,
} from '../src/state/store';
import { resetWithScreen } from './helpers';

/** An in-memory stand-in for local storage, so the tests do not depend on a browser. */
function memoryStore(initial?: string): ProjectStore & { value: string | undefined } {
  return {
    value: initial,
    read() {
      return this.value;
    },
    write(json: string) {
      this.value = json;
    },
    clear() {
      this.value = undefined;
    },
  };
}

beforeEach(() => {
  resetWithScreen();
});

describe('restoring a saved project', () => {
  it('reports an empty store rather than inventing a document', () => {
    expect(restoreProject(memoryStore())).toEqual({ status: 'empty' });
  });

  it('round-trips a real document', () => {
    const saved = createTrivialSnapshot();
    const result = restoreProject(memoryStore(serializeSnapshot(saved)));
    expect(result.status).toBe('restored');
    if (result.status !== 'restored') return;
    expect(result.snapshot).toEqual(saved);
  });

  it('refuses a document from another schema version, naming both', () => {
    const future = JSON.stringify({ ...createTrivialSnapshot(), schemaVersion: SCHEMA_VERSION + 1 });
    const result = restoreProject(memoryStore(future));
    expect(result.status).toBe('refused');
    if (result.status !== 'refused') return;
    // A designer has to be able to tell "too new" from "corrupt" without reading a stack trace.
    expect(result.reason).toContain(`version ${SCHEMA_VERSION + 1}`);
    expect(result.reason).toContain(`version ${SCHEMA_VERSION}`);
  });

  it('refuses unreadable JSON and a document that does not validate', () => {
    expect(restoreProject(memoryStore('{ not json'))).toEqual({
      status: 'refused',
      reason: 'The saved project is not readable JSON.',
    });

    const broken = JSON.stringify({ schemaVersion: SCHEMA_VERSION, id: 'pj_1' });
    const result = restoreProject(memoryStore(broken));
    expect(result.status).toBe('refused');
  });

  it('never returns a half-loaded document', () => {
    const partial = JSON.stringify({
      ...createTrivialSnapshot(),
      components: { cp_ghost: { id: 'cp_ghost' } },
    });
    // Loading most of a project is worse than loading none: the designer would edit the remains.
    expect(restoreProject(memoryStore(partial)).status).toBe('refused');
  });
});

describe('autosave', () => {
  it('writes after a change, debounced into one write', () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const handle = startAutosave(store);

    addComponent('Text');
    rename(selectedComponentId()!, 'One');
    rename(selectedComponentId()!, 'Two');
    expect(store.value).toBeUndefined();

    vi.advanceTimersByTime(500);
    expect(store.value).toBeDefined();
    expect(store.value).toContain('"Two"');

    handle.stop();
    vi.useRealTimers();
  });

  it('announces what it is doing, including failure', () => {
    vi.useFakeTimers();
    const failing: ProjectStore = {
      read: () => undefined,
      write: () => {
        throw new Error('quota exceeded');
      },
      clear: () => {},
    };

    const seen: string[] = [];
    const handle = startAutosave(failing);
    handle.subscribe((state) => seen.push(state));

    addComponent('Text');
    vi.advanceTimersByTime(500);

    // A browser refusing to store must not look like a saved project.
    expect(seen).toContain('saving');
    expect(seen).toContain('error');

    handle.stop();
    vi.useRealTimers();
  });

  it('stops writing once stopped', () => {
    vi.useFakeTimers();
    const store = memoryStore();
    startAutosave(store).stop();

    addComponent('Text');
    vi.advanceTimersByTime(500);
    expect(store.value).toBeUndefined();
    vi.useRealTimers();
  });
});

describe('opening and discarding', () => {
  it('opens a document with empty history, so undo cannot walk into someone else’s session', () => {
    const saved = createTrivialSnapshot();
    loadSnapshot(saved);
    expect(getState().snapshot).toEqual(saved);
    expect(getState().past).toHaveLength(0);
    expect(getState().activeArtboardId).toBe(saved.entryArtboard);
  });

  it('starting over clears the store as well as the editor', () => {
    const store = memoryStore(serializeSnapshot(createTrivialSnapshot()));
    clearProject(store);
    resetProject();
    expect(store.value).toBeUndefined();
    // Starting over lands where a new project lands: nothing drawn yet, not one empty screen
    // somebody has to delete (`docs/12-canvas.md` C0).
    expect(Object.keys(getState().snapshot.artboards)).toHaveLength(0);
  });
});
