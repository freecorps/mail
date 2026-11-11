// Thread-list actions (M3): swipe settling, which actions each side runs, list prefs, Edit-mode selection, and the
// undo slot after an archive.
import { describe, expect, it, vi } from "vitest";
import {
  archivable,
  bulkReadTarget,
  DEFAULT_LIST_PREFS,
  FULL_SWIPE,
  keepsArchived,
  parseListPrefs,
  project,
  pruneSelection,
  rubberband,
  settleSwipe,
  SWIPE_BUTTON,
  swipeKinds,
  toggleSelected,
} from "../src/model/list-actions";
import { createUndoStore, offerUndoArchive } from "../src/model/undo";

const W = 390;
const row = (o: Partial<{ threadId: string; unread: boolean; status: "open" | "waiting" | "closed" | "spam" | null; pending: boolean; mailbox: string }> = {}) => ({
  threadId: "t1",
  unread: false,
  status: "open" as "open" | "waiting" | "closed" | "spam" | null,
  pending: false,
  mailbox: "support",
  ...o,
});

describe("swipe settling", () => {
  it("rests, opens past half the buttons, commits past the full-swipe point", () => {
    expect(settleSwipe(0, 0, W, 1, 2)).toEqual({ to: "close", side: null });
    expect(settleSwipe(20, 0, W, 1, 2)).toEqual({ to: "close", side: null });
    expect(settleSwipe(-SWIPE_BUTTON, 0, W, 1, 2)).toEqual({ to: "open", side: "trailing" });
    expect(settleSwipe(SWIPE_BUTTON * 0.6, 0, W, 1, 2)).toEqual({ to: "open", side: "leading" });
    expect(settleSwipe(-W * FULL_SWIPE, 0, W, 1, 2)).toEqual({ to: "commit", side: "trailing" });
    expect(settleSwipe(W * FULL_SWIPE + 1, 0, W, 1, 2)).toEqual({ to: "commit", side: "leading" });
  });

  it("a flick counts like a longer drag; a flick back closes; a side without buttons never opens", () => {
    // Short distance, fast toward the side: commits.
    expect(settleSwipe(-80, -2500, W, 1, 2).to).toBe("commit");
    // Far out but flung back toward rest: closes.
    expect(settleSwipe(-120, 900, W, 1, 2).to).toBe("close");
    expect(settleSwipe(150, 0, W, 0, 2)).toEqual({ to: "close", side: null });
  });

  it("projection and rubber band are monotonic and bounded", () => {
    expect(project(0)).toBe(0);
    expect(project(1000)).toBeGreaterThan(project(500));
    expect(Math.abs(rubberband(10_000, W))).toBeLessThan(W);
    expect(rubberband(-50, W)).toBeLessThan(0);
  });
});

describe("swipe kinds", () => {
  it("leading and trailing from prefs, Assign beside the trailing edge action in shared mailboxes", () => {
    expect(swipeKinds(row(), DEFAULT_LIST_PREFS, true)).toEqual({ leading: "read", trailing: ["archive", "assign"] });
    expect(swipeKinds(row(), DEFAULT_LIST_PREFS, false)).toEqual({ leading: "read", trailing: ["archive"] });
    expect(swipeKinds(row(), { swipeLeading: "none", swipeTrailing: "assign" }, true)).toEqual({ leading: null, trailing: ["assign"] });
    expect(swipeKinds(row(), { swipeLeading: "assign", swipeTrailing: "archive" }, false)).toEqual({ leading: null, trailing: ["archive"] });
  });

  it("search hits and rows not on the server yet take no swipes", () => {
    expect(swipeKinds(row({ status: null }), DEFAULT_LIST_PREFS, true)).toEqual({ leading: null, trailing: [] });
    expect(swipeKinds(row({ pending: true }), DEFAULT_LIST_PREFS, true)).toEqual({ leading: null, trailing: [] });
  });
});

describe("list prefs", () => {
  it("defaults, partial and malformed storage", () => {
    expect(parseListPrefs(null)).toEqual(DEFAULT_LIST_PREFS);
    expect(parseListPrefs("{nope")).toEqual(DEFAULT_LIST_PREFS);
    expect(parseListPrefs(JSON.stringify({ avatars: false, previewLines: 3 }))).toEqual({ ...DEFAULT_LIST_PREFS, avatars: false, previewLines: 3 });
    expect(parseListPrefs(JSON.stringify({ previewLines: 9, swipeLeading: "delete", avatars: "yes" }))).toEqual(DEFAULT_LIST_PREFS);
  });
});

describe("edit mode", () => {
  it("bulk read marks read when anything is unread, else unread", () => {
    expect(bulkReadTarget([row({ unread: true }), row()])).toBe("read");
    expect(bulkReadTarget([row(), row()])).toBe("unread");
  });

  it("selection follows the list and toggles", () => {
    const sel = toggleSelected(toggleSelected(new Set(), "t1"), "t2");
    expect([...sel]).toEqual(["t1", "t2"]);
    expect([...toggleSelected(sel, "t1")]).toEqual(["t2"]);
    // t2 left the list (archived in a filtered view), t3 is a search hit: neither stays selected.
    expect([...pruneSelection(new Set(["t1", "t2", "t3"]), [row(), row({ threadId: "t3", status: null })])]).toEqual(["t1"]);
    // Unchanged selection keeps its identity (no re-render loop).
    const same = new Set(["t1"]);
    expect(pruneSelection(same, [row()])).toBe(same);
  });

  it("archive records the status before, skips already archived and pending rows", () => {
    expect(archivable([row({ status: "waiting" }), row({ threadId: "t2", status: "closed" }), row({ threadId: "t3", pending: true })])).toEqual([{ threadId: "t1", before: "waiting" }]);
  });

  it("which lists keep an archived thread", () => {
    expect(keepsArchived({ mailbox: "support" }, "all")).toBe(true);
    expect(keepsArchived({ mailbox: "support" }, "open")).toBe(false);
    expect(keepsArchived({ view: "all" }, "all")).toBe(true);
    expect(keepsArchived({ view: "assigned" }, "all")).toBe(false);
    expect(keepsArchived({ view: "waiting" }, "all")).toBe(false);
  });
});

describe("undo", () => {
  it("one slot: a newer action replaces it, undo runs once, it expires", () => {
    vi.useFakeTimers();
    try {
      const store = createUndoStore({ ms: 5000 });
      const first = vi.fn();
      const second = vi.fn();
      store.show("a", first);
      store.show("b", second);
      expect(store.get()?.message).toBe("b");
      store.undo();
      store.undo();
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
      expect(store.get()).toBeNull();
      store.show("c", first);
      vi.advanceTimersByTime(5001);
      expect(store.get()).toBeNull();
      // A stale dismiss (an older snackbar closing) leaves the newer entry alone.
      const id = store.show("d", first);
      store.show("e", second);
      store.dismiss(id);
      expect(store.get()?.message).toBe("e");
    } finally {
      vi.useRealTimers();
    }
  });

  it("undoing an archive restores each thread's previous status", () => {
    const store = createUndoStore();
    const restore = vi.fn();
    expect(offerUndoArchive("x", [], restore, store)).toBeNull();
    offerUndoArchive("2 archived", [{ threadId: "t1", before: "open" }, { threadId: "t2", before: "waiting" }], restore, store);
    store.undo();
    expect(restore.mock.calls).toEqual([["t1", "open"], ["t2", "waiting"]]);
  });
});

describe("pull-to-refresh connectivity", () => {
  it("a nudge's online/offline wins over a stale source until the source reports itself", async () => {
    const { nudgeable } = await import("../src/client");
    let emitBase: (e: "online" | "offline" | "foreground" | "background") => void = () => {};
    let online = false;
    const c = nudgeable({ isOnline: () => online, subscribe: (emit) => ((emitBase = emit), () => {}) });
    const seen: string[] = [];
    c.source!.subscribe((e) => void seen.push(e));
    expect(c.source!.isOnline!()).toBe(false);
    c.nudge("online");
    c.nudge("foreground");
    expect(c.source!.isOnline!()).toBe(true);
    expect(seen).toEqual(["online", "foreground"]);
    online = false;
    emitBase("offline");
    expect(c.source!.isOnline!()).toBe(false);
  });
});
