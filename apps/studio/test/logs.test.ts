import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetLogs,
  clearLogs,
  log,
  logEntries,
  pullLogs,
  subscribeToLogs,
  type LogEntry,
} from '../src/state/logs';

/**
 * The log the studio shows (L1, `docs/23-logs.md`).
 *
 * Lines arrive from two places — this browser and the dev server — and the whole value is that
 * they end up in one column in the order things happened. These are about that ordering, the
 * cursor that survives a reload, and the gap being admitted rather than hidden.
 */

const server = (seq: number, at: string, message: string): LogEntry => ({
  seq,
  at,
  source: 'route',
  level: 'info',
  message,
});

afterEach(() => {
  __resetLogs();
  vi.unstubAllGlobals();
});

describe('lines from two places', () => {
  it('puts them in the order they happened, not the order they arrived', async () => {
    // A local compile at :01, a server line at :00. The server's is older, so it goes first.
    log({ source: 'compile', message: 'Compiled 9 files' });
    const entries = logEntries();
    const localAt = entries[0]!.at;
    const earlier = new Date(Date.parse(localAt) - 1000).toISOString();

    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ entries: [server(1, earlier, 'GET /api/notes → 200')], cursor: 1 })),
    );
    await pullLogs();

    expect(logEntries().map((entry) => entry.message)).toEqual([
      'GET /api/notes → 200',
      'Compiled 9 files',
    ]);
  });

  it('never collides the two numberings', async () => {
    log({ message: 'local one' });
    log({ message: 'local two' });
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ entries: [server(1, new Date().toISOString(), 'server')], cursor: 1 })),
    );
    await pullLogs();

    const seqs = logEntries().map((entry) => entry.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe('asking for what is new', () => {
  it('asks from where it got to, so nothing is read twice', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo) => {
      asked.push(String(input));
      return new Response(
        JSON.stringify({ entries: [server(7, new Date().toISOString(), 'one')], cursor: 7 }),
      );
    });

    await pullLogs();
    await pullLogs();

    expect(asked[0]).toContain('since=0');
    expect(asked[1]).toContain('since=7');
  });

  it('says so when lines fell off before anyone read them', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({ entries: [server(600, new Date().toISOString(), 'later')], cursor: 600, dropped: 40 }),
      ),
    );
    await pullLogs();

    // A log that silently loses the middle is worse than one that admits to a gap.
    expect(logEntries().some((entry) => entry.message.includes('40 earlier lines were dropped'))).toBe(
      true,
    );
  });

  it('stays quiet when the dev server is not answering', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await pullLogs();
    // Complaining on every poll would bury the log in its own complaints.
    expect(logEntries()).toEqual([]);
  });
});

describe('the panel subscribers', () => {
  it('are told when a line arrives', () => {
    let told = 0;
    const stop = subscribeToLogs(() => {
      told += 1;
    });

    log({ message: 'something' });
    expect(told).toBe(1);

    stop();
    log({ message: 'after' });
    expect(told).toBe(1);
  });

  it('clearing empties the panel even when the server cannot be told', async () => {
    log({ message: 'something' });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });

    await clearLogs();
    expect(logEntries()).toEqual([]);
  });
});
