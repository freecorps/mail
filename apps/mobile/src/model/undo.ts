// "Desfazer" after an archive: one pending undo at a time (a newer action replaces it, like Mail and Gmail), shown by
// the undo banner for a few seconds. An entry can say what happens when a newer one takes its place (`onReplaced`):
// a send waiting out its undo delay goes out then, since its "Desfazer" is no longer offered. Only another action with
// its own undo (an archive, another send) takes that place: a plain notice ("Link copiado") waits until the send's
// banner ends and shows then, or is dropped if its moment has passed. A plain store (useSyncExternalStore), no React
// Native: tested in vitest.
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

export function createUndoStore(opts: { ms?: number; now?: () => number; setTimeout?: (fn: () => void, ms: number) => Timer; clearTimeout?: (t: Timer) => void } = {}) {
  const set = opts.setTimeout ?? setTimeout;
  const clear = opts.clearTimeout ?? clearTimeout;
  const now = opts.now ?? Date.now;
  let defaultMs = opts.ms ?? 6000;
  let current: UndoEntry | null = null;
  /** What the shown entry does when a newer one replaces it (not when it times out, is undone or dismissed). */
  let replaced: (() => void) | null = null;
  /** A plain notice that came while a send's undo was shown: it shows once that ends (the latest one only). */
  let waiting: { id: number; message: string; ms: number; at: number } | null = null;
  let timer: Timer | null = null;
  let seq = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const stop = () => {
    if (timer !== null) clear(timer);
    timer = null;
  };
  const put = (id: number, message: string, undo: (() => void) | undefined, ms: number, onReplaced: (() => void) | undefined) => {
    current = { id, message, undo };
    replaced = onReplaced ?? null;
    timer = set(() => dismiss(id), ms);
  };
  const dismiss = (id?: number) => {
    if (waiting && id !== undefined && waiting.id === id) {
      waiting = null;
      return;
    }
    if (!current || (id !== undefined && current.id !== id)) return;
    stop();
    current = null;
    replaced = null;
    // The notice that waited shows now, unless its moment has passed.
    const next = waiting;
    waiting = null;
    if (next && now() - next.at < next.ms) put(next.id, next.message, undefined, next.ms, undefined);
    emit();
  };
  return {
    /**
     * Offers an undo for `ms` (longer for screen reader users, who need time to reach the button). `onReplaced` runs if
     * a newer entry takes the slot while this one is still shown.
     */
    show(message: string, undo: (() => void) | undefined, ms = defaultMs, onReplaced?: () => void): number {
      const id = ++seq;
      // A plain notice never takes a waiting send's place (that would send it early): it waits for the slot.
      if (!undo && replaced) {
        waiting = { id, message, ms, at: now() };
        return id;
      }
      stop();
      const before = replaced;
      put(id, message, undo, ms, onReplaced);
      emit();
      before?.();
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
 * For a presenter that can't take back what it shows (Android's snackbars queue and keep their own clock): true the
 * first time it is asked about an entry, false after, so a re-render, a language change or a new object for the same
 * entry never queues it twice. A notice that waited out a send can show after a newer entry (ids are not in order),
 * so it remembers each id, the last few only.
 */
export function createShowOnce(keep = 16) {
  const shown: number[] = [];
  return (id: number): boolean => {
    if (shown.includes(id)) return false;
    shown.push(id);
    if (shown.length > keep) shown.shift();
    return true;
  };
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
