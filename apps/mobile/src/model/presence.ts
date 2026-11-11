// Presence ("Bia está respondendo…"), pure: who of this member's screens is on a thread (the conversation viewing it,
// the reply bar or the composer replying), the heartbeat that tells the server (`inbox:setPresence` about every 10 s,
// `null` on leaving or in the background), and the quiet line the conversation shows about the others.
// No React Native: tested in vitest with fake timers.
import type { Presence, PresenceState } from "../api";
import type { I18n } from "../i18n";

export const HEARTBEAT_MS = 10_000;

/** What sets a member's presence on a thread: the open conversation, its reply bar, the full composer. */
export type PresenceSource = "view" | "bar" | "composer";

/** The state the server gets from every source of one thread: replying wins over viewing. */
export function effectiveState(states: Iterable<PresenceState | null>): PresenceState | null {
  let out: PresenceState | null = null;
  for (const s of states) {
    if (s === "replying") return "replying";
    if (s === "viewing") out = "viewing";
  }
  return out;
}

type Timer = ReturnType<typeof setInterval>;

export function createPresence(o: {
  send(threadId: string, state: PresenceState | null): void;
  /** Whether a heartbeat can go now (a live connection): presence is never queued offline to replay later. */
  connected(): boolean;
  setInterval?: (fn: () => void, ms: number) => Timer;
  clearInterval?: (t: Timer) => void;
  interval?: number;
}) {
  const every = o.setInterval ?? setInterval;
  const stop = o.clearInterval ?? clearInterval;
  const ms = o.interval ?? HEARTBEAT_MS;
  const threads = new Map<string, Map<PresenceSource, PresenceState>>();
  /** What the server was last told per thread (null: nothing, or left). */
  const told = new Map<string, PresenceState>();
  let timer: Timer | null = null;
  let active = true;

  const current = (threadId: string) => (active ? effectiveState(threads.get(threadId)?.values() ?? []) : null);
  const tell = (threadId: string, state: PresenceState | null) => {
    if (!o.connected()) {
      // Not sent: next time it can go, it goes (the heartbeat, or `reconnected`).
      if (state === null) told.delete(threadId);
      return;
    }
    o.send(threadId, state);
    if (state === null) told.delete(threadId);
    else told.set(threadId, state);
  };
  const sync = (threadId: string) => {
    const want = current(threadId);
    const was = told.get(threadId) ?? null;
    if (want !== was) tell(threadId, want);
    schedule();
  };
  const schedule = () => {
    const any = active && [...threads.keys()].some((id) => current(id) !== null);
    if (any && timer === null) timer = every(beat, ms);
    if (!any && timer !== null) {
      stop(timer);
      timer = null;
    }
  };
  const beat = () => {
    for (const id of threads.keys()) {
      const s = current(id);
      if (s !== null) tell(id, s);
    }
  };
  return {
    /** A source's state on a thread (null: that source left it). */
    set(threadId: string, source: PresenceSource, state: PresenceState | null) {
      let m = threads.get(threadId);
      if (state === null) {
        m?.delete(source);
        if (m && !m.size) threads.delete(threadId);
      } else {
        if (!m) threads.set(threadId, (m = new Map()));
        m.set(source, state);
      }
      sync(threadId);
    },
    /** The app went to the background (false: every thread is left now) or came back (true: told again). */
    setActive(on: boolean) {
      if (active === on) return;
      active = on;
      for (const id of new Set([...threads.keys(), ...told.keys()])) sync(id);
      schedule();
    },
    /**
     * The connection came back: every thread this member is on is told again now, not at the next tick. What the server
     * was told before may have expired while the socket was down (rows live 30 s), so nothing counts as told.
     */
    reconnected() {
      told.clear();
      for (const id of threads.keys()) sync(id);
    },
    /** For tests and the screen: what the server should know now. */
    state: current,
  };
}

export type PresenceController = ReturnType<typeof createPresence>;

/** Names as a short list: "Bia", "Bia e Caio", "Bia, Caio e mais 2". */
function names(list: readonly string[], t: I18n["t"]): string {
  if (list.length === 1) return list[0]!;
  if (list.length === 2) return t("presence.two", { a: list[0]!, b: list[1]! });
  return t("presence.many", { a: list[0]!, b: list[1]!, count: list.length - 2 });
}

/** The conversation's quiet line about the others on it, replying first ("Bia está respondendo…"); null when nobody. */
export function presenceLine(rows: readonly Presence[] | undefined, t: I18n["t"]): { state: PresenceState; text: string } | null {
  const seen = new Set<string>();
  const unique = (rows ?? []).filter((r) => !seen.has(r.userId) && (seen.add(r.userId), true));
  const replying = unique.filter((r) => r.state === "replying").map((r) => r.name);
  if (replying.length) return { state: "replying", text: replying.length === 1 ? t("presence.replying", { who: replying[0]! }) : t("presence.replyingMany", { who: names(replying, t) }) };
  const viewing = unique.filter((r) => r.state === "viewing").map((r) => r.name);
  if (viewing.length) return { state: "viewing", text: viewing.length === 1 ? t("presence.viewing", { who: viewing[0]! }) : t("presence.viewingMany", { who: names(viewing, t) }) };
  return null;
}
