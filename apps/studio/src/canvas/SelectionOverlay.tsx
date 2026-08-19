import { useLayoutEffect, useState } from 'react';
import type { Id } from '@loom/ir';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Props {
  target: HTMLElement | null | undefined;
  container: HTMLElement | null;
  /** Any value whose change should re-measure (zoom, pan, document version). */
  deps: unknown;
  label: string;
  variant: 'selected' | 'hovered';
  /** Canvas zoom: rects are measured in screen px and divided back into layer px. */
  scale: number;
  id: Id;
}

/**
 * The selection chrome floats above the artboard rather than styling the component itself —
 * a border on the real node would change its layout and lie about what the app looks like.
 */
export function SelectionOverlay({ target, container, deps, label, variant, scale }: Props) {
  const [rect, setRect] = useState<Rect | undefined>();

  useLayoutEffect(() => {
    if (!target || !container) {
      setRect(undefined);
      return;
    }
    const measure = (): void => {
      const box = target.getBoundingClientRect();
      const base = container.getBoundingClientRect();
      setRect({
        left: (box.left - base.left) / scale,
        top: (box.top - base.top) / scale,
        width: box.width / scale,
        height: box.height / scale,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    observer.observe(container);
    return () => observer.disconnect();
  }, [target, container, deps, scale]);

  if (!rect) return null;

  const selected = variant === 'selected';

  return (
    <div
      className={`overlay overlay--${variant}`}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {selected ? <span className="overlay__label">{label}</span> : null}
    </div>
  );
}
