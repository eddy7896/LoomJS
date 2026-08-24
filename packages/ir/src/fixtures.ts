import { newArtboardId, newComponentId, newProjectId } from './ids';
import { SCHEMA_VERSION, type Artboard, type Component, type Snapshot } from './schema';

/** An empty, valid project with no artboards. */
export function createEmptyProject(name: string): Snapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newProjectId(),
    name,
    artboards: {},
    components: {},
    nodes: {},
    wires: {},
    flows: {},
    connectors: {},
  };
}

/**
 * The trivial fixture: one Text component inside a root Frame on a single artboard.
 * This is the first thing the M0 compiler skeleton will emit into a running app.
 */
export function createTrivialSnapshot(): Snapshot {
  const rootId = newComponentId();
  const textId = newComponentId();
  const artboardId = newArtboardId();

  const root: Component = {
    id: rootId,
    type: 'Frame',
    name: 'Root',
    props: {},
    layout: { direction: 'column', gap: 16, padding: 24, align: 'stretch', justify: 'start' },
    children: [textId],
  };

  const text: Component = {
    id: textId,
    type: 'Text',
    name: 'Greeting',
    props: { content: { kind: 'static', value: 'Hello loomJS' } },
  };

  const home: Artboard = { id: artboardId, name: 'Home', root: rootId };

  return {
    ...createEmptyProject('Sample'),
    entryArtboard: artboardId,
    artboards: { [artboardId]: home },
    components: { [rootId]: root, [textId]: text },
  };
}
