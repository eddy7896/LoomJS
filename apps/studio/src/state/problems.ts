import type { Problem } from '@loom/compiler';
import { getState, select, setActiveArtboard, setMode } from './store';

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
