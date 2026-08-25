import type { Id, Node, Port, TypeRef } from '@loom/ir';

/**
 * File nodes (N3, `docs/V1-COMPLETION.md` §10).
 *
 * Five bucket providers ship and the canvas could reach none of them. An upload field could put a
 * file somewhere and nothing could ever list it, delete it, or hand somebody a link — which is a
 * connector nobody has.
 *
 * These are **typed per operation**, the way a tool node is, rather than one `file` node with a
 * dropdown. A list answers with rows and a signed link answers with a URL; giving both the same
 * shape would mean every wire out of one carried `any`.
 */

const port = (
  id: string,
  name: string,
  direction: Port['direction'],
  type: TypeRef,
  portKind: Port['portKind'] = 'data',
): Port => ({ id, name, direction, portKind, type });

export interface FileOperation {
  id: string;
  label: string;
  /** What it says on the card and in the palette. */
  summary: string;
  ports: () => Port[];
}

/** The four things a project does to a file it did not just receive. */
export const FILE_OPERATIONS: Record<string, FileOperation> = {
  listFiles: {
    id: 'listFiles',
    label: 'List files',
    summary: 'What is in a bucket',
    ports: () => [
      port('pt_prefix', 'under', 'in', { kind: 'optional', of: { kind: 'text' } }),
      port('pt_files', 'files', 'out', { kind: 'list', of: { kind: 'record' } }),
    ],
  },
  deleteFile: {
    id: 'deleteFile',
    label: 'Delete file',
    summary: 'Remove one',
    ports: () => [
      port('pt_key', 'file', 'in', { kind: 'text' }),
      port('pt_done', 'done', 'out', { kind: 'boolean' }),
    ],
  },
  signUrl: {
    id: 'signUrl',
    label: 'Link to file',
    summary: 'A link that works for a while',
    ports: () => [
      port('pt_key', 'file', 'in', { kind: 'text' }),
      port('pt_url', 'link', 'out', { kind: 'text' }),
    ],
  },
  putFile: {
    id: 'putFile',
    label: 'Write file',
    summary: 'Put a file the server made into a bucket',
    ports: () => [
      port('pt_name', 'name', 'in', { kind: 'text' }),
      port('pt_body', 'contents', 'in', { kind: 'text' }),
      port('pt_file', 'file', 'out', { kind: 'record' }),
    ],
  },
};

export type FileOperationId = keyof typeof FILE_OPERATIONS;

export interface FileNodeConfig {
  /** The bucket connector this reaches. Named, never a credential. */
  bucketId: string;
  operationId: string;
  /** `listFiles` only: how many at most. */
  limit?: number;
  /** `signUrl` only: how long the link lasts. */
  seconds?: number;
}

export function fileNodePorts(operationId: string): Port[] {
  return FILE_OPERATIONS[operationId]?.ports() ?? [];
}

export function createFileNode(
  id: Id,
  position: { x: number; y: number },
  bucketId: string,
  operationId: string,
): Node {
  const operation = FILE_OPERATIONS[operationId];
  return {
    id,
    category: 'file',
    kind: operationId,
    name: operation?.label ?? operationId,
    ports: fileNodePorts(operationId),
    position,
    config: { bucketId, operationId } satisfies FileNodeConfig,
  };
}
