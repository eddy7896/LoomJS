import { useEffect, useState } from 'react';
import type { BucketManifest } from '@loom/connectors';
import { useEditor } from '../state/useEditor';
import { readServerEnv } from '../state/connectors';
import {
  BUCKETS,
  attachBucket,
  bucketProblem,
  bucketsIn,
  configureBucket,
  detachBucket,
  saveBucketCredentials,
  type BucketRow,
} from '../state/buckets';

/**
 * Files (`docs/29-storage.md`).
 *
 * Where a project says **where uploaded files live**. Attaching a bucket writes two things to two
 * places: the configuration into the document, where a colleague opening the project will see it,
 * and the credential to the dev server and nowhere else.
 *
 * The panel never shows a stored value back. It shows whether the server *has* one — which is the
 * only question anyone actually has, and answering it this way means a screenshot of this panel
 * gives nothing away.
 */
export function FilesPanel() {
  const snapshot = useEditor((s) => s.snapshot);
  const rows = bucketsIn(snapshot);

  // Names only. The values live on the dev server; this is how the panel knows what is missing.
  const [held, setHeld] = useState<string[]>([]);
  const refresh = () => void readServerEnv().then((env) => setHeld(env.names));
  useEffect(refresh, []);

  return (
    <section className="panel files" data-testid="files-panel">
      <div className="panel__head">
        <h2 className="panel__title">Files</h2>
      </div>

      <p className="panel__hint">
        Somewhere for uploads to live. Keys go to the dev server, never into the project file.
      </p>

      <div className="files__add">
        {BUCKETS.map((manifest: BucketManifest) => (
          <button
            key={manifest.id}
            data-testid={`attach-${manifest.id}`}
            title={manifest.summary}
            onClick={() => attachBucket(manifest.id)}
          >
            + {manifest.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="panel__empty">
          Nothing attached yet. Local disk works on a laptop with no account anywhere.
        </p>
      ) : (
        <ol className="files__list">
          {rows.map((row) => (
            <BucketCard key={row.id} row={row} held={held} onSaved={refresh} />
          ))}
        </ol>
      )}
    </section>
  );
}

function BucketCard({
  row,
  held,
  onSaved,
}: {
  row: BucketRow;
  held: readonly string[];
  onSaved: () => void;
}) {
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const problem = bucketProblem(row, held);

  return (
    <li className="files__card" data-testid={`bucket-${row.id}`}>
      <div className="files__cardhead">
        <input
          className="files__name"
          value={row.config.label ?? ''}
          placeholder={row.manifest.label}
          data-testid={`bucket-label-${row.id}`}
          onChange={(event) => configureBucket(row.id, { label: event.target.value })}
        />
        <code className="mono id">{row.id}</code>
        <button data-testid={`detach-${row.id}`} onClick={() => detachBucket(row.id)}>
          Remove
        </button>
      </div>

      <p className="panel__hint">{row.manifest.summary}</p>

      {row.manifest.fields.map((field) => (
        <label key={field.key} className="field">
          <span className="field__label">
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <input
            value={String((row.config as Record<string, unknown>)[field.key] ?? '')}
            placeholder={field.placeholder}
            data-testid={`bucket-${row.id}-${field.key}`}
            onChange={(event) => configureBucket(row.id, { [field.key]: event.target.value })}
          />
          {field.hint ? <span className="field__hint">{field.hint}</span> : null}
        </label>
      ))}

      {/* Enforced on the server, where it cannot be skipped — this is where it is *decided*. */}
      <label className="field">
        <span className="field__label">Largest file (MB)</span>
        <input
          type="number"
          min={1}
          value={row.config.maxMb ?? 10}
          data-testid={`bucket-${row.id}-maxMb`}
          onChange={(event) => configureBucket(row.id, { maxMb: Number(event.target.value) || 1 })}
        />
      </label>

      <label className="field">
        <span className="field__label">Accepts</span>
        <input
          value={row.config.accept ?? ''}
          placeholder="image/*, application/pdf"
          data-testid={`bucket-${row.id}-accept`}
          onChange={(event) => configureBucket(row.id, { accept: event.target.value })}
        />
        <span className="field__hint">Blank means anything. Checked on the server too.</span>
      </label>

      <div className="files__secrets">
        {row.manifest.credentials.map((credential) => {
          const stored = held.includes(credential.name);
          return (
            <label key={credential.name} className="field">
              <span className="field__label">
                {credential.label}
                {stored ? <span className="files__held"> · stored</span> : null}
              </span>
              <input
                type="password"
                autoComplete="off"
                placeholder={stored ? '••••••••' : credential.name}
                data-testid={`secret-${credential.name}`}
                value={secrets[credential.name] ?? ''}
                onChange={(event) =>
                  setSecrets((current) => ({ ...current, [credential.name]: event.target.value }))
                }
              />
              {credential.hint ? <span className="field__hint">{credential.hint}</span> : null}
            </label>
          );
        })}

        <button
          data-testid={`save-secrets-${row.id}`}
          onClick={() => {
            void saveBucketCredentials(secrets).then((ok) => {
              // Cleared either way: a key sitting in a React state is a key in a heap dump.
              setSecrets({});
              if (ok) onSaved();
            });
          }}
        >
          Store keys
        </button>
      </div>

      {problem ? (
        <p className="files__problem" data-testid={`bucket-problem-${row.id}`}>
          {problem}
        </p>
      ) : null}
    </li>
  );
}
