import { beforeEach, describe, expect, it } from 'vitest';
import { compile } from '@loom/compiler';
import { newConnectorId } from '@loom/ir';
import {
  addComponent,
  dispatch,
  getState,
  rename,
  rootComponentId,
  selectComponent,
  selectedComponentId,
  undo,
} from '../src/state/store';
import { resetWithScreen } from './helpers';
import {
  acceptAuto,
  autoGroups,
  backendOffer,
  detachAuto,
  generateBackend,
  withdrawAuto,
} from '../src/state/autobackend';

const snapshot = () => getState().snapshot;
const root = () => rootComponentId(snapshot());

const TASKS = {
  name: 'tasks',
  columns: [
    { name: 'id', type: { kind: 'number' as const }, required: false, primaryKey: true, generated: true },
    { name: 'title', type: { kind: 'text' as const }, required: true, primaryKey: false, generated: false },
    { name: 'notes', type: { kind: 'text' as const }, required: false, primaryKey: false, generated: false },
  ],
};

function connectDatabase(): void {
  dispatch({
    type: 'addConnector',
    connector: {
      id: newConnectorId(),
      moduleId: 'supabase',
      config: { url: 'https://demo.supabase.co', schema: { tables: [TASKS] } },
      credentialRef: 'default',
    },
  });
}

/** Draw a form the way a designer would: a frame holding two fields and a button. */
function drawForm(): { frameId: string; titleId: string; buttonId: string } {
  selectComponent(root());
  addComponent('Frame');
  const frameId = selectedComponentId()!;

  selectComponent(frameId);
  addComponent('TextField');
  const titleId = selectedComponentId()!;
  rename(titleId, 'Title');

  selectComponent(frameId);
  addComponent('TextField');
  rename(selectedComponentId()!, 'Notes');

  selectComponent(frameId);
  addComponent('Button');
  const buttonId = selectedComponentId()!;

  return { frameId, titleId, buttonId };
}

beforeEach(() => {
  resetWithScreen();
});

describe('what the inspector may offer', () => {
  it('says what it would build when the form matches a table', () => {
    connectDatabase();
    const { frameId } = drawForm();

    expect(backendOffer(snapshot(), frameId)).toEqual({
      ok: true,
      table: 'tasks',
      fields: ['title', 'notes'],
      unmatched: [],
    });
  });

  it('explains itself instead of just refusing', () => {
    const { frameId } = drawForm();
    expect(backendOffer(snapshot(), frameId)).toEqual({
      ok: false,
      reason: 'Connect a database first.',
    });

    connectDatabase();
    selectComponent(frameId);
    addComponent('Button');
    expect(backendOffer(snapshot(), frameId)).toEqual({
      ok: false,
      reason: 'A form needs exactly one button, so loom knows which click submits.',
    });
  });
});

describe('generating a backend from the editor', () => {
  it('materialises the pipeline, shows it, and compiles', () => {
    connectDatabase();
    const { frameId } = drawForm();

    const result = generateBackend(frameId);
    expect(result.ok).toBe(true);

    // It says where it put the behaviour rather than leaving the designer to find it.
    expect(getState().mode).toBe('nodes');
    expect(getState().selection).toEqual({ kind: 'node', id: result.proposal!.nodes.route });

    const files = compile(snapshot()).files.map((file) => file.path);
    expect(files).toContain('api/createtasks.ts');
  });

  it('is one undo, not eleven', () => {
    connectDatabase();
    const { frameId } = drawForm();
    const before = Object.keys(snapshot().nodes).length;

    generateBackend(frameId);
    expect(Object.keys(snapshot().nodes).length).toBeGreaterThan(before);

    undo();
    expect(Object.keys(snapshot().nodes).length).toBe(before);
  });

  it('accept keeps the pipeline in sync; detach hands it over', () => {
    connectDatabase();
    const { frameId } = drawForm();
    const group = generateBackend(frameId).proposal!.group;

    expect(autoGroups(snapshot())[0]!.state).toBe('proposed');

    acceptAuto(group);
    expect(autoGroups(snapshot())[0]!.state).toBe('accepted');

    detachAuto(group);
    expect(autoGroups(snapshot())).toHaveLength(0);
    // The nodes are still there — detaching changes ownership, not the graph.
    expect(Object.values(snapshot().nodes).some((node) => node.category === 'api')).toBe(true);
  });

  it('discarding withdraws the whole proposal, including the button handler', () => {
    connectDatabase();
    const { frameId, buttonId } = drawForm();
    const group = generateBackend(frameId).proposal!.group;

    expect(snapshot().components[buttonId]!.props.onClick).toBeDefined();

    withdrawAuto(group);
    expect(Object.values(snapshot().nodes).some((node) => node.category === 'api')).toBe(false);
    expect(snapshot().components[buttonId]!.props.onClick).toBeUndefined();
    // A withdrawn proposal must leave a compilable document behind.
    expect(() => compile(snapshot())).not.toThrow();
  });
});
