import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  SnapshotSchema,
  canOpenVersion,
  createTrivialSnapshot,
  deserializeSnapshot,
  migrateSnapshot,
  serializeSnapshot,
  type Snapshot,
} from '../src/index';

/**
 * The IR wave (`docs/V1-COMPLETION.md` §5): every shape the remaining phases need, landed in one
 * version bump rather than twenty.
 *
 * Two properties matter more than any individual field, and both are asserted here:
 *
 *  1. **Everything added is optional**, so a document written before the wave is still valid after
 *     it. That is what lets the migration be a stamp instead of a rewrite.
 *  2. **Everything added round-trips.** The snapshot is the save format and the compiler input at
 *     once, so a field that serializes and does not come back is data loss with extra steps.
 */

/** A snapshot carrying one of everything the wave added. */
function loaded(): Snapshot {
  const base = createTrivialSnapshot();
  const artboardId = Object.keys(base.artboards)[0]!;
  const artboard = base.artboards[artboardId]!;
  const rootId = artboard.root;

  return {
    ...base,
    roles: ['admin', 'teacher', 'parent'],
    tenancy: {
      orgTable: 'schools',
      membershipTable: 'school_members',
      tenantColumn: 'school_id',
      roleColumn: 'role',
    },
    definitions: {
      def_header: {
        id: 'def_header',
        name: 'Header',
        root: rootId,
        params: [{ name: 'title', type: { kind: 'text' } }],
      },
    },
    layouts: { lay_shell: { id: 'lay_shell', name: 'App shell', root: rootId } },
    artboards: {
      [artboardId]: {
        ...artboard,
        kind: 'document',
        page: { preset: 'a4', width: 210, height: 297, orientation: 'portrait', margin: 12 },
        layoutId: 'lay_shell',
        public: true,
        meta: {
          title: 'Invoice',
          description: 'What is owed',
          image: 'https://example.com/og.png',
        },
        guard: { redirectTo: artboardId, requireRole: ['admin'] },
      },
    },
    components: {
      ...base.components,
      [rootId]: {
        ...base.components[rootId]!,
        style: {
          background: { kind: 'token', token: 'color.surface' },
          responsive: { sm: { background: { kind: 'token', token: 'color.panel' } } },
        },
        layout: {
          direction: 'row',
          gap: 16,
          padding: 16,
          align: 'stretch',
          justify: 'start',
          responsive: { sm: { direction: 'column', gap: 8 } },
        },
      },
    },
  };
}

describe('the IR wave round-trips', () => {
  it('accepts a snapshot carrying one of everything it added', () => {
    expect(() => SnapshotSchema.parse(loaded())).not.toThrow();
  });

  it('brings every new field back through serialize and parse', () => {
    const before = loaded();
    const after = deserializeSnapshot(serializeSnapshot(before));
    expect(after).toEqual(before);
  });

  it('leaves a document that uses none of it exactly as it was', () => {
    const plain = createTrivialSnapshot();
    expect(deserializeSnapshot(serializeSnapshot(plain))).toEqual(plain);
  });
});

describe('a version-1 document still opens', () => {
  /**
   * The half of P0's promise that had never run. There was only ever one version, so the guard
   * could only refuse; this is the first bump, and refusing here would throw away every project
   * anyone had saved — for a change that added nothing but optional fields.
   */
  it('carries a version-1 document forward by stamping it', () => {
    const v1 = { ...createTrivialSnapshot(), schemaVersion: 1 };
    const migrated = migrateSnapshot(v1) as Snapshot;

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    // A stamp, and nothing else: no invented defaults, no moved data.
    expect({ ...migrated, schemaVersion: 1 }).toEqual(v1);
    expect(() => SnapshotSchema.parse(migrated)).not.toThrow();
  });

  it('opens one through the ordinary deserialize path', () => {
    const v1 = JSON.stringify({ ...createTrivialSnapshot(), schemaVersion: 1 });
    expect(deserializeSnapshot(v1).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('knows which versions it can open, and refuses the rest by name', () => {
    expect(canOpenVersion(1)).toBe(true);
    expect(canOpenVersion(2)).toBe(true);
    // A document from a *newer* build. Nothing here can carry it back, and guessing would be the
    // half-loaded project P0 refused for.
    expect(canOpenVersion(3)).toBe(false);
    expect(canOpenVersion(undefined)).toBe(false);
  });

  it('leaves a document it does not recognise alone, rather than guessing', () => {
    const alien = { schemaVersion: 99, name: 'From the future' };
    expect(migrateSnapshot(alien)).toBe(alien);
    expect(migrateSnapshot(null)).toBe(null);
  });
});
