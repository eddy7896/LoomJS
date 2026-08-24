/**
 * What the running app and its server said (L1, `docs/23-logs.md`).
 *
 * The studio's Problems panel says what is wrong with the *document*. This is the other half: what
 * happened while the app ran — a console line from the browser, an API route that threw, a build
 * that landed. Until now that lived in whichever terminal the dev server was started from, which
 * is a window most designers never open and cannot read.
 *
 * The preview server and the studio server run in the **same Node process**, so this is a plain
 * module holding a ring buffer. No socket between them, no file to tail, no second source of truth.
 */

export type LogSource = 'app' | 'route' | 'build' | 'env';
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  /** Monotonic, so a reader asks for "everything after 41" and cannot miss one. */
  seq: number;
  at: string;
  source: LogSource;
  level: LogLevel;
  message: string;
  /** Where it came from, when that is knowable: a route path, a file, a stack line. */
  where?: string;
}

/**
 * How much is kept.
 *
 * A render loop can write thousands of lines a second, and the answer to that is a bounded buffer
 * rather than a studio that runs out of memory while showing you why.
 */
const LIMIT = 500;

/** One line is truncated rather than allowed to be a megabyte of stringified state. */
const MAX_MESSAGE = 2000;

let entries: LogEntry[] = [];
let next = 1;

export function record(entry: {
  source: LogSource;
  level?: LogLevel;
  message: string;
  where?: string;
}): LogEntry {
  const line: LogEntry = {
    seq: next++,
    at: new Date().toISOString(),
    source: entry.source,
    level: entry.level ?? 'info',
    message: entry.message.slice(0, MAX_MESSAGE),
    ...(entry.where ? { where: entry.where } : {}),
  };

  entries.push(line);
  if (entries.length > LIMIT) entries = entries.slice(-LIMIT);
  return line;
}

/**
 * Everything after `cursor`, and where the reader has got to.
 *
 * `dropped` is how many lines fell off the end before the reader arrived — said out loud, because
 * a log that silently loses the middle is worse than one that admits to a gap.
 */
export function since(cursor: number): { entries: LogEntry[]; cursor: number; dropped: number } {
  const first = entries[0]?.seq ?? next;
  const dropped = cursor > 0 && first > cursor + 1 ? first - cursor - 1 : 0;
  const after = entries.filter((entry) => entry.seq > cursor);
  return { entries: after, cursor: after.at(-1)?.seq ?? cursor, dropped };
}

export function clear(): void {
  entries = [];
}

/** The script the previewed app runs, which is how a console line gets here at all. */
export const CONSOLE_HOOK = `<script>
(() => {
  // The app runs in an iframe on another port, so the studio cannot read its console: the same
  // origin rule that protects every other page protects this one. So the app forwards instead.
  const post = (level, args, where) => {
    try {
      const message = args
        .map((value) => {
          if (typeof value === 'string') return value;
          if (value instanceof Error) return value.stack || value.message;
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })
        .join(' ');
      navigator.sendBeacon?.(
        '/__loom/log',
        new Blob([JSON.stringify({ level, message, where })], { type: 'application/json' }),
      );
    } catch {
      /* a log that breaks the app it is logging is worse than a missing line */
    }
  };

  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      post(level === 'log' ? 'info' : level, args);
      original(...args);
    };
  }

  addEventListener('error', (event) => {
    post('error', [event.message], event.filename ? event.filename + ':' + event.lineno : undefined);
  });
  addEventListener('unhandledrejection', (event) => {
    post('error', ['Unhandled rejection: ' + String(event.reason)]);
  });
})();
</script>`;
