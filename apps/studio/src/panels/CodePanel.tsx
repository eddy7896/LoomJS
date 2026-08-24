import { useMemo, useState } from 'react';
import { useEditor } from '../state/useEditor';
import { revealEntity } from '../state/problems';
import { downloadProject, emittedCode, fileTree } from '../state/code';

/**
 * The code (`docs/24-code.md`).
 *
 * loom's claim is that a project compiles to a real repo the user owns. This is where that claim
 * becomes checkable: the files, as they are, with a button that hands them over.
 *
 * It is the **same** `compile()` the Preview runs — not an export path that could drift from what
 * actually runs. What you read here is what the Preview is executing and what a deploy would ship.
 */
export function CodePanel() {
  const snapshot = useEditor((s) => s.snapshot);
  const [selected, setSelected] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  // Compiling is not free, so it happens when the document changes and not on every render.
  const result = useMemo(() => emittedCode(snapshot), [snapshot]);
  const tree = useMemo(() => fileTree(result.files), [result.files]);

  const open = result.files.find((file) => file.path === selected) ?? result.files[0];

  return (
    <section className="panel code" data-testid="code-panel">
      <div className="panel__head">
        <h2 className="panel__title">Code</h2>
        <button
          data-testid="download-project"
          disabled={Boolean(result.error)}
          onClick={() => downloadProject(snapshot)}
        >
          Download
        </button>
      </div>

      {result.error ? (
        <div className="code__problem" data-testid="code-problem">
          <p>{result.error}</p>
          {/* Straight to the thing that has to change: reading a refusal and then hunting for
              what it is about is the half that wastes the time. */}
          {result.entityId ? (
            <button onClick={() => revealEntity(result.entityId!)}>Show me</button>
          ) : null}
        </div>
      ) : (
        <p className="panel__hint">
          {result.files.length} files — the same ones the Preview is running.
        </p>
      )}

      <div className="code__body">
        <ol className="code__tree">
          {tree.map((entry) => (
            <li key={entry.path}>
              {entry.file ? (
                <button
                  className={`code__file ${open?.path === entry.path ? 'is-selected' : ''}`}
                  style={{ paddingLeft: 8 + entry.depth * 12 }}
                  data-testid={`code-file-${entry.path}`}
                  onClick={() => {
                    setSelected(entry.path);
                    setCopied(false);
                  }}
                >
                  {entry.name}
                </button>
              ) : (
                <span className="code__folder" style={{ paddingLeft: 8 + entry.depth * 12 }}>
                  {entry.name}/
                </span>
              )}
            </li>
          ))}
        </ol>

        {open ? (
          <div className="code__view">
            <div className="code__viewhead">
              <code className="mono id" data-testid="code-open-path">
                {open.path}
              </code>
              <button
                data-testid="copy-file"
                onClick={() => {
                  void navigator.clipboard?.writeText(open.content).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  );
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {/* Read-only on purpose: the document is the source, and a file edited here would be
                overwritten by the next compile — which is a worse lie than not offering it. */}
            <pre className="code__text" data-testid="code-content">
              {open.content}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}
