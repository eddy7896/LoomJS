import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node as FlowNode,
  type NodeProps,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Node, Port } from '@loom/ir';
import { mirrorPortsFor, nodeTitle } from '@loom/components';
import { formatType } from '@loom/typesys';
import { useEditor } from '../state/useEditor';
import { select } from '../state/store';
import {
  groupNodes,
  removeNodeGroup,
  renameNodeGroup,
  connect,
  ensureMirror,
  graphNodesFor,
  mirrorableComponents,
  moveNode,
  removeWire,
} from '../state/graph';

/**
 * Nodes mode: the behaviour canvas. The artboard owns what exists and how it looks; this canvas
 * owns what it *does* (guardrail 13). UI components appear here as **mirrors** — a view of the
 * component, never a second copy — and are materialised into the document on the first wire.
 */

interface LoomNodeData extends Record<string, unknown> {
  node: Node;
  subtitle: string;
  body: Node[];
}

const PORT_STYLE = { width: 10, height: 10 };

function PortRow({ port, side }: { port: Port; side: 'in' | 'out' }) {
  return (
    <div className={`nport nport--${side}`}>
      <Handle
        id={port.id}
        type={side === 'in' ? 'target' : 'source'}
        position={side === 'in' ? Position.Left : Position.Right}
        style={PORT_STYLE}
        className={`nhandle nhandle--${port.portKind}`}
      />
      <span className="nport__name">{port.name}</span>
      <span className="nport__type mono">{formatType(port.type)}</span>
    </div>
  );
}

function LoomNode({ data, selected }: NodeProps) {
  const { node, subtitle, body } = data as LoomNodeData;
  const inputs = node.ports.filter((port) => port.direction === 'in');
  const outputs = node.ports.filter((port) => port.direction === 'out');

  return (
    <div
      className={`nnode nnode--${node.category} ${selected ? 'is-selected' : ''} ${
        node.auto ? `is-auto is-auto--${node.auto.state}` : ''
      }`}
      data-auto={node.auto?.state}
    >
      <header className="nnode__head">
        <span className="nnode__title">{nodeTitle(node)}</span>
        {/* AUTO is drawn, not hidden: a node loom wrote should say so on the canvas. */}
        {node.auto ? <span className="badge badge--auto">AUTO</span> : null}
        <span className="nnode__kind mono">{subtitle}</span>
      </header>

      {body.length > 0 ? (
        <div className="nnode__body">
          <span className="nnode__body-label">runs on the server</span>
          {body.map((step, index) => (
            <button
              key={step.id}
              // A step is coloured by what it *is*, so a route's body reads at a glance: a
              // database read, a tool call and a computation are three different kinds of work
              // and should not look alike (T2, `docs/22-api-connectors.md`).
              className={`nstep nstep--${step.category}`}
              data-testid={`nstep-${step.category}`}
              onClick={(event) => {
                event.stopPropagation();
                select({ kind: 'node', id: step.id });
              }}
            >
              <span className="nstep__index mono">{index + 1}</span>
              <span>{step.name ?? step.kind}</span>
              <span className="nstep__op mono">
                {/* What it does, in its own words: an operation for a tool, an op for a
                    computation, the table for a database step. */}
                {String(
                  (step.config as { operationId?: string; table?: string; op?: string } | undefined)
                    ?.operationId ??
                    (step.config as { table?: string } | undefined)?.table ??
                    (step.config as { op?: string } | undefined)?.op ??
                    step.kind,
                )}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="nnode__ports">
        <div>
          {inputs.map((port) => (
            <PortRow key={port.id} port={port} side="in" />
          ))}
        </div>
        <div>
          {outputs.map((port) => (
            <PortRow key={port.id} port={port} side="out" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A named box drawn behind some nodes (G2, `docs/16-grouping.md`).
 *
 * It is how the graph is *read* — "these four are the sign-up flow" — and nothing else. What
 * groups nodes for execution is an API route's body, and this is deliberately not that: a box
 * that quietly changed what ran would be two ideas wearing one shape.
 *
 * The box has `pointer-events: none` over its middle, so the nodes inside stay clickable and the
 * only things you can grab are its title and its ×.
 */
function GroupBox({ data }: { data: GroupBoxData }) {
  return (
    <div className="ngroup" style={{ width: data.width, height: data.height }}>
      <div className="ngroup__head">
        <input
          className="ngroup__title"
          data-testid={`group-title-${data.id}`}
          value={data.title}
          onChange={(event) => renameNodeGroup(data.id, event.target.value)}
        />
        <button
          className="ngroup__remove"
          data-testid={`ungroup-${data.id}`}
          title="Remove this box, keeping the nodes"
          onClick={() => removeNodeGroup(data.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
}

interface GroupBoxData {
  id: string;
  title: string;
  width: number;
  height: number;
}

const nodeTypes = { loom: LoomNode, ngroup: GroupBox };

/** Room for the title bar above the topmost node, and a margin around the rest. */
const GROUP_PADDING = 24;
const GROUP_HEADER = 34;

/** A node's size on the canvas, near enough to draw a box around it. */
const NODE_WIDTH = 210;
const NODE_HEIGHT = 90;

export function NodesCanvas() {
  const snapshot = useEditor((s) => s.snapshot);
  const selection = useEditor((s) => s.selection);
  const activeArtboardId = useEditor((s) => s.activeArtboardId);
  const [problem, setProblem] = useState<string | undefined>();
  // React Flow owns the multiple selection here — it already has the shift-drag box — so what is
  // kept is only which ids it reported.
  const [picked, setPicked] = useState<string[]>([]);

  // Components that could be mirrored but have not been wired yet still need somewhere to sit.
  const pendingMirrors = useMemo(() => {
    const materialised = new Set(
      Object.values(snapshot.nodes)
        .filter((node) => node.category === 'ui')
        .map((node) => node.mirrorOf),
    );
    return mirrorableComponents(snapshot, activeArtboardId).filter((id) => !materialised.has(id));
  }, [snapshot, activeArtboardId]);

  const bodyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of Object.values(snapshot.nodes)) {
      for (const id of ((node.config ?? {}) as { body?: string[] }).body ?? []) ids.add(id);
    }
    return ids;
  }, [snapshot.nodes]);

  /**
   * One box per group, sized from where its members currently sit.
   *
   * Computed rather than stored: a stored box would drift the moment a node inside it moved, and
   * a box that no longer contains what it claims to is worse than no box.
   */
  const groupBoxes: FlowNode[] = useMemo(() => {
    const boxes: FlowNode[] = [];

    for (const group of Object.values(snapshot.nodeGroups ?? {})) {
      const members = group.nodeIds
        .map((id) => snapshot.nodes[id])
        .filter((node): node is Node => Boolean(node) && !bodyIds.has(node!.id));
      if (members.length === 0) continue;

      const left = Math.min(...members.map((node) => node.position.x));
      const top = Math.min(...members.map((node) => node.position.y));
      const right = Math.max(...members.map((node) => node.position.x + NODE_WIDTH));
      const bottom = Math.max(...members.map((node) => node.position.y + NODE_HEIGHT));

      boxes.push({
        id: `group:${group.id}`,
        type: 'ngroup',
        draggable: false,
        selectable: false,
        // Behind everything: React Flow paints in order, and a box over its own nodes would
        // swallow every click meant for them.
        zIndex: -1,
        position: { x: left - GROUP_PADDING, y: top - GROUP_PADDING - GROUP_HEADER },
        data: {
          id: group.id,
          title: group.title,
          width: right - left + GROUP_PADDING * 2,
          height: bottom - top + GROUP_PADDING * 2 + GROUP_HEADER,
        } satisfies GroupBoxData,
      } as FlowNode);
    }

    return boxes;
  }, [snapshot.nodeGroups, snapshot.nodes, bodyIds]);

  const flowNodes: FlowNode[] = useMemo(() => {
    const graphNodes = graphNodesFor(snapshot, activeArtboardId)
      // Body steps are drawn inside their container, not as free-floating nodes.
      .filter((node) => !bodyIds.has(node.id));

    const real = graphNodes.map((node) => ({
      id: node.id,
      type: 'loom',
      position: node.position,
      selected: selection?.kind === 'node' && selection.id === node.id,
      data: {
        node,
        subtitle: node.mirrorOf ? 'mirror' : `${node.category}:${node.kind}`,
        body: (((node.config ?? {}) as { body?: string[] }).body ?? [])
          .map((id) => snapshot.nodes[id])
          .filter((step): step is Node => Boolean(step)),
      } satisfies LoomNodeData,
    }));

    // Position by the component's index on the artboard, not by index among the pending ones,
    // so a mirror does not slide upward when a sibling is wired.
    const order = mirrorableComponents(snapshot, activeArtboardId);
    const pending = pendingMirrors.map((componentId) => {
      const index = Math.max(0, order.indexOf(componentId));
      const component = snapshot.components[componentId]!;
      return {
        id: `pending:${componentId}`,
        type: 'loom',
        position: { x: 24, y: 24 + index * 130 },
        data: {
          node: {
            id: `pending:${componentId}`,
            category: 'ui' as const,
            kind: 'mirror',
            name: component.name ?? component.type,
            mirrorOf: componentId,
            ports: mirrorPortsFor(component),
            position: { x: 0, y: 0 },
          },
          subtitle: 'mirror',
          body: [],
        } satisfies LoomNodeData,
      };
    });

    return [...pending, ...real];
  }, [snapshot, activeArtboardId, selection, pendingMirrors, bodyIds]);

  const edges: Edge[] = useMemo(
    () =>
      Object.values(snapshot.wires).map((wire) => ({
        id: wire.id,
        source: wire.from.nodeId,
        sourceHandle: wire.from.portId,
        target: wire.to.nodeId,
        targetHandle: wire.to.portId,
        selected: selection?.kind === 'wire' && selection.id === wire.id,
        className: 'nedge',
      })),
    [snapshot.wires, selection],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setProblem(undefined);
      // A pending mirror becomes a real node the moment it is wired — in place, so wiring one
      // never shuffles the canvas under the pointer.
      const resolve = (id: string): string | undefined => {
        if (!id.startsWith('pending:')) return id;
        const at = flowNodes.find((node) => node.id === id)?.position ?? { x: 24, y: 24 };
        return ensureMirror(id.slice('pending:'.length), at);
      };

      const source = resolve(connection.source);
      const target = resolve(connection.target);
      if (!source || !target || !connection.sourceHandle || !connection.targetHandle) return;

      const result = connect(
        { nodeId: source, portId: connection.sourceHandle },
        { nodeId: target, portId: connection.targetHandle },
      );
      if (!result.ok) setProblem(result.reason);
    },
    [flowNodes],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position && !change.id.startsWith('pending:')) {
        moveNode(change.id, change.position);
      }
    }
  }, []);

  return (
    <div className="nodes-canvas">
      {picked.length > 1 ? (
        <button className="nodes-canvas__group" data-testid="group-nodes" onClick={() => {
          groupNodes(picked);
          setPicked([]);
        }}>
          Group {picked.length} nodes
        </button>
      ) : null}

      <ReactFlow
        nodes={[...groupBoxes, ...flowNodes]}
        edges={edges}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) =>
          node.id.startsWith('pending:')
            ? select({ kind: 'component', id: node.id.slice('pending:'.length) })
            : select({ kind: 'node', id: node.id })
        }
        onSelectionChange={({ nodes: selectedNodes }) =>
          setPicked(
            selectedNodes
              .filter((node) => node.type === 'loom' && !node.id.startsWith('pending:'))
              .map((node) => node.id),
          )
        }
        onEdgeClick={(_, edge) => select({ kind: 'wire', id: edge.id })}
        onEdgesDelete={(deleted) => deleted.forEach((edge) => removeWire(edge.id))}
        onPaneClick={() => {
          select(undefined);
          setProblem(undefined);
        }}
        // Shift-drag draws a selection box, which is what makes grouping possible at all.
        selectionOnDrag
        panOnDrag={[1, 2]}
        fitView
        // React Flow stops zooming out at 0.5 by default, which is not far enough to fit a
        // pipeline and its mirrors into the pane while the Preview is open — "Fit view" would
        // quietly leave nodes off screen.
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {problem ? (
        <div className="problem" role="alert">
          {problem}
        </div>
      ) : null}
    </div>
  );
}
