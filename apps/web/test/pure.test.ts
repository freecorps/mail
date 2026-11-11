// Pure helpers: safe email HTML, formatting, i18n, keyboard shortcuts, compose validation, the URL route, the JWT
// cache, theme resolution and the optimistic updates.
import { composerMode, isPersonal, ownFirst, sentRow } from "@/model/threads";
import { deliveryState } from "@/model/thread";
import { forwardedFiles, forwardSubject, forwardText, MAX_CC, replyAllCc } from "@/model/forward";
import { describe, expect, it, vi } from "vite-plus/test";
import type { OptimisticLocalStore, PendingMutationRecord } from "@freecorps/ember-client";
import { pickLocale, translate } from "@/i18n/strings";
import { VIEWS, type Mailbox, type Message, type Page, type Thread, type ThreadDetail } from "@/lib/api";
import { jwtExpMs, jwtSource } from "@/lib/auth";
import {
  buildEmailDocument,
  contentSecurityPolicy,
  EMAIL_SANDBOX,
  externalLinks,
  hasRemoteImages,
  linkifyText,
  resolveCid,
  sanitizeEmailHtml,
  urlAttrAllowed,
} from "@/lib/emailHtml";
import { bodyOf, HOSTILE_LEFTOVER, HOSTILE_SAMPLES, SAFE_SAMPLES } from "@freecorps/mail-email-html/test-samples";
import { formatAge, formatWhen, initials, parseRecipients } from "@/lib/format";
import { overdueBeyondScan, staleWaiting } from "@/model/today";
import { monogram } from "@/lib/nav";
import { badge, viewBadge } from "@/model/threads";
import { inboxOptimisticUpdates, isOptimisticId, setOptimisticViewer } from "@/lib/optimistic";
import { parsePrefs, resolveTheme } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { checkCompose, composeErrorField } from "@/model/compose";
import { isTextField, modKey, moveSelection, shortcutFor } from "@/model/keys";
import { formatRoute, parseRoute } from "@/model/route";
import { searchRows, threadRow } from "@/model/threads";

const thread = (o: Partial<Thread> = {}): Thread => ({
  _id: "t1",
  _creationTime: 0,
  mailbox: "support",
  number: 7,
  subject: "Fatura",
  subjectKey: "fatura",
  contact: "ana@user.test",
  contactName: "Ana",
  status: "open",
  token: "tok",
  messageCount: 1,
  unreadCount: 1,
  lastMessageAt: 1000,
  snippet: "O valor…",
  ...o,
});

describe("email HTML", () => {
  it("strips scripts, handlers, javascript: URLs, frames and forms", () => {
    const s = sanitizeEmailHtml(
      `<p onclick="x()">Oi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><iframe src="https://e.vil"></iframe><form><input></form><scr<script>ipt>alert(2)</script>`,
    );
    expect(s).not.toMatch(/script|onclick|javascript:|iframe|<form|<input/i);
    expect(s).toContain("<p>Oi</p>");
  });

  it(`allowlists URL schemes in the iframe document: ${HOSTILE_SAMPLES.length} hostile samples`, () => {
    for (const h of HOSTILE_SAMPLES) expect(bodyOf(buildEmailDocument(h)), h).not.toMatch(HOSTILE_LEFTOVER);
    for (const h of SAFE_SAMPLES) expect(sanitizeEmailHtml(h), h).toBe(h);
    expect(urlAttrAllowed("href", "cid:x")).toBe(false);
    // In-message anchors stay in the frame; everything else opens a new tab.
    expect(externalLinks(`<a href="#s2">x</a>`)).toBe(`<a href="#s2">x</a>`);
    expect(externalLinks(`<a href="mailto:a@b.test">x</a>`)).toContain(`target="_blank"`);
  });

  it("never throws on malformed cid: references", () => {
    const cid = { "a%b": "https://mail.test/a", "logo@x": "https://mail.test/l" };
    expect(resolveCid(`<img src="cid:a%b"><img src="cid:%E0%A4%A"><img src="cid:logo%40x">`, cid)).toBe(
      `<img src="https://mail.test/a"><img src="about:blank"><img src="https://mail.test/l">`,
    );
    expect(() => buildEmailDocument(`<img src="cid:foo%bar">`, { cid })).not.toThrow();
  });

  it("blocks remote images until allowed; inline cid images come from their signed URL origin", () => {
    const html = `<img src="https://tracker.example.com/p.gif"><img src="cid:logo@x">`;
    expect(hasRemoteImages(html)).toBe(true);
    expect(hasRemoteImages(`<img src="cid:a">`)).toBe(false);
    const cid = { "logo@x": "https://mail.test/api/storage/get?k=1" };
    const blocked = buildEmailDocument(html, { cid });
    expect(blocked).toContain("img-src data: https://mail.test;");
    expect(blocked).toContain(`src="https://mail.test/api/storage/get?k=1"`);
    expect(blocked.indexOf("Content-Security-Policy")).toBeLessThan(blocked.indexOf("<body>"));
    expect(contentSecurityPolicy({ loadImages: true })).toContain("img-src data: https: http:");
    expect(contentSecurityPolicy({})).toContain("script-src 'none'");
  });

  it("opens links in a new tab without opener/referrer; the sandbox never allows scripts", () => {
    expect(externalLinks(`<a href="https://x.test" target="_self" rel="opener">x</a>`)).toBe(
      `<a href="https://x.test" target="_blank" rel="noopener noreferrer nofollow">x</a>`,
    );
    expect(EMAIL_SANDBOX).not.toContain("allow-scripts");
    expect(EMAIL_SANDBOX).not.toContain("allow-top-navigation");
  });

  it("linkifies plain text (http, https, mailto only)", () => {
    expect(linkifyText("veja https://acme.test/x. ou mailto:a@b.test javascript:alert(1)")).toEqual([
      { kind: "text", value: "veja " },
      { kind: "link", value: "https://acme.test/x" },
      { kind: "text", value: ". ou " },
      { kind: "link", value: "mailto:a@b.test" },
      { kind: "text", value: " javascript:alert(1)" },
    ]);
  });
});

describe("format and i18n", () => {
  it("makes initials from words with letters, by code point", () => {
    expect(initials("Fernanda Oliveira 🌻")).toBe("FO");
    expect(initials("🌻")).toBe("?");
    expect(initials("ana.beatriz@x.test")).toBe("AB");
    expect(initials("Élise Østergaard")).toBe("ÉØ");
  });

  it("makes mailbox monograms and count badges", () => {
    expect(monogram("Atendimento")).toBe("A");
    expect(monogram("Vendas Brasil Sul")).toBe("VS");
    expect(monogram("Vendas Região Sul 3")).toBe("V3");
    expect(monogram("🌻 Jardim")).toBe("J");
    expect(monogram("")).toBe("?");
    expect(badge(7)).toBe("7");
    expect(badge(12_000)).toBe("99+");
    expect(badge(40, true)).toBe("40+");
    const counts = {
      all: { threads: 9, unread: 14, capped: false },
      assigned: { threads: 3, unread: 1, capped: false },
      unread: { threads: 0, unread: 0, capped: false },
      waiting: { threads: 2, unread: 0, capped: true },
      snoozed: { threads: 4, unread: 9, capped: false },
    };
    // Unread messages for all/unread, threads for assigned/waiting/snoozed (as on mobile); nothing at zero.
    expect(VIEWS.map((v) => viewBadge(v, counts))).toEqual(["14", "3", null, "2+", "4"]);
    expect(viewBadge("all", null)).toBeNull();
  });

  it("says how long ago, in the largest whole unit", () => {
    const now = new Date(2026, 10, 10, 12, 0).getTime();
    expect(formatAge(now - 5 * 60_000, now, "en")).toBe("5 min. ago");
    expect(formatAge(now - 26 * 3_600_000, now, "en")).toBe("26 hr. ago");
    expect(formatAge(now - 3 * 86_400_000, now, "pt-BR")).toBe("há 3 dias");
    expect(formatAge(now - 4_000, now, "pt-BR")).toBe("agora");
    expect(formatAge(now - 400 * 86_400_000, now, "pt-BR")).toBe("há 1 ano");
    expect(formatAge(now - 100 * 86_400_000, now, "en")).toBe("3 mo. ago");
  });

  it("finds conversations waiting for more than a day, the longest first", () => {
    const now = 10 * 86_400_000;
    const at = (h: number) => ({ ...thread(), _id: `w${h}`, status: "waiting" as const, lastMessageAt: now - h * 3_600_000 });
    expect(staleWaiting([at(2), at(30), at(80), at(23)], now).map((t) => t._id)).toEqual(["w80", "w30"]);
    // More stale ones past the scan: only when the scan stopped early and its oldest row is already stale.
    expect(overdueBeyondScan([at(2), at(30)], false, now)).toBe(true);
    expect(overdueBeyondScan([at(2), at(10)], false, now)).toBe(false);
    expect(overdueBeyondScan([at(2), at(30)], true, now)).toBe(false);
    expect(overdueBeyondScan([], false, now)).toBe(false);
  });

  it("formats list times relative to now", () => {
    const now = new Date(2026, 10, 5, 15, 0).getTime();
    expect(formatWhen(new Date(2026, 10, 5, 9, 5).getTime(), now, "pt-BR")).toBe("09:05");
    expect(formatWhen(new Date(2026, 10, 4, 9, 5).getTime(), now, "pt-BR")).toBe("Ontem");
    expect(formatWhen(new Date(2026, 10, 4, 9, 5).getTime(), now, "en")).toBe("Yesterday");
  });

  it("parses recipients as typed", () => {
    expect(parseRecipients("a@x.com, Bia <b@y.com>; nope")).toEqual({ valid: ["a@x.com", "Bia <b@y.com>"], invalid: ["nope"] });
  });

  it("defaults to pt-BR; English only when the browser prefers it", () => {
    expect(pickLocale([])).toBe("pt-BR");
    expect(pickLocale(["de-DE", "en-US"])).toBe("en");
    expect(pickLocale(["pt-PT", "en"])).toBe("pt-BR");
    expect(translate("en", "mailboxes.a11y", { name: "Suporte", unread: 2 })).toBe("Suporte, 2 unread");
  });
});

describe("keyboard", () => {
  it("maps single keys, ignores modifiers, and only Escape inside fields", () => {
    expect(shortcutFor({ key: "j" }, false)).toBe("next");
    expect(shortcutFor({ key: "e" }, false)).toBe("archive");
    expect(shortcutFor({ key: "/" }, false)).toBe("search");
    expect(shortcutFor({ key: "[" }, false)).toBe("sidebar");
    expect(shortcutFor({ key: "k", metaKey: true }, true)).toBe("palette");
    expect(shortcutFor({ key: "K", ctrlKey: true }, false)).toBe("palette");
    expect(shortcutFor({ key: "k", ctrlKey: true, altKey: true }, false)).toBeNull();
    expect(shortcutFor({ key: "c", metaKey: true }, false)).toBeNull();
    expect(modKey("MacIntel")).toBe("⌘");
    expect(modKey("Win32")).toBe("Ctrl");
    expect(shortcutFor({ key: "r" }, true)).toBeNull();
    expect(shortcutFor({ key: "Escape" }, true)).toBe("escape");
  });

  it("moves the selection within bounds", () => {
    const ids = ["a", "b", "c"];
    expect(moveSelection(ids, null, 1)).toBe("a");
    expect(moveSelection(ids, null, -1)).toBe("c");
    expect(moveSelection(ids, "b", 1)).toBe("c");
    expect(moveSelection(ids, "c", 1)).toBe("c");
    expect(moveSelection(ids, "a", -1)).toBe("a");
    expect(moveSelection([], "a", 1)).toBeNull();
  });

  it("knows text fields", () => {
    const input = document.createElement("input");
    const box = document.createElement("input");
    box.type = "checkbox";
    expect(isTextField(input)).toBe(true);
    expect(isTextField(box)).toBe(false);
    expect(isTextField(document.createElement("textarea"))).toBe(true);
    expect(isTextField(document.createElement("button"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

describe("compose", () => {
  const base = { mailbox: "support", to: "", cc: "", subject: " Oi ", text: " Olá " };
  it("needs a valid recipient and a body", () => {
    expect(checkCompose(base)).toEqual({ ok: false, error: "invalidTo", invalid: [] });
    expect(checkCompose({ ...base, to: "x" })).toEqual({ ok: false, error: "invalidList", invalid: ["x"] });
    expect(checkCompose({ ...base, to: "a@b.test", text: " " })).toMatchObject({ ok: false, error: "empty" });
    expect(composeErrorField("empty")).toBe("text");
    expect(composeErrorField("invalidTo")).toBe("to");
    expect(composeErrorField("invalidList")).toBe("to");
    expect(checkCompose({ ...base, to: "Ana <a@b.test>", cc: "c@d.test" })).toEqual({
      ok: true,
      args: { mailbox: "support", to: ["Ana <a@b.test>"], cc: ["c@d.test"], subject: "Oi", text: "Olá" },
    });
  });
});

describe("route", () => {
  it("round-trips through the URL and drops defaults", () => {
    const r = parseRoute("?m=support&f=waiting&t=email%24threads_1&q=fatura");
    expect(r).toEqual({
      admin: null,
      view: null,
      tag: null,
      mailbox: "support",
      filter: "waiting",
      thread: "email$threads_1",
      query: "fatura",
    });
    expect(parseRoute(formatRoute(r))).toEqual(r);
    expect(formatRoute({ admin: null, view: null, tag: null, mailbox: null, filter: "all", thread: null, query: "" })).toBe("");
    // Views across mailboxes; Sent and Spam as a mailbox's lists; unknown values fall back.
    expect(parseRoute("?v=assigned&t=x")).toMatchObject({ view: "assigned", mailbox: null, thread: "x" });
    expect(formatRoute({ ...parseRoute(""), view: "unread", query: "boleto" })).toBe("?v=unread&q=boleto");
    expect(parseRoute("?v=bogus").view).toBeNull();
    // "Adiadas" is a view; a tag's list is `g`.
    expect(parseRoute("?v=snoozed").view).toBe("snoozed");
    expect(formatRoute({ ...parseRoute(""), tag: "email$tags_1" })).toBe("?g=email%24tags_1");
    expect(parseRoute("?g=email%24tags_1").tag).toBe("email$tags_1");
    expect(parseRoute("?m=support&f=spam").filter).toBe("spam");
    expect(parseRoute("?m=support&f=sent").filter).toBe("sent");
    expect(parseRoute("?f=bogus").filter).toBe("all");
    // The admin screen's section; an unknown one is the inbox.
    expect(parseRoute("?a=keys")).toMatchObject({ admin: "keys" });
    expect(formatRoute({ ...parseRoute(""), admin: "members" })).toBe("?a=members");
    expect(parseRoute("?a=bogus").admin).toBeNull();
  });
});

describe("auth token cache", () => {
  const jwt = (expSec: number) => `h.${btoa(JSON.stringify({ exp: expSec })).replace(/=+$/, "")}.s`;
  it("reads exp", () => {
    expect(jwtExpMs(jwt(100))).toBe(100_000);
    expect(jwtExpMs("opaque")).toBeNull();
  });

  it("reuses the JWT until shortly before exp, shares in-flight requests, and resets", async () => {
    let now = 0;
    const mint = vi.fn(async () => jwt(60));
    const get = jwtSource(mint, { now: () => now, marginMs: 30_000 });
    await Promise.all([get(), get()]);
    expect(mint).toHaveBeenCalledTimes(1);
    now = 20_000;
    await get();
    expect(mint).toHaveBeenCalledTimes(1);
    now = 31_000;
    await get();
    expect(mint).toHaveBeenCalledTimes(2);
    get.reset();
    await get();
    expect(mint).toHaveBeenCalledTimes(3);
  });

  it("signed out: null, not cached", async () => {
    const mint = vi.fn(async () => null);
    const get = jwtSource(mint);
    expect(await get()).toBeNull();
    expect(await get()).toBeNull();
    expect(mint).toHaveBeenCalledTimes(2);
  });
});

describe("theme", () => {
  it("resolves system against the OS", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("parses stored prefs field by field, with defaults for anything unknown", () => {
    const defaults = {
      theme: "system",
      locale: null,
      density: "comfortable",
      reading: "split",
      sidebarCollapsed: false,
      panes: { sidebar: 248, list: 380 },
      contextPanel: true,
      undoSend: 5,
    };
    expect(parsePrefs(null)).toEqual(defaults);
    expect(parsePrefs({ contextPanel: false }).contextPanel).toBe(false);
    expect(parsePrefs({ undoSend: 20 }).undoSend).toBe(20);
    expect(parsePrefs({ undoSend: 7 }).undoSend).toBe(5);
    expect(parsePrefs({ theme: "dark", locale: "en", density: "compact", reading: "focus", sidebarCollapsed: true })).toEqual({
      ...defaults,
      theme: "dark",
      locale: "en",
      density: "compact",
      reading: "focus",
      sidebarCollapsed: true,
    });
    expect(parsePrefs({ theme: "neon", locale: "fr", density: 3, reading: "zen", sidebarCollapsed: "yes" })).toEqual(defaults);
  });

  it("keeps pane widths inside their limits", () => {
    expect(parsePrefs({ panes: { sidebar: 10, list: 9999 } }).panes).toEqual({ sidebar: 200, list: 640 });
    expect(parsePrefs({ panes: { sidebar: 301.6, list: "wide" } }).panes).toEqual({ sidebar: 302, list: 380 });
  });
});

describe("cn", () => {
  it("knows the theme's own sizes and shadows", () => {
    expect(cn("text-ui", "text-foreground")).toBe("text-ui text-foreground");
    expect(cn("text-sm", "text-ui")).toBe("text-ui");
    expect(cn("shadow-raised", "shadow-overlay")).toBe("shadow-overlay");
  });
});

describe("rows", () => {
  it("builds thread rows and one search row per thread", () => {
    expect(threadRow(thread())).toMatchObject({ threadId: "t1", title: "Ana", unread: true, status: "open", pending: false });
    const hit = {
      threadId: "t1",
      mailbox: "support",
      direction: "inbound" as const,
      subject: "S",
      from: { email: "a@b.test" },
      snippet: "",
      at: 1,
    };
    expect(
      searchRows([
        { ...hit, messageId: "m1" },
        { ...hit, messageId: "m2" },
      ]).map((r) => r.key),
    ).toEqual(["m1"]);
    // The thread's state comes with the hit (archived and unread here), so actions toggle the right way.
    expect(
      searchRows([{ ...hit, messageId: "m3", status: "closed", unreadCount: 2, assignee: "u1", assigneeName: "Bia" }])[0],
    ).toMatchObject({
      status: "closed",
      unread: true,
      assignee: "u1",
      assigneeName: "Bia",
    });
    expect(searchRows([{ ...hit, messageId: "m4" }])[0]).toMatchObject({ status: null, unread: false });
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

describe("optimistic updates", () => {
  const u = inboxOptimisticUpdates(() => 5000);
  const rec = {} as PendingMutationRecord;
  const page = (ts: Thread[]): Page<Thread> => ({ page: ts, isDone: true, continueCursor: null });
  const boxes: Mailbox[] = [{ name: "support", address: "s@x", displayName: null, unread: 3, threads: 4 }];

  it("markRead drops unread counts; a status filter drops archived threads", () => {
    const s = store({
      "inbox:threads": [
        { args: { mailbox: "support" }, value: page([thread({ unreadCount: 2 })]) },
        { args: { mailbox: "support", status: "open" }, value: page([thread({ unreadCount: 2 })]) },
      ],
      "inbox:mailboxes": [{ args: {}, value: boxes }],
    });
    u["inbox:markRead"]!(s, { threadId: "t1" }, rec);
    expect(s.dump("inbox:threads")[0].page[0].unreadCount).toBe(0);
    expect(s.dump("inbox:mailboxes")[0][0].unread).toBe(1);
    u["inbox:setStatus"]!(s, { threadId: "t1", status: "closed" }, rec);
    expect(s.dump("inbox:threads").map((p: Page<Thread>) => p.page.length)).toEqual([1, 0]);
  });

  it("search hits follow read, archive and assign (also when the thread is loaded in no list)", () => {
    const hit = {
      messageId: "m1",
      threadId: "t1",
      mailbox: "support",
      direction: "inbound",
      subject: "S",
      from: { email: "a@b.test" },
      snippet: "",
      at: 1,
      status: "open",
      unreadCount: 2,
    };
    const s = store({ "inbox:search": [{ args: { query: "oi" }, value: [hit, { ...hit, messageId: "m2", threadId: "t2" }] }] });
    u["inbox:markRead"]!(s, { threadId: "t1" }, rec);
    u["inbox:setStatus"]!(s, { threadId: "t1", status: "closed" }, rec);
    expect(s.dump("inbox:search")[0][0]).toMatchObject({ threadId: "t1", status: "closed", unreadCount: 0 });
    expect(s.dump("inbox:search")[0][1]).toMatchObject({ threadId: "t2", status: "open", unreadCount: 2 });
    u["inbox:addTag"]!(s, { threadId: "t1", tag: "g1" }, rec);
    expect(s.dump("inbox:search")[0][0].tags).toEqual(["g1"]);
    u["inbox:removeTag"]!(s, { threadId: "t1", tag: "g1" }, rec);
    expect(s.dump("inbox:search")[0][0].tags).toEqual([]);
  });

  it("a new conversation shows on top of the views it belongs to, and their counts grow", () => {
    const zero = { threads: 0, unread: 0, capped: false };
    const s = store({
      "inbox:view": [
        {
          args: { view: "waiting", limit: 30 },
          value: { page: [thread({ _id: "old", status: "waiting" })], isDone: true, partial: false },
        },
        { args: { view: "unread", limit: 30 }, value: { page: [], isDone: true, partial: false } },
      ],
      "inbox:views": [
        { args: {}, value: { all: { ...zero, threads: 1 }, assigned: zero, unread: zero, waiting: { ...zero, threads: 1 } } },
      ],
    });
    u["inbox:compose"]!(s, { mailbox: "support", to: ["ana@user.test"], subject: "Oi", text: "Olá" }, rec);
    const [waiting, unread] = s.dump("inbox:view") as Array<{ page: Thread[] }>;
    expect(waiting!.page).toHaveLength(2);
    expect(isOptimisticId(waiting!.page[0]!._id)).toBe(true);
    expect(unread!.page).toEqual([]);
    expect(s.dump("inbox:views")[0]).toMatchObject({ all: { threads: 2 }, waiting: { threads: 2 }, unread: { threads: 0 } });
  });

  it("the cross-mailbox views and their counts follow read, assign and archive", () => {
    setOptimisticViewer("u2");
    const zero = { threads: 0, unread: 0, capped: false };
    const t = thread({ unreadCount: 2 });
    const s = store({
      "inbox:view": [
        { args: { view: "unread", limit: 30 }, value: { page: [t], isDone: true, partial: false } },
        { args: { view: "all", limit: 30 }, value: { page: [t], isDone: true, partial: false } },
      ],
      "inbox:views": [
        {
          args: {},
          value: { all: { ...zero, threads: 1, unread: 2 }, assigned: zero, unread: { ...zero, threads: 1, unread: 2 }, waiting: zero },
        },
      ],
      "inbox:members": [{ args: { mailbox: "support" }, value: [{ userId: "u2", name: "Caio" }] }],
    });
    u["inbox:assign"]!(s, { threadId: "t1", userId: "u2" }, rec);
    expect(s.dump("inbox:views")[0].assigned).toMatchObject({ threads: 1, unread: 2 });
    u["inbox:markRead"]!(s, { threadId: "t1" }, rec);
    expect(s.dump("inbox:view").map((v: { page: Thread[] }) => v.page.length)).toEqual([0, 1]);
    expect(s.dump("inbox:views")[0]).toMatchObject({ all: { threads: 1, unread: 0 }, unread: { threads: 0, unread: 0 } });
    u["inbox:setStatus"]!(s, { threadId: "t1", status: "closed" }, rec);
    expect(s.dump("inbox:views")[0]).toMatchObject({ all: { threads: 1 }, assigned: { threads: 0 } });
    setOptimisticViewer(null);
  });

  it("reply appends a pending message and moves the thread to waiting", () => {
    const detail: ThreadDetail = { thread: thread(), messages: [] as Message[] };
    const s = store({
      "inbox:thread": [{ args: { threadId: "t1" }, value: detail }],
      "inbox:threads": [{ args: { mailbox: "support" }, value: page([thread()]) }],
    });
    u["inbox:reply"]!(s, { threadId: "t1", text: "Corrigido" }, rec);
    const d = s.dump("inbox:thread")[0] as ThreadDetail;
    expect(d.messages).toHaveLength(1);
    expect(isOptimisticId(d.messages[0]!._id)).toBe(true);
    expect(d.thread.status).toBe("waiting");
    expect(s.dump("inbox:threads")[0].page[0].snippet).toBe("Corrigido");
  });

  it("compose puts a pending thread on top of matching lists only", () => {
    const s = store({
      "inbox:threads": [
        { args: { mailbox: "support" }, value: page([thread()]) },
        { args: { mailbox: "support", status: "closed" }, value: page([]) },
      ],
    });
    u["inbox:compose"]!(s, { mailbox: "support", to: ["Rui <rui@u.test>"], subject: "Oi", text: "Olá" }, rec);
    const [all, closed] = s.dump("inbox:threads");
    expect(all.page[0]).toMatchObject({ contact: "rui@u.test", status: "waiting" });
    expect(closed.page).toHaveLength(0);
  });

  it("forward puts the new conversation on top of the forwarded thread's mailbox lists; unknown thread, nothing", () => {
    const s = store({ "inbox:threads": [{ args: { mailbox: "support" }, value: page([thread()]) }] });
    const id = s.dump("inbox:threads")[0].page[0]._id as string;
    u["inbox:forward"]!(s, { threadId: id, to: ["Bia <bia@u.test>"], subject: "Fwd: Oi", text: "Veja." }, rec);
    expect(s.dump("inbox:threads")[0].page[0]).toMatchObject({
      contact: "bia@u.test",
      subject: "Fwd: Oi",
      status: "waiting",
      mailbox: "support",
    });
    u["inbox:forward"]!(s, { threadId: "nope", to: ["x@u.test"], subject: "s", text: "t" }, rec);
    expect(s.dump("inbox:threads")[0].page).toHaveLength(2);
  });

  it("a reply or a new conversation goes to the top of its mailbox's Sent lists, once; status changes patch it in place", () => {
    const old = { ...thread({ _id: "t0" }), lastSentAt: 5 };
    const s = store({
      "inbox:thread": [{ args: { threadId: "t1" }, value: { thread: thread(), messages: [] as Message[] } }],
      "inbox:sent": [
        { args: { mailbox: "support", limit: 30 }, value: { page: [old, { ...thread(), lastSentAt: 1 }], isDone: true } },
        { args: { mailbox: "privacy", limit: 30 }, value: { page: [], isDone: true } },
      ],
    });
    u["inbox:reply"]!(s, { threadId: "t1", text: "Corrigido" }, rec);
    const [support, privacy] = s.dump("inbox:sent");
    expect(support.page.map((t: Thread) => t._id)).toEqual(["t1", "t0"]);
    expect(support.page[0].lastSentAt).toBeGreaterThan(5);
    expect(privacy.page).toEqual([]);
    u["inbox:note"]!(s, { threadId: "t0", text: "nota" }, rec);
    expect(s.dump("inbox:sent")[0].page.map((t: Thread) => t._id)).toEqual(["t1", "t0"]);
    u["inbox:setStatus"]!(s, { threadId: "t0", status: "closed" }, rec);
    expect(s.dump("inbox:sent")[0].page[1]).toMatchObject({ _id: "t0", status: "closed", lastSentAt: 5 });
    u["inbox:compose"]!(s, { mailbox: "support", to: ["Rui <rui@u.test>"], subject: "Oi", text: "Olá" }, rec);
    expect(s.dump("inbox:sent")[0].page[0]).toMatchObject({ contact: "rui@u.test", lastSentAt: expect.any(Number) });
    expect(s.dump("inbox:sent")[0].page).toHaveLength(3);
  });

  it("a Sent row is dated by the mailbox's latest send, not the thread's latest message", () => {
    expect(sentRow({ ...thread({ lastMessageAt: 99 }), lastSentAt: 42 })).toMatchObject({ at: 42, threadId: "t1" });
  });
});

describe("personal mailboxes", () => {
  it("list your own mailbox first and keep the shared ones in the server's order", () => {
    const list = [{ name: "support" }, { name: "heitor", personal: true }, { name: "privacy", personal: false }];
    expect(ownFirst(list).map((b) => b.name)).toEqual(["heitor", "support", "privacy"]);
    expect(list.map((b) => b.name)).toEqual(["support", "heitor", "privacy"]);
  });

  it("know a thread's mailbox as personal only when the list says so", () => {
    const list = [{ name: "support" }, { name: "heitor", personal: true }];
    expect(isPersonal(list, "heitor")).toBe(true);
    expect(isPersonal(list, "support")).toBe(false);
    expect(isPersonal(list, undefined)).toBe(false);
    expect(isPersonal([], "heitor")).toBe(false);
  });

  it("never send a note where there are none: a note picked before the mailbox was known is a reply", () => {
    expect(composerMode("note", false)).toBe("reply");
    expect(composerMode("note", true)).toBe("note");
    expect(composerMode("note", undefined)).toBe("note");
    expect(composerMode("reply", false)).toBe("reply");
  });
});

describe("reply all and forward", () => {
  const msg = (o: Partial<Message>): Message =>
    ({
      _id: "m",
      direction: "inbound",
      from: { email: "ana@user.test", name: "Ana" },
      to: [],
      cc: [],
      subject: "Contrato",
      text: "Segue.",
      attachments: [],
      ...o,
    }) as Message;

  it("reply all copies everyone else on the latest message received, never this mailbox (or a +tag) nor the contact", () => {
    const messages = [
      msg({ to: [{ email: "old@user.test" }] }),
      msg({ direction: "outbound", to: [{ email: "ignored@user.test" }] }),
      msg({
        to: [{ email: "Heitor@freecorps.test" }, { email: "bia@user.test", name: "Bia" }],
        cc: [{ email: "heitor+t_x@freecorps.test" }, { email: "ana@user.test" }, { email: "BIA@user.test" }, { email: "caio@user.test" }],
      }),
    ];
    expect(replyAllCc(messages, "heitor@freecorps.test", "ana@user.test")).toEqual(["Bia <bia@user.test>", "caio@user.test"]);
    expect(replyAllCc([msg({ to: [{ email: "heitor@freecorps.test" }] })], "heitor@freecorps.test", "ana@user.test")).toEqual([]);
    expect(replyAllCc([], "heitor@freecorps.test", "ana@user.test")).toEqual([]);
    // The mailbox's address not known yet: no reply all (it would copy itself).
    expect(replyAllCc(messages, "", "ana@user.test")).toEqual([]);
    // At most what the API takes.
    const crowd = msg({ cc: Array.from({ length: 80 }, (_, i) => ({ email: `p${i}@user.test` })) });
    expect(replyAllCc([crowd], "heitor@freecorps.test", "ana@user.test")).toHaveLength(MAX_CC);
  });

  it("a forward sends the files, not the inline images of the HTML", () => {
    const files = [{ filename: "a.pdf" }, { filename: "logo.png", inline: true, contentId: "<logo>" }, { filename: "b.png", inline: true }];
    expect(forwardedFiles(files).map((f) => f.filename)).toEqual(["a.pdf", "b.png"]);
  });

  it("a forward says Fwd: once, and quotes the original under a header", () => {
    expect(forwardSubject("Contrato")).toBe("Fwd: Contrato");
    for (const s of ["Fwd: Contrato", "FW: Contrato", "Enc: Contrato", "tr : Contrato"]) expect(forwardSubject(s)).toBe(s);
    const text = forwardText(
      msg({ to: [{ email: "heitor@freecorps.test", name: "Heitor" }] }),
      { header: "Mensagem encaminhada", from: "De", date: "Data", subject: "Assunto", to: "Para" },
      "10 nov 2026",
    );
    expect(text).toBe(
      "\n\n---------- Mensagem encaminhada ----------\nDe: Ana <ana@user.test>\nData: 10 nov 2026\nAssunto: Contrato\nPara: Heitor <heitor@freecorps.test>\n\nSegue.",
    );
  });
});

describe("delivery marker", () => {
  it("maps an outbound message's email status to its marker; none for notes, inbound or without a status", () => {
    const out = (status: string) => ({ direction: "outbound", delivery: { status, reason: null } });
    expect(["scheduled", "queued", "sending"].map((s) => deliveryState(out(s)))).toEqual(["pending", "pending", "pending"]);
    expect(deliveryState(out("sent"))).toBe("sent");
    expect(deliveryState(out("delivered"))).toBe("delivered");
    expect(deliveryState(out("delivery_delayed"))).toBe("delayed");
    expect(["bounced", "failed", "suppressed"].map((s) => deliveryState(out(s)))).toEqual(["failed", "failed", "failed"]);
    expect(deliveryState(out("complained"))).toBe("spam");
    expect(deliveryState(out("canceled"))).toBe("canceled");
    expect(deliveryState(out("something-new"))).toBeNull();
    expect(deliveryState({ direction: "note", delivery: { status: "sent" } })).toBeNull();
    expect(deliveryState({ direction: "inbound" })).toBeNull();
    expect(deliveryState({ direction: "outbound" })).toBeNull();
  });
});
