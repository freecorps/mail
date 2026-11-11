// "Nothing animates on a keyboard action": a hardware shortcut (E archives, Esc closes, J/K move) marks a short still
// window before its handler runs, and what would animate in response (the list closing the archived row's gap, the
// undo capsule rising) reads it and appears in place instead. Pure: no React Native; the hook lives in src/keys.tsx.

/** Long enough to cover the optimistic update and the list's re-render that follow the key. */
export const STILL_MS = 700;

export interface KeyMotion {
  /** A key was pressed: still until `STILL_MS` after the last one. */
  mark(now?: number): void;
  /** Within the still window: state the store changes (and announces), never read off the clock, so it is a pure
   * `useSyncExternalStore` snapshot. */
  still(): boolean;
  subscribe(listener: () => void): () => void;
}

export function createKeyMotion(schedule: (fn: () => void, ms: number) => unknown = setTimeout): KeyMotion {
  let active = false;
  let last = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    mark() {
      const was = active;
      active = true;
      const mine = ++last;
      if (!was) emit();
      schedule(() => {
        // Only the last key's timer ends the window (and tells the listeners it ended).
        if (mine !== last) return;
        active = false;
        emit();
      }, STILL_MS);
    },
    still() {
      return active;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const keyMotion = createKeyMotion();
