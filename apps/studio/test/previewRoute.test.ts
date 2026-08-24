import { describe, expect, it } from 'vitest';
import { navigablePath, previewRoute } from '../src/preview/route';
import { __resetStore, addArtboard, getState, setArtboardParams } from '../src/state/store';

/**
 * Where the Preview points (`docs/12-canvas.md`).
 *
 * The rule these check is the one the bug broke: the entry screen is at `/` and every other screen
 * is somewhere else, so a Preview that only ever loads `/` can show exactly one of them.
 */
describe('previewRoute', () => {
  it('puts the entry screen at the root and the rest at their own paths', () => {
    __resetStore();
    const home = addArtboard('Home');
    const second = addArtboard('Checkout');

    const snapshot = getState().snapshot;
    expect(previewRoute(snapshot, home)?.path).toBe('/');
    expect(previewRoute(snapshot, second)?.path).toBe('/checkout');
  });

  it('has nowhere honest to send a screen that takes params', () => {
    __resetStore();
    addArtboard('Home');
    const order = addArtboard('Order');
    setArtboardParams(order, [{ name: 'id', type: { kind: 'text' } }]);

    const route = previewRoute(getState().snapshot, order);
    expect(route?.params).toEqual(['id']);
    // The screen is reachable through the app, from whatever supplies the id. Jumping straight to
    // it would render it against a record that does not exist.
    expect(navigablePath(route)).toBeUndefined();
  });

  it('gives no answer for a screen that is not there', () => {
    __resetStore();
    addArtboard('Home');
    expect(previewRoute(getState().snapshot, 'ab_missing')).toBeUndefined();
  });
});
