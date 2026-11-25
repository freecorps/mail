// The "Offline" / "N actions waiting for a connection" strip, steadied. The client counts every mutation in flight as
// pending, so a plain `pendingMutations > 0` showed the strip for each mark-as-read or presence beat on a good
// connection and hid it a moment later: the screen jumped. Now the strip shows what lasts: offline after a short
// grace, actions only once they have waited a few seconds (a connected round trip never does), and once shown it stays
// a little so a flapping state does not blink it. Pure (tested); `useConnectionBanner` drives it with one timer.
import { useConnectionState } from "@freecorps/ember-react-native";
import { useEffect, useReducer, useRef } from "react";

export type BannerKind = "offline" | "pending";

export const BANNER_TIMING = {
  /** Offline this long before the strip says so (a network hand-off is not "offline"). */
  offlineAfter: 1_000,
  /** Actions waiting this long, online, before the strip shows them. */
  pendingAfter: 4_000,
  /** Once shown, at least this long on screen. */
  minShown: 2_000,
  /** Nothing to say for this long before the strip goes. */
  hideAfter: 800,
} as const;

export interface BannerState {
  /** What the strip shows now. */
  shown: BannerKind | null;
  /** What the connection says now, and since when. */
  want: BannerKind | null;
  wantSince: number;
  shownAt: number;
}

export const initialBanner: BannerState = { shown: null, want: null, wantSince: 0, shownAt: 0 };

/** What the connection would show, unsteadied. */
export function bannerWant(c: { online: boolean; pendingMutations: number }): BannerKind | null {
  if (!c.online) return "offline";
  return c.pendingMutations > 0 ? "pending" : null;
}

/** The next state at `now`, and when to look again (null: nothing will change until the connection does). */
export function stepBanner(s: BannerState, want: BannerKind | null, now: number): { state: BannerState; wakeAt: number | null } {
  const st: BannerState = want === s.want ? { ...s } : { ...s, want, wantSince: now };
  if (want) {
    if (st.shown === want) return { state: st, wakeAt: null };
    // Already showing the other kind (offline → reconnected with a queue): switch at once, no new grace.
    const due = st.shown ? now : st.wantSince + (want === "offline" ? BANNER_TIMING.offlineAfter : BANNER_TIMING.pendingAfter);
    if (now >= due) return { state: { ...st, shown: want, shownAt: st.shown ? st.shownAt : now }, wakeAt: null };
    return { state: st, wakeAt: due };
  }
  if (!st.shown) return { state: st, wakeAt: null };
  const due = Math.max(st.shownAt + BANNER_TIMING.minShown, st.wantSince + BANNER_TIMING.hideAfter);
  if (now >= due) return { state: { ...st, shown: null }, wakeAt: null };
  return { state: st, wakeAt: due };
}

/** The steadied strip: `kind` to show (or null) and the live connection for its text. */
export function useConnectionBanner(): { kind: BannerKind | null; online: boolean; pendingMutations: number } {
  const c = useConnectionState();
  const want = bannerWant(c);
  const state = useRef<BannerState>(initialBanner);
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  // Stepped while rendering, so the strip never shows a frame of the raw state (a step is idempotent at one time).
  const r = stepBanner(state.current, want, Date.now());
  state.current = r.state;
  const wakeAt = r.wakeAt;
  // One timer, to the next moment the strip may change (a fixed time: re-renders do not push it back).
  useEffect(() => {
    if (wakeAt === null) return;
    const id = setTimeout(bump, Math.max(0, wakeAt - Date.now()));
    return () => clearTimeout(id);
  }, [wakeAt, tick]);
  return { kind: r.state.shown, online: c.online, pendingMutations: c.pendingMutations };
}
