import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '@loom/ir';

export interface PreviewStatus {
  url: string | undefined;
  /** Build-tier diagnostic from the compiler, or undefined when the last compile succeeded. */
  error: string | undefined;
  entityId: string | undefined;
  syncing: boolean;
}

const ENDPOINT = '/__loom/preview';
const DEBOUNCE_MS = 250;

/**
 * Push the snapshot to the studio dev server, which compiles it to disk; the child Vite dev
 * server HMRs the emitted app inside the iframe. Debounced so typing in the inspector does not
 * recompile per keystroke.
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
      void fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(snapshot),
      })
        .then((r) => r.json() as Promise<{ ok: boolean; error?: string; entityId?: string }>)
        .then((body) =>
          setStatus((s) => ({
            ...s,
            syncing: false,
            error: body.ok ? undefined : (body.error ?? 'Compile failed'),
            entityId: body.entityId,
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
