// Pure helpers: HTML safety, formatting, i18n, the push seam, optimistic updates.
import { describe, expect, it } from "vitest";
import type { OptimisticLocalStore } from "@freecorps/ember-react-native";
import type { Mailbox, Page, Thread, ThreadDetail } from "../src/api";
import { pickLocale, translate } from "../src/i18n/strings";
import { bodyOf, HOSTILE_LEFTOVER, HOSTILE_SAMPLES, SAFE_SAMPLES } from "@freecorps/mail-email-html/test-samples";
import { buildEmailDocument, contentSecurityPolicy, hasRemoteImages, HEIGHT_PROBE, isExternalLink, isInitialLoad, resolveCid, sanitizeEmailHtml } from "../src/lib/emailHtml";
import { fileSize, formatWhen, initials, parseRecipients } from "../src/lib/format";
import { inboxOptimisticUpdates, isOptimisticId } from "../src/offline/optimistic";
import { pushTransport, registrationArgs, targetOf } from "../src/push/transport";
import { searchRows, threadRow } from "../src/model/threads";
import { cidMap } from "../src/model/thread";

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
  });
  it("initials, sizes, recipients", () => {
    expect(initials("Ana Souza")).toBe("AS");
    expect(initials("caio.lima@user.test")).toBe("CL");
    expect(initials("")).toBe("?");
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
  it("picks the transport from config; the direct one is a placeholder until feat/push-direct", async () => {
    expect(pushTransport(undefined).name).toBe("expo");
    expect(pushTransport("direct").name).toBe("direct");
    expect(await pushTransport("direct").register()).toMatchObject({ status: "unsupported" });
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
    up["inbox:reply"]!(s.store, { threadId: "email$threads_1", text: "Resolvido" });
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
    up["inbox:markRead"]!(s.store, { threadId: "email$threads_1" });
    expect(s.get("inbox:threads", all).page[0].unreadCount).toBe(0);
    expect(s.get("inbox:mailboxes", {})[0].unread).toBe(3);
    up["inbox:markUnread"]!(s.store, { threadId: "email$threads_1" });
    expect(s.get("inbox:threads", all).page[0].unreadCount).toBe(1);
    expect(s.get("inbox:mailboxes", {})[0].unread).toBe(4);
  });

  it("archive, assign (name from the loaded member list), compose", () => {
    const s = fakeStore([
      ["inbox:threads", all, page([thread()])],
      ["inbox:threads", open, page([thread()])],
      ["inbox:members", { mailbox: "support" }, [{ userId: "u2", name: "Caio" }]],
    ]);
    up["inbox:setStatus"]!(s.store, { threadId: "email$threads_1", status: "closed" });
    expect(s.get("inbox:threads", all).page[0].status).toBe("closed");
    expect(s.get("inbox:threads", open).page).toEqual([]);
    up["inbox:assign"]!(s.store, { threadId: "email$threads_1", userId: "u2" });
    expect(s.get("inbox:threads", all).page[0]).toMatchObject({ assignee: "u2", assigneeName: "Caio" });
    up["inbox:assign"]!(s.store, { threadId: "email$threads_1", userId: null });
    expect(s.get("inbox:threads", all).page[0].assignee).toBeUndefined();
    up["inbox:compose"]!(s.store, { mailbox: "support", to: ["Lia <lia@user.test>"], subject: "Oi", text: "Tudo bem?" });
    const first = s.get("inbox:threads", all).page[0] as Thread;
    expect(first).toMatchObject({ contact: "lia@user.test", subject: "Oi", status: "waiting" });
    expect(threadRow(first).pending).toBe(true);
  });
});

describe("rows", () => {
  it("thread rows and search rows (one per thread)", () => {
    expect(threadRow(thread({ assigneeName: "Bia" }))).toMatchObject({ title: "Ana", unread: true, assigneeName: "Bia", pending: false, number: 7 });
    const hit = { messageId: "m1", threadId: "t1", mailbox: "support", direction: "inbound" as const, subject: "s", from: { email: "a@b.test" }, snippet: "x", at: 1 };
    expect(searchRows([hit, { ...hit, messageId: "m2" }, { ...hit, messageId: "m3", threadId: "t2" }]).map((r) => r.key)).toEqual(["m1", "m3"]);
  });
  it("inline images map Content-ID to the attachment URL", () => {
    const m = { attachments: [{ filename: "l.png", contentType: "image/png", file: "f1", contentId: "<logo@x>", inline: true }, { filename: "a.pdf", contentType: "application/pdf", file: "f2" }] } as any;
    expect(cidMap(m, { f1: "https://u/1", f2: "https://u/2" })).toEqual({ "logo@x": "https://u/1" });
    expect(cidMap(m, undefined)).toEqual({});
  });
});
