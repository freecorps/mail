// Home-screen widgets: the snapshots built from the inbox's queries (counts, order, deep links), the privacy rules
// (previews off: counts only; signed out: nothing of the inbox) and the throttled, deduplicated writer.
import { describe, expect, it } from "vitest";
import type { Mailbox, Thread, ViewCounts } from "../src/api";
import { buildWidgetSnapshots, MINE_ROWS, signedOutSnapshots, snapshotWriter, UNREAD_ROWS, widgetInputsReady, widgetUrls, type Timers, type WidgetInputs } from "../src/widgets/snapshot";

const box = (name: string, unread: number, o: Partial<Mailbox> = {}): Mailbox => ({ name, address: `${name}@freecorps.com.br`, displayName: null, unread, threads: 10, ...o });
const thread = (id: string, o: Partial<Thread> = {}): Thread => ({
  _id: id,
  _creationTime: 1,
  mailbox: "support",
  number: 7,
  subject: `Assunto ${id}`,
  subjectKey: "x",
  contact: "ana@user.test",
  contactName: "Ana",
  status: "open",
  token: "tok",
  messageCount: 1,
  unreadCount: 0,
  lastMessageAt: 10,
  snippet: "oi",
  ...o,
});
const zero = { threads: 0, unread: 0, capped: false };
const counts = (assigned: Partial<ViewCounts["assigned"]> = {}): ViewCounts => ({ all: zero, unread: zero, waiting: zero, snoozed: zero, assigned: { ...zero, ...assigned } });
const inputs = (o: Partial<WidgetInputs> = {}): WidgetInputs => ({ locale: "pt-BR", mailboxes: [], counts: counts(), assigned: [], preview: true, ...o });

describe("widget snapshots", () => {
  it("Não lidas: the total, the mailbox with the most, and up to four mailboxes, most unread first", () => {
    const mailboxes = [box("support", 3), box("privacy", 0, { displayName: "Privacidade" }), box("heitor", 1, { personal: true }), box("billing", 12), box("legal", 3), box("jobs", 0)];
    const s = buildWidgetSnapshots(inputs({ mailboxes })).unread;
    expect(s.state).toBe("ready");
    expect(s.total).toBe(19);
    expect(s.caption).toBe("19 não lidas");
    expect(s.top).toEqual({ label: "billing", count: "12", unread: 12, url: "embermail://mailbox/billing" });
    // Ties keep the app's order (own mailbox first, then the server's): support before legal.
    expect(s.rows.map((r) => r.label)).toEqual(["billing", "support", "legal", "heitor"]);
    expect(s.rows).toHaveLength(UNREAD_ROWS);
    expect(s.url).toBe(widgetUrls.unread);
  });

  it("Não lidas: nothing unread opens the mailbox list; a display name labels its row; counts cap at 99+", () => {
    const s = buildWidgetSnapshots(inputs({ mailboxes: [box("support", 0), box("privacy", 0, { displayName: "Privacidade" })] })).unread;
    expect(s.top).toBeNull();
    expect(s.message).toBe("Tudo lido");
    expect(s.url).toBe(widgetUrls.home);
    expect(s.rows.map((r) => r.label)).toEqual(["support", "Privacidade"]);
    const many = buildWidgetSnapshots(inputs({ mailboxes: [box("support", 140)], locale: "en" })).unread;
    expect([many.totalText, many.rows[0]?.count, many.caption]).toEqual(["99+", "99+", "140 unread"]);
    expect(buildWidgetSnapshots(inputs({ mailboxes: [box("support", 1)] })).unread.caption).toBe("1 não lida");
    expect(buildWidgetSnapshots(inputs()).unread.message).toBe("Nenhuma caixa");
  });

  it("Minhas: the count of the Minhas tab, and the latest conversations (sender, subject) linking to them", () => {
    const assigned = [thread("t1", { unreadCount: 2 }), thread("t2", { contactName: undefined, contact: "bob@user.test" }), thread("t/3"), thread("t4")];
    const s = buildWidgetSnapshots(inputs({ counts: counts({ threads: 5 }), assigned })).mine;
    expect([s.count, s.countText, s.caption, s.label]).toEqual([5, "5", "5 conversas abertas", "abertas"]);
    expect(s.rows).toHaveLength(MINE_ROWS);
    expect(s.rows[0]).toEqual({ sender: "Ana", subject: "Assunto t1", unread: true, url: "embermail://thread/t1" });
    expect(s.rows[1]?.sender).toBe("bob@user.test");
    expect(s.rows[2]?.url).toBe("embermail://thread/t%2F3");
    expect(s.url).toBe(widgetUrls.mine);
    expect(buildWidgetSnapshots(inputs({ counts: counts({ threads: 1 }), assigned: [thread("t1")], locale: "en" })).mine.caption).toBe("1 open conversation");
    // A lower bound from the server reads as one.
    expect(buildWidgetSnapshots(inputs({ counts: counts({ threads: 40, capped: true }) })).mine.countText).toBe("40+");
  });

  it("Minhas: previews off (or not known yet) show counts only, no sender or subject", () => {
    for (const preview of [false, null]) {
      const s = buildWidgetSnapshots(inputs({ counts: counts({ threads: 2 }), assigned: [thread("t1"), thread("t2")], preview })).mine;
      expect(s.rows).toEqual([]);
      expect(s.count).toBe(2);
      expect(s.message).toBe("Prévias desligadas");
      expect(s.hidden).toBe(true);
      expect(JSON.stringify(s)).not.toMatch(/Ana|Assunto/);
    }
    expect(buildWidgetSnapshots(inputs({ counts: counts({ threads: 0 }) })).mine.message).toBe("Nada atribuído a você");
  });

  it("Minhas: no rows to list is not 'previews off' (the widget shows the count, not the eye-off line)", () => {
    // Previews on, the count says 2 but the page has none (it failed, or lags the counts): no rows, nothing hidden.
    for (const assigned of [[], null]) {
      const s = buildWidgetSnapshots(inputs({ counts: counts({ threads: 2 }), assigned, preview: true })).mine;
      expect([s.rows, s.hidden, s.message]).toEqual([[], false, ""]);
    }
    // Nothing assigned, whatever the preference: the empty state, never "hidden".
    for (const preview of [true, false, null]) expect(buildWidgetSnapshots(inputs({ counts: counts({ threads: 0 }), preview })).mine.hidden).toBe(false);
    expect(signedOutSnapshots("pt-BR").mine.hidden).toBe(false);
  });

  it("writes only once every input settled: not while the preference or the assigned page load", () => {
    const c = counts({ threads: 2 });
    const ok = { mailboxes: "success", counts: c, assigned: "success", notifications: "success" } as const;
    expect(widgetInputsReady(ok)).toBe(true);
    expect(widgetInputsReady({ ...ok, notifications: "loading" })).toBe(false);
    expect(widgetInputsReady({ ...ok, assigned: "loading" })).toBe(false);
    expect(widgetInputsReady({ ...ok, mailboxes: "loading" })).toBe(false);
    expect(widgetInputsReady({ ...ok, counts: null })).toBe(false);
    // A failed query is settled: its part is left out (counts only), which is what the widget can honestly show.
    expect(widgetInputsReady({ ...ok, notifications: "error", assigned: "error" })).toBe(true);
    expect(widgetInputsReady({ ...ok, mailboxes: "error" })).toBe(false);
  });

  it("signed out: no count, mailbox, sender or subject, only 'sign in' in the app's language", () => {
    const s = signedOutSnapshots("en");
    expect(s.unread).toMatchObject({ state: "signedOut", total: 0, top: null, rows: [], message: "Sign in to Ember Mail", url: widgetUrls.home });
    expect(s.mine).toMatchObject({ state: "signedOut", count: 0, rows: [], message: "Sign in to Ember Mail", url: widgetUrls.home });
    expect(signedOutSnapshots("pt-BR").mine.title).toBe("Minhas");
  });
});

function fakeTimers(): Timers & { advance(ms: number): void } {
  let now = 0;
  let next: { at: number; fn: () => void; id: number } | null = null;
  let ids = 0;
  return {
    now: () => now,
    set: (fn, ms) => (next = { at: now + ms, fn, id: ++ids }).id,
    clear: (id) => {
      if (next?.id === id) next = null;
    },
    advance(ms) {
      now += ms;
      if (next && next.at <= now) {
        const fn = next.fn;
        next = null;
        fn();
      }
    },
  };
}

describe("widget writer", () => {
  const at = (unread: number, preview = true) => buildWidgetSnapshots(inputs({ mailboxes: [box("support", unread)], preview, counts: counts({ threads: 1 }), assigned: [thread("t1")] }));

  it("writes at once, then at most once per interval with the latest change; only the widget that changed", () => {
    const timers = fakeTimers();
    const writes: string[] = [];
    const w = snapshotWriter((kind, json) => writes.push(`${kind}:${(JSON.parse(json) as { total?: number }).total ?? "-"}`), 1000, timers);
    w.push(at(1));
    expect(writes).toEqual(["unread:1", "mine:-"]);
    w.push(at(2));
    w.push(at(3));
    expect(writes).toHaveLength(2);
    timers.advance(1000);
    expect(writes).toEqual(["unread:1", "mine:-", "unread:3"]);
    // Same as on screen: nothing.
    timers.advance(5000);
    w.push(at(3));
    expect(writes).toHaveLength(3);
  });

  it("a change undone before the interval is up writes nothing; flush writes what is waiting now", () => {
    const timers = fakeTimers();
    const writes: string[] = [];
    const w = snapshotWriter((kind) => writes.push(kind), 1000, timers);
    w.push(at(1));
    w.push(at(2));
    w.push(at(1));
    timers.advance(1000);
    expect(writes).toEqual(["unread", "mine"]);
    w.push(at(2, false));
    w.flush();
    expect(writes).toEqual(["unread", "mine", "unread", "mine"]);
  });

  it("cancel drops a waiting write (sign-out): the member's inbox never lands after the signed-out state", () => {
    const timers = fakeTimers();
    const written: string[] = [];
    const w = snapshotWriter((_kind, json) => written.push(json), 1000, timers);
    w.push(at(1));
    w.push(at(5));
    w.cancel();
    w.push(signedOutSnapshots("pt-BR"));
    w.flush();
    timers.advance(10_000);
    const last = written.slice(-2).map((j) => JSON.parse(j) as { state: string });
    expect(last.map((s) => s.state)).toEqual(["signedOut", "signedOut"]);
    expect(written.some((j) => j.includes('"total":5'))).toBe(false);
  });
});
