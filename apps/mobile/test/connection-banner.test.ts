// The connection strip, steadied: no blink for a mutation in flight on a good connection.
import { describe, expect, it } from "vitest";
import { BANNER_TIMING as T, bannerWant, initialBanner, stepBanner, type BannerKind, type BannerState } from "../src/model/connection-banner";

/** Runs a timeline of (time, want) changes, waking when asked; returns what was shown at each `probe` time. */
function run(events: Array<[number, BannerKind | null]>, probes: number[]) {
  let s: BannerState = initialBanner;
  let wake: number | null = null;
  const times = [...new Set([...events.map((e) => e[0]), ...probes])].sort((a, b) => a - b);
  let want: BannerKind | null = null;
  const out: Array<BannerKind | null> = [];
  for (const now of times) {
    while (wake !== null && wake <= now) {
      const r = stepBanner(s, want, wake);
      s = r.state;
      wake = r.wakeAt;
    }
    const e = events.find((x) => x[0] === now);
    if (e) want = e[1];
    const r = stepBanner(s, want, now);
    s = r.state;
    wake = r.wakeAt;
    if (probes.includes(now)) out.push(s.shown);
  }
  return out;
}

describe("connection strip", () => {
  it("wants offline, then pending, then nothing", () => {
    expect(bannerWant({ online: false, pendingMutations: 2 })).toBe("offline");
    expect(bannerWant({ online: true, pendingMutations: 1 })).toBe("pending");
    expect(bannerWant({ online: true, pendingMutations: 0 })).toBeNull();
  });
  it("a mutation in flight on a good connection never shows it", () => {
    // Mark as read, presence beats: pending for 300 ms every second.
    const events: Array<[number, BannerKind | null]> = [];
    for (let t = 0; t < 10_000; t += 1000) events.push([t, "pending"], [t + 300, null]);
    expect(run(events, [150, 1150, 5150, 9150])).toEqual([null, null, null, null]);
  });
  it("actions stuck for a while show, and the strip stays a moment after they go", () => {
    const shown = run([[0, "pending"], [T.pendingAfter + 100, null]], [T.pendingAfter - 1, T.pendingAfter, T.pendingAfter + 200, T.pendingAfter + T.minShown + 1]);
    expect(shown).toEqual([null, "pending", "pending", null]);
  });
  it("offline after a short grace; a quick network hand-off says nothing", () => {
    expect(run([[0, "offline"], [T.offlineAfter / 2, null]], [T.offlineAfter + 10])).toEqual([null]);
    expect(run([[0, "offline"]], [T.offlineAfter - 1, T.offlineAfter])).toEqual([null, "offline"]);
  });
  it("flapping while shown does not blink it", () => {
    const at = T.offlineAfter;
    expect(run([[0, "offline"], [at + 100, null], [at + 400, "offline"], [at + 500, null]], [at + 200, at + 450, at + 600])).toEqual(["offline", "offline", "offline"]);
  });
  it("from offline to a queue waiting for the socket: switches at once", () => {
    const at = T.offlineAfter;
    expect(run([[0, "offline"], [at + 50, "pending"]], [at + 60])).toEqual(["pending"]);
  });
});
