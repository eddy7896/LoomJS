import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '@loom/ir';
import type { EmittedFile } from '@loom/compiler';
import { CompileError, compile } from '@loom/compiler';
import { log } from '../state/logs';
import { setBuildResult } from '../state/build';

export interface PreviewStatus {
  url: string | undefined;
  /** How many builds have been written since the studio opened. */
  builds: number;
  /** Builds that were written while no page was listening, and so reached nobody. */
  missed: number;
  /** Build-tier diagnostic, or undefined when the last compile succeeded. */
  error: string | undefined;
  entityId: string | undefined;
  syncing: boolean;
}

const ENDPOINT = '/__loom/preview';
const DEBOUNCE_MS = 250;

/** How many times a build is repeated while nothing is listening, and how long between tries. */
const REDELIVERIES = 6;
const REDELIVERY_MS = 400;

/**
 * When the Preview page last finished loading.
 *
 * A build that lands right after a load is the one at risk: the page may have asked for its
 * modules a moment before the write, and the dev server's count of who is listening cannot be
 * trusted to notice — a page closed a second ago can still be counted. So a build in that window
 * is repeated once on principle, which costs a file write that changes nothing.
 */
let loadedAt = 0;
const FRESH_MS = 2500;

export function notePreviewLoaded(): void {
  loadedAt = Date.now();
}

/**
 * Whether there is a frame at all.
 *
 * With the Preview closed, folded, or not yet opened, a build reaches nobody *and that is fine* —
 * whatever appears next will fetch the current files. Chasing delivery there would end in a
 * "missed" that reloads a page later, in the middle of something.
 */
let mounted = false;

export function notePreviewMounted(present: boolean): void {
  mounted = present;
}

interface PostResult {
  ok: boolean;
  error?: string;
  written?: number;
  clients?: number;
}

/**
 * Compile here, in the browser, and post the emitted files to the dev server, which writes them;
 * the child Vite dev server then HMRs the emitted app inside the iframe. Compiling on this side
 * means a Build error arrives with the offending entity id and no round trip, and it keeps the
 * Vite plugin free of workspace imports. Debounced so typing does not recompile per keystroke.
 */
export function usePreviewSync(snapshot: Snapshot, enabled: boolean): PreviewStatus {
  const [status, setStatus] = useState<PreviewStatus>({
    url: undefined,
    builds: 0,
    missed: 0,
    error: undefined,
    entityId: undefined,
    syncing: false,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const redelivery = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetch(ENDPOINT)
      .then((r) => r.json() as Promise<{ url: string }>)
      .then((body) => {
        if (!cancelled) setStatus((s) => ({ ...s, url: body.url }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    clearTimeout(timer.current);
    // A newer build is on its way; there is no point still repeating the last one.
    clearTimeout(redelivery.current);
    setStatus((s) => ({ ...s, syncing: true }));

    timer.current = setTimeout(() => {
      // A project with no screens is not a broken project; it is one nobody has drawn on. The
      // compiler is right to refuse it and the studio is wrong to call that an error.
      if (Object.keys(snapshot.artboards).length === 0) {
        setBuildResult(null);
        setStatus((s) => ({ ...s, syncing: false, error: undefined, entityId: undefined }));
        return;
      }

      let files;
      const started = performance.now();
      try {
        files = compile(snapshot).files;
        // This is the project's only compile: the Problems panel reads the verdict rather than
        // running emission a second time on its own render path.
        setBuildResult(null);
        // In the log as well as the panel: Problems says what is wrong *now*, and the log says
        // that this compile happened, which is what answers "did my edit even reach it".
        log({
          source: 'compile',
          message: `Compiled ${files.length} files in ${Math.round(performance.now() - started)}ms`,
        });
      } catch (error) {
        // The Build tier: keep the last good build running and point at the offending entity.
        const message = error instanceof Error ? error.message : String(error);
        const entityId = error instanceof CompileError ? error.entityId : undefined;
        setBuildResult({ message, entityId });
        setStatus((s) => ({ ...s, syncing: false, error: message, entityId }));
        log({ source: 'compile', level: 'error', message, where: entityId });
        return;
      }

      void deliver(files, 0);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer.current);
      clearTimeout(redelivery.current);
    };
  }, [snapshot, enabled]);

  /**
   * Post a build, and **say it again** if nobody was listening.
   *
   * A hot update only reaches pages that are connected at that moment, and the Preview is not
   * connected while it is loading — so the first build after it opens can land in an empty room.
   * The obvious repair is to reload the frame, and it is the wrong one: a reload throws away
   * whatever the person has done in the running app, which is usually the very thing they were
   * about to look at. Saying the same thing again once someone is listening costs a file write
   * that changes nothing and leaves the app exactly as it was.
   *
   * It gives up after a few tries — nobody may be listening because the Preview is closed, and
   * that is not a problem to solve. The counter it reports is what the window falls back to.
   */
  function deliver(files: EmittedFile[], attempt: number): void {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files, redeliver: attempt > 0 }),
    })
      .then((r) => r.json() as Promise<PostResult>)
      .then((body) => {
        const fresh = Date.now() - loadedAt < FRESH_MS;
        // Nothing to reach, so nothing to chase. Otherwise: heard, unless this build landed while
        // the page was still settling — in which case say it again once anyway, rather than
        // trusting a count that cannot see a socket belonging to a page that has closed.
        const heard = !mounted || ((body.clients ?? 0) > 0 && !(fresh && attempt === 0));
        const gaveUp = !heard && attempt >= REDELIVERIES;

        setStatus((s) => ({
          ...s,
          // **"live" means the page has this build**, not that the studio finished posting it. A
          // preview that says live while showing the app from before the last edit is the studio
          // telling a small lie at exactly the moment someone is checking their work.
          syncing: !heard && !gaveUp,
          builds: attempt === 0 ? s.builds + 1 : s.builds,
          missed: s.missed + (gaveUp ? 1 : 0),
          error: body.ok ? undefined : (body.error ?? 'Preview write failed'),
          entityId: undefined,
        }));

        if (heard || gaveUp) return;
        // The page is most likely mid-load; give it a moment to finish and say it again.
        redelivery.current = setTimeout(() => deliver(files, attempt + 1), REDELIVERY_MS);
      })
      .catch((error: Error) =>
        setStatus((s) => ({ ...s, syncing: false, error: error.message, entityId: undefined })),
      );
  }

  return status;
}
