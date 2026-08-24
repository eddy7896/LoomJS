import { describe, expect, it } from 'vitest';
import { compile } from '@loom/compiler';
import { ssoLabel } from '@loom/connectors';
import {
  __resetStore,
  addArtboard,
  addComponent,
  dispatch,
  getState,
  placeComponent,
} from '../src/state/store';

/**
 * Sign-in buttons from the palette (`docs/19-sign-in-elements.md`).
 *
 * The claim is that one arrives *already saying what it does* — label and action — and that it is
 * an ordinary Button underneath, so nothing downstream had to learn a new component type.
 */

const componentAt = (id: string) => getState().snapshot.components[id]!;

function screen(): string {
  __resetStore();
  const artboardId = addArtboard('Home');
  return getState().snapshot.artboards[artboardId]!.root;
}

describe('a sign-in button', () => {
  it('arrives labelled, and wired to the provider it names', () => {
    screen();
    addComponent('Button', { signInWith: 'google' });
    const button = componentAt(getState().selection!.id);

    expect(button.type).toBe('Button');
    expect(button.props.label).toEqual({ kind: 'static', value: 'Continue with Google' });
    expect(button.props.onClick).toEqual({
      kind: 'event',
      handler: { kind: 'actions', actions: [{ kind: 'signInWith', provider: 'google' }] },
    });
  });

  it('is an ordinary Button, so it compiles like one', () => {
    screen();
    // Signing people in needs a connection — the compiler says so, and this is a project that has
    // one. A project without one gets that refusal in Problems, which is the right place for it.
    dispatch({
      type: 'addConnector',
      connector: {
        id: 'cn_supabase',
        moduleId: 'supabase',
        config: { url: 'http://localhost:5412', schema: { tables: [] } },
        credentialRef: 'default',
      },
    });
    addComponent('Button', { signInWith: 'github' });

    const home = compile(getState().snapshot).files.find((file) =>
      file.path.startsWith('src/artboards/'),
    )!;
    expect(home.content).toContain('window.location.assign("/api/auth/start?provider="');
    expect(home.content).toContain('Continue with GitHub');

    // And the app gained the routes that flow needs.
    const paths = compile(getState().snapshot).files.map((file) => file.path);
    expect(paths).toContain('api/auth/start.ts');
    expect(paths).toContain('api/auth/callback.ts');
  });

  it('lands where it was dropped inside a free frame', () => {
    const root = screen();
    const id = placeComponent('Button', root, 0, {
      signInWith: 'apple',
      position: { x: 120, y: 64 },
    })!;

    expect(componentAt(id).position).toEqual({ x: 120, y: 64 });
    expect(componentAt(id).name).toBe(ssoLabel('apple'));
  });

  it('can be edited afterwards like anything else placed by hand', () => {
    screen();
    addComponent('Button', { signInWith: 'google' });
    const id = getState().selection!.id;

    // Nothing about it is locked: it carries no marker that only the palette understands.
    expect(Object.keys(componentAt(id))).not.toContain('signInWith');
    expect(componentAt(id).type).toBe('Button');
  });
});
