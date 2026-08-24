import { useMemo, useState } from 'react';
import { diagnose } from '@loom/compiler';
import { useEditor } from '../state/useEditor';
import { useBuildResult } from '../state/build';
import { revealProblem } from '../state/problems';

/**
 * The Problems tier gets a home (P2, `docs/specs/problems.md`).
 *
 * A live list of what is currently wrong, recomputed from the document rather than accumulated
 * from events — so it never needs clearing, and a fixed problem simply stops being listed.
 */
export function ProblemsPanel() {
  const snapshot = useEditor((s) => s.snapshot);
  const build = useBuildResult();
  const [open, setOpen] = useState(true);

  // Memoised on the snapshot: this walks every component and node, and the snapshot is immutable,
  // so a keystroke that changes nothing structural costs one identity check. The Build row comes
  // from the Preview's compile — `undefined` while nothing has compiled yet, which is a different
  // fact from "compiled clean" and is why the option is passed explicitly.
  const problems = useMemo(
    () => diagnose(snapshot, { build: build ?? null }),
    [snapshot, build],
  );

  const errors = problems.filter((problem) => problem.severity === 'error').length;
  const warnings = problems.length - errors;

  return (
    <aside className={`panel problems ${open ? '' : 'problems--closed'}`} data-testid="problems">
      <div className="panel__head">
        <h2 className="panel__title">Problems</h2>
        <span
          className={`chip ${errors > 0 ? 'chip--error' : warnings > 0 ? 'chip--warn' : ''}`}
          data-testid="problems-count"
        >
          {errors > 0 ? errors : warnings > 0 ? warnings : 'none'}
        </span>
        <button
          title={open ? 'Collapse' : 'Expand'}
          data-testid="problems-toggle"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '–' : '+'}
        </button>
      </div>

      {open ? (
        <div className="problems__list">
          {problems.length === 0 ? (
            <p className="panel__hint">Nothing is wrong.</p>
          ) : (
            problems.map((problem) => (
              <button
                key={problem.id}
                className={`problem-row problem-row--${problem.severity}`}
                data-testid={`problem-${problem.code}`}
                data-code={problem.code}
                title={problem.message}
                disabled={!problem.entityId}
                onClick={() => revealProblem(problem)}
              >
                <span className="problem-row__message">{problem.message}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </aside>
  );
}
