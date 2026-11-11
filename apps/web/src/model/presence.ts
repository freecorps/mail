// Presence ("Bia está vendo", "Bia está respondendo…"): the member's own heartbeat while a conversation is visible,
// and who else is on it. The server keeps a row 30 s after the last heartbeat and writes nothing for a heartbeat that
// changes nothing within 15 s, so one every 10 s keeps the row alive without churn; `null` leaves at once.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { api, type PresenceRow, type PresenceState } from "@/lib/api";
import { isOptimisticId } from "@/lib/optimistic";
import type { StringKey, Vars } from "@/i18n/strings";

/** How often the heartbeat goes (the row lives 30 s after the last one). */
export const HEARTBEAT_MS = 10_000;
/** Replying → viewing waits this long: a blur and a focus back (a click on a toolbar button) send nothing. */
export const SETTLE_MS = 4_000;

export interface PresenceTimers {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const realTimers: PresenceTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * The heartbeat of one conversation (pure state machine; tested). `set` says what the member is doing now (null:
 * not there, such as a hidden tab); a change goes at once (replying → viewing after SETTLE_MS), and the state repeats
 * every HEARTBEAT_MS while it is not null. `stop` leaves (one `null` if anything was sent) and ends the timers.
 */
export function presenceBeat(send: (state: PresenceState | null) => void, timers: PresenceTimers = realTimers) {
  let sent: PresenceState | null = null;
  let beat: unknown = null;
  let settle: unknown = null;
  let stopped = false;
  const clearSettle = () => {
    if (settle !== null) timers.clearTimeout(settle);
    settle = null;
  };
  const go = (state: PresenceState | null) => {
    if (state === sent) return;
    sent = state;
    send(state);
    if (beat !== null) timers.clearInterval(beat);
    beat = state === null ? null : timers.setInterval(() => sent !== null && send(sent), HEARTBEAT_MS);
  };
  return {
    set(state: PresenceState | null) {
      if (stopped) return;
      clearSettle();
      if (state === "viewing" && sent === "replying") settle = timers.setTimeout(() => go("viewing"), SETTLE_MS);
      else go(state);
    },
    stop() {
      if (stopped) return;
      clearSettle();
      go(null);
      stopped = true;
    },
  };
}

/**
 * Sends the member's presence on `threadId` while the conversation is mounted and the tab is visible: `replying`
 * while `replying` is true, `viewing` otherwise; `null` when the tab hides or the conversation closes.
 */
export function useOwnPresence(threadId: string, replying: boolean, enabled = true) {
  const setPresence = useMutation(api.inbox.setPresence);
  const beat = useRef<ReturnType<typeof presenceBeat> | null>(null);
  const replyingNow = useRef(replying);
  useLayoutEffect(() => {
    replyingNow.current = replying;
  });
  const on = enabled && !isOptimisticId(threadId);
  useEffect(() => {
    if (!on) return;
    const b = presenceBeat((state) => void setPresence({ threadId, state }).catch(() => {}));
    beat.current = b;
    const apply = () => b.set(document.visibilityState === "hidden" ? null : replyingNow.current ? "replying" : "viewing");
    apply();
    document.addEventListener("visibilitychange", apply);
    // Closing the tab: the row would otherwise stay until it expires (30 s).
    const leave = () => b.stop();
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", apply);
      window.removeEventListener("pagehide", leave);
      b.stop();
      beat.current = null;
    };
  }, [threadId, on, setPresence]);
  useEffect(() => {
    if (document.visibilityState === "hidden") return;
    beat.current?.set(replying ? "replying" : "viewing");
  }, [replying]);
}

/** Who else is on the conversation now (never the member). */
export function usePresence(threadId: string): PresenceRow[] {
  const s = useQuerySnapshot(api.inbox.presence, isOptimisticId(threadId) ? "skip" : { threadId });
  return useMemo(() => s.value ?? [], [s.value]);
}

/**
 * The line for the header: those replying first (they matter more), else those viewing. One first name, two, or the
 * first and how many more. Null when nobody is there.
 */
export function presenceLine(rows: readonly PresenceRow[]): { state: PresenceState; key: StringKey; vars: Vars } | null {
  const replying = rows.filter((r) => r.state === "replying");
  const who = replying.length ? replying : rows.filter((r) => r.state === "viewing");
  if (!who.length) return null;
  const state: PresenceState = replying.length ? "replying" : "viewing";
  // First names keep the line short in the header; the tooltip lists the full names.
  const first = (r: PresenceRow) => r.name.trim().split(/\s+/)[0] || r.name;
  if (who.length === 1) return { state, key: `presence.${state}.one`, vars: { name: first(who[0]!) } };
  if (who.length === 2) return { state, key: `presence.${state}.two`, vars: { a: first(who[0]!), b: first(who[1]!) } };
  return { state, key: `presence.${state}.many`, vars: { name: first(who[0]!), count: who.length - 1 } };
}
