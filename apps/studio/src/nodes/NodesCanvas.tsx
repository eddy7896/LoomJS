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
              className="nstep"
              onClick={(event) => {
                event.stopPropagation();
                select({ kind: 'node', id: step.id });
              }}
            >
              <span className="nstep__index mono">{index + 1}</span>
              <span>{step.name ?? step.kind}</span>
              <span className="nstep__op mono">
                {String((step.config as { op?: string } | undefined)?.op ?? step.kind)}
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

const nodeTypes = { loom: LoomNode };

export function NodesCanvas() {
  const snapshot = useEditor((s) => s.snapshot);
  const selection = useEditor((s) => s.selection);
  const activeArtboardId = useEditor((s) => s.activeArtboardId);
  const [problem, setProblem] = useState<string | undefined>();

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
            ports: mirrorPortsFor(component.type),
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
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) =>
          node.id.startsWith('pending:')
            ? select({ kind: 'component', id: node.id.slice('pending:'.length) })
            : select({ kind: 'node', id: node.id })
        }
        onEdgeClick={(_, edge) => select({ kind: 'wire', id: edge.id })}
        onEdgesDelete={(deleted) => deleted.forEach((edge) => removeWire(edge.id))}
        onPaneClick={() => {
          select(undefined);
          setProblem(undefined);
        }}
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
