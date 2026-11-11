// Undo send: a send waits a few seconds (Ajustes → Desfazer envio: 0, 5, 10 or 20 s) before its mutation runs. Until
// then the conversation shows it as scheduled and "Desfazer" takes it back into the composer; nothing has reached the
// server (the optimistic update only starts when the mutation does). Module-level so a scheduled send survives the
// composer closing or the member opening another conversation.
import { useSyncExternalStore } from "react";

export interface Scheduled {
  id: string;
  /** The conversation it goes to (null: a new conversation). */
  threadId: string | null;
  kind: "reply" | "note" | "compose" | "forward";
  text: string;
  sendAt: number;
}

type Entry = { item: Scheduled; timer: ReturnType<typeof setTimeout>; run: () => void; undo: () => void };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let snapshot: Scheduled[] = [];
let seq = 0;

function changed() {
  snapshot = [...entries.values()].map((e) => e.item);
  for (const l of listeners) l();
}

/**
 * Runs `run` after `delayMs` (at once when 0) unless undone first; `undo` gives the content back. Returns the id (null
 * when it ran at once).
 */
export function schedule(
  o: Omit<Scheduled, "id" | "sendAt">,
  delayMs: number,
  run: () => void,
  undo: () => void,
  now: () => number = Date.now,
): string | null {
  if (delayMs <= 0) {
    run();
    return null;
  }
  const id = `send-${++seq}`;
  const timer = setTimeout(() => {
    if (!entries.delete(id)) return;
    changed();
    run();
  }, delayMs);
  entries.set(id, { item: { ...o, id, sendAt: now() + delayMs }, timer, run, undo });
  changed();
  return id;
}

/** Takes a scheduled send back (false when it already went). */
export function undoSend(id: string): boolean {
  const e = entries.get(id);
  if (!e) return false;
  clearTimeout(e.timer);
  entries.delete(id);
  changed();
  e.undo();
  return true;
}

export function scheduledSends(): Scheduled[] {
  return snapshot;
}

/** The scheduled sends (of one conversation when `threadId` is given). */
export function useScheduled(threadId?: string): Scheduled[] {
  const all = useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => snapshot,
  );
  return threadId === undefined ? all : all.filter((s) => s.threadId === threadId);
}
