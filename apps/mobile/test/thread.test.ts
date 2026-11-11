// The conversation's layout rules (M4): which messages are open, the collapsed preview, previous / next, remembered
// image senders, and the undo slot's plain notices.
import { describe, expect, it, vi } from "vitest";
import { collapsedCount, imagesAllowed, isExpanded, keepOpened, latestId, neighbors, parseSenders, previewLine, senderKey } from "../src/model/thread-view";
import { createUndoStore, notify } from "../src/model/undo";

const items = (ids: string[], pending: string[] = []) => ids.map((id) => ({ message: { _id: id }, pending: pending.includes(id) }));

describe("expanded messages", () => {
  it("only the newest is open; pending ones, opened ones and Expandir tudo open the rest", () => {
    const list = items(["a", "b", "c"]);
    const latest = latestId(list.map((i) => i.message));
    expect(latest).toBe("c");
    const o = { latest, opened: new Set<string>(), all: false };
    expect(list.map((i) => isExpanded(i.message._id, o))).toEqual([false, false, true]);
    expect(collapsedCount(list, o)).toBe(2);
    expect(isExpanded("a", { ...o, opened: new Set(["a"]) })).toBe(true);
    expect(isExpanded("b", { ...o, pending: true })).toBe(true);
    expect(collapsedCount(list, { ...o, all: true })).toBe(0);
    expect(collapsedCount(items(["a", "b", "c"], ["b"]), o)).toBe(1);
    expect(latestId([])).toBeNull();
  });

  it("a new message keeps the one that was newest open", () => {
    expect([...keepOpened(new Set(["x"]), "c", "d")].sort()).toEqual(["c", "x"]);
    expect([...keepOpened(new Set(), "c", "c")]).toEqual([]);
    expect([...keepOpened(new Set(), null, "c")]).toEqual([]);
  });
});

describe("collapsed preview", () => {
  it("drops the quoted history and the attribution line, joins lines, cuts emoji-safely", () => {
    expect(previewLine({ text: "Oi Bia,\n\nObrigada!\n\nEm 5 de nov. de 2026, Ana escreveu:\n> antigo", snippet: "x" })).toBe("Oi Bia, Obrigada!");
    expect(previewLine({ text: "On Mon, Ana wrote:\n> old", snippet: "snippet" })).toBe("snippet");
    expect(previewLine({ text: "Veja\n---------- Mensagem encaminhada ----------\nDe: x", snippet: "" })).toBe("Veja");
    expect(previewLine({ text: "", snippet: "  só   o snippet " })).toBe("só o snippet");
    const long = previewLine({ text: "😀".repeat(200), snippet: "" }, 10);
    expect(Array.from(long)).toHaveLength(10);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("previous / next", () => {
  const order = [
    { threadId: "1", mailbox: "s" },
    { threadId: "2", mailbox: "s" },
    { threadId: "3", mailbox: "p" },
  ];
  it("neighbors in the list it came from, none at the ends or when absent", () => {
    expect(neighbors(order, "2")).toEqual({ prev: order[0], next: order[2] });
    expect(neighbors(order, "1").prev).toBeNull();
    expect(neighbors(order, "3").next).toBeNull();
    expect(neighbors(order, "9")).toEqual({ prev: null, next: null });
  });
});

describe("remote image senders", () => {
  it("keys by lowercase address, parses only arrays of addresses", () => {
    const set = parseSenders(JSON.stringify([" News@Shop.TEST ", 3, "nope"]));
    expect([...set]).toEqual(["news@shop.test"]);
    expect(imagesAllowed(set, "NEWS@shop.test")).toBe(true);
    expect(imagesAllowed(set, "other@shop.test")).toBe(false);
    expect(parseSenders("{bad")).toEqual(new Set());
    expect(parseSenders(null)).toEqual(new Set());
    expect(senderKey(" A@B.C ")).toBe("a@b.c");
  });
});

describe("notices in the undo slot", () => {
  it("a notice has no undo and leaves after its own short time", () => {
    vi.useFakeTimers();
    const store = createUndoStore();
    notify("Link copiado", store);
    expect(store.get()).toMatchObject({ message: "Link copiado", undo: undefined });
    store.undo(); // nothing to run; just hides it
    expect(store.get()).toBeNull();
    notify("Link copiado", store);
    vi.advanceTimersByTime(2600);
    expect(store.get()).toBeNull();
    vi.useRealTimers();
  });
});
