// Wave 6 polish: the keyboard's still window (nothing animates on a hardware shortcut), counts grouped for the locale
// in copy (break-ui: 10k+ unread), and worst-case inputs through the widgets' snapshot builder.
import { describe, expect, it } from "vitest";
import { translate } from "../src/i18n/strings";
import type { Mailbox, Thread, ViewCounts } from "../src/api";
import { createKeyMotion, STILL_MS } from "../src/model/key-motion";
import { buildWidgetSnapshots, widgetLine } from "../src/widgets/snapshot";

describe("key motion", () => {
  it("is still for a moment after a key, and tells listeners when it starts and ends", () => {
    const timers: Array<() => void> = [];
    const km = createKeyMotion((fn) => timers.push(fn));
    const events: boolean[] = [];
    km.subscribe(() => events.push(km.still(1000)));
    expect(km.still(1000)).toBe(false);
    km.mark(1000);
    expect(km.still(1000 + STILL_MS - 1)).toBe(true);
    expect(events).toEqual([true]);
    // A second key inside the window extends it without a second "start".
    km.mark(1200);
    expect(events).toEqual([true]);
    timers[0]!(); // the first key's timer: not the last key, the window stays
    expect(km.still(1200 + STILL_MS - 1)).toBe(true);
    expect(events).toEqual([true]);
    timers[1]!(); // the last key's timer ends it
    expect(km.still(1300)).toBe(false);
    expect(events).toEqual([true, false]);
  });

  it("unsubscribes", () => {
    const km = createKeyMotion(() => {});
    let n = 0;
    const off = km.subscribe(() => n++);
    off();
    km.mark(0);
    expect(n).toBe(0);
  });
});

describe("counts in copy", () => {
  it("groups a count for the locale, singular at exactly one", () => {
    expect(translate("pt-BR", "widget.unread.caption", { count: 10482 })).toBe("10.482 não lidas");
    expect(translate("en", "widget.unread.caption", { count: 10482 })).toBe("10,482 unread");
    expect(translate("pt-BR", "widget.unread.caption", { count: 1 })).toBe("1 não lida");
    expect(translate("en", "tags.more", { count: 1200 })).toBe("+1,200");
    expect(translate("pt-BR", "undo.archived", { count: 0 })).toBe("0 conversas arquivadas");
  });

  it("leaves other numbers and strings as they are", () => {
    expect(translate("pt-BR", "presence.many", { a: "Bia", b: "Caio", count: 1234 })).toBe("Bia, Caio e mais 1.234");
    expect(translate("en", "threads.emptySearch", { query: "10000" })).toBe("Nothing found for “10000”");
  });
});

describe("widget snapshots, worst case", () => {
  const box = (o: Partial<Mailbox>): Mailbox => ({ name: "support", address: "support@acme.test", displayName: null, unread: 0, threads: 1, ...o });
  const th = (o: Partial<Thread>): Thread => ({
    _id: "t1",
    _creationTime: 1,
    mailbox: "support",
    number: 1,
    subject: "Oi",
    subjectKey: "oi",
    contact: "j@worst.test",
    status: "open",
    token: "tok",
    messageCount: 1,
    unreadCount: 1,
    lastMessageAt: 1,
    snippet: "",
    ...o,
  });
  const zero = { threads: 0, unread: 0, capped: false };
  const counts = (threads: number): ViewCounts => ({ all: zero, unread: zero, waiting: zero, snoozed: zero, assigned: { threads, unread: 0, capped: false } });

  it("one line per row: no empty subject, no blank name, no line breaks, long text cut on a whole character", () => {
    const long = "Maximiliano Bartholomeu de Albuquerque Cavalcanti Figueiredo Sobrinho Júnior 🔥🔥🔥 e mais um pouco de texto";
    const s = buildWidgetSnapshots({
      locale: "pt-BR",
      mailboxes: [box({ displayName: "   ", unread: 10482 })],
      counts: counts(3),
      assigned: [th({ subject: "  " }), th({ _id: "t2", contactName: " ", contact: "bartholomew@worst.test", subject: "Linha um\r\nLinha dois" }), th({ _id: "t3", contactName: long, subject: "🎉".repeat(120) })],
      preview: true,
    });
    expect(s.unread.rows[0]!.label).toBe("support");
    expect([s.unread.totalText, s.unread.caption]).toEqual(["99+", "10.482 não lidas"]);
    expect(s.mine.rows.map((r) => r.subject).slice(0, 2)).toEqual(["(sem assunto)", "Linha um Linha dois"]);
    expect(s.mine.rows[1]!.sender).toBe("bartholomew@worst.test");
    const cut = s.mine.rows[2]!;
    expect(cut.sender.endsWith("…")).toBe(true);
    expect(Array.from(cut.subject)).toHaveLength(80);
    expect(cut.subject.endsWith("🎉…")).toBe(true);
    // Never a lone surrogate.
    expect(cut.subject).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("names a mailbox by its address when it has neither a display name nor a name", () => {
    expect(widgetLine("", "fallback")).toBe("fallback");
    expect(buildWidgetSnapshots({ locale: "en", mailboxes: [box({ name: "", unread: 1 })], counts: counts(0), assigned: [], preview: true }).unread.rows[0]!.label).toBe("support@acme.test");
  });
});
