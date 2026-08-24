/**
 * The log the studio shows (L1, `docs/23-logs.md`).
 *
 * Two kinds of line meet here. Some happen in this browser — a compile succeeded, a compile was
 * refused — and are appended directly. The rest happen in the dev server and the previewed app,
 * and are fetched by cursor. Merging them in one place is the point: "my edit did nothing" is
 * answered by seeing the compile, the delivery and the app's own console in one column, in order.
 *
 * Problems and logs are different things and stay apart. Problems is what is wrong with the
 * document *now*; this is what happened, in the order it happened, including the parts that are
 * over.
 */

export type LogSource = 'app' | 'route' | 'build' | 'env' | 'compile';
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  seq: number;
  at: string;
  source: LogSource;
  level: LogLevel;
  message: string;
  where?: string;
}

/** The same bound the server keeps, for the same reason: a render loop must not exhaust a tab. */
const LIMIT = 500;

let entries: LogEntry[] = [];
let cursor = 0;
/** Local lines get negative sequence numbers, so they can never collide with the server's. */
let localSeq = -1;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

export function subscribeToLogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function logEntries(): LogEntry[] {
  return entries;
}

function append(added: readonly LogEntry[]): void {
  if (added.length === 0) return;
  // Sorted by time rather than by sequence: local lines and server lines are numbered by different
  // counters, and what a reader wants is the order things happened.
  entries = [...entries, ...added].sort((a, b) => a.at.localeCompare(b.at)).slice(-LIMIT);
  announce();
}

/** Something that happened in the studio itself — a compile, a refusal. */
export function log(entry: {
  source?: LogSource;
  level?: LogLevel;
  message: string;
  where?: string;
}): void {
  append([
    {
      seq: localSeq--,
      at: new Date().toISOString(),
      source: entry.source ?? 'compile',
      level: entry.level ?? 'info',
      message: entry.message,
      ...(entry.where ? { where: entry.where } : {}),
    },
  ]);
}

/**
 * Fetch whatever the dev server has said since last time.
 *
 * A cursor rather than a stream: it survives a reload, a paused panel, and a studio that was not
 * open when something was logged. A gap — lines that fell off the server's buffer before anyone
 * read them — is reported rather than skipped over.
 */
export async function pullLogs(): Promise<void> {
  try {
    const response = await fetch(`/__loom/logs?since=${cursor}`);
    const payload = (await response.json()) as {
      entries?: LogEntry[];
      cursor?: number;
      dropped?: number;
    };

    if (payload.dropped && payload.dropped > 0) {
      log({
        source: 'build',
        level: 'warn',
        message: `${payload.dropped} earlier lines were dropped — the log keeps the last ${LIMIT}.`,
      });
    }

    cursor = payload.cursor ?? cursor;
    append(payload.entries ?? []);
  } catch {
    // The dev server is not answering. Saying so on every poll would bury the log in its own
    // complaints, so this stays quiet: the panel shows the last thing it knew.
  }
}

export async function clearLogs(): Promise<void> {
  entries = [];
  announce();
  try {
    await fetch('/__loom/logs', { method: 'DELETE' });
  } catch {
    /* clearing the panel is worth doing even when the server cannot be told */
  }
}

/** For tests: forget everything, including where the reader had got to. */
export function __resetLogs(): void {
  entries = [];
  cursor = 0;
  localSeq = -1;
}
