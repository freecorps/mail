// Pure helpers: safe email HTML, formatting, i18n, keyboard shortcuts, compose validation, the URL route, the JWT
// cache, theme resolution and the optimistic updates.
import { describe, expect, it, vi } from "vite-plus/test";
import type { OptimisticLocalStore } from "@freecorps/ember-client";
import { pickLocale, translate } from "@/i18n/strings";
import type { Mailbox, Message, Page, Thread, ThreadDetail } from "@/lib/api";
import { jwtExpMs, jwtSource } from "@/lib/auth";
import {
  buildEmailDocument,
  contentSecurityPolicy,
  EMAIL_SANDBOX,
  externalLinks,
  hasRemoteImages,
  linkifyText,
  sanitizeEmailHtml,
} from "@/lib/emailHtml";
import { formatWhen, parseRecipients } from "@/lib/format";
import { inboxOptimisticUpdates, isOptimisticId } from "@/lib/optimistic";
import { resolveTheme } from "@/lib/prefs";
import { checkCompose } from "@/model/compose";
import { isTextField, moveSelection, shortcutFor } from "@/model/keys";
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
    expect(shortcutFor({ key: "c", metaKey: true }, false)).toBeNull();
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
    expect(checkCompose({ ...base, to: "Ana <a@b.test>", cc: "c@d.test" })).toEqual({
      ok: true,
      args: { mailbox: "support", to: ["Ana <a@b.test>"], cc: ["c@d.test"], subject: "Oi", text: "Olá" },
    });
  });
});

describe("route", () => {
  it("round-trips through the URL and drops defaults", () => {
    const r = parseRoute("?m=support&f=waiting&t=email%24threads_1&q=fatura");
    expect(r).toEqual({ mailbox: "support", filter: "waiting", thread: "email$threads_1", query: "fatura" });
    expect(parseRoute(formatRoute(r))).toEqual(r);
    expect(formatRoute({ mailbox: null, filter: "all", thread: null, query: "" })).toBe("");
    expect(parseRoute("?f=bogus").filter).toBe("all");
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
    u["inbox:markRead"]!(s, { threadId: "t1" });
    expect(s.dump("inbox:threads")[0].page[0].unreadCount).toBe(0);
    expect(s.dump("inbox:mailboxes")[0][0].unread).toBe(1);
    u["inbox:setStatus"]!(s, { threadId: "t1", status: "closed" });
    expect(s.dump("inbox:threads").map((p: Page<Thread>) => p.page.length)).toEqual([1, 0]);
  });

  it("reply appends a pending message and moves the thread to waiting", () => {
    const detail: ThreadDetail = { thread: thread(), messages: [] as Message[] };
    const s = store({
      "inbox:thread": [{ args: { threadId: "t1" }, value: detail }],
      "inbox:threads": [{ args: { mailbox: "support" }, value: page([thread()]) }],
    });
    u["inbox:reply"]!(s, { threadId: "t1", text: "Corrigido" });
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
    u["inbox:compose"]!(s, { mailbox: "support", to: ["Rui <rui@u.test>"], subject: "Oi", text: "Olá" });
    const [all, closed] = s.dump("inbox:threads");
    expect(all.page[0]).toMatchObject({ contact: "rui@u.test", status: "waiting" });
    expect(closed.page).toHaveLength(0);
  });
});
