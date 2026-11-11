// Pure helpers: HTML safety, formatting, i18n, the push seam, optimistic updates.
import { composerMode, isPersonal, ownFirst } from "../src/model/threads";
import { forwardedFiles, forwardSubject, forwardText, MAX_CC, replyAllCc } from "../src/model/forward";
import { describe, expect, it } from "vitest";
import type { OptimisticLocalStore } from "@freecorps/ember-react-native";
import type { PendingMutationRecord } from "@freecorps/ember-client";
import type { Mailbox, Page, Thread, ThreadDetail } from "../src/api";
import { pickLocale, translate } from "../src/i18n/strings";
import { bodyOf, HOSTILE_LEFTOVER, HOSTILE_SAMPLES, SAFE_SAMPLES } from "@freecorps/mail-email-html/test-samples";
import { buildEmailDocument, contentSecurityPolicy, hasRemoteImages, HEIGHT_PROBE, isExternalLink, isInitialLoad, resolveCid, sanitizeEmailHtml } from "../src/lib/emailHtml";
import { fileSize, formatWhen, initials, parseRecipients } from "../src/lib/format";
import { inboxOptimisticUpdates, isOptimisticId } from "../src/offline/optimistic";
import { setReplicaUser } from "../src/offline/replica";
import { pushTransport, registrationArgs, targetOf } from "../src/push/transport";
import { searchRows, sentRow, threadRow } from "../src/model/threads";
import { cidMap, deliveryState } from "../src/model/thread";

describe("email HTML", () => {
  it("removes scripts, handlers, script URLs, frames, forms, meta refresh and base", () => {
    const dirty = `<p onclick="steal()">Hi<script>alert(1)</script></p><a href="javascript:alert(1)">x</a><a href=" JaVaScRiPt:alert(1)">y</a>
      <iframe src="https://evil.test"></iframe><form action="https://evil.test"><input name=a></form><meta http-equiv="refresh" content="0;url=https://evil.test">
      <base href="https://evil.test/"><img src=x onerror=alert(1)><scr<script>x</script>ipt>alert(2)</script><svg onload=alert(3)><circle/></svg><!-- <script>c</script> -->`;
    const clean = sanitizeEmailHtml(dirty);
    expect(clean).not.toMatch(/<script|onclick|onerror|onload|javascript:|<iframe|<form|<input|<meta|<base|<svg/i);
    expect(clean).toContain("<p>Hi</p>");
    expect(clean).toContain("<img src=x>");
  });

  it(`allowlists URL schemes in the WebView document: ${HOSTILE_SAMPLES.length} hostile samples, safe ones kept`, () => {
    for (const h of HOSTILE_SAMPLES) expect(bodyOf(buildEmailDocument(h)), h).not.toMatch(HOSTILE_LEFTOVER);
    for (const h of SAFE_SAMPLES) expect(sanitizeEmailHtml(h), h).toBe(h);
    // Glued attributes and entity-encoded schemes (the old blocklist let these through).
    expect(sanitizeEmailHtml(`<p title="x"onclick="alert(1)">a</p>`)).toBe(`<p title="x">a</p>`);
    expect(sanitizeEmailHtml(`<a href="jav&#x61;script&colon;alert(1)">x</a>`)).toBe(`<a>x</a>`);
  });

  it("never throws on malformed cid: references", () => {
    const cid = { "logo@x": "https://mail.test/l" };
    expect(() => buildEmailDocument(`<img src="cid:foo%bar"><img src="cid:%E0%A4%A">`, { cid })).not.toThrow();
    expect(resolveCid(`<img src="cid:%E0%A4%A"><img src="cid:logo%40x">`, cid)).toBe(`<img src="about:blank"><img src="https://mail.test/l">`);
  });

  it("detects remote images (img, CSS url(), background=) and leaves data: images alone", () => {
    expect(hasRemoteImages('<img src="https://t.test/p.gif">')).toBe(true);
    expect(hasRemoteImages('<img src="//t.test/p.gif">')).toBe(true);
    expect(hasRemoteImages('<td style="background:url(\'http://t.test/bg.png\')">')).toBe(true);
    expect(hasRemoteImages('<table background="https://t.test/bg.png">')).toBe(true);
    expect(hasRemoteImages('<img src="data:image/png;base64,AAA="><img src="cid:logo">')).toBe(false);
  });

  it("CSP blocks network images until the user loads them; inline cid: images come from the attachment origin", () => {
    const blocked = contentSecurityPolicy({});
    expect(blocked).toContain("script-src 'none'");
    expect(blocked).toContain("img-src data:;");
    expect(blocked).not.toMatch(/img-src[^;]*https:/);
    const cid = { "logo@x": "https://mail.test/api/storage/f/abc?sig=1" };
    expect(contentSecurityPolicy({ cid })).toContain("img-src data: https://mail.test;");
    expect(contentSecurityPolicy({ loadImages: true })).toMatch(/img-src data: https: http:/);
    expect(resolveCid('<img src="cid:logo@x"><img src=cid:missing>', cid)).toBe('<img src="https://mail.test/api/storage/f/abc?sig=1"><img src=about:blank>');
  });

  it("builds a document with the CSP first, the body only, and no email scripts", () => {
    const doc = buildEmailDocument('<html><head><style>p{color:red}</style><script>x()</script></head><body class="a"><p>Olá</p></body></html>');
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<style>"));
    expect(doc).toContain("p{color:red}");
    expect(doc).toContain("<p>Olá</p>");
    expect(doc).not.toContain("x()");
  });

  it("the injected probe parses and fits wide mail to the width before reporting its height", () => {
    expect(() => new Function(HEIGHT_PROBE)).not.toThrow();
    expect(HEIGHT_PROBE).toContain("zoom");
  });

  it("only the initial document loads in the WebView; taps on http(s)/mailto/tel go to the OS", () => {
    expect(isInitialLoad("about:blank")).toBe(true);
    expect(isInitialLoad("https://evil.test")).toBe(false);
    expect(isExternalLink("https://acme.test")).toBe(true);
    expect(isExternalLink("mailto:a@b.test")).toBe(true);
    expect(isExternalLink("javascript:alert(1)")).toBe(false);
    expect(isExternalLink("file:///etc/passwd")).toBe(false);
    expect(isExternalLink(" JavaScript:alert(1)")).toBe(false);
    expect(isExternalLink("intent://x#Intent;scheme=http;end")).toBe(false);
    expect(isExternalLink("TEL:+5511999999999")).toBe(true);
  });
});

describe("format and i18n", () => {
  const now = new Date(2026, 10, 5, 15, 0).getTime();
  it("formats list dates per locale", () => {
    expect(formatWhen(new Date(2026, 10, 5, 9, 7).getTime(), now, "pt-BR")).toBe("09:07");
    expect(formatWhen(new Date(2026, 10, 4, 9, 7).getTime(), now, "pt-BR")).toBe("Ontem");
    expect(formatWhen(new Date(2026, 10, 4, 9, 7).getTime(), now, "en")).toBe("Yesterday");
    expect(formatWhen(new Date(2025, 0, 2).getTime(), now, "pt-BR")).toBe("02/01/2025");
    // The clock is explicit (Hermes on iOS would take the device's): 24 h in Portuguese, the device's in English.
    expect(formatWhen(new Date(2026, 10, 5, 12, 49).getTime(), now, "pt-BR")).toBe("12:49");
    expect(formatWhen(new Date(2026, 10, 5, 15, 7).getTime(), now, "pt-BR")).toBe("15:07");
    expect(formatWhen(new Date(2026, 10, 5, 15, 7).getTime(), now, "en")).toMatch(/^03:07\sPM$/);
    expect(formatWhen(new Date(2026, 10, 5, 15, 7).getTime(), now, "en", true)).toBe("15:07");
  });
  it("initials, sizes, recipients", () => {
    expect(initials("Ana Souza")).toBe("AS");
    expect(initials("caio.lima@user.test")).toBe("CL");
    expect(initials("")).toBe("");
    // break-ui: emoji, punctuation, one letter, CJK, an address with no name.
    expect(initials("🔥 Equipe Fogo")).toBe("EF");
    expect(initials("🎉")).toBe("");
    expect(initials("\"Ana\" (Suporte)")).toBe("AS");
    expect(initials("x")).toBe("X");
    expect(initials("李小龙")).toBe("李");
    expect(initials("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@example.test")).toBe("A");
    expect(fileSize(1536, "en")).toBe("1.5 KB");
    expect(fileSize(1536, "pt-BR")).toBe("1,5 KB");
    expect(parseRecipients("a@b.test, Bia <bia@x.test>; nope, ")).toEqual({ valid: ["a@b.test", "Bia <bia@x.test>"], invalid: ["nope"] });
  });
  it("pt-BR by default, English when the device prefers it; placeholders", () => {
    expect(pickLocale([])).toBe("pt-BR");
    expect(pickLocale(["fr-FR", "en-US"])).toBe("en");
    expect(pickLocale(["pt-PT"])).toBe("pt-BR");
    expect(translate("pt-BR", "mailboxes.unread", { count: 3 })).toBe("3 não lidas");
    expect(translate("pt-BR", "mailboxes.threads", { count: 1 })).toBe("1 conversa");
    expect(translate("en", "mailboxes.threads", { count: 1 })).toBe("1 conversation");
    expect(translate("en", "mailboxes.threads", { count: 0 })).toBe("0 conversations");
    expect(translate("pt-BR", "banner.pending", { count: 1 })).toBe("1 ação aguardando conexão");
    expect(translate("en", "threads.emptySearch", { query: "x" })).toBe("Nothing found for “x”");
  });
});

describe("push seam", () => {
  it("picks the transport from config", async () => {
    expect(pushTransport(undefined).name).toBe("expo");
    expect(pushTransport("direct").name).toBe("direct");
  });
  it("registration args drop direct-only fields unless the server takes them", () => {
    const r = { status: "granted" as const, token: "t", provider: "apns" as const, platform: "ios", environment: "development", publicKey: "pk" };
    expect(registrationArgs(r)).toEqual({ token: "t", provider: "apns", platform: "ios" });
    expect(registrationArgs(r, { direct: true })).toEqual({ token: "t", provider: "apns", platform: "ios", environment: "development", publicKey: "pk" });
  });
  it("notification data → thread", () => {
    expect(targetOf({ threadId: "email$threads_1", mailbox: "support" })).toEqual({ threadId: "email$threads_1", mailbox: "support" });
    expect(targetOf({ url: "embermail://thread/email%24threads_1" })).toEqual({ threadId: "email$threads_1" });
    expect(targetOf({ url: "https://evil.test" })).toBeNull();
    expect(targetOf(null)).toBeNull();
  });
});

const thread = (o: Partial<Thread> = {}): Thread => ({
  _id: "email$threads_1",
  _creationTime: 1,
  mailbox: "support",
  number: 7,
  subject: "Fatura",
  subjectKey: "fatura",
  contact: "ana@user.test",
  contactName: "Ana",
  status: "open",
  token: "tok",
  messageCount: 1,
  unreadCount: 2,
  lastMessageAt: 10,
  snippet: "oi",
  ...o,
});

/** An OptimisticLocalStore over a plain map (what the client gives an update). */
function fakeStore(init: Array<[string, Record<string, unknown>, unknown]>) {
  const k = (fn: string, args: unknown) => `${fn}|${JSON.stringify(args)}`;
  const m = new Map(init.map(([fn, args, v]) => [k(fn, args), { fn, args, v }]));
  const store: OptimisticLocalStore = {
    getQuery: (fn: any, args?: any) => m.get(k(fn, args ?? {}))?.v as any,
    setQuery: (fn: any, args: any, v: any) => void m.set(k(fn, args), { fn, args, v }),
    getAllQueries: (fn: any) => [...m.values()].filter((e) => e.fn === fn).map((e) => ({ args: e.args as any, value: e.v as any })),
  };
  return { store, get: (fn: string, args: Record<string, unknown>) => m.get(k(fn, args))?.v as any };
}

describe("optimistic updates", () => {
  const up = inboxOptimisticUpdates(() => 99);
  const rec = {} as PendingMutationRecord;
  const all = { mailbox: "support" };
  const open = { mailbox: "support", status: "open" };
  const page = (ts: Thread[]): Page<Thread> => ({ page: ts, isDone: true, continueCursor: null });
  const boxes: Mailbox[] = [{ name: "support", address: "support@acme.test", displayName: null, unread: 5, threads: 2 }];

  it("reply: pending message, waiting, moved out of the open filter", () => {
    const s = fakeStore([
      ["inbox:thread", { threadId: "email$threads_1" }, { thread: thread(), messages: [] } satisfies ThreadDetail],
      ["inbox:threads", all, page([thread()])],
      ["inbox:threads", open, page([thread()])],
    ]);
    up["inbox:reply"]!(s.store, { threadId: "email$threads_1", text: "Resolvido" }, rec);
    const d = s.get("inbox:thread", { threadId: "email$threads_1" }) as ThreadDetail;
    expect(d.thread.status).toBe("waiting");
    expect(d.messages).toMatchObject([{ direction: "outbound", text: "Resolvido", at: 99, to: [{ email: "ana@user.test", name: "Ana" }] }]);
    expect(isOptimisticId(d.messages[0]!._id)).toBe(true);
    expect(s.get("inbox:threads", all).page[0]).toMatchObject({ status: "waiting", messageCount: 2, lastMessageAt: 99, snippet: "Resolvido" });
    expect(s.get("inbox:threads", open).page).toEqual([]);
  });

  it("read / unread adjust the thread and the mailbox counter", () => {
    const s = fakeStore([
      ["inbox:threads", all, page([thread()])],
      ["inbox:mailboxes", {}, boxes],
    ]);
    up["inbox:markRead"]!(s.store, { threadId: "email$threads_1" }, rec);
    expect(s.get("inbox:threads", all).page[0].unreadCount).toBe(0);
    expect(s.get("inbox:mailboxes", {})[0].unread).toBe(3);
    up["inbox:markUnread"]!(s.store, { threadId: "email$threads_1" }, rec);
    expect(s.get("inbox:threads", all).page[0].unreadCount).toBe(1);
    expect(s.get("inbox:mailboxes", {})[0].unread).toBe(4);
  });

  it("the home's view counts follow read, archive and assignment (badges move at once)", () => {
    setReplicaUser("u2");
    const zero = { threads: 0, unread: 0, capped: false };
    const t = thread({ unreadCount: 2, status: "open" });
    const s = fakeStore([
      ["inbox:threads", all, page([t])],
      ["inbox:views", {}, { all: { ...zero, threads: 1, unread: 2 }, assigned: zero, unread: { ...zero, threads: 1, unread: 2 }, waiting: zero }],
      ["inbox:members", { mailbox: "support" }, [{ userId: "u2", name: "Caio" }]],
    ]);
    up["inbox:assign"]!(s.store, { threadId: t._id, userId: "u2" }, rec);
    expect(s.get("inbox:views", {}).assigned).toMatchObject({ threads: 1, unread: 2 });
    up["inbox:markRead"]!(s.store, { threadId: t._id }, rec);
    expect(s.get("inbox:views", {})).toMatchObject({ all: { threads: 1, unread: 0 }, assigned: { threads: 1, unread: 0 }, unread: { threads: 0, unread: 0 } });
    up["inbox:setStatus"]!(s.store, { threadId: t._id, status: "closed" }, rec);
    expect(s.get("inbox:views", {})).toMatchObject({ all: { threads: 1 }, assigned: { threads: 0 }, waiting: { threads: 0 } });
    setReplicaUser(null);
  });

  it("undo of an archive brings the thread back to a filtered list that had dropped it", () => {
    const t = thread({ _id: "email$threads_undo", status: "open", lastMessageAt: 50 });
    const older = thread({ _id: "email$threads_old", status: "open", lastMessageAt: 10 });
    const s = fakeStore([["inbox:threads", open, page([t, older])]]);
    up["inbox:setStatus"]!(s.store, { threadId: t._id, status: "closed" }, rec);
    expect(s.get("inbox:threads", open).page.map((x: Thread) => x._id)).toEqual([older._id]);
    up["inbox:setStatus"]!(s.store, { threadId: t._id, status: "open" }, rec);
    expect(s.get("inbox:threads", open).page.map((x: Thread) => x._id)).toEqual([t._id, older._id]);
  });

  it("archive, assign (name from the loaded member list), compose", () => {
    const s = fakeStore([
      ["inbox:threads", all, page([thread()])],
      ["inbox:threads", open, page([thread()])],
      ["inbox:members", { mailbox: "support" }, [{ userId: "u2", name: "Caio" }]],
    ]);
    up["inbox:setStatus"]!(s.store, { threadId: "email$threads_1", status: "closed" }, rec);
    expect(s.get("inbox:threads", all).page[0].status).toBe("closed");
    expect(s.get("inbox:threads", open).page).toEqual([]);
    up["inbox:assign"]!(s.store, { threadId: "email$threads_1", userId: "u2" }, rec);
    expect(s.get("inbox:threads", all).page[0]).toMatchObject({ assignee: "u2", assigneeName: "Caio" });
    up["inbox:assign"]!(s.store, { threadId: "email$threads_1", userId: null }, rec);
    expect(s.get("inbox:threads", all).page[0].assignee).toBeUndefined();
    up["inbox:compose"]!(s.store, { mailbox: "support", to: ["Lia <lia@user.test>"], subject: "Oi", text: "Tudo bem?" }, rec);
    const first = s.get("inbox:threads", all).page[0] as Thread;
    expect(first).toMatchObject({ contact: "lia@user.test", subject: "Oi", status: "waiting" });
    expect(threadRow(first).pending).toBe(true);
    // A forward from the loaded thread's mailbox shows the same way.
    up["inbox:forward"]!(s.store, { threadId: "email$threads_1", to: ["Bia <bia@user.test>"], subject: "Fwd: Oi", text: "Veja." }, rec);
    expect(s.get("inbox:threads", all).page[0]).toMatchObject({ contact: "bia@user.test", subject: "Fwd: Oi", mailbox: "support" });
  });

  it("compose and forward: on top of the loaded views that keep a new waiting thread, and their counts grow", () => {
    setReplicaUser("u2");
    const zero = { threads: 0, unread: 0, capped: false };
    const viewPage = (ts: Thread[]) => ({ page: ts, isDone: true, partial: false });
    const s = fakeStore([
      ["inbox:thread", { threadId: "email$threads_1" }, { thread: thread(), messages: [] }],
      ["inbox:view", { view: "all" }, viewPage([thread()])],
      ["inbox:view", { view: "waiting" }, viewPage([])],
      ["inbox:view", { view: "all", status: "closed" }, viewPage([])],
      ["inbox:view", { view: "unread" }, viewPage([])],
      ["inbox:view", { view: "assigned" }, viewPage([])],
      ["inbox:views", {}, { all: { ...zero, threads: 1 }, assigned: zero, unread: zero, waiting: zero }],
    ]);
    up["inbox:compose"]!(s.store, { mailbox: "support", to: ["Lia <lia@user.test>"], subject: "Oi", text: "Tudo bem?" }, rec);
    expect(s.get("inbox:view", { view: "all" }).page[0]).toMatchObject({ contact: "lia@user.test", status: "waiting" });
    expect(s.get("inbox:view", { view: "all" }).page).toHaveLength(2);
    expect(s.get("inbox:view", { view: "waiting" }).page).toHaveLength(1);
    // Not archived, not unread, not assigned: those lists stay as they were.
    expect(s.get("inbox:view", { view: "all", status: "closed" }).page).toEqual([]);
    expect(s.get("inbox:view", { view: "unread" }).page).toEqual([]);
    expect(s.get("inbox:view", { view: "assigned" }).page).toEqual([]);
    expect(s.get("inbox:views", {})).toMatchObject({ all: { threads: 2 }, waiting: { threads: 1 }, unread: { threads: 0 }, assigned: { threads: 0 } });
    up["inbox:forward"]!(s.store, { threadId: "email$threads_1", to: ["bia@user.test"], subject: "Fwd: Oi", text: "Veja." }, rec);
    expect(s.get("inbox:view", { view: "waiting" }).page[0]).toMatchObject({ contact: "bia@user.test", subject: "Fwd: Oi" });
    expect(s.get("inbox:views", {})).toMatchObject({ all: { threads: 3 }, waiting: { threads: 2 } });
    setReplicaUser(null);
  });

  it("delete: the thread leaves every loaded list, and the counts drop with it", () => {
    const zero = { threads: 0, unread: 0, capped: false };
    const t = thread({ unreadCount: 2, status: "open" });
    const s = fakeStore([
      ["inbox:threads", all, page([t])],
      ["inbox:view", { view: "all" }, { page: [t], isDone: true, partial: false }],
      ["inbox:sent", { mailbox: "support", limit: 30 }, { page: [{ ...t, lastSentAt: 1 }], isDone: true }],
      ["inbox:views", {}, { all: { ...zero, threads: 1, unread: 2 }, assigned: zero, unread: { ...zero, threads: 1, unread: 2 }, waiting: zero }],
      ["inbox:mailboxes", {}, boxes],
      ["inbox:thread", { threadId: t._id }, { thread: t, messages: [] }],
      ["inbox:search", { query: "oi" }, [{ threadId: t._id, messageId: "m1" }, { threadId: "email$threads_9", messageId: "m2" }]],
    ]);
    up["inbox:deleteThread"]!(s.store, { threadId: t._id }, rec);
    expect(s.get("inbox:thread", { threadId: t._id })).toBeNull();
    expect(s.get("inbox:search", { query: "oi" }).map((h: { threadId: string }) => h.threadId)).toEqual(["email$threads_9"]);
    expect(s.get("inbox:threads", all).page).toEqual([]);
    expect(s.get("inbox:view", { view: "all" }).page).toEqual([]);
    expect(s.get("inbox:sent", { mailbox: "support", limit: 30 }).page).toEqual([]);
    expect(s.get("inbox:views", {})).toMatchObject({ all: { threads: 0, unread: 0 }, unread: { threads: 0, unread: 0 } });
    expect(s.get("inbox:mailboxes", {})[0].unread).toBe(3);
  });

  it("Sent: a reply or a new conversation goes on top of its mailbox's Sent lists, once; notes do not; status patches in place", () => {
    const sent = { mailbox: "support", limit: 30 };
    const old = { ...thread({ _id: "email$threads_0" }), lastSentAt: 5 };
    const s = fakeStore([
      ["inbox:thread", { threadId: "email$threads_1" }, { thread: thread(), messages: [] }],
      ["inbox:sent", sent, { page: [old, { ...thread(), lastSentAt: 1 }], isDone: true }],
      ["inbox:sent", { mailbox: "privacy", limit: 30 }, { page: [], isDone: true }],
    ]);
    up["inbox:reply"]!(s.store, { threadId: "email$threads_1", text: "Pronto" }, rec);
    expect(s.get("inbox:sent", sent).page.map((t: Thread) => t._id)).toEqual(["email$threads_1", "email$threads_0"]);
    expect(s.get("inbox:sent", sent).page[0].lastSentAt).toBe(99);
    expect(s.get("inbox:sent", { mailbox: "privacy", limit: 30 }).page).toEqual([]);
    up["inbox:note"]!(s.store, { threadId: "email$threads_0", text: "nota" }, rec);
    expect(s.get("inbox:sent", sent).page[1]._id).toBe("email$threads_0");
    up["inbox:setStatus"]!(s.store, { threadId: "email$threads_0", status: "closed" }, rec);
    expect(s.get("inbox:sent", sent).page[1]).toMatchObject({ status: "closed", lastSentAt: 5 });
    up["inbox:compose"]!(s.store, { mailbox: "support", to: ["Lia <lia@user.test>"], subject: "Oi", text: "Tudo bem?" }, rec);
    expect(s.get("inbox:sent", sent).page).toHaveLength(3);
    expect(s.get("inbox:sent", sent).page[0]).toMatchObject({ contact: "lia@user.test", lastSentAt: 99 });
    expect(sentRow({ ...thread({ lastMessageAt: 120 }), lastSentAt: 42 }).at).toBe(42);
  });
});

describe("rows", () => {
  it("thread rows and search rows (one per thread)", () => {
    expect(threadRow(thread({ assigneeName: "Bia" }))).toMatchObject({ title: "Ana", unread: true, assigneeName: "Bia", pending: false, number: 7 });
    const hit = { messageId: "m1", threadId: "t1", mailbox: "support", direction: "inbound" as const, subject: "s", from: { email: "a@b.test" }, snippet: "x", at: 1 };
    expect(searchRows([hit, { ...hit, messageId: "m2" }, { ...hit, messageId: "m3", threadId: "t2" }]).map((r) => r.key)).toEqual(["m1", "m3"]);
    expect(searchRows([{ ...hit, status: "closed", unreadCount: 1, assignee: "u1", assigneeName: "Bia" }])[0]).toMatchObject({ status: "closed", unread: true, assignee: "u1" });
    expect(searchRows([hit])[0]).toMatchObject({ status: null, unread: false, tags: [], snoozedUntil: null });
    expect(searchRows([{ ...hit, tags: ["vip"], snoozedUntil: 9 }])[0]).toMatchObject({ tags: ["vip"], snoozedUntil: 9 });
  });
  it("inline images map Content-ID to the attachment URL", () => {
    const m = { attachments: [{ filename: "l.png", contentType: "image/png", file: "f1", contentId: "<logo@x>", inline: true }, { filename: "a.pdf", contentType: "application/pdf", file: "f2" }] } as any;
    expect(cidMap(m, { f1: "https://u/1", f2: "https://u/2" })).toEqual({ "logo@x": "https://u/1" });
    expect(cidMap(m, undefined)).toEqual({});
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
  const msg = (o: Record<string, unknown>) =>
    ({ _id: "m", direction: "inbound", from: { email: "ana@user.test", name: "Ana" }, to: [], cc: [], subject: "Contrato", text: "Segue.", attachments: [], ...o }) as never;

  it("reply all copies everyone else on the latest message received, never this mailbox (or a +tag) nor the contact", () => {
    const messages = [msg({ to: [{ email: "heitor@freecorps.test" }, { email: "bia@user.test", name: "Bia" }], cc: [{ email: "heitor+t_x@freecorps.test" }, { email: "ana@user.test" }] })];
    expect(replyAllCc(messages, "heitor@freecorps.test", "ana@user.test")).toEqual(["Bia <bia@user.test>"]);
    expect(replyAllCc([], "heitor@freecorps.test", "ana@user.test")).toEqual([]);
    expect(replyAllCc(messages, "", "ana@user.test")).toEqual([]);
    const crowd = msg({ cc: Array.from({ length: 80 }, (_, i) => ({ email: `p${i}@user.test` })) });
    expect(replyAllCc([crowd], "heitor@freecorps.test", "ana@user.test")).toHaveLength(MAX_CC);
    expect(forwardedFiles([{ filename: "a.pdf" }, { filename: "logo.png", inline: true, contentId: "<logo>" }])).toEqual([{ filename: "a.pdf" }]);
  });

  it("a forward says Fwd: once, and quotes the original under a header", () => {
    expect(forwardSubject("Contrato")).toBe("Fwd: Contrato");
    expect(forwardSubject("Enc: Contrato")).toBe("Enc: Contrato");
    expect(forwardText(msg({}), { header: "Forwarded message", from: "From", date: "Date", subject: "Subject", to: "To" }, "Nov 10")).toBe(
      "\n\n---------- Forwarded message ----------\nFrom: Ana <ana@user.test>\nDate: Nov 10\nSubject: Contrato\n\nSegue.",
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

describe("undone new message", () => {
  it("what it had comes back once (by key), then nothing", async () => {
    const { keepUndoneCompose, takeUndoneCompose } = await import("../src/model/undone-compose");
    const key = keepUndoneCompose({ mailbox: "support", to: ["ana@user.test"], cc: [], subject: "Oi", text: "Olá", attachments: [] });
    expect(takeUndoneCompose(key)).toMatchObject({ mailbox: "support", subject: "Oi", text: "Olá" });
    expect(takeUndoneCompose(key)).toBeNull();
    expect(takeUndoneCompose(undefined)).toBeNull();
  });
});
