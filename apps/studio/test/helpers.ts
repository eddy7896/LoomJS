import { __resetStore, addArtboard } from '../src/state/store';

/**
 * A fresh project with one screen on it.
 *
 * A new project is **empty** — not one empty screen, but nothing at all (`docs/12-canvas.md` C0)
 * — so a test about anything else makes a screen first, exactly as a designer would. The tests
 * that are about the empty project itself call `__resetStore` directly.
 */
export function resetWithScreen(): string {
  __resetStore();
  return addArtboard('Home');
}
