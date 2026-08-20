import type { TypeRef } from '@loom/ir';

/**
 * The module system (`06-glossary.md`): a **module definition** is a manifest plus an adapter; a
 * **module instance** is a configured module on the canvas. A **connector** is a module that
 * bridges to an external service — every connector is a module, not every module is a connector.
 *
 * This is deliberately the smallest thing that supports one real connector. The registry,
 * versioning and third-party authoring are v2 (`07-v1-scope.md`).
 */

export interface ConfigField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

/**
 * A credential the module needs. The **name** is what reaches the document and the emitted code;
 * the value lives in the env bucket (`docs/specs/connector-credentials.md`).
 */
export interface CredentialSpec {
  /** Environment variable name, e.g. `SUPABASE_SERVICE_ROLE_KEY`. */
  name: string;
  label: string;
  /** `server` credentials may never reach the browser — the compiler refuses. */
  scope: 'client' | 'server';
  hint?: string;
}

/** One column of an introspected table, in loom's visible type vocabulary. */
export interface ColumnSchema {
  name: string;
  type: TypeRef;
  /** NOT NULL and no default: it must be supplied on insert. */
  required: boolean;
  primaryKey: boolean;
  /** True when the database fills it in (identity, default) — never asked for on insert. */
  generated: boolean;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
}

/** What a connector's `introspect()` returns, and what gets cached in the document. */
export interface IntrospectionResult {
  tables: TableSchema[];
  /** When the schema was read, so the studio can say how stale it is. */
  introspectedAt: string;
}

export interface ConnectorCredentials {
  [name: string]: string;
}

export interface ModuleManifest {
  id: string;
  label: string;
  kind: 'connector';
  /** What the module needs configured; none of these are secret. */
  config: ConfigField[];
  credentials: CredentialSpec[];
}

export interface ConnectorAdapter {
  manifest: ModuleManifest;
  /** Read a live schema and return typed tables (`06-glossary.md`: introspect). */
  introspect: (
    config: Record<string, string>,
    credentials: ConnectorCredentials,
    fetchImpl?: typeof fetch,
  ) => Promise<IntrospectionResult>;
}

export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorError';
  }
}

/** Credential names a module declares for a given scope. */
export function credentialNames(manifest: ModuleManifest, scope: 'client' | 'server'): string[] {
  return manifest.credentials.filter((c) => c.scope === scope).map((c) => c.name);
}

/** True when `name` is a secret this module says must stay on the server. */
export function isServerOnly(manifest: ModuleManifest, name: string): boolean {
  return manifest.credentials.some((c) => c.name === name && c.scope === 'server');
}
