import { useSyncExternalStore } from 'react';
import { getState, subscribe, type EditorState } from './store';

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getState()),
    () => selector(getState()),
  );
}
