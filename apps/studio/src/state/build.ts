import { useSyncExternalStore } from 'react';
import type { BuildFailure } from '@loom/compiler';

/**
 * The last thing the compiler said, shared between the Preview and the Problems panel.
 *
 * Both want the same answer, and emission is not cheap. Compiling twice per keystroke — once to
 * update the Preview, once to fill one row in a list — is a cost with nothing behind it, so the
 * Preview's compile is the only one and this is where its verdict lands.
 *
 * `undefined` means nothing has compiled yet (the Preview is closed, or the first run is still in
 * flight); `null` means it compiled clean. The two are different facts and the panel treats them
 * differently: no Build row either way, but only `undefined` means "not known".
 */

let current: BuildFailure | null | undefined;
const listeners = new Set<() => void>();

export function setBuildResult(next: BuildFailure | null): void {
  // Same verdict twice is not a change; re-notifying would re-render the panel on every keystroke
  // of a project that is building fine.
  const same =
    current === next ||
    (current != null &&
      next != null &&
      current.message === next.message &&
      current.entityId === next.entityId);
  if (same) return;

  current = next;
  for (const listener of listeners) listener();
}

export function useBuildResult(): BuildFailure | null | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

/** Tests and `New` start from a blank slate; a stale verdict would outlive the document. */
export function __resetBuildResult(): void {
  current = undefined;
  for (const listener of listeners) listener();
}
