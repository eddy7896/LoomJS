import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadSnapshot } from './state/store';
import { restoreProject, startAutosave } from './state/persistence';
import './index.css';

/**
 * Restore before the first render, so the editor never flashes an empty project over a saved one
 * (P0, `docs/10-interaction-plan.md`). A refusal is deliberately not silent: the saved document
 * stays on disk and the reason travels to the toolbar, because a half-loaded project is worse
 * than a fresh one.
 */
const restored = restoreProject();
if (restored.status === 'restored') loadSnapshot(restored.snapshot);

const autosave = startAutosave();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App autosave={autosave} restoreProblem={restored.status === 'refused' ? restored.reason : undefined} />
  </React.StrictMode>,
);
