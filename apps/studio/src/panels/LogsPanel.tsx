import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  clearLogs,
  logEntries,
  pullLogs,
  subscribeToLogs,
  type LogEntry,
  type LogLevel,
} from '../state/logs';

/**
 * The log (L1, `docs/23-logs.md`).
 *
 * What the app said, what its routes answered, and what the last build did — in one column, in the
 * order it happened. Until now that lived in whichever terminal the dev server was started from,
 * which is a window most designers never open and could not read if they did.
 *
 * It is not Problems. Problems is what is wrong with the document *now*, and it clears itself as
 * you fix things. This keeps what happened, including the parts that are over, because "it worked
 * a minute ago" is a question only a history can answer.
 */

/** How often the dev server is asked for new lines. */
const POLL_MS = 1000;

const SOURCE_LABELS: Record<string, string> = {
  app: 'app',
  route: 'route',
  build: 'build',
  env: 'env',
  compile: 'compile',
};

export function LogsPanel() {
  const entries = useSyncExternalStore(subscribeToLogs, logEntries);
  const [level, setLevel] = useState<'all' | LogLevel>('all');
  const [follow, setFollow] = useState(true);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void pullLogs();
    const timer = window.setInterval(() => void pullLogs(), POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const shown = useMemo(
    () => (level === 'all' ? entries : entries.filter((entry) => entry.level === level)),
    [entries, level],
  );

  useEffect(() => {
    // Following is the default because the interesting line is almost always the newest — but it
    // is a *toggle*, because reading something while lines arrive is impossible otherwise.
    if (follow) bottom.current?.scrollIntoView({ block: 'end' });
  }, [shown.length, follow]);

  const errors = entries.filter((entry) => entry.level === 'error').length;

  return (
    <section className="panel logs" data-testid="logs-panel">
      <div className="panel__head">
        <h2 className="panel__title">Logs</h2>
        {errors > 0 ? (
          <span className="logs__count" data-testid="logs-errors">
            {errors}
          </span>
        ) : null}
      </div>

      <div className="logs__controls">
        <select
          aria-label="Level"
          data-testid="logs-level"
          value={level}
          onChange={(event) => setLevel(event.target.value as 'all' | LogLevel)}
        >
          <option value="all">Everything</option>
          <option value="error">Errors</option>
          <option value="warn">Warnings</option>
          <option value="info">Notes</option>
        </select>
        <label className="schema-edit__check">
          <input
            type="checkbox"
            data-testid="logs-follow"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />
          Follow
        </label>
        <button data-testid="logs-clear" onClick={() => void clearLogs()}>
          Clear
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="panel__hint">
          Nothing yet. Open the Preview and this fills with what the app says, what its routes
          answer, and what each build did.
        </p>
      ) : (
        <ol className="logs__list">
          {shown.map((entry) => (
            <Line key={`${entry.seq}:${entry.at}`} entry={entry} />
          ))}
        </ol>
      )}
      <div ref={bottom} />
    </section>
  );
}

function Line({ entry }: { entry: LogEntry }) {
  const time = entry.at.slice(11, 19);

  return (
    <li className={`logline logline--${entry.level}`} data-testid={`logline-${entry.source}`}>
      <span className="logline__time mono">{time}</span>
      <span className="logline__source">{SOURCE_LABELS[entry.source] ?? entry.source}</span>
      <span className="logline__message">
        {entry.message}
        {entry.where ? <span className="logline__where mono"> {entry.where}</span> : null}
      </span>
    </li>
  );
}
