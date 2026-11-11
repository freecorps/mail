// Undo send: a message waits here for the delay set in Ajustes (0, 5, 10 or 20 s) before its mutation runs. Meanwhile
// it shows in the conversation as pending and "Desfazer" cancels it: nothing reached the server, and the composer
// gets the text back (the draft was kept for that). Leaving the app sends what is waiting at once, so a message is
// never lost to a suspended timer. A plain store (useSyncExternalStore), no React Native: tested in vitest.
import { useMemo, useSyncExternalStore } from "react";
import type { UndoStore } from "./undo";

export type OutboxKind = "reply" | "compose" | "forward";

export interface OutboxEntry {
  id: string;
  kind: OutboxKind;
  /** The conversation it goes to (reply), or comes from (forward); none for a new conversation. */
  threadId?: string;
  text: string;
  /** Reply all: who it copies (for the pending message's header). */
  cc?: string[];
  at: number;
  /** When it goes out (ms since epoch). */
  sendsAt: number;
}

type Timer = ReturnType<typeof setTimeout>;
type Job = { entry: OutboxEntry; timer: Timer; run(): void; cancelled?: () => void };

export function createOutbox(opts: { now?: () => number; setTimeout?: (fn: () => void, ms: number) => Timer; clearTimeout?: (t: Timer) => void } = {}) {
  const now = opts.now ?? Date.now;
  const set = opts.setTimeout ?? setTimeout;
  const clear = opts.clearTimeout ?? clearTimeout;
  const jobs = new Map<string, Job>();
  let list: readonly OutboxEntry[] = [];
  let seq = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    list = [...jobs.values()].map((j) => j.entry);
    listeners.forEach((l) => l());
  };
  const take = (id: string): Job | null => {
    const j = jobs.get(id);
    if (!j) return null;
    clear(j.timer);
    jobs.delete(id);
    emit();
    return j;
  };
  return {
    /**
     * Runs `run` after `delayMs` (at once when 0). Returns the entry's id, or null when it ran at once. `cancelled` runs
     * when the member undoes it (to give the text back).
     */
    schedule(e: Omit<OutboxEntry, "id" | "at" | "sendsAt">, delayMs: number, run: () => void, cancelled?: () => void): string | null {
      if (delayMs <= 0) {
        run();
        return null;
      }
      const id = `out${++seq}`;
      const at = now();
      const entry: OutboxEntry = { ...e, id, at, sendsAt: at + delayMs };
      const timer = set(() => take(id)?.run(), delayMs);
      jobs.set(id, { entry, timer, run, ...(cancelled ? { cancelled } : {}) });
      emit();
      return id;
    },
    /** "Desfazer": drops it before it is sent. False when it already went. */
    cancel(id: string): boolean {
      const j = take(id);
      if (!j) return false;
      j.cancelled?.();
      return true;
    },
    /** Sends one now (its "Desfazer" is no longer offered). False when it already went or was undone. */
    sendNow(id: string): boolean {
      const j = take(id);
      if (!j) return false;
      j.run();
      return true;
    },
    /** Sends everything waiting now (the app is going to the background). */
    flushAll() {
      for (const id of [...jobs.keys()]) take(id)?.run();
    },
    get: () => list,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;

/**
 * Schedules a send and offers "Desfazer" for it on the undo banner. Once the send goes out (its delay ran out, or the
 * app went to the background and `flushAll` sent it), the banner goes too: there is nothing left to undo. The banner
 * has one slot: when another action with its own undo takes it (an archive, a second send), this send goes out at
 * once instead of waiting with no way left to undo it. A plain notice ("Link copiado") waits instead (`UndoStore`).
 */
export function scheduleWithUndo(o: {
  outbox: Outbox;
  undo: UndoStore;
  message: string;
  entry: Omit<OutboxEntry, "id" | "at" | "sendsAt">;
  delayMs: number;
  run(): void;
  restore?: (() => void) | undefined;
}): string | null {
  let banner: number | null = null;
  const run = () => {
    if (banner !== null) o.undo.dismiss(banner);
    o.run();
  };
  const id = o.outbox.schedule(o.entry, o.delayMs, run, o.restore);
  if (id) banner = o.undo.show(o.message, () => o.outbox.cancel(id), o.delayMs, () => o.outbox.sendNow(id));
  return id;
}

/** The app's outbox. */
export const outbox = createOutbox();

/** What is waiting to be sent to one conversation (shown there as pending messages). */
export function useOutbox(threadId: string | null, store: Outbox = outbox): OutboxEntry[] {
  const all = useSyncExternalStore(store.subscribe, store.get, store.get);
  return useMemo(() => (threadId ? all.filter((e) => e.kind === "reply" && e.threadId === threadId) : []), [all, threadId]);
}

/** The undo-send delays Ajustes offers, in seconds (0 = off). */
export const UNDO_SEND_DELAYS = [0, 5, 10, 20] as const;
export type UndoSendDelay = (typeof UNDO_SEND_DELAYS)[number];
export const DEFAULT_UNDO_SEND: UndoSendDelay = 5;

export function parseUndoDelay(raw: string | null): UndoSendDelay {
  const n = Number(raw);
  return (UNDO_SEND_DELAYS as readonly number[]).includes(n) && raw !== null && raw !== "" ? (n as UndoSendDelay) : DEFAULT_UNDO_SEND;
}
