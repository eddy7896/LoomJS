import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '@loom/ir';
import { CompileError, compile } from '@loom/compiler';

export interface PreviewStatus {
  url: string | undefined;
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
      } catch (error) {
        // The Build tier: keep the last good build running and point at the offending entity.
        setStatus((s) => ({
          ...s,
          syncing: false,
          error: error instanceof Error ? error.message : String(error),
          entityId: error instanceof CompileError ? error.entityId : undefined,
        }));
        return;
      }

      void fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files }),
      })
        .then((r) => r.json() as Promise<{ ok: boolean; error?: string }>)
        .then((body) =>
          setStatus((s) => ({
            ...s,
            syncing: false,
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
