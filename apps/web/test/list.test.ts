// The thread list's pure rules: date groups, selection, plurals, the selection keys and the undo after archive.
import type { OptimisticLocalStore, PendingMutationRecord } from "@freecorps/ember-client";
import { describe, expect, it } from "vite-plus/test";
import { plural, translate } from "@/i18n/strings";
import type { Page, Thread } from "@/lib/api";
import { inboxOptimisticUpdates } from "@/lib/optimistic";
import { escapeStep, shortcutFor } from "@/model/keys";
import {
  cursorIndex,
  dateGroup,
  extendSelection,
  listItems,
  loadMoreDue,
  selectable,
  selectRange,
  toggleSelected,
  visibleSelection,
} from "@/model/listItems";
import { threadRow } from "@/model/threads";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
// Wednesday 11 Nov 2026, 15:00 (the week started Sunday 8 Nov in pt-BR and en-US).
const NOW = at(2026, 11, 11, 15);

const thread = (o: Partial<Thread> = {}): Thread => ({
  _id: "t1",
  _creationTime: 0,
  mailbox: "support",
  number: 7,
  subject: "Fatura",
  subjectKey: "fatura",
  contact: "ana@user.test",
  status: "open",
  token: "tok",
  messageCount: 1,
  unreadCount: 0,
  lastMessageAt: 1000,
  snippet: "",
  ...o,
});

describe("date groups", () => {
  it("today, yesterday, this week, then months (with the year when not this one)", () => {
    const g = (t: number) => dateGroup(t, NOW, "pt-BR").label;
    expect(g(at(2026, 11, 11, 0))).toBe("Hoje");
    expect(g(NOW + 60_000)).toBe("Hoje"); // a clock a little ahead
    expect(g(at(2026, 11, 10, 23))).toBe("Ontem");
    expect(g(at(2026, 11, 8, 1))).toBe("Esta semana");
    expect(g(at(2026, 11, 7))).toBe("Novembro");
    expect(g(at(2026, 10, 31))).toBe("Outubro");
    expect(g(at(2025, 12, 31))).toBe("Dezembro de 2025");
    expect(dateGroup(at(2026, 10, 31), NOW, "en").label).toBe("October");
  });

  it("a header before each group; search results (not dated) get none", () => {
    const rows = [at(2026, 11, 11), at(2026, 11, 11, 9), at(2026, 11, 10), at(2026, 9, 2)].map((t, i) =>
      threadRow(thread({ _id: `t${i}`, lastMessageAt: t })),
    );
    const items = listItems(rows, { grouped: true, now: NOW, locale: "pt-BR" });
    expect(items.map((x) => (x.kind === "group" ? x.label : x.row.threadId))).toEqual([
      "Hoje",
      "t0",
      "t1",
      "Ontem",
      "t2",
      "Setembro",
      "t3",
    ]);
    expect(new Set(items.map((x) => x.key)).size).toBe(items.length);
    expect(listItems(rows, { grouped: false, now: NOW, locale: "pt-BR" }).every((x) => x.kind === "row")).toBe(true);
    expect(listItems([], { grouped: true, now: NOW, locale: "pt-BR" })).toEqual([]);
  });
});

describe("selection", () => {
  const ids = ["a", "b", "c", "d", "e"];
  it("toggle, range from the anchor (either direction), extend with shift+j/k", () => {
    expect([...toggleSelected(new Set(["a"]), "a")]).toEqual([]);
    expect([...toggleSelected(new Set(["a"]), "b")]).toEqual(["a", "b"]);
    expect([...selectRange(ids, new Set(), "b", "d")].sort()).toEqual(["b", "c", "d"]);
    expect([...selectRange(ids, new Set(["e"]), "d", "b")].sort()).toEqual(["b", "c", "d", "e"]);
    expect([...selectRange(ids, new Set(), null, "c")]).toEqual(["c"]);
    expect([...selectRange(ids, new Set(), "gone", "c")]).toEqual(["c"]);
    const down = extendSelection(ids, new Set(), "b", 1);
    expect(down.cursor).toBe("c");
    expect([...down.selected].sort()).toEqual(["b", "c"]);
    // At the end it stays put; with no cursor it starts at the first (down) or last (up) row.
    expect(extendSelection(ids, new Set(), "e", 1).cursor).toBe("e");
    expect(extendSelection(ids, new Set(), null, -1)).toMatchObject({ cursor: "e" });
    expect(extendSelection([], new Set(["a"]), "a", 1).cursor).toBeNull();
  });

  it("only rows still in the list count", () => {
    const rows = [{ threadId: "a" }, { threadId: "c" }];
    expect(visibleSelection(new Set(["a", "b"]), rows)).toEqual([{ threadId: "a" }]);
    expect(visibleSelection(new Set(), rows)).toEqual([]);
  });

  it("pending rows (not confirmed by the server) are never selected nor acted on", () => {
    const rows = [{ threadId: "a" }, { threadId: "optimistic:1", pending: true }, { threadId: "c", pending: false }];
    // Select all, shift-click and the bulk bar all go through these.
    expect(selectable(rows).map((r) => r.threadId)).toEqual(["a", "c"]);
    expect(
      [
        ...selectRange(
          selectable(rows).map((r) => r.threadId),
          new Set(),
          "a",
          "c",
        ),
      ].sort(),
    ).toEqual(["a", "c"]);
    expect(visibleSelection(new Set(["a", "optimistic:1"]), rows).map((r) => r.threadId)).toEqual(["a"]);
  });

  it("pending ids never enter the selection: x, shift-click, shift+j/k", () => {
    const ids = ["a", "p", "c"];
    const can = (id: string) => id !== "p";
    expect([...toggleSelected(new Set(), "p", can)]).toEqual([]);
    expect([...toggleSelected(new Set(["a"]), "a", can)]).toEqual([]);
    expect([...selectRange(ids, new Set(), "a", "c", can)].sort()).toEqual(["a", "c"]);
    expect([...selectRange(ids, new Set(), null, "p", can)]).toEqual([]);
    // The cursor still moves onto (and past) the pending row; only the confirmed rows join.
    const down = extendSelection(ids, new Set(), "a", 1, can);
    expect(down).toEqual({ selected: new Set(["a"]), cursor: "p" });
    expect(extendSelection(ids, down.selected, down.cursor, 1, can)).toEqual({ selected: new Set(["a", "c"]), cursor: "c" });
  });

  it("Escape: a selection that left the list does not swallow it (the open conversation closes)", () => {
    const rows = [{ threadId: "a" }];
    const selected = visibleSelection(new Set(["gone"]), rows).length;
    expect(escapeStep({ inField: false, selected, thread: true })).toBe("close");
    expect(escapeStep({ inField: false, selected: 1, thread: true })).toBe("clear");
    expect(escapeStep({ inField: true, selected: 1, thread: true })).toBe("blur");
    expect(escapeStep({ inField: false, selected: 0, thread: false })).toBeNull();
  });

  it("keys: x selects, shift+j/k and shift+arrows extend, not in a field", () => {
    expect(shortcutFor({ key: "x" }, false)).toBe("select");
    expect(shortcutFor({ key: "J", shiftKey: true }, false)).toBe("extendNext");
    expect(shortcutFor({ key: "K", shiftKey: true }, false)).toBe("extendPrev");
    expect(shortcutFor({ key: "ArrowDown", shiftKey: true }, false)).toBe("extendNext");
    expect(shortcutFor({ key: "ArrowUp" }, false)).toBe("prev");
    expect(shortcutFor({ key: "x" }, true)).toBeNull();
    // Caps Lock: "J"/"K" without Shift still move; Shift with Caps Lock ("j") still extends.
    expect(shortcutFor({ key: "J" }, false)).toBe("next");
    expect(shortcutFor({ key: "K" }, false)).toBe("prev");
    expect(shortcutFor({ key: "E" }, false)).toBe("archive");
    expect(shortcutFor({ key: "j", shiftKey: true }, false)).toBe("extendNext");
  });

  it("counted strings pick one/other by locale", () => {
    const say = (n: number) => translate("pt-BR", plural("pt-BR", "list.selected", n), { count: n });
    expect(say(1)).toBe("1 selecionada");
    expect(say(3)).toBe("3 selecionadas");
    expect(translate("en", plural("en", "list.archivedMany", 2), { count: 2 })).toBe("2 conversations archived");
    expect(translate("en", plural("en", "threads.results", 1), { count: 1 })).toBe("1 result");
  });
});

/** A minimal optimistic store over a map (the client's real store has the same surface). */
function store(init: Record<string, Array<{ args: any; value: any }>>): OptimisticLocalStore & { dump(name: string): any[] } {
  const data = new Map(Object.entries(init).map(([k, v]) => [k, v.map((x) => ({ ...x }))]));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return {
    getQuery: (name: any, args: any) => data.get(name)?.find((e) => same(e.args, args))?.value,
    getAllQueries: (name: any) => data.get(name) ?? [],
    setQuery: (name: any, args: any, value: any) => {
      const list = data.get(name) ?? [];
      const e = list.find((x) => same(x.args, args));
      if (e) e.value = value;
      else list.push({ args, value });
      data.set(name, list);
    },
    dump: (name: string) => (data.get(name) ?? []).map((e) => e.value),
  } as any;
}

describe("undo after archive", () => {
  const u = inboxOptimisticUpdates(() => 5000);
  const rec = {} as PendingMutationRecord;
  const page = (ts: Thread[], isDone = true): Page<Thread> => ({ page: ts, isDone, continueCursor: null });

  it("Desfazer brings the thread back, in date order, into the lists that dropped it", () => {
    const a = thread({ _id: "a", lastMessageAt: 3000 });
    const b = thread({ _id: "b", lastMessageAt: 2000 });
    const c = thread({ _id: "c", lastMessageAt: 1000 });
    const s = store({
      "inbox:threads": [{ args: { mailbox: "support", status: "open" }, value: page([a, b, c]) }],
      "inbox:view": [{ args: { view: "all", status: "open", limit: 30 }, value: { page: [a, b, c], isDone: true, partial: false } }],
    });
    u["inbox:setStatus"]!(s, { threadId: "b", status: "closed" }, rec);
    expect(s.dump("inbox:threads")[0].page.map((t: Thread) => t._id)).toEqual(["a", "c"]);
    expect(s.dump("inbox:view")[0].page.map((t: Thread) => t._id)).toEqual(["a", "c"]);
    // The server confirmed the archive (its answer no longer lists b), then the undo runs.
    u["inbox:setStatus"]!(s, { threadId: "b", status: "open" }, rec);
    expect(s.dump("inbox:threads")[0].page.map((t: Thread) => t._id)).toEqual(["a", "b", "c"]);
    expect(s.dump("inbox:view")[0].page.map((t: Thread) => t._id)).toEqual(["a", "b", "c"]);
    expect(s.dump("inbox:threads")[0].page[1].status).toBe("open");
  });

  it("not into a page that has not loaded that far, nor into another mailbox's list", () => {
    const s = store({
      "inbox:threads": [
        {
          args: { mailbox: "support", status: "open" },
          value: page([thread({ _id: "x", lastMessageAt: 9000 }), thread({ _id: "old", lastMessageAt: 50 })]),
        },
        { args: { mailbox: "support", status: "waiting" }, value: page([thread({ _id: "y", lastMessageAt: 8000 })], false) },
        { args: { mailbox: "privacy", status: "open" }, value: page([]) },
      ],
    });
    u["inbox:setStatus"]!(s, { threadId: "old", status: "closed" }, rec);
    u["inbox:setStatus"]!(s, { threadId: "old", status: "waiting" }, rec);
    const [open, waiting, privacy] = s.dump("inbox:threads");
    expect(open.page.map((t: Thread) => t._id)).toEqual(["x"]);
    expect(waiting.page.map((t: Thread) => t._id)).toEqual(["y"]); // older than what the page holds
    expect(privacy.page).toEqual([]);
  });
});

describe("scrolling", () => {
  const row = (id: string, day: number) => threadRow(thread({ _id: id, lastMessageAt: at(2026, 11, day) }));
  const items = listItems([row("a", 11), row("b", 10), row("c", 9)], { grouped: true, now: NOW, locale: "pt-BR" });

  it("the cursor is followed when it moves, not when the list changes under it", () => {
    const i = cursorIndex(items, "b", null);
    expect(items[i]).toMatchObject({ kind: "row", row: { threadId: "b" } });
    // Same cursor, a new list (a page loaded, new mail on top, the minute tick): no scroll back to it.
    const more = listItems([row("new", 11), ...items.flatMap((x) => (x.kind === "row" ? [x.row] : []))], {
      grouped: true,
      now: NOW,
      locale: "pt-BR",
    });
    expect(cursorIndex(more, "b", "b")).toBe(-1);
    // Moved: followed again. Not loaded yet: waits.
    expect(cursorIndex(more, "c", "b")).toBeGreaterThan(0);
    expect(cursorIndex(items, "later", null)).toBe(-1);
    expect(cursorIndex(items, null, "b")).toBe(-1);
  });

  it("the next page: once per length of each list, so another list of the same length still pages", () => {
    const base = { place: "inbox", count: 31, lastIndex: 28, canLoadMore: true, loading: false, asked: null };
    expect(loadMoreDue(base)).toBe(true);
    expect(loadMoreDue({ ...base, asked: { place: "inbox", count: 31 } })).toBe(false);
    expect(loadMoreDue({ ...base, place: "view:assigned", asked: { place: "inbox", count: 31 } })).toBe(true);
    expect(loadMoreDue({ ...base, lastIndex: 20 })).toBe(false);
    expect(loadMoreDue({ ...base, loading: true })).toBe(false);
    expect(loadMoreDue({ ...base, canLoadMore: false })).toBe(false);
  });
});

describe("conversation folds", () => {
  it("long conversations keep the first and the last three, the rest behind one line", async () => {
    const { foldMessages } = await import("@/model/thread");
    expect(foldMessages(3, false).map((f) => f.kind)).toEqual(["message", "message", "message"]);
    expect(foldMessages(5, false)).toHaveLength(5);
    expect(foldMessages(9, false)).toEqual([
      { kind: "message", index: 0 },
      { kind: "fold", from: 1, count: 5 },
      { kind: "message", index: 6 },
      { kind: "message", index: 7 },
      { kind: "message", index: 8 },
    ]);
    expect(foldMessages(9, true)).toHaveLength(9);
    expect(foldMessages(0, false)).toEqual([]);
  });
});
