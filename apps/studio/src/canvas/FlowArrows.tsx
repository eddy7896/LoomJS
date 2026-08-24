import type { Id, Snapshot } from '@loom/ir';

export interface ArtboardBox {
  id: Id;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  snapshot: Snapshot;
  boxes: Map<Id, ArtboardBox>;
  selectedFlowId: Id | undefined;
  onSelect: (flowId: Id) => void;
}

/**
 * Flow arrows between artboards — the router, drawn (docs/02 "flow arrows as router"). The
 * arrow is the navigation: it exists because a component's click points at another artboard,
 * and the compiler turns it into a react-router route.
 */
export function FlowArrows({ snapshot, boxes, selectedFlowId, onSelect }: Props) {
  const flows = Object.values(snapshot.flows).filter(
    (flow) => boxes.has(flow.from) && boxes.has(flow.to),
  );
  if (flows.length === 0) return null;

  return (
    <svg className="flow-layer" aria-hidden={false}>
      <defs>
        <marker
          id="loom-arrowhead"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>

      {flows.map((flow) => {
        const from = boxes.get(flow.from)!;
        const to = boxes.get(flow.to)!;

        // Leave from the right edge into the left edge when the target is to the right,
        // and mirror it otherwise, so the arrow never crosses its own artboard.
        const rightwards = to.x >= from.x;
        const start = {
          x: rightwards ? from.x + from.width : from.x,
          y: from.y + from.height / 2,
        };
        const end = { x: rightwards ? to.x : to.x + to.width, y: to.y + to.height / 2 };
        const bend = Math.max(48, Math.abs(end.x - start.x) / 2);
        const path = `M ${start.x} ${start.y} C ${start.x + (rightwards ? bend : -bend)} ${start.y}, ${
          end.x - (rightwards ? bend : -bend)
        } ${end.y}, ${end.x} ${end.y}`;

        const label = (flow.payload ?? []).map((p) => p.param).join(', ');
        const selected = selectedFlowId === flow.id;

        return (
          <g
            key={flow.id}
            className={`flow ${selected ? 'is-selected' : ''}`}
            onClick={() => onSelect(flow.id)}
          >
            <path className="flow__hit" d={path} />
            <path className="flow__line" d={path} markerEnd="url(#loom-arrowhead)" />
            {label ? (
              <text className="flow__label" x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 8}>
                {label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
