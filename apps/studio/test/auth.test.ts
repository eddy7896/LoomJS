import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetStore,
  addArtboard,
  addComponent,
  getState,
  rootComponentId,
  selectComponent,
  selectedComponentId,
  setArtboardGuard,
} from '../src/state/store';
import { addGraphNode } from '../src/state/graph';
import { actionsFor, addAction, variableChoices } from '../src/state/actions';

/**
 * App auth through the editor's own calls (P5, `docs/specs/app-auth.md`).
 *
 * The editor's job here is the same as everywhere else: offer only what works, and produce a step
 * that already means something the moment it appears.
 */

const snapshot = () => getState().snapshot;
const root = () => rootComponentId(snapshot());

function place(type: string): string {
  selectComponent(root());
  addComponent(type);
  return selectedComponentId()!;
}

describe('a sign-in step arrives already wired', () => {
  beforeEach(() => __resetStore());

  it('guesses the two fields on the screen, because that is what a sign-in form is', () => {
    const email = place('TextField');
    const password = place('TextField');
    const button = place('Button');

    addAction(button, 'signIn');
    const [step] = actionsFor(snapshot(), button);
    expect(step?.kind).toBe('signIn');
    if (step?.kind !== 'signIn') throw new Error('not a sign-in');

    // Each value is bound through the field's mirror, which the pick materialised.
    for (const [value, componentId] of [
      [step.email, email],
      [step.password, password],
    ] as const) {
      expect(value.kind).toBe('bound');
      if (value.kind !== 'bound') continue;
      expect(snapshot().nodes[value.source.nodeId]?.mirrorOf).toBe(componentId);
    }
  });

  it('falls back to something typed when the screen has no fields yet', () => {
    const button = place('Button');
    addAction(button, 'signIn');
    const [step] = actionsFor(snapshot(), button);
    if (step?.kind !== 'signIn') throw new Error('not a sign-in');
    expect(step.email).toEqual({ kind: 'static', value: '' });
  });

  it('signs out with nothing to configure', () => {
    const button = place('Button');
    addAction(button, 'signOut');
    expect(actionsFor(snapshot(), button)).toEqual([{ kind: 'signOut' }]);
  });
});

describe('the current user is not a variable', () => {
  beforeEach(() => __resetStore());

  it('is never offered as something to set', () => {
    // It is app state, and it is nobody's to write: signing in is what writes it.
    addGraphNode('state', 'currentUser');
    const variable = addGraphNode('state', 'write');
    expect(variableChoices(snapshot()).map((choice) => choice.value)).toEqual([variable]);
  });
});

describe('who can open a screen', () => {
  beforeEach(() => __resetStore());

  it('keeps the guard as the absence of a key when anyone may open it', () => {
    const second = addArtboard();
    setArtboardGuard(second, { redirectTo: rootArtboard() });
    expect(snapshot().artboards[second]?.guard).toEqual({ redirectTo: rootArtboard() });

    setArtboardGuard(second, undefined);
    expect(snapshot().artboards[second]).not.toHaveProperty('guard');
  });
});

function rootArtboard(): string {
  return Object.keys(getState().snapshot.artboards)[0]!;
}
