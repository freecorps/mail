// "Desfazer" after an archive: one pending undo at a time (a newer action replaces it, like Mail and Gmail), shown by
// the undo banner for a few seconds. A plain store (useSyncExternalStore), no React Native: tested in vitest.
import { useSyncExternalStore } from "react";
import type { ThreadStatus } from "../api";
import type { ArchiveRecord } from "./list-actions";

export interface UndoEntry {
  id: number;
  message: string;
  /** Runs once, when the person taps "Desfazer". Absent for a plain notice ("Link copiado"), which has no action. */
  undo?: (() => void) | undefined;
}

type Timer = ReturnType<typeof setTimeout>;

export function createUndoStore(opts: { ms?: number; setTimeout?: (fn: () => void, ms: number) => Timer; clearTimeout?: (t: Timer) => void } = {}) {
  const set = opts.setTimeout ?? setTimeout;
  const clear = opts.clearTimeout ?? clearTimeout;
  let defaultMs = opts.ms ?? 6000;
  let current: UndoEntry | null = null;
  let timer: Timer | null = null;
  let seq = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const stop = () => {
    if (timer !== null) clear(timer);
    timer = null;
  };
  const dismiss = (id?: number) => {
    if (!current || (id !== undefined && current.id !== id)) return;
    stop();
    current = null;
    emit();
  };
  return {
    /** Offers an undo for `ms` (longer for screen reader users, who need time to reach the button). */
    show(message: string, undo: (() => void) | undefined, ms = defaultMs): number {
      stop();
      const id = ++seq;
      current = { id, message, undo };
      timer = set(() => dismiss(id), ms);
      emit();
      return id;
    },
    /** Runs the undo of the shown entry (once) and hides it. */
    undo() {
      const e = current;
      if (!e) return;
      dismiss(e.id);
      e.undo?.();
    },
    dismiss,
    /** How long an undo stays offered (the app sets 10 s while a screen reader runs). */
    setDuration(ms: number) {
      defaultMs = ms;
    },
    get: () => current,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}

export type UndoStore = ReturnType<typeof createUndoStore>;

/** The app's one undo slot. */
export const undoStore = createUndoStore();

export function useUndo(store: UndoStore = undoStore): UndoEntry | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * Offers "Desfazer" for an archive: undo puts each thread back to the status it had (optimistic, like the archive).
 * `restore` is the setStatus mutation of the caller.
 */
/** A short notice in the same slot, without "Desfazer" (2.5 s). */
export function notify(message: string, store: UndoStore = undoStore): number {
  return store.show(message, undefined, 2500);
}

export function offerUndoArchive(message: string, records: readonly ArchiveRecord[], restore: (threadId: string, status: ThreadStatus) => void, store: UndoStore = undoStore): number | null {
  if (!records.length) return null;
  return store.show(message, () => {
    for (const r of records) restore(r.threadId, r.before);
  });
}
