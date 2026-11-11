// iPad: the split layout by window width, moving the selection, and the hardware keyboard's commands and registry.
import { describe, expect, it, vi } from "vitest";
import { translate } from "../src/i18n/strings";
import { afterListChange, nextAfter, paneLayout, reselect, SPLIT_MIN_WIDTH, step } from "../src/model/split";
import { actionOf, BINDINGS, createShortcutRegistry, keyCommands, SHORTCUT_TITLES, type ShortcutAction } from "../src/model/shortcuts";

const rows = (...ids: string[]) => ids.map((threadId) => ({ threadId }));
const ids = (r: { threadId: string } | null) => r?.threadId ?? null;

describe("split layout", () => {
  it("splits from the regular width up: iPad full screen, 2/3 and the 13-inch's 1/2, not Slide Over, 1/3 or a phone", () => {
    // iPad Pro 13" landscape / portrait, 11" portrait, iPad mini portrait, 13" half Split View.
    for (const w of [1376, 1032, 834, 744, 678]) expect(paneLayout(w).split, String(w)).toBe(true);
    // 11" half Split View, 1/3, Slide Over, iPhone 18 Pro Max portrait, a phone.
    for (const w of [597, 507, 375, 320, 440, 390]) expect(paneLayout(w).split, String(w)).toBe(false);
    expect(paneLayout(SPLIT_MIN_WIDTH - 1).split).toBe(false);
    expect(paneLayout(Number.NaN).split).toBe(false);
  });

  it("gives the list a Mail-like column within its bounds", () => {
    const width = (w: number) => {
      const l = paneLayout(w);
      return l.split ? l.listWidth : 0;
    };
    expect(width(678)).toBe(320);
    expect(width(1032)).toBe(392);
    expect(width(1376)).toBe(420);
    for (const w of [678, 744, 834, 1032, 1194, 1376, 2000]) expect(width(w)).toBeGreaterThanOrEqual(320), expect(width(w)).toBeLessThanOrEqual(420);
  });
});

describe("selection", () => {
  const list = rows("a", "b", "c");

  it("steps down and up, stays at the ends, starts at the top", () => {
    expect(ids(step(list, "a", 1))).toBe("b");
    expect(ids(step(list, "b", -1))).toBe("a");
    expect(ids(step(list, "c", 1))).toBe("c");
    expect(ids(step(list, "a", -1))).toBe("a");
    expect(ids(step(list, null, 1))).toBe("a");
    expect(ids(step(list, null, -1))).toBe("a");
    expect(ids(step(list, "gone", 1))).toBe("a");
    expect(step([], "a", 1)).toBeNull();
  });

  it("moves on to the next conversation once the open one leaves, the previous one at the end", () => {
    expect(ids(nextAfter(list, "a"))).toBe("b");
    expect(ids(nextAfter(list, "c"))).toBe("b");
    expect(nextAfter(rows("a"), "a")).toBeNull();
    expect(nextAfter(list, "gone")).toBeNull();
  });

  it("opening an unread conversation in Não lidas keeps it open as it leaves; one archived from the list moves on", () => {
    // Read by opening it: it leaves the unread list, and the pane stays on it (it never walks on, reading the rest).
    expect(afterListChange(list, rows("b", "c"), "a", new Set())).toBe("a");
    // Archived or snoozed from the list: the neighbor takes its place.
    expect(afterListChange(list, rows("b", "c"), "a", new Set(["a"]))).toBe("b");
    expect(afterListChange(list, rows("a", "c"), "a", new Set(["a"]))).toBe("a");
    expect(afterListChange(list, list, null, new Set(["a"]))).toBeNull();
  });

  it("keeps a selection still listed and hands a vanished one to its surviving neighbor", () => {
    expect(reselect(list, rows("c", "a", "b"), "a")).toBe("a");
    expect(reselect(list, rows("a", "c"), "b")).toBe("c");
    // Its next neighbor left too: the one after it, else the one before.
    expect(reselect(rows("a", "b", "c", "d"), rows("a", "d"), "b")).toBe("d");
    expect(reselect(list, rows("a"), "c")).toBe("a");
    expect(reselect(list, [], "b")).toBeNull();
    expect(reselect(list, list, null)).toBeNull();
    expect(reselect([], list, "x")).toBeNull();
  });
});

describe("keyboard shortcuts", () => {
  const all = new Set(Object.keys(BINDINGS) as ShortcutAction[]);
  const title = (a: ShortcutAction) => translate("en", SHORTCUT_TITLES[a]);

  it("maps the agreed keys", () => {
    const keys = Object.fromEntries(keyCommands(all, title).map((k) => [k.id, `${k.modifiers.join("+")}${k.modifiers.length ? "+" : ""}${k.input}`]));
    expect(keys).toEqual({
      "compose:0": "command+n",
      "reply:0": "command+r",
      "replyAll:0": "command+shift+r",
      "archive:0": "e",
      "send:0": "command+enter",
      "next:0": "j",
      "next:1": "down",
      "previous:0": "k",
      "previous:1": "up",
      "search:0": "command+f",
      "close:0": "escape",
    });
  });

  it("never lets a bare key or Esc fire while typing, and lists each action once in the overlay", () => {
    for (const k of keyCommands(all, title)) expect(k.whileTyping, k.id).toBe(k.modifiers.length > 0);
    const listed = keyCommands(all, title).filter((k) => k.discoverable);
    expect(listed.map((k) => actionOf(k.id))).toEqual([...new Set(listed.map((k) => actionOf(k.id)))]);
    expect(listed).toHaveLength(all.size);
  });

  it("offers only what some screen handles, titled in the app's language", () => {
    const cmds = keyCommands(new Set<ShortcutAction>(["archive", "compose"]), (a) => translate("pt-BR", SHORTCUT_TITLES[a]));
    expect(cmds.map((c) => [c.id, c.title])).toEqual([
      ["compose:0", "Nova mensagem"],
      ["archive:0", "Arquivar"],
    ]);
    for (const a of all) expect(translate("en", SHORTCUT_TITLES[a])).not.toBe(translate("pt-BR", SHORTCUT_TITLES[a]));
  });

  it("reads the action back from a command id, and nothing from anything else", () => {
    expect(actionOf("next:1")).toBe("next");
    expect(actionOf("send:0")).toBe("send");
    expect(actionOf("toString:0")).toBeNull();
    expect(actionOf("bogus")).toBeNull();
  });
});

describe("shortcut registry", () => {
  it("dispatches to the newest layer that handles the action, falling through to older ones", () => {
    const r = createShortcutRegistry();
    const list = { compose: vi.fn(), next: vi.fn() };
    const pane = { reply: vi.fn(), next: vi.fn() };
    const offList = r.add(() => list);
    const offPane = r.add(() => pane);
    expect(r.dispatch("next")).toBe(true);
    expect(pane.next).toHaveBeenCalledOnce();
    expect(list.next).not.toHaveBeenCalled();
    expect(r.dispatch("compose")).toBe(true);
    expect(list.compose).toHaveBeenCalledOnce();
    expect([...r.actions()].sort()).toEqual(["compose", "next", "reply"]);
    offPane();
    expect(r.dispatch("reply")).toBe(false);
    r.dispatch("next");
    expect(list.next).toHaveBeenCalledOnce();
    offList();
    offList();
    expect(r.actions().size).toBe(0);
  });

  it("skips handlers that are off (false, null, undefined) and reads them fresh at each key", () => {
    const r = createShortcutRegistry();
    let handlers: Record<string, unknown> = { archive: false, reply: null, send: undefined };
    r.add(() => handlers as never);
    expect(r.actions().size).toBe(0);
    expect(r.dispatch("archive")).toBe(false);
    const archive = vi.fn();
    handlers = { archive };
    expect(r.dispatch("archive")).toBe(true);
    expect(archive).toHaveBeenCalledOnce();
  });

  it("tells its listener when layers come and go or change", () => {
    const r = createShortcutRegistry();
    const heard = vi.fn();
    const stop = r.subscribe(heard);
    const off = r.add(() => ({}));
    r.changed();
    off();
    expect(heard).toHaveBeenCalledTimes(3);
    stop();
    r.changed();
    expect(heard).toHaveBeenCalledTimes(3);
  });
});
