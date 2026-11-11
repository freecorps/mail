// "Nothing animates on a keyboard action": a hardware shortcut (E archives, Esc closes, J/K move) marks a short still
// window before its handler runs, and what would animate in response (the list closing the archived row's gap, the
// undo capsule rising) reads it and appears in place instead. Pure: no React Native; the hook lives in src/keys.tsx.

/** Long enough to cover the optimistic update and the list's re-render that follow the key. */
export const STILL_MS = 700;

export interface KeyMotion {
  /** A key was pressed: still until `STILL_MS` after the last one. */
  mark(now?: number): void;
  /** Within the still window. */
  still(now?: number): boolean;
  subscribe(listener: () => void): () => void;
}

export function createKeyMotion(schedule: (fn: () => void, ms: number) => unknown = setTimeout): KeyMotion {
  let until = 0;
  let last = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    mark(now = Date.now()) {
      const was = now < until;
      until = now + STILL_MS;
      const mine = ++last;
      if (!was) emit();
      schedule(() => {
        // Only the last key's timer ends the window (and tells the listeners it ended).
        if (mine !== last) return;
        until = 0;
        emit();
      }, STILL_MS);
    },
    still(now = Date.now()) {
      return now < until;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const keyMotion = createKeyMotion();
