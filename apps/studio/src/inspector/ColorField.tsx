import { useEffect, useRef, useState } from 'react';
import type { StyleValue } from '@loom/ir';
import { tokensIn } from '@loom/ui';
import { useEditor } from '../state/useEditor';

/**
 * Choosing a colour (`docs/13-inspector.md`).
 *
 * **The system comes first and stays first.** The swatches at the top of this popover are the
 * project's own decisions, and picking one writes a *reference* — move the token later and every
 * surface built on it moves. That is still the thing worth defending.
 *
 * Under them is a picker, because a designer composing a screen needs a colour before they know
 * whether it deserves a name, and a tool that refuses until they decide is a tool they fight. A
 * custom colour is stored as a literal, which is exactly what it is: a value nothing else follows.
 */

const RECENT_KEY = 'loom.colors.recent';

function loadRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, 8) : [];
  } catch {
    return [];
  }
}

function remember(color: string): string[] {
  const next = [color, ...loadRecent().filter((entry) => entry !== color)].slice(0, 8);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* a convenience, not a requirement */
  }
  return next;
}

/** `rgb(27 29 33 / 40%)` is not something `<input type="color">` can hold; `#1b1d21` is. */
function hexOf(value: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) return '#000000';
  const body = hex[1]!;
  return body.length === 3
    ? `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
    : `#${body}`;
}

export function swatchOf(
  value: StyleValue | undefined,
  overrides: Record<string, string> | undefined,
): string {
  if (!value) return 'transparent';
  if (value.kind === 'literal') return value.value;
  return (
    overrides?.[value.token] ??
    tokensIn('color').find((entry) => entry.id === value.token)?.value ??
    'transparent'
  );
}

export function ColorField({
  value,
  onChange,
  testId,
  label,
}: {
  value: StyleValue | undefined;
  onChange: (next: StyleValue | undefined) => void;
  testId: string;
  label: string;
}) {
  const theme = useEditor((s) => s.snapshot.theme);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const box = useRef<HTMLDivElement | null>(null);

  // Clicking away closes it, the way every picker in every tool does.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const custom = value?.kind === 'literal';
  const shown = swatchOf(value, theme);

  const pickCustom = (color: string): void => {
    onChange({ kind: 'literal', value: color });
    setRecent(remember(color));
  };

  return (
    <div className="ins__color" ref={box}>
      <button
        className="ins__swatch"
        style={{ backgroundColor: shown }}
        title={`${label} — ${custom ? value.value : (value?.token ?? 'none')}`}
        aria-label={label}
        data-testid={`${testId}-swatch`}
        onClick={() => setOpen((value_) => !value_)}
      />
      <button
        className="ins__value mono"
        data-testid={`${testId}-value`}
        onClick={() => setOpen((value_) => !value_)}
      >
        {custom ? value.value : value ? tokenLabel(value.token) : '—'}
      </button>
      {value ? (
        <button
          className="ins__icon"
          title="Remove"
          aria-label={`Remove ${label}`}
          data-testid={`${testId}-clear`}
          onClick={() => onChange(undefined)}
        >
          −
        </button>
      ) : null}

      {open ? (
        <div className="picker" data-testid={`${testId}-picker`}>
          <div className="picker__group">
            <span className="picker__label">From the system</span>
            <div className="picker__swatches">
              {tokensIn('color').map((token) => (
                <button
                  key={token.id}
                  className={`picker__swatch ${
                    value?.kind === 'token' && value.token === token.id ? 'is-active' : ''
                  }`}
                  style={{ backgroundColor: theme?.[token.id] ?? token.value }}
                  title={token.label}
                  aria-label={token.label}
                  data-testid={`${testId}-token-${token.id}`}
                  onClick={() => {
                    onChange({ kind: 'token', token: token.id });
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          </div>

          <div className="picker__group">
            <span className="picker__label">Custom</span>
            <div className="picker__row">
              <input
                type="color"
                className="picker__wheel"
                data-testid={`${testId}-picker-input`}
                value={hexOf(custom ? value.value : shown)}
                onChange={(event) => pickCustom(event.target.value)}
              />
              <input
                className="mono picker__hex"
                data-testid={`${testId}-hex`}
                value={custom ? value.value : hexOf(shown)}
                spellCheck={false}
                onChange={(event) => onChange({ kind: 'literal', value: event.target.value })}
                onBlur={(event) => setRecent(remember(event.target.value))}
              />
            </div>
            <p className="picker__note">
              A custom colour is a value on this one object. A token is a decision the whole
              project follows.
            </p>
          </div>

          {recent.length > 0 ? (
            <div className="picker__group">
              <span className="picker__label">Recent</span>
              <div className="picker__swatches">
                {recent.map((color) => (
                  <button
                    key={color}
                    className="picker__swatch"
                    style={{ backgroundColor: color }}
                    title={color}
                    aria-label={color}
                    data-testid={`${testId}-recent`}
                    onClick={() => {
                      onChange({ kind: 'literal', value: color });
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const tokenLabel = (id: string): string =>
  tokensIn('color').find((entry) => entry.id === id)?.label ?? id;
