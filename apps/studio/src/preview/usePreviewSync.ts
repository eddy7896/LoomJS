import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '@loom/ir';
import { CompileError, compile } from '@loom/compiler';
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
    setStatus((s) => ({ ...s, syncing: true }));

    timer.current = setTimeout(() => {
      let files;
      try {
        files = compile(snapshot).files;
        // This is the project's only compile: the Problems panel reads the verdict rather than
        // running emission a second time on its own render path.
        setBuildResult(null);
      } catch (error) {
        // The Build tier: keep the last good build running and point at the offending entity.
        const message = error instanceof Error ? error.message : String(error);
        const entityId = error instanceof CompileError ? error.entityId : undefined;
        setBuildResult({ message, entityId });
        setStatus((s) => ({ ...s, syncing: false, error: message, entityId }));
        return;
      }

      void fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files }),
      })
        .then((r) => r.json() as Promise<{ ok: boolean; error?: string; written?: number; clients?: number }>)
        .then((body) =>
          setStatus((s) => ({
            ...s,
            syncing: false,
            builds: s.builds + 1,
            // Written, but nothing was connected to hear it: the page on screen is now behind,
            // and only a reload can catch it up.
            missed: s.missed + ((body.written ?? 0) > 0 && (body.clients ?? 0) === 0 ? 1 : 0),
            error: body.ok ? undefined : (body.error ?? 'Preview write failed'),
            entityId: undefined,
          })),
        )
        .catch((error: Error) =>
          setStatus((s) => ({ ...s, syncing: false, error: error.message, entityId: undefined })),
        );
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer.current);
  }, [snapshot, enabled]);

  return status;
}
