import type { Id, Node, Snapshot } from '@loom/ir';
import { analyzeForm, inferBackend, type InferenceProposal } from '@loom/inference';
import { dispatch, dispatchAll, getState, select, setMode } from './store';

/**
 * Auto-backend inference in the editor (M5).
 *
 * The document work all lives in `@loom/inference`; this file is the editor's side of it —
 * what the Inspector may offer, and what Accept/Detach do. Generating is one undoable step,
 * because a proposal a designer did not ask for should cost exactly one press to take back.
 */

export type BackendOffer =
  | { ok: true; table: string; fields: string[]; unmatched: string[] }
  | { ok: false; reason: string };

/** What inference would propose for this frame — the text the Inspector shows either way. */
export function backendOffer(snapshot: Snapshot, frameId: Id): BackendOffer {
  const analysis = analyzeForm(snapshot, frameId);
  if ('reason' in analysis) return { ok: false, reason: analysis.reason };
  return {
    ok: true,
    table: analysis.match.table.name,
    fields: analysis.match.fields.map((field) => field.name),
    unmatched: analysis.match.unmatched,
  };
}

export interface GenerateResult {
  ok: boolean;
  reason?: string;
  proposal?: InferenceProposal;
}

/**
 * Materialise the pipeline and show it. Landing the designer in Nodes mode on the new route is
 * the honest move: loom generated behaviour, so it says where it put it.
 */
export function generateBackend(frameId: Id): GenerateResult {
  const result = inferBackend(getState().snapshot, { frameId });
  if (!result.ok) return { ok: false, reason: result.reason };

  dispatchAll(result.proposal.ops);
  setMode('nodes');
  select({ kind: 'node', id: result.proposal.nodes.route });
  return { ok: true, proposal: result.proposal };
}

export interface AutoGroup {
  group: Id;
  state: 'proposed' | 'accepted';
  sourceId: Id | undefined;
  nodes: Node[];
}

/** AUTO groups present in the document, newest last. */
export function autoGroups(snapshot: Snapshot): AutoGroup[] {
  const groups = new Map<Id, AutoGroup>();
  for (const node of Object.values(snapshot.nodes)) {
    if (!node.auto) continue;
    const existing = groups.get(node.auto.group);
    if (existing) {
      existing.nodes.push(node);
      continue;
    }
    groups.set(node.auto.group, {
      group: node.auto.group,
      state: node.auto.state,
      sourceId: node.auto.sourceId,
      nodes: [node],
    });
  }
  return [...groups.values()];
}

/** Keep the pipeline as loom generated it. */
export function acceptAuto(group: Id): void {
  dispatch({ type: 'acceptAuto', group });
}

/** Take ownership: the nodes stay, the mark goes, inference never touches them again. */
export function detachAuto(group: Id): void {
  dispatch({ type: 'detachAuto', group });
}

/** Reject a proposal outright. */
export function withdrawAuto(group: Id): void {
  dispatch({ type: 'removeAuto', group });
  const selection = getState().selection;
  if (selection?.kind === 'node' && !getState().snapshot.nodes[selection.id]) select(undefined);
}
