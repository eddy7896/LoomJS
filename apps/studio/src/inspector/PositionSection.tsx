import type { Component, Style } from '@loom/ir';
import { moveTo, setStyle } from '../state/store';
import { Cell, Choice, Glyph, Row, Section } from './Section';

/**
 * Position — where a thing sits, which way round it faces, and how it lines up with its parent
 * (`docs/13-inspector.md`).
 *
 * Only for a child of a **free** frame: in a frame that arranges its own children there is no
 * coordinate to edit, and offering one would be offering a lie. Alignment is the exception worth
 * noting — it is a one-off calculation here, not a rule that keeps holding, because a rule that
 * keeps holding is what auto layout is for.
 */

const ALIGN = [
  { at: 'left', title: 'Align left', path: 'M4 4v16M8 8h11M8 16h7' },
  { at: 'center-x', title: 'Align centre', path: 'M12 4v16M7 8h10M9 16h6' },
  { at: 'right', title: 'Align right', path: 'M20 4v16M5 8h11M9 16h7' },
  { at: 'top', title: 'Align top', path: 'M4 4h16M8 8v11M16 8v7' },
  { at: 'center-y', title: 'Align middle', path: 'M4 12h16M8 7v10M16 9v6' },
  { at: 'bottom', title: 'Align bottom', path: 'M4 20h16M8 5v11M16 9v7' },
] as const;

type Align = (typeof ALIGN)[number]['at'];

export function PositionSection({
  component,
  parent,
}: {
  component: Component;
  parent: Component | undefined;
}) {
  const free = parent?.layout?.mode === 'free';
  if (!free) return null;

  const position = component.position ?? { x: 0, y: 0 };
  const style = component.style ?? {};

  /**
   * Line this up against its parent's box.
   *
   * The parent's inner box is what a designer means by "the edge": padding is part of the frame,
   * not of the space inside it. The component's own size is only known once it is drawn, so it is
   * measured from the canvas rather than guessed from the document.
   */
  const align = (at: Align): void => {
    const node = document.querySelector<HTMLElement>(`[data-loom-id="${component.id}"]`);
    const parentNode = document.querySelector<HTMLElement>(`[data-loom-id="${parent.id}"]`);
    if (!node || !parentNode) return;

    // The zoom, read from the parent — an <svg> has no `offsetWidth` to divide by, so a shape
    // would have measured itself as NaN and aligned to nowhere.
    const parentBox = parentNode.getBoundingClientRect();
    const scale = parentBox.width / parentNode.offsetWidth || 1;
    const nodeBox = node.getBoundingClientRect();
    const box = { width: nodeBox.width / scale, height: nodeBox.height / scale };
    const padding = parent.layout?.padding ?? 0;
    const inner = {
      width: parentBox.width / scale - padding * 2,
      height: parentBox.height / scale - padding * 2,
    };

    const next = { ...position };
    if (at === 'left') next.x = padding;
    if (at === 'center-x') next.x = padding + (inner.width - box.width) / 2;
    if (at === 'right') next.x = padding + inner.width - box.width;
    if (at === 'top') next.y = padding;
    if (at === 'center-y') next.y = padding + (inner.height - box.height) / 2;
    if (at === 'bottom') next.y = padding + inner.height - box.height;
    moveTo(component.id, next);
  };

  const patch = (next: Partial<Style>): void => setStyle(component.id, next);

  return (
    <Section name="Position">
      <Row>
        {ALIGN.map((entry) => (
          <Choice
            key={entry.at}
            active={false}
            title={entry.title}
            testId={`align-${entry.at}`}
            onPick={() => align(entry.at)}
          >
            <Glyph path={entry.path} />
          </Choice>
        ))}
      </Row>

      <Row>
        <Cell mark="X" title="Distance from the left of the frame">
          <input
            type="number"
            data-testid="position-x"
            value={Math.round(position.x)}
            onChange={(e) => moveTo(component.id, { ...position, x: Number(e.target.value) })}
          />
        </Cell>
        <Cell mark="Y" title="Distance from the top of the frame">
          <input
            type="number"
            data-testid="position-y"
            value={Math.round(position.y)}
            onChange={(e) => moveTo(component.id, { ...position, y: Number(e.target.value) })}
          />
        </Cell>
      </Row>

      <Row>
        <Cell mark="∠" title="Rotation, in degrees">
          <input
            type="number"
            data-testid="rotation"
            value={style.rotation ?? 0}
            onChange={(e) => patch({ rotation: Number(e.target.value) || undefined })}
          />
        </Cell>
        <Choice
          active={Boolean(style.flipX)}
          title="Flip horizontally"
          testId="flip-x"
          onPick={() => patch({ flipX: style.flipX ? undefined : true })}
        >
          <Glyph path="M12 4v16M8 8L4 12l4 4M16 8l4 4-4 4" />
        </Choice>
        <Choice
          active={Boolean(style.flipY)}
          title="Flip vertically"
          testId="flip-y"
          onPick={() => patch({ flipY: style.flipY ? undefined : true })}
        >
          <Glyph path="M4 12h16M8 8l4-4 4 4M8 16l4 4 4-4" />
        </Choice>
      </Row>
    </Section>
  );
}
