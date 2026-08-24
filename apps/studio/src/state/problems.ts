import type { Problem } from '@loom/compiler';
import { getState, select, selectComponent, setActiveArtboard, setMode } from './store';

/**
 * Revealing a problem (P2, `docs/specs/problems.md`).
 *
 * Selecting the entity is the entire interaction. Nothing is auto-fixed: a panel that edited the
 * document on click would be guessing at intent, and the fix for "nothing is wired into input 2"
 * is a decision, not a default.
 */
export function revealProblem(problem: Problem): void {
  const { entityId, entityKind } = problem;
  if (!entityId || !entityKind) return;

  const snapshot = getState().snapshot;

  if (entityKind === 'artboard') {
    if (snapshot.artboards[entityId]) setActiveArtboard(entityId);
    return;
  }

  if (entityKind === 'component') {
    if (!snapshot.components[entityId]) return;
    // The screen first: selecting a component on a screen you are not looking at selects
    // something invisible, which reads as the click having done nothing.
    if (problem.artboardId && problem.artboardId !== getState().activeArtboardId) {
      setActiveArtboard(problem.artboardId);
    }
    setMode('design');
    select({ kind: 'component', id: entityId });
    return;
  }

  if (!snapshot.nodes[entityId]) return;
  setMode('nodes');
  select({ kind: 'node', id: entityId });
}

/**
 * Show whatever this id belongs to, whichever kind of thing it is.
 *
 * A compile refusal carries an entity id and not its kind, because the compiler does not care —
 * so the lookup happens here rather than making every caller guess. Used by the Code panel, where
 * a refusal appears in the place someone came to read the code.
 */
export function revealEntity(entityId: string): void {
  const snapshot = getState().snapshot;

  if (snapshot.artboards[entityId]) {
    setActiveArtboard(entityId);
    return;
  }
  if (snapshot.components[entityId]) {
    selectComponent(entityId);
    return;
  }
  if (snapshot.nodes[entityId]) select({ kind: 'node', id: entityId });
}
