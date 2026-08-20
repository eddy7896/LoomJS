import { nanoid } from 'nanoid';

/**
 * Stable ids. Every entity carries a generated id (never positional), so atomic ops,
 * undo/redo, and a future semantic branch/merge all stay cheap (docs/02, docs/03).
 *
 * Ids are prefixed for readability in the snapshot JSON: `cp_V1StGXR8_Z`.
 */

export type IdPrefix = 'pj' | 'ab' | 'cp' | 'nd' | 'wr' | 'fl' | 'pt' | 'cn' | 'au';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${nanoid(10)}`;
}

export const newProjectId = (): string => newId('pj');
export const newArtboardId = (): string => newId('ab');
export const newComponentId = (): string => newId('cp');
export const newNodeId = (): string => newId('nd');
export const newWireId = (): string => newId('wr');
export const newFlowId = (): string => newId('fl');
export const newPortId = (): string => newId('pt');
export const newConnectorId = (): string => newId('cn');
/** One id per inference run; every AUTO node and wire it produces shares it. */
export const newAutoGroupId = (): string => newId('au');
