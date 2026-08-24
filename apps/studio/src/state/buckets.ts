import { BUCKETS, bucketManifest, isBucket, type BucketConfig, type BucketManifest } from '@loom/connectors';
import type { ConnectorInstance, Snapshot } from '@loom/ir';
import { newConnectorId } from '@loom/ir';
import { dispatch, getState } from './store';
import { log } from './logs';

/**
 * Buckets in the studio (`docs/29-storage.md`).
 *
 * Attaching one writes **two separate things to two separate places**: the configuration goes into
 * the document, where a colleague opening the project will see it, and the credential goes to the
 * dev server and nowhere else. Neither half ever holds the other's data — that separation is the
 * whole reason a designer can hand this project file to somebody without handing over the keys to
 * the bucket.
 */

export interface BucketRow {
  id: string;
  manifest: BucketManifest;
  config: BucketConfig;
}

/** Every bucket this project has attached, in a stable order. */
export function bucketsIn(snapshot: Snapshot): BucketRow[] {
  return Object.values(snapshot.connectors)
    .filter((connector) => isBucket(connector.moduleId))
    .map((connector) => ({
      id: connector.id,
      manifest: bucketManifest(connector.moduleId)!,
      config: (connector.config ?? {}) as BucketConfig,
    }))
    .sort((a, b) => (a.config.label ?? a.id).localeCompare(b.config.label ?? b.id));
}

/** What a field's Bucket property should offer. */
export function bucketChoices(snapshot: Snapshot): { id: string; label: string }[] {
  return bucketsIn(snapshot).map((row) => ({
    id: row.id,
    label: row.config.label?.trim() || row.manifest.label,
  }));
}

export function attachBucket(moduleId: string): string {
  const manifest = bucketManifest(moduleId);
  if (!manifest) throw new Error(`Unknown bucket "${moduleId}".`);

  const id = newConnectorId();
  const connector: ConnectorInstance = {
    id,
    moduleId,
    // Sensible from the start, and all of it visible: 10 MB is large enough for a document and
    // small enough that a mistake is not a bill.
    config: {
      label: manifest.label,
      prefix: 'uploads',
      maxMb: 10,
      ...(manifest.local ? { directory: '.data/uploads' } : {}),
    } satisfies BucketConfig,
  };

  dispatch({ type: 'addConnector', connector });
  log({ source: 'env', message: `Attached ${manifest.label}` });
  return id;
}

export function configureBucket(id: string, patch: Partial<BucketConfig>): void {
  const current = (getState().snapshot.connectors[id]?.config ?? {}) as BucketConfig;
  dispatch({ type: 'setConnectorConfig', connectorId: id, config: { ...current, ...patch } });
}

export function detachBucket(id: string): void {
  dispatch({ type: 'removeConnector', connectorId: id });
}

/**
 * Hand a bucket credential to the dev server, and keep no copy.
 *
 * A bucket key is the credential it would be worst to leak: a bucket anyone can write to is a
 * bucket anyone can fill, and unlike a password it does not expire on its own. So it goes to the
 * server, the server holds it, and a reload asks the server whether it still does rather than
 * reading it back out of this browser.
 */
export async function saveBucketCredentials(values: Record<string, string>): Promise<boolean> {
  const filled = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value.trim().length > 0),
  );
  if (Object.keys(filled).length === 0) return true;

  try {
    await fetch('/__loom/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env: filled }),
    });
    log({ source: 'env', message: `Stored ${Object.keys(filled).join(', ')} on the dev server` });
    return true;
  } catch {
    log({
      source: 'env',
      level: 'error',
      message: 'Could not reach the dev server to store the credential.',
    });
    return false;
  }
}

/**
 * What is missing before a bucket can actually take a file.
 *
 * Reported rather than assumed: a bucket with no name configured will fail on the first upload,
 * and finding that out from a customer is worse than finding it out here.
 */
export function bucketProblem(row: BucketRow, credentialsHeld: readonly string[]): string | undefined {
  for (const field of row.manifest.fields) {
    if (field.required && !String((row.config as Record<string, unknown>)[field.key] ?? '').trim()) {
      return `${row.manifest.label} needs ${field.label.toLowerCase()}.`;
    }
  }

  const missing = row.manifest.credentials
    .map((credential) => credential.name)
    .filter((name) => !credentialsHeld.includes(name));
  if (missing.length > 0) return `${row.manifest.label} needs ${missing.join(' and ')}.`;

  return undefined;
}

export { BUCKETS };
