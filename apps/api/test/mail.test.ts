// The mail app on workerd (Miniflare): the SDK against the HTTP API (keys, idempotency, sends through the simulated
// send_email binding), Email Service events through the component's real local queue, inbound mail through the
// Worker's email() handler (postal-mime, attachments in R2, threads, auto-reply, push hook), the inbox API and the
// members-only reactive queries.
import { createExecutionContext, createMessageBatch, env, getQueueResult, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { composeApp } from "@freecorps/ember-server";
import { EmberMail, verifyWebhook } from "@freecorps/mail-sdk";
import worker from "./worker.ts";
import { addDomain, removeDomain, resolveAccountId } from "../src/operator.ts";
import { app, functions, http, schema } from "../src/app.ts";

const BASE = "http://mail.test";
const f = ((url: string, init?: RequestInit) => SELF.fetch(url, init)) as typeof fetch;
const admin = new EmberMail("admin-secret", { baseUrl: BASE, fetch: f });

async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await get();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

const call = async (kind: "query" | "mutation" | "action", fn: string, args: unknown, token?: string) => {
  const r = await SELF.fetch(`${BASE}/api/${kind}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ fn, args, shard: "global:main" }) });
  return (await r.json()) as any;
};

const event = (type: string, messageId: string, eventId: string, payload: Record<string, unknown> = {}) => ({
  type: `cf.email.sending.message.${type}`,
  source: { type: "email.sending", zoneId: "z", domain: "acme.test" },
  payload: { eventId, messageId, sender: "hello@acme.test", recipient: "ana@user.test", terminal: type !== "deferred", ...payload },
  metadata: { accountId: "acc", eventSubscriptionId: "s", eventSchemaVersion: 1, eventTimestamp: new Date().toISOString() },
});

function inbound(from: string, to: string, raw: string) {
  const bytes = new TextEncoder().encode(raw);
  const out = { rejected: null as string | null };
  const msg = {
    from,
    to,
    headers: new Headers(),
    raw: new Response(bytes).body!,
    rawSize: bytes.length,
    setReject: (r: string) => void (out.rejected = r),
    forward: async () => ({}),
    reply: async () => ({}),
  };
  return { msg, out };
}

const mime = (o: { from: string; to: string; subject: string; text: string; id: string; extra?: string[] }) =>
  [
    "Authentication-Results: mx.cloudflare.net; dkim=pass header.d=user.test; dmarc=pass header.from=user.test; spf=pass",
    `From: ${o.from}`,
    `To: ${o.to}`,
    `Subject: ${o.subject}`,
    `Message-ID: <${o.id}>`,
    ...(o.extra ?? []),
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="xx"',
    "",
    "--xx",
    "Content-Type: text/plain; charset=utf-8",
    "",
    o.text,
    "--xx",
    'Content-Type: application/pdf; name="invoice.pdf"',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    btoa("%PDF-1.4 fake"),
    "--xx--",
    "",
  ].join("\r\n");

describe("mail app", () => {
  let sender: EmberMail;

  it("bootstrap: admin token creates keys; keys are hashed and scoped", async () => {
    expect((await call("mutation", "testing:seedDomain", { name: "acme.test" })).ok).toBe(true);
    const k = await admin.apiKeys.create({ name: "app", permission: "sending_access", project: "acme" });
    expect(k.error).toBeNull();
    expect(k.data!.token).toMatch(/^em_[0-9a-f]{8}_/);
    sender = new EmberMail(k.data!.token, { baseUrl: BASE, fetch: f });
    const list = await admin.apiKeys.list();
    expect(JSON.stringify(list.data)).not.toContain(k.data!.token); // only the prefix is ever shown
    expect((await sender.domains.list()).error).toMatchObject({ statusCode: 403, name: "restricted_api_key" });
    // A malformed domain is a validation error (422), not a 500.
    for (const name of ["not a domain!", "nodot", "-bad-.test"]) expect((await admin.domains.create({ name })).error).toMatchObject({ statusCode: 422, name: "validation_error" });
    expect((await new EmberMail("em_nope_x", { baseUrl: BASE, fetch: f }).emails.get("x")).error).toMatchObject({ statusCode: 401 });
  });

  it("emails.send → Email Service (simulated binding) → sent; Idempotency-Key replays; unknown domains refused", async () => {
    const r = await sender.emails.send({ from: "Acme <hello@acme.test>", to: "ana@user.test", subject: "Hi", html: "<p>Hello</p>", tags: [{ name: "kind", value: "welcome" }] }, { idempotencyKey: "welcome-ana" });
    expect(r.error).toBeNull();
    const again = await sender.emails.send({ from: "Acme <hello@acme.test>", to: "someone-else@user.test", subject: "x", text: "x" }, { idempotencyKey: "welcome-ana" });
    expect(again.data!.id).toBe(r.data!.id);
    const sent = await until(() => sender.emails.get(r.data!.id), (x) => x.data?.last_event === "sent");
    expect(sent.data).toMatchObject({ object: "email", from: "Acme <hello@acme.test>", to: ["ana@user.test"], subject: "Hi", html: "<p>Hello</p>", last_event: "sent", tags: [{ name: "kind", value: "welcome" }] });
    expect((await sender.emails.send({ from: "x@other.test", to: "a@b.test", subject: "s", text: "t" })).error).toMatchObject({ statusCode: 403, name: "invalid_from_address" });
    expect((await sender.emails.send({ from: "x@acme.test", to: "not-an-address", subject: "s", text: "t" })).error).toMatchObject({ statusCode: 422 });
  });

  it("batch, scheduled + cancel, templates", async () => {
    const b = await sender.batch.send([
      { from: "hello@acme.test", to: "a1@user.test", subject: "1", text: "1" },
      { from: "hello@acme.test", to: "a2@user.test", subject: "2", text: "2" },
    ]);
    expect(b.data!.data).toHaveLength(2);
    const later = await sender.emails.send({ from: "hello@acme.test", to: "a3@user.test", subject: "later", text: "x", scheduled_at: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await sender.emails.get(later.data!.id)).data!.last_event).toBe("scheduled");
    expect((await sender.emails.cancel(later.data!.id)).error).toBeNull();
    expect((await sender.emails.get(later.data!.id)).data!.last_event).toBe("canceled");

    const owner = await admin.apiKeys.create({ name: "owner", permission: "full_access", project: "acme" });
    const full = new EmberMail(owner.data!.token, { baseUrl: BASE, fetch: f });
    expect((await full.templates.create({ name: "welcome", subject: "Welcome {{name}}", html: "<p>Hi <b>{{name}}</b></p>", layout: { brand: "Acme" } })).error).toBeNull();
    const t = await sender.emails.send({ from: "hello@acme.test", to: "a4@user.test", template: { name: "welcome", data: { name: "Ana" } } });
    const done = await until(() => sender.emails.get(t.data!.id), (x) => x.data?.last_event === "sent");
    expect(done.data!.subject).toBe(""); // rendered at delivery; the row keeps the template
  });

  it("delivery events from the component's queue: delivered, duplicate, bounce → suppression", async () => {
    const r = await sender.emails.send({ from: "hello@acme.test", to: "ana@user.test", subject: "events", text: "x" });
    const sent = await until(() => sender.emails.get(r.data!.id), (x) => x.data?.last_event === "sent");
    const mid = sent.data!.message_id!;
    expect(mid).toBeTruthy();
    const batch = createMessageBatch("ember-mail-test-email-events", [
      { id: "q1", timestamp: new Date(), attempts: 1, body: event("delivered", mid, "ev-1") },
      { id: "q2", timestamp: new Date(), attempts: 1, body: event("delivered", mid, "ev-1") }, // duplicate
      { id: "q3", timestamp: new Date(), attempts: 1, body: { hello: "not an event" } as any },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch as never, env as never, ctx);
    const res = await getQueueResult(batch, ctx);
    expect(res.explicitAcks.sort()).toEqual(["q1", "q2", "q3"]);
    expect((await sender.emails.get(r.data!.id)).data!.last_event).toBe("delivered");
    expect((await sender.emails.events(r.data!.id)).data!.data).toMatchObject([{ id: "ev-1", type: "delivered", duplicates: 1, terminal: true }]);

    // A hard bounce of another email suppresses the address for the project.
    const b = await sender.emails.send({ from: "hello@acme.test", to: "gone@user.test", subject: "bounce", text: "x" });
    const bs = await until(() => sender.emails.get(b.data!.id), (x) => x.data?.last_event === "sent");
    // Through the real local queue this time (producer binding → consumer → component handler).
    await env.EMBER_Q_EMAIL_EVENTS.send(event("bounced", bs.data!.message_id!, "ev-2", { recipient: "gone@user.test", bounce: { type: "hard", reason: "550 no such user" } }));
    await until(() => sender.emails.get(b.data!.id), (x) => x.data?.last_event === "bounced");
    const again = await sender.emails.send({ from: "hello@acme.test", to: "gone@user.test", subject: "again", text: "x" });
    expect((await sender.emails.get(again.data!.id)).data!.last_event).toBe("suppressed");
  });

  it("GET /emails lists the project's emails newest first, filtered by tag, status, recipient and time, page by page", async () => {
    const tagged = async (n: number, to: string) => (await sender.emails.send({ from: "hello@acme.test", to, subject: `list ${n}`, text: "x", tags: [{ name: "order", value: String(n) }] })).data!.id;
    const a = await tagged(1, "ana@user.test");
    const b = await tagged(2, "bia@user.test");
    const c = await tagged(3, "ana@user.test");
    const all = (await sender.emails.list({ tag: "order" })).data!;
    expect(all.data.map((e) => e.id)).toEqual([c, b, a]);
    expect((await sender.emails.list({ tag: "order:2" })).data!.data.map((e) => e.id)).toEqual([b]);
    expect((await sender.emails.list({ tag: "order", to: "ANA@user.test" })).data!.data.map((e) => e.id)).toEqual([c, a]);
    // Paging: two by two, nothing skipped or repeated.
    const first = (await sender.emails.list({ tag: "order", limit: 2 })).data!;
    expect(first.data.map((e) => e.id)).toEqual([c, b]);
    expect(first.has_more).toBe(true);
    const second = (await sender.emails.list({ tag: "order", limit: 2, cursor: first.next_cursor! })).data!;
    expect(second.data.map((e) => e.id)).toEqual(expect.arrayContaining([a]));
    expect(second.data.map((e) => e.id)).not.toContain(b);
    // Time and status filters; a bad date is a 422; another project's key sees none of them.
    expect((await sender.emails.list({ tag: "order", since: new Date(Date.now() + 60_000) })).data!.data).toEqual([]);
    expect((await sender.emails.list({ tag: "order", status: "canceled" })).data!.data).toEqual([]);
    expect((await sender.emails.list({ since: "not a date" })).error).toMatchObject({ statusCode: 422 });
    const other = (await admin.apiKeys.create({ name: "other", permission: "sending_access", project: "else" })).data!.token;
    const elsewhere = new EmberMail(other, { baseUrl: BASE, fetch: f });
    expect((await elsewhere.emails.list({ tag: "order" })).data!.data).toEqual([]);
  });

  it("inbound: email() → mailbox thread (attachment in R2), auto-reply sent, unknown addresses rejected", async () => {
    expect((await admin.inbox.upsertMailbox({ name: "support", address: "support@acme.test", display_name: "Acme Support", auto_reply: { subject: "Re: {{subject}} [#{{number}}]", text: "Hi {{name}}, ticket #{{number}} is open." } })).error).toBeNull();
    expect((await admin.inbox.upsertMailbox({ name: "privacy", address: "privacy@acme.test" })).error).toBeNull();
    const m = inbound("ana@user.test", "support@acme.test", mime({ from: '"Ana" <ana@user.test>', to: "support@acme.test", subject: "Invoice wrong", text: "My invoice total is wrong.", id: "in-1@user.test" }));
    await worker.email(m.msg as never, env as never, createExecutionContext());
    expect(m.out.rejected).toBeNull();
    const nope = inbound("ana@user.test", "sales@acme.test", mime({ from: "ana@user.test", to: "sales@acme.test", subject: "x", text: "x", id: "in-2@user.test" }));
    await worker.email(nope.msg as never, env as never, createExecutionContext());
    expect(nope.out.rejected).toBe("Address not found");

    const inbox = await admin.apiKeys.create({ name: "agent", permission: "inbox", project: "acme" });
    const agent = new EmberMail(inbox.data!.token, { baseUrl: BASE, fetch: f });
    const boxes = await agent.inbox.mailboxes();
    expect(boxes.data!.data.find((b) => b.name === "support")).toMatchObject({ unread: 1, threads: 1 });
    const threads = await agent.inbox.threads({ mailbox: "support" });
    const t = threads.data!.page[0]!;
    expect(t).toMatchObject({ number: 1, subject: "Invoice wrong", contact: "ana@user.test", status: "open", unreadCount: 1 });
    const full = await agent.inbox.thread(t._id);
    const msg = full.data!.messages[0] as any;
    expect(msg).toMatchObject({ direction: "inbound", text: "My invoice total is wrong.", auth: { dkim: "pass", dmarc: "pass" } });
    expect(msg.attachments).toMatchObject([{ filename: "invoice.pdf", contentType: "application/pdf" }]);
    const stored = await env.EMBER_FILES.list();
    expect(stored.objects.length).toBeGreaterThanOrEqual(2); // the raw .eml and the PDF
    // Search (searchIndex on the component's messages table).
    expect((await agent.inbox.search("invoice", "support")).data!.data).toMatchObject([{ threadId: t._id }]);
    // Reply from the inbox: threaded, then waiting.
    const reply = await agent.inbox.reply(t._id, "Fixed, sorry!", "agent-1");
    expect(reply.error).toBeNull();
    expect((await agent.inbox.thread(t._id)).data!.thread.status).toBe("waiting");
    // ?limit= is validated: a number is capped at 100, garbage is a 422 (not a 500 from NaN).
    const page = async (limit: string) => SELF.fetch(`${BASE}/inbox/threads?mailbox=support&limit=${limit}`, { headers: { authorization: `Bearer ${inbox.data!.token}` } });
    expect((await page("500")).status).toBe(200);
    expect(((await (await page("1")).json()) as any).page).toHaveLength(1);
    for (const bad of ["abc", "0", "-3", "2.5"]) {
      const res = await page(bad);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ name: "validation_error" });
    }
    // An inbox key cannot send arbitrary email.
    expect((await agent.emails.send({ from: "hello@acme.test", to: "x@user.test", subject: "s", text: "t" })).error).toMatchObject({ statusCode: 403 });
  });

  it("members-only reactive queries for the mobile client; push device registration", async () => {
    expect((await admin.inbox.addMember({ user_id: "agent-1", mailboxes: ["support"], name: "Agent One" })).error).toBeNull();
    expect((await call("query", "inbox:mailboxes", {})).error.message).toMatch(/unauthenticated/);
    expect((await call("query", "inbox:mailboxes", {}, "user:stranger")).error.message).toMatch(/not a member/);
    const boxes = await call("query", "inbox:mailboxes", {}, "user:agent-1");
    expect(boxes.value.map((b: any) => b.name)).toEqual(["support"]);
    expect((await call("query", "inbox:threads", { mailbox: "privacy" }, "user:agent-1")).error.message).toMatch(/no access/);
    const threads = await call("query", "inbox:threads", { mailbox: "support" }, "user:agent-1");
    expect(threads.value.page.length).toBe(1);
    expect((await call("mutation", "inbox:registerDevice", { token: "ExponentPushToken[abc]", platform: "ios" }, "user:agent-1")).ok).toBe(true);
    expect((await call("mutation", "inbox:markRead", { threadId: threads.value.page[0]._id }, "user:agent-1")).ok).toBe(true);
    expect((await call("query", "inbox:mailboxes", {}, "user:agent-1")).value[0].unread).toBe(0);
  });

  it("mobile inbox: me, members, mark unread, assign, attachments, compose, recent (complete documents)", async () => {
    expect((await admin.inbox.addMember({ user_id: "agent-2", mailboxes: ["privacy"], name: "Agent Two" })).error).toBeNull();
    expect((await call("query", "inbox:me", {})).value).toBeNull();
    expect((await call("query", "inbox:me", {}, "user:stranger")).value).toMatchObject({ member: false, mailboxes: [] });
    expect((await call("query", "inbox:me", {}, "user:agent-1")).value).toMatchObject({ member: true, name: "Agent One", mailboxes: ["support"] });
    expect((await call("query", "inbox:members", { mailbox: "support" }, "user:agent-1")).value).toEqual([{ userId: "agent-1", name: "Agent One" }]);

    const t = (await call("query", "inbox:threads", { mailbox: "support" }, "user:agent-1")).value.page[0];
    expect((await call("mutation", "inbox:markUnread", { threadId: t._id }, "user:agent-1")).ok).toBe(true);
    expect((await call("query", "inbox:mailboxes", {}, "user:agent-1")).value[0].unread).toBe(1);
    // Only members who can see the mailbox can be assigned.
    expect((await call("mutation", "inbox:assign", { threadId: t._id, userId: "agent-2" }, "user:agent-1")).error.message).toMatch(/cannot see/);
    expect((await call("mutation", "inbox:assign", { threadId: t._id, userId: "agent-1" }, "user:agent-1")).ok).toBe(true);
    expect((await call("query", "inbox:thread", { threadId: t._id }, "user:agent-1")).value.thread).toMatchObject({ assignee: "agent-1", assigneeName: "Agent One" });
    // Signed download URLs of the attachments, by file id (the thread keeps returning complete documents).
    const full = (await call("query", "inbox:thread", { threadId: t._id }, "user:agent-1")).value;
    const file = full.messages[0].attachments[0].file;
    const urls = (await call("query", "inbox:attachments", { threadId: t._id }, "user:agent-1")).value;
    expect(typeof urls[file]).toBe("string");
    expect((await call("query", "inbox:attachments", { threadId: t._id }, "user:agent-2")).error.message).toMatch(/no access/);

    expect((await call("mutation", "inbox:compose", { mailbox: "privacy", to: ["x@user.test"], subject: "s", text: "t" }, "user:agent-1")).error.message).toMatch(/no access/);
    const c = await call("mutation", "inbox:compose", { mailbox: "support", to: ["Caio <caio@user.test>"], subject: "Your refund", text: "On its way." }, "user:agent-1");
    expect(c.value).toMatchObject({ number: 2 });
    const recent = (await call("query", "inbox:recent", {}, "user:agent-1")).value;
    expect(recent.threads.map((x: any) => x.number)).toEqual([2, 1]);
    expect(recent.messages.every((m: any) => typeof m._id === "string" && typeof m._creationTime === "number" && m.mailbox === "support")).toBe(true);
    expect((await call("mutation", "inbox:registerDevice", { token: "apns-device-token", provider: "apns", platform: "ios" }, "user:agent-1")).ok).toBe(true);
    // The direct transport also reports the token's APNs environment and the device key the server seals to.
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    const publicKey = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const direct = { token: "apns-direct-token", provider: "apns", platform: "ios", environment: "production", publicKey };
    const reg = await call("mutation", "inbox:registerDevice", direct, "user:agent-1");
    expect(reg.error ?? null).toBeNull();
  });

  it("attachments: uploaded with a ticket, a small one attached, past the limit a 7-day link (the thread keeps both)", async () => {
    // What the app's client does: ticket from inbox:generateUploadUrl, PUT the bytes, confirm.
    const upload = async (bytes: Uint8Array, contentType: string) => {
      const t = await call("mutation", "inbox:generateUploadUrl", { contentType, size: bytes.length }, "user:agent-1");
      expect(t.error ?? null).toBeNull();
      const ticket = t.value;
      const put = await SELF.fetch(new URL(ticket.url, BASE).toString(), { method: "PUT", headers: ticket.headers ?? {}, body: bytes });
      expect(put.status).toBeLessThan(300);
      const ok = await SELF.fetch(`${BASE}/api/storage/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: ticket.shard, storageId: ticket.storageId, token: ticket.token }) });
      expect(ok.status).toBe(200);
      return ticket.storageId as string;
    };
    expect((await call("mutation", "inbox:generateUploadUrl", { size: 10 }, "user:stranger")).error.message).toMatch(/not a member/);
    expect((await call("mutation", "inbox:generateUploadUrl", { size: 3 * 1024 ** 3 }, "user:agent-1")).error.message).toMatch(/too large/);

    const small = await upload(new TextEncoder().encode("hello attachment"), "text/plain");
    const big = await upload(new Uint8Array(10 * 1024 * 1024 + 1), "application/octet-stream");
    const c = await call(
      "mutation",
      "inbox:compose",
      { mailbox: "support", to: ["Lia <lia@user.test>"], subject: "Files", text: "See the files.", attachments: [{ file: big, filename: "big.bin", contentType: "application/octet-stream" }, { file: small, filename: "note.txt", contentType: "text/plain" }] },
      "user:agent-1",
    );
    expect(c.error ?? null).toBeNull();
    const t = (await call("query", "inbox:thread", { threadId: c.value.threadId }, "user:agent-1")).value;
    const msg = t.messages[0];
    expect(msg.attachments).toEqual([
      { filename: "big.bin", contentType: "application/octet-stream", file: big, size: 10 * 1024 * 1024 + 1, link: true },
      { filename: "note.txt", contentType: "text/plain", file: small, size: 16 },
    ]);
    expect(msg.text).toMatch(/^See the files\.\n\n—\nArquivos para baixar \(links válidos até \d{4}-\d{2}-\d{2}\):\nbig\.bin \(10\.0 MB\): \S+/);
    // The link downloads the file.
    const url = /big\.bin \(10\.0 MB\): (\S+)/.exec(msg.text)![1]!;
    const dl = await SELF.fetch(new URL(url, BASE).toString());
    expect(dl.status).toBe(200);
    expect((await dl.arrayBuffer()).byteLength).toBe(10 * 1024 * 1024 + 1);
    // The email goes out with the small file only.
    const sent = await until(() => call("query", "testing:email", { id: c.value.emailId }), (x) => x.value?.status === "sent");
    expect(sent.value).toMatchObject({ status: "sent", attachments: [{ filename: "note.txt", file: small }] });
    // Only one's own uploads: another member's upload, or an inbound attachment's file id, is refused.
    expect((await admin.inbox.addMember({ user_id: "agent-3", mailboxes: ["support"], name: "Agent Three" })).error).toBeNull();
    expect((await call("mutation", "inbox:reply", { threadId: c.value.threadId, text: "x", attachments: [{ file: small, filename: "note.txt", contentType: "text/plain" }] }, "user:agent-3")).error.message).toMatch(/not an upload of yours/);
    const inboundFile = (await call("query", "inbox:recent", {}, "user:agent-1")).value.messages.flatMap((m: any) => m.attachments).find((x: any) => !x.link && x.file !== small)?.file;
    if (inboundFile) expect((await call("mutation", "inbox:compose", { mailbox: "support", to: ["x@user.test"], subject: "s", text: "t", attachments: [{ file: inboundFile, filename: "a", contentType: "x/y" }] }, "user:agent-1")).error.message).toMatch(/not an upload of yours/);
    expect((await call("mutation", "inbox:generateUploadUrl", { size: -1 }, "user:agent-1")).error.message).toMatch(/positive integer/);
    expect((await call("mutation", "inbox:generateUploadUrl", { size: 0 }, "user:agent-1")).error.message).toMatch(/positive integer/);
    // A file still uploading is refused.
    const pending = (await call("mutation", "inbox:generateUploadUrl", { contentType: "text/plain", size: 4 }, "user:agent-1")).value;
    expect((await call("mutation", "inbox:reply", { threadId: c.value.threadId, text: "x", attachments: [{ file: pending.storageId, filename: "p.txt", contentType: "text/plain" }] }, "user:agent-1")).error.message).toMatch(/still uploading/);
  });

  it("operator script: remove deletes the Cloudflare side, then the service's record (From no longer accepted)", async () => {
    const imported = await SELF.fetch(`${BASE}/domains/import`, {
      method: "POST",
      headers: { authorization: "Bearer admin-secret", "content-type": "application/json" },
      body: JSON.stringify({ name: "Ops.TEST", zoneId: "z9", status: "verified", sending: true, receiving: false, records: [], ruleIds: ["r1"], subscriptionId: "sub9", notes: [] }),
    });
    expect(imported.status).toBe(201); // mixed case accepted and stored lowercase, as POST /domains does
    expect(((await imported.json()) as any).name).toBe("ops.test");
    const deleted: string[] = [];
    let failCf = true;
    const cf = { accountId: "acc", apiToken: "t", fetch: (async (u: string, init: RequestInit = {}) => {
      deleted.push(`${init.method} ${new URL(u).pathname.replace("/client/v4", "")}`);
      return failCf ? Response.json({ success: false, errors: [{ code: 10000, message: "auth" }] }, { status: 403 }) : Response.json({ success: true, errors: [], result: {} });
    }) as typeof fetch };
    const listed = async () => ((await admin.domains.list()).data!.data as any[]).some((d) => d.name === "ops.test");
    // A Cloudflare failure keeps the record (and its ids) for a retry.
    expect((await removeDomain(cf, BASE, "admin-secret", "OPS.test", { fetch: f })).length).toBeGreaterThan(0); // case-insensitive
    expect(await listed()).toBe(true);
    failCf = false;
    deleted.length = 0;
    expect(await removeDomain(cf, BASE, "admin-secret", "ops.test", { fetch: f })).toEqual([]);
    expect(deleted).toEqual(["DELETE /zones/z9/email/routing/rules/r1", "DELETE /accounts/acc/event_subscriptions/subscriptions/sub9"]);
    expect(await listed()).toBe(false);
    expect((await sender.emails.send({ from: "x@ops.test", to: "a@user.test", subject: "s", text: "t" })).error).toMatchObject({ statusCode: 403, name: "invalid_from_address" });
  });

  it("operator script: the account is CLOUDFLARE_ACCOUNT_ID or the token's only account (clear errors otherwise)", async () => {
    const accounts = (result: unknown, status = 200) => (async () => Response.json({ success: status === 200, errors: status === 200 ? [] : [{ message: "bad token" }], result }, { status })) as unknown as typeof fetch;
    await expect(resolveAccountId("t", { env: {}, fetch: accounts([]) })).rejects.toThrow(/sees no account: set CLOUDFLARE_ACCOUNT_ID/);
    await expect(resolveAccountId("t", { env: {}, fetch: accounts([{ id: "a" }, { id: "b" }]) })).rejects.toThrow(/2 accounts/);
    await expect(resolveAccountId("t", { env: {}, fetch: accounts(null, 403) })).rejects.toThrow(/403 bad token/);
    expect(await resolveAccountId("t", { env: {}, fetch: accounts([{ id: "a" }]) })).toBe("a");
    expect(await resolveAccountId("t", { env: { CLOUDFLARE_ACCOUNT_ID: "x" }, fetch: accounts([]) })).toBe("x");
  });

  it("personal mailboxes: only the owner sees, answers and is pushed their mail; no admin, member or key reads it", async () => {
    // Heitor is an admin (every shared mailbox), Wolf a member of support; each has their own address.
    expect((await admin.inbox.addMember({ user_id: "heitor", name: "Heitor", admin: true })).error).toBeNull();
    expect((await admin.inbox.addMember({ user_id: "wolf", name: "Wolf", mailboxes: ["support"] })).error).toBeNull();
    expect((await admin.inbox.upsertMailbox({ name: "heitor", address: "heitor@acme.test", display_name: "Heitor", owner: "heitor" })).error).toBeNull();
    expect((await admin.inbox.upsertMailbox({ name: "wolf", address: "wolf@acme.test", display_name: "Wolf", owner: "wolf" })).error).toBeNull();
    const box = (await admin.inbox.mailboxes()).data!.data;
    expect(box.find((b) => b.name === "wolf")).toEqual({ name: "wolf", address: "wolf@acme.test", display_name: "Wolf", owner: "wolf", catch_all: false, retention: null });
    expect(box.find((b) => b.name === "support")).toMatchObject({ owner: null, threads: expect.any(Number) });

    const m = inbound("ana@user.test", "wolf@acme.test", mime({ from: '"Ana" <ana@user.test>', to: "wolf@acme.test", subject: "Lunch?", text: "Lunch on Friday?", id: "in-wolf@user.test" }));
    await worker.email(m.msg as never, env as never, createExecutionContext());
    expect(m.out.rejected).toBeNull();

    const names = async (who: string) => (await call("query", "inbox:mailboxes", {}, `user:${who}`)).value.map((b: any) => `${b.name}${b.personal ? "*" : ""}`).sort();
    // Each sees their own mailbox (marked personal); the admin sees every shared one but not Wolf's.
    expect(await names("heitor")).toEqual(["heitor*", "privacy", "support"]);
    expect(await names("wolf")).toEqual(["support", "wolf*"]);
    // Your own mailbox first, so a client opening "the first one" before the list loads opens it.
    expect((await call("query", "inbox:me", {}, "user:heitor")).value.mailboxes).toEqual(["heitor", "support", "privacy"]);
    expect((await call("query", "inbox:me", {}, "user:wolf")).value.mailboxes).toEqual(["wolf", "support"]);
    expect((await call("query", "inbox:threads", { mailbox: "wolf" }, "user:heitor")).error.message).toMatch(/no access/);
    const t = (await call("query", "inbox:threads", { mailbox: "wolf" }, "user:wolf")).value.page[0];
    expect(t).toMatchObject({ subject: "Lunch?", contact: "ana@user.test" });
    expect((await call("query", "inbox:thread", { threadId: t._id }, "user:heitor")).error.message).toMatch(/no access/);
    expect((await call("query", "inbox:search", { query: "lunch" }, "user:heitor")).value).toEqual([]);
    // Each hit carries its thread's state (Ember 0.7.1), so the clients act on it without loading the thread.
    expect((await call("query", "inbox:search", { query: "lunch" }, "user:wolf")).value).toMatchObject([{ threadId: t._id, status: expect.any(String), unreadCount: expect.any(Number) }]);
    expect((await call("query", "inbox:recent", {}, "user:heitor")).value.threads.some((x: any) => x._id === t._id)).toBe(false);
    // No assignment in a personal mailbox; its member list is its owner.
    expect((await call("mutation", "inbox:assign", { threadId: t._id, userId: "wolf" }, "user:wolf")).error.message).toMatch(/personal mailbox/);
    expect((await call("query", "inbox:members", { mailbox: "wolf" }, "user:wolf")).value).toEqual([{ userId: "wolf", name: "Wolf" }]);
    // The owner answers it.
    expect((await call("mutation", "inbox:reply", { threadId: t._id, text: "Sure!" }, "user:wolf")).error ?? null).toBeNull();
    expect((await call("mutation", "inbox:reply", { threadId: t._id, text: "Me too" }, "user:heitor")).error.message).toMatch(/no access/);

    // No API key reads, answers or searches it (the inbox permission is for shared mailboxes).
    const key = (await admin.apiKeys.create({ name: "reader", permission: "inbox", project: "acme" })).data!.token;
    const get = (path: string, init?: RequestInit) => SELF.fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" } });
    expect((await get("/inbox/threads?mailbox=wolf")).status).toBe(403);
    expect(await (await get(`/inbox/threads/${t._id}`)).json()).toMatchObject({ name: "personal_mailbox" });
    expect((await get(`/inbox/threads/${t._id}/reply`, { method: "POST", body: JSON.stringify({ text: "x" }) })).status).toBe(403);
    expect((await get("/inbox/search?q=lunch&mailbox=wolf")).status).toBe(403);
    expect(((await (await get("/inbox/search?q=lunch")).json()) as any).data).toEqual([]);

    // Shared again (owner: null): back to admins and its members (none), and the admin sees it.
    expect((await admin.inbox.upsertMailbox({ name: "wolf", address: "wolf@acme.test", owner: null })).error).toBeNull();
    expect(await names("heitor")).toEqual(["heitor*", "privacy", "support", "wolf"]);
    expect(await names("wolf")).toEqual(["support"]);
    expect((await admin.inbox.upsertMailbox({ name: "wolf", address: "wolf@acme.test", owner: "wolf" })).error).toBeNull();
    // An owner who was not a member yet becomes one (with no shared mailboxes).
    expect((await admin.inbox.upsertMailbox({ name: "caio", address: "caio@acme.test", owner: "caio" })).error).toBeNull();
    expect(await names("caio")).toEqual(["caio*"]);
  });

  it("reply all copies the others; forward sends a message on, with its files, as a new conversation", async () => {
    const t = (await call("query", "inbox:threads", { mailbox: "support" }, "user:agent-1")).value.page.find((x: any) => x.number === 1);
    const full = (await call("query", "inbox:thread", { threadId: t._id }, "user:agent-1")).value;
    const inbound = full.messages.find((m: any) => m.direction === "inbound");

    const all = await call("mutation", "inbox:reply", { threadId: t._id, text: "Copying finance.", cc: ["Fin <fin@user.test>"] }, "user:agent-1");
    expect(all.error ?? null).toBeNull();
    expect((await call("query", "testing:email", { id: all.value.emailId })).value).toMatchObject({ cc: [{ email: "fin@user.test", name: "Fin" }] });
    // The thread shows where that email is (its marker) and, when it bounces, why; nothing on inbound messages.
    const marker = async () => (await call("query", "inbox:thread", { threadId: t._id }, "user:agent-1")).value.messages.find((m: any) => m.emailId === all.value.emailId)?.delivery;
    expect(await until(marker, (d) => d?.status === "sent")).toEqual({ status: "sent", reason: null });
    const mid = (await call("query", "testing:email", { id: all.value.emailId })).value.messageId;
    await env.EMBER_Q_EMAIL_EVENTS.send(event("bounced", mid, "ev-fin", { recipient: "fin@user.test", bounce: { type: "hard", reason: "550 mailbox unavailable" } }));
    expect(await until(marker, (d) => d?.status === "bounced")).toEqual({ status: "bounced", reason: "550 mailbox unavailable" });
    // A later delay with its own reason (out of order) neither moves the status back nor replaces the bounce's reason.
    await env.EMBER_Q_EMAIL_EVENTS.send(event("deferred", mid, "ev-fin-late", { recipient: "fin@user.test", delivery: { smtpResponse: "421 try later" } }));
    await until(async () => (await call("query", "testing:email", { id: all.value.emailId })).value, () => false, 600);
    expect(await marker()).toEqual({ status: "bounced", reason: "550 mailbox unavailable" });
    const after = (await call("query", "inbox:thread", { threadId: t._id }, "user:agent-1")).value;
    expect(after.messages.find((m: any) => m.direction === "inbound").delivery).toBeUndefined();
    const many = Array.from({ length: 51 }, (_, i) => `p${i}@user.test`);
    expect((await call("mutation", "inbox:reply", { threadId: t._id, text: "x", cc: many }, "user:agent-1")).error.message).toMatch(/at most 50/);

    const fwd = await call(
      "mutation",
      "inbox:forward",
      { threadId: t._id, messageId: inbound._id, to: ["Boss <boss@user.test>"], subject: "Fwd: Invoice wrong", text: "See below.\n\n> My invoice total is wrong." },
      "user:agent-1",
    );
    expect(fwd.error ?? null).toBeNull();
    const out = (await call("query", "inbox:thread", { threadId: fwd.value.threadId }, "user:agent-1")).value;
    expect(out.thread).toMatchObject({ mailbox: "support", subject: "Fwd: Invoice wrong", contact: "boss@user.test" });
    // The original's file goes along, the same stored file (no copy, no upload by the member).
    expect(out.messages[0].attachments).toMatchObject([{ filename: "invoice.pdf", file: inbound.attachments[0].file }]);
    expect((await call("query", "testing:email", { id: fwd.value.emailId })).value.attachments).toMatchObject([{ filename: "invoice.pdf" }]);
    // Only a message of that thread, never a note, and only by someone who can see it.
    expect((await call("mutation", "inbox:forward", { threadId: t._id, messageId: out.messages[0]._id, to: ["x@user.test"], subject: "s", text: "t" }, "user:agent-1")).error.message).toMatch(/not found in this thread/);
    expect((await call("mutation", "inbox:forward", { threadId: t._id, messageId: inbound._id, to: ["x@user.test"], subject: "s", text: "t" }, "user:agent-2")).error.message).toMatch(/no access/);
  });

  it("sent: the conversations a mailbox wrote in, newest send first; members only, never a personal one by key", async () => {
    const sent = await call("query", "inbox:sent", { mailbox: "support" }, "user:agent-1");
    expect(sent.error ?? null).toBeNull();
    const subjects = sent.value.page.map((t: any) => t.subject);
    // The forward (a new conversation) went out after the reply to #1, so it comes first; each thread once.
    const fwd = subjects.indexOf("Fwd: Invoice wrong");
    const replied = subjects.findIndex((s: string) => /invoice/i.test(s) && !s.startsWith("Fwd"));
    expect(fwd).toBeGreaterThanOrEqual(0);
    expect(replied).toBeGreaterThan(fwd);
    expect(new Set(sent.value.page.map((t: any) => t._id)).size).toBe(sent.value.page.length);
    expect(sent.value.page[0]).toMatchObject({ mailbox: "support", lastSentAt: expect.any(Number) });
    expect((await call("query", "inbox:sent", { mailbox: "support", limit: 1 }, "user:agent-1")).value).toMatchObject({ page: [{ _id: sent.value.page[0]._id }], isDone: false });
    // At the cap (300) the list says it is done: no "load more" that never ends.
    expect((await call("query", "inbox:sent", { mailbox: "support", limit: 10_000 }, "user:agent-1")).value.isDone).toBe(true);
    expect((await call("query", "inbox:sent", { mailbox: "support" }, "user:agent-2")).error.message).toMatch(/no access/);
    // Wolf's own mailbox: his answer is in his Sent; nobody else reads it, by session or by key.
    expect((await call("query", "inbox:sent", { mailbox: "wolf" }, "user:wolf")).value.page).toMatchObject([{ subject: "Lunch?" }]);
    expect((await call("query", "inbox:sent", { mailbox: "wolf" }, "user:heitor")).error.message).toMatch(/no access/);
    const key = (await admin.apiKeys.create({ name: "sent-reader", permission: "inbox", project: "acme" })).data!.token;
    const get = (path: string) => SELF.fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${key}` } });
    expect((await get("/inbox/sent?mailbox=wolf")).status).toBe(403);
    const first = (await (await get("/inbox/sent?mailbox=support&limit=1")).json()) as any;
    expect(first).toMatchObject({ page: [{ _id: sent.value.page[0]._id }], next: expect.any(String) });
    const more = (await (await get(`/inbox/sent?mailbox=support&limit=1&before=${encodeURIComponent(first.next)}`)).json()) as any;
    expect(more.page[0]._id).toBe(sent.value.page[1]._id);
    expect((await admin.inbox.sent({ mailbox: "support" })).data!.page.length).toBe(sent.value.page.length);
  });

  it("access requests: a signed-in non-member is listed with their email; granting or owning a mailbox answers it", async () => {
    const lia = "user:lia-1|lia@acme.test|Lia";
    expect((await call("query", "inbox:me", {}, lia)).value).toMatchObject({ member: false, userId: "lia-1" });
    expect((await call("mutation", "inbox:requestAccess", {}, lia)).error ?? null).toBeNull();
    expect((await call("mutation", "inbox:requestAccess", {}, "user:rui-1|rui@acme.test|Rui")).error ?? null).toBeNull();
    expect((await call("mutation", "inbox:requestAccess", {})).error.message).toMatch(/unauthenticated/);
    const first = (await admin.inbox.members()).data!.requests.find((r) => r.user_id === "lia-1")!.requested_at;
    await new Promise((r) => setTimeout(r, 5));
    expect((await call("mutation", "inbox:requestAccess", {}, "user:lia-1|lia@acme.test|Lia Souza")).error ?? null).toBeNull();
    // A sign-in without claims never clears what was stored.
    expect((await call("mutation", "inbox:requestAccess", {}, "user:lia-1")).error ?? null).toBeNull();
    let list = (await admin.inbox.members()).data!;
    // Asking again keeps when they first asked; a new name is taken.
    expect(list.requests.find((r) => r.user_id === "lia-1")).toMatchObject({ requested_at: first, name: "Lia Souza" });
    expect(list.requests.map((r) => r.user_id).sort()).toEqual(["lia-1", "rui-1"]);
    expect(list.requests.find((r) => r.user_id === "lia-1")).toMatchObject({ email: "lia@acme.test", requested_at: expect.any(String) });
    expect(list.data.find((m) => m.user_id === "wolf")).toMatchObject({ personal_mailbox: "wolf", mailboxes: ["support"] });
    // A member asking does nothing; only a full-access key or the admin token lists anyone.
    expect((await call("mutation", "inbox:requestAccess", {}, "user:agent-1|a@acme.test")).error ?? null).toBeNull();
    expect((await admin.inbox.members()).data!.requests.some((r) => r.user_id === "agent-1")).toBe(false);
    const key = (await admin.apiKeys.create({ name: "inbox-only", permission: "inbox", project: "acme" })).data!.token;
    expect((await SELF.fetch(`${BASE}/inbox/members`, { headers: { authorization: `Bearer ${key}` } })).status).toBe(403);
    // Granted (POST /inbox/members) or given their own mailbox (owner): no longer waiting; the owner keeps their name.
    expect((await admin.inbox.addMember({ user_id: "rui-1", mailboxes: ["support"] })).error).toBeNull();
    expect((await admin.inbox.upsertMailbox({ name: "lia", address: "lia@acme.test", owner: "lia-1" })).error).toBeNull();
    list = (await admin.inbox.members()).data!;
    expect(list.requests.filter((r) => ["lia-1", "rui-1"].includes(r.user_id))).toEqual([]);
    expect(list.data.find((m) => m.user_id === "lia-1")).toMatchObject({ name: "Lia Souza", personal_mailbox: "lia", mailboxes: [] });
    // Granted without a name: the one they signed in with.
    expect(list.data.find((m) => m.user_id === "rui-1")).toMatchObject({ name: "Rui", mailboxes: ["support"] });
    expect((await call("query", "inbox:me", {}, lia)).value).toMatchObject({ member: true, mailboxes: ["lia"] });
  });

  it("catch-all: a shared mailbox takes every address of its domain no mailbox has; one per domain", async () => {
    expect((await admin.inbox.upsertMailbox({ name: "geral", address: "geral@acme.test", display_name: "Acme", catch_all: true })).error).toBeNull();
    const box = (await admin.inbox.mailboxes()).data!.data.find((b) => b.name === "geral");
    expect(box).toMatchObject({ catch_all: true, owner: null });
    const m = inbound("bia@user.test", "contato@acme.test", mime({ from: '"Bia" <bia@user.test>', to: "contato@acme.test", subject: "Orçamento", text: "Vocês fazem sites?", id: "in-contato@user.test" }));
    await worker.email(m.msg as never, env as never, createExecutionContext());
    expect(m.out.rejected).toBeNull();
    // Heitor is an admin: he sees every shared mailbox.
    const t = (await call("query", "inbox:threads", { mailbox: "geral" }, "user:heitor")).value.page;
    expect(t[0]).toMatchObject({ subject: "Orçamento", contact: "bia@user.test" });
    // The address it was sent to stays on the message.
    const full = (await call("query", "inbox:thread", { threadId: t[0]._id }, "user:heitor")).value;
    expect(full.messages[0].to).toMatchObject([{ email: "contato@acme.test" }]);
    // An address a mailbox has still goes to it; another domain is still refused; a second catch-all is refused.
    const other = inbound("bia@user.test", "nobody@else.test", mime({ from: "bia@user.test", to: "nobody@else.test", subject: "x", text: "x", id: "in-else@user.test" }));
    await worker.email(other.msg as never, env as never, createExecutionContext());
    expect(other.out.rejected).toMatch(/not found/i);
    expect((await admin.inbox.upsertMailbox({ name: "support", address: "support@acme.test", catch_all: true })).error?.message).toMatch(/already has a catch-all/);

    // Retention: set, kept by an upsert without it, validated, cleared with null.
    expect((await admin.inbox.upsertMailbox({ name: "geral", address: "geral@acme.test", retention: { closed_days: 730, spam_days: 30 } })).error).toBeNull();
    expect((await admin.inbox.upsertMailbox({ name: "geral", address: "geral@acme.test", display_name: "Acme" })).error).toBeNull();
    const kept = (await admin.inbox.mailboxes()).data!.data.find((b) => b.name === "geral");
    expect(kept).toMatchObject({ retention: { closed_days: 730, spam_days: 30 }, catch_all: true });
    expect((await admin.inbox.upsertMailbox({ name: "geral", address: "geral@acme.test", retention: { closed_days: 0 } })).error?.message).toMatch(/whole number of days/);
    expect((await admin.inbox.upsertMailbox({ name: "geral", address: "geral@acme.test", retention: { closedDays: 5 } as never })).error?.message).toMatch(/unknown field closedDays/);
    expect((await admin.inbox.upsertMailbox({ name: "geral", address: "geral@acme.test", retention: null })).error).toBeNull();
    expect((await admin.inbox.mailboxes()).data!.data.find((b) => b.name === "geral")!.retention).toBeNull();

    // Onboarding (operator script): the zone's catch-all rule → this Worker; the domain record keeps it; remove turns it off.
    const cfState = { catchAll: { enabled: false, matchers: [{ type: "all" }], actions: [{ type: "drop" }] } as any, puts: [] as any[] };
    const ok = (result: unknown) => Response.json({ success: true, errors: [], result });
    const cf = {
      accountId: "acc",
      apiToken: "t",
      fetch: (async (u: string, init: RequestInit = {}) => {
        const url = new URL(u);
        const m = `${init.method ?? "GET"} ${url.pathname.replace("/client/v4", "")}`;
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        if (m === "GET /zones") return ok(url.searchParams.get("name") === "acme.test" ? [{ id: "za", name: "acme.test" }] : []);
        if (m === "GET /zones/za/email/sending/subdomains") return ok([{ tag: "sa", name: "acme.test", enabled: true }]);
        if (m === "GET /zones/za/email/sending/subdomains/sa/dns") return ok([]);
        if (m === "GET /zones/za/email/routing") return ok({ enabled: true, status: "ready", subdomains: [] });
        if (m === "GET /zones/za/email/routing/dns") return ok({ records: [] });
        if (m === "GET /zones/za/email/routing/rules") return ok([]);
        if (m === "POST /zones/za/email/routing/rules") return ok({ id: `r-${body.matchers[0].value}`, ...body });
        if (m === "GET /zones/za/email/routing/rules/catch_all") return ok(cfState.catchAll);
        if (m === "PUT /zones/za/email/routing/rules/catch_all") return (cfState.puts.push(body), (cfState.catchAll = body), ok(body));
        if (m === "GET /accounts/acc/queues") return ok([{ queue_id: "q", queue_name: "ember-mail-prod-email-events" }]);
        if (m === "GET /accounts/acc/event_subscriptions/subscriptions") return ok([{ id: "sa-sub", source: { type: "email.sending", zone_id: "za", domain: "acme.test" }, destination: { queue_id: "q" } }]);
        if (m.startsWith("DELETE ")) return ok({});
        return Response.json({ success: false, errors: [{ code: 7003, message: `unexpected ${m}` }] }, { status: 400 });
      }) as typeof fetch,
    };
    await addDomain(cf, BASE, "admin-secret", "acme.test", { project: "mail", env: "prod", fetch: f });
    expect(cfState.catchAll).toEqual({ enabled: true, matchers: [{ type: "all" }], actions: [{ type: "worker", value: ["ember-mail-prod"] }] });
    const view = ((await admin.domains.list()).data!.data as any[]).find((d) => d.name === "acme.test");
    expect(view.cloudflare.catch_all).toBe("ember-mail-prod");
    expect(await removeDomain(cf, BASE, "admin-secret", "acme.test", { fetch: f })).toEqual([]);
    expect(cfState.catchAll).toMatchObject({ enabled: false, actions: [{ type: "drop" }] });
    // The record comes back (later tests send from acme.test).
    await addDomain(cf, BASE, "admin-secret", "acme.test", { project: "mail", env: "prod", fetch: f });
    expect(((await admin.domains.list()).data!.data as any[]).some((d) => d.name === "acme.test")).toBe(true);
    expect((await admin.inbox.upsertMailbox({ name: "geral", address: "geral@acme.test", catch_all: false })).error).toBeNull();
    const after = inbound("bia@user.test", "contato@acme.test", mime({ from: "bia@user.test", to: "contato@acme.test", subject: "y", text: "y", id: "in-contato2@user.test" }));
    await worker.email(after.msg as never, env as never, createExecutionContext());
    expect(after.out.rejected).toMatch(/not found/i);
  });

  it("members: POST /inbox/members is a patch (absent fields keep their stored value)", async () => {
    const member = async () => (await call("mutation", "testing:member", { userId: "boss-1" })).value;
    const names = async () => (await call("query", "inbox:mailboxes", {}, "user:boss-1")).value.map((b: any) => b.name).sort();
    expect((await admin.inbox.addMember({ user_id: "boss-1", mailboxes: ["support"], name: "Boss", admin: true })).error).toBeNull();
    expect(await names()).toEqual(["geral", "privacy", "support"]); // admin: every shared mailbox
    // Changing only the mailboxes keeps admin and the name.
    expect((await admin.inbox.addMember({ user_id: "boss-1", mailboxes: ["privacy"] })).error).toBeNull();
    expect(await member()).toMatchObject({ name: "Boss", admin: true, mailboxes: ["privacy"] });
    expect(await names()).toEqual(["geral", "privacy", "support"]);
    // admin: false revokes; mailboxes absent are kept; name: null clears.
    expect((await admin.inbox.addMember({ user_id: "boss-1", admin: false, name: null })).error).toBeNull();
    expect(await member()).toMatchObject({ admin: false, mailboxes: ["privacy"] });
    expect((await member()).name).toBeUndefined();
    expect(await names()).toEqual(["privacy"]);
  });

  it("admin screen (console:*): admins only; keys, mailboxes, members, emails and suppressions; personal mailboxes stay private", async () => {
    const as = (kind: "query" | "mutation" | "action", fn: string, args: unknown = {}) => call(kind, `console:${fn}`, args, "user:root-1");
    expect((await call("query", "console:overview", {}, "user:wolf")).error.message).toMatch(/admins only/);
    expect((await call("action", "console:server", {}, "user:wolf")).error.message).toMatch(/admins only/);
    expect((await admin.inbox.addMember({ user_id: "root-1", name: "Root", admin: true })).error).toBeNull();

    const server = (await as("action", "server")).value;
    expect(server).toMatchObject({ project: "mail", env: "test", manageDomains: true });
    expect((await as("query", "overview")).value).toMatchObject({ domains: expect.any(Number), mailboxes: expect.any(Number), personalMailboxes: expect.any(Number) });
    expect((await as("query", "domains")).value.map((d: any) => d.name)).toContain("acme.test");

    // Keys: the token comes back once; the list shows the prefix; inbox projects and bad scopes are refused.
    const k = (await as("action", "createKey", { name: "crm", permission: "sending_access", project: "crm", domain: "acme.test" })).value;
    expect(k.token).toMatch(/^em_[0-9a-f]{8}_/);
    const listed = (await as("query", "keys")).value.find((x: any) => x.id === k.id);
    expect(listed).toMatchObject({ name: "crm", prefix: k.prefix, permission: "sending_access", project: "crm", domain: "acme.test" });
    expect(JSON.stringify(listed)).not.toContain(k.token);
    expect((await as("action", "createKey", { name: "x", permission: "inbox", project: "mailbox:support" })).error.message).toMatch(/belong to the inbox/);
    expect((await as("action", "createKey", { name: "x", permission: "full_access", project: "crm", domain: "acme.test" })).error.message).toMatch(/only sending_access/);
    expect((await as("mutation", "revokeKey", { id: k.id })).value).toBe(true);
    expect((await as("query", "keys")).value.some((x: any) => x.id === k.id)).toBe(false);

    // Mailboxes: personal ones show their owner, never their counts.
    const boxes = (await as("query", "mailboxes")).value;
    expect(boxes.find((b: any) => b.name === "wolf")).toMatchObject({ owner: "wolf", ownerName: "Wolf", counts: null, granted: [] });
    expect(boxes.find((b: any) => b.name === "support")).toMatchObject({ owner: null, counts: { threads: expect.any(Number) } });
    expect((await as("mutation", "saveMailbox", { name: "sales", address: "sales@acme.test", displayName: "Sales", retention: { closedDays: 90 } })).ok).toBe(true);
    expect((await as("query", "mailboxes")).value.find((b: any) => b.name === "sales")).toMatchObject({ displayName: "Sales", retention: { closedDays: 90 } });
    expect((await as("mutation", "saveMailbox", { name: "sales", address: "sales@acme.test", retention: null, displayName: null })).ok).toBe(true);
    expect((await as("query", "mailboxes")).value.find((b: any) => b.name === "sales")).toMatchObject({ displayName: null, retention: null });

    // Members: grant shared mailboxes only; no self-demotion or self-removal; an owner of a personal mailbox stays.
    expect((await as("mutation", "saveMember", { userId: "new-1", mailboxes: ["sales"] })).ok).toBe(true);
    expect((await as("query", "members")).value.members.find((m: any) => m.userId === "new-1")).toMatchObject({ mailboxes: ["sales"], admin: false });
    expect((await as("mutation", "saveMember", { userId: "new-1", mailboxes: ["wolf"] })).error.message).toMatch(/personal mailbox/);
    expect((await as("mutation", "saveMember", { userId: "root-1", admin: false })).error.message).toMatch(/your own admin/);
    expect((await as("mutation", "removeMember", { userId: "root-1" })).error.message).toMatch(/yourself/);
    expect((await as("mutation", "removeMember", { userId: "wolf" })).error.message).toMatch(/personal mailbox wolf/);
    expect((await as("mutation", "removeMember", { userId: "new-1" })).value).toBe(true);

    // Emails and suppressions by project; a personal mailbox's project is refused.
    const projects = (await as("query", "projects")).value as string[];
    expect(projects).toEqual(expect.arrayContaining(["default", "acme", "mailbox:support"]));
    expect(projects).not.toContain("mailbox:wolf");
    const page = (await as("query", "emails", { project: "acme", paginationOpts: { numItems: 5, cursor: null } })).value;
    expect(page.page.length).toBeGreaterThan(0);
    expect(page.page[0]).toMatchObject({ id: expect.any(String), status: expect.any(String), to: expect.any(Array) });
    expect((await as("query", "emailEvents", { id: page.page[0].id })).ok).toBe(true);
    expect((await as("query", "emails", { project: "mailbox:wolf", paginationOpts: { numItems: 5, cursor: null } })).error.message).toMatch(/owner's business/);
    expect((await as("mutation", "suppress", { project: "acme", email: "Block@User.test" })).ok).toBe(true);
    const sup = (await as("query", "suppressions", { project: "acme", paginationOpts: { numItems: 50, cursor: null } })).value.page;
    expect(sup.map((x: any) => x.email)).toContain("block@user.test");
    expect((await as("mutation", "unsuppress", { project: "acme", email: "block@user.test" })).value).toBe(true);
  });

  it("webhooks: signed email.received and email.delivered, retries, test, rotate, filters; personal mailboxes never", async () => {
    // Tests and the Worker share an isolate: requests to hooks.test land here.
    const got: Array<{ url: string; headers: Headers; body: string }> = [];
    let answer = 200;
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://hooks.test/")) return real(input, init);
      got.push({ url, headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response(answer === 200 ? "ok" : "nope", { status: answer });
    }) as typeof fetch;
    try {
      for (const [endpoint, msg] of [["http://hooks.test/x", /https/], ["https://10.0.0.1/x", /IP address/], ["https://localhost/x", /public host/]] as const) {
        expect((await admin.webhooks.create({ endpoint, events: ["email.received"] })).error).toMatchObject({ statusCode: 422, message: expect.stringMatching(msg) });
      }
      expect((await admin.webhooks.create({ endpoint: "https://hooks.test/a", events: ["email.opened" as any] })).error).toMatchObject({ statusCode: 422 });
      expect((await admin.webhooks.create({ endpoint: "https://hooks.test/a", events: ["email.received"], mailboxes: ["wolf"] })).error).toMatchObject({ statusCode: 422, message: expect.stringMatching(/personal/) });
      expect((await admin.webhooks.create({ endpoint: "https://hooks.test/a", events: ["email.received"], project: 7 as any })).error).toMatchObject({ statusCode: 422, message: expect.stringMatching(/project must be a string/) });
      expect((await admin.webhooks.create({ endpoint: "https://hooks.test/a", events: ["email.received"], mailboxes: ["nope"] })).error).toMatchObject({ statusCode: 422, message: expect.stringMatching(/mailbox nope not found/) });

      const all = await admin.webhooks.create({ endpoint: "https://hooks.test/all", events: ["email.received", "email.delivered"], description: "everything" });
      expect(all.data!.signing_secret).toMatch(/^whsec_/);
      const acme = await admin.webhooks.create({ endpoint: "https://hooks.test/acme", events: ["email.delivered"], project: "acme" });
      const sales = await admin.webhooks.create({ endpoint: "https://hooks.test/privacy", events: ["email.received"], mailboxes: ["privacy"] });
      expect((await admin.webhooks.list()).data!.data.map((w) => w.endpoint)).toEqual(["https://hooks.test/all", "https://hooks.test/acme", "https://hooks.test/privacy"]);
      const read = (await admin.webhooks.get(all.data!.id)).data!;
      expect(read).toMatchObject({ events: ["email.received", "email.delivered"], description: "everything" });
      expect(read).not.toHaveProperty("signing_secret"); // only create and rotate return it
      expect((await call("query", "console:webhookSecret", { id: all.data!.id }, "user:root-1")).value).toBe(all.data!.signing_secret);
      expect((await sender.webhooks.list()).error).toMatchObject({ statusCode: 403 });

      // email.received: support → only the unfiltered webhook; signed per Standard Webhooks.
      const m = inbound("rui@user.test", "support@acme.test", mime({ from: '"Rui" <rui@user.test>', to: "support@acme.test", subject: "Hook me", text: "hello hooks", id: "hook-1@user.test" }));
      await worker.email(m.msg as never, env as never, createExecutionContext());
      const first = await until(async () => got.filter((g) => g.body.includes("Hook me")), (x) => x.length > 0);
      expect(first.map((g) => g.url)).toEqual(["https://hooks.test/all"]);
      const ev = await verifyWebhook<any>({ secret: all.data!.signing_secret, headers: first[0]!.headers, body: first[0]!.body });
      expect(ev).toMatchObject({ type: "email.received", data: { mailbox: "support", subject: "Hook me", from: { email: "rui@user.test", name: "Rui" }, new_thread: true } });
      expect(first[0]!.headers.get("user-agent")).toMatch(/EmberMail-Webhooks/);

      // A personal mailbox's mail never goes out.
      const p = inbound("rui@user.test", "wolf@acme.test", mime({ from: "rui@user.test", to: "wolf@acme.test", subject: "Private hook", text: "x", id: "hook-2@user.test" }));
      await worker.email(p.msg as never, env as never, createExecutionContext());

      // email.delivered of an acme email: the unfiltered and the acme webhooks, with the email's details.
      const r = await sender.emails.send({ from: "hello@acme.test", to: "eva@user.test", subject: "Delivered hook", text: "x", tags: [{ name: "kind", value: "hook" }] });
      const sent = await until(() => sender.emails.get(r.data!.id), (x) => x.data?.last_event === "sent");
      await env.EMBER_Q_EMAIL_EVENTS.send(event("delivered", sent.data!.message_id!, "ev-hook-1", { recipient: "eva@user.test" }));
      const delivered = await until(async () => got.filter((g) => g.body.includes("email.delivered")), (x) => x.length >= 2);
      expect(delivered.map((g) => g.url).sort()).toEqual(["https://hooks.test/acme", "https://hooks.test/all"]);
      expect(JSON.parse(delivered[0]!.body)).toMatchObject({ type: "email.delivered", data: { email_id: r.data!.id, project: "acme", recipient: "eva@user.test", subject: "Delivered hook", to: ["eva@user.test"], tags: { kind: "hook" } } });
      expect(got.some((g) => g.body.includes("Private hook"))).toBe(false);

      const okList = (await admin.webhooks.deliveries(all.data!.id)).data!.data;
      expect(okList.map((d) => [d.type, d.status, d.attempts, d.last_status])).toEqual([
        ["email.delivered", "succeeded", 1, 200],
        ["email.received", "succeeded", 1, 200],
      ]);

      // A failing endpoint: the attempt is recorded and the next one scheduled; retry sends the same id and body.
      answer = 500;
      expect((await admin.webhooks.test(sales.data!.id)).error).toBeNull();
      const failing = await until(async () => (await admin.webhooks.deliveries(sales.data!.id)).data!.data[0]!, (d) => d.attempts === 1);
      expect(failing).toMatchObject({ type: "webhook.test", status: "pending", last_status: 500, last_error: "HTTP 500 nope" });
      expect(failing.next_attempt_at).toBeTruthy();
      expect((await admin.webhooks.list()).data!.data.find((w) => w.id === sales.data!.id)!.failures).toBe(1);
      answer = 200;
      const before = got.length;
      expect((await admin.webhooks.retry(failing.id)).data).toEqual({ ok: true });
      await until(async () => (await admin.webhooks.deliveries(sales.data!.id)).data!.data[0]!, (d) => d.status === "succeeded");
      const resent = got.slice(before).find((g) => g.url === "https://hooks.test/privacy")!;
      expect(resent.headers.get("webhook-id")).toBe(failing.id);
      expect((await admin.webhooks.list()).data!.data.find((w) => w.id === sales.data!.id)!.failures).toBe(0);

      // Pausing holds a pending delivery (no failure counted, no attempt); turning back on sends it.
      answer = 500;
      await admin.webhooks.test(sales.data!.id);
      const held = await until(async () => (await admin.webhooks.deliveries(sales.data!.id)).data!.data[0]!, (d) => d.type === "webhook.test" && d.attempts === 1 && d.status === "pending");
      const failuresBefore = (await admin.webhooks.list()).data!.data.find((w) => w.id === sales.data!.id)!.failures;
      expect((await admin.webhooks.update(sales.data!.id, { enabled: false })).data).toMatchObject({ enabled: false });
      const paused = (await admin.webhooks.deliveries(sales.data!.id)).data!.data.find((d) => d.id === held.id)!;
      expect(paused).toMatchObject({ status: "pending", next_attempt_at: null });
      expect((await admin.webhooks.list()).data!.data.find((w) => w.id === sales.data!.id)!.failures).toBe(failuresBefore);
      answer = 200;
      expect((await admin.webhooks.update(sales.data!.id, { enabled: true })).data).toMatchObject({ enabled: true });
      await until(async () => (await admin.webhooks.deliveries(sales.data!.id)).data!.data.find((d) => d.id === held.id)!, (d) => d.status === "succeeded");

      // Rotate: the old secret no longer verifies; disabled webhooks get nothing; delete removes it and its deliveries.
      const rotated = await admin.webhooks.rotateSecret(sales.data!.id);
      expect(rotated.data!.signing_secret).not.toBe(sales.data!.signing_secret);
      const seen = got.filter((g) => g.url === "https://hooks.test/privacy").length;
      await admin.webhooks.test(sales.data!.id);
      const t2 = await until(async () => got.filter((g) => g.url === "https://hooks.test/privacy"), (x) => x.length > seen);
      const last = t2[t2.length - 1]!;
      await expect(verifyWebhook({ secret: sales.data!.signing_secret, headers: last.headers, body: last.body })).rejects.toThrow();
      await expect(verifyWebhook({ secret: rotated.data!.signing_secret, headers: last.headers, body: last.body })).resolves.toMatchObject({ type: "webhook.test" });
      expect((await admin.webhooks.update(all.data!.id, { enabled: false })).data).toMatchObject({ enabled: false });
      // A paused webhook's test is refused (it would never be sent).
      expect((await admin.webhooks.test(all.data!.id)).error).toMatchObject({ statusCode: 422, message: expect.stringMatching(/paused/) });
      const n = got.length;
      const m2 = inbound("rui@user.test", "support@acme.test", mime({ from: "rui@user.test", to: "support@acme.test", subject: "Quiet hook", text: "x", id: "hook-3@user.test" }));
      await worker.email(m2.msg as never, env as never, createExecutionContext());
      await new Promise((r) => setTimeout(r, 300));
      expect(got.slice(n).filter((g) => g.url === "https://hooks.test/all")).toEqual([]);
      for (const w of [all, acme, sales]) expect((await admin.webhooks.remove(w.data!.id)).data).toMatchObject({ deleted: true });
      expect((await admin.webhooks.list()).data!.data).toEqual([]);
      expect((await admin.webhooks.deliveries(all.data!.id)).error).toMatchObject({ statusCode: 404 });
    } finally {
      globalThis.fetch = real;
    }
  });

  it("delete a conversation: admins in shared mailboxes, owners in their own; members and keys on personal ones cannot", async () => {
    const send = async (to: string, subject: string, id: string) => {
      const m = inbound("lia@user.test", to, mime({ from: "lia@user.test", to, subject, text: "delete me", id }));
      await worker.email(m.msg as never, env as never, createExecutionContext());
    };
    await send("support@acme.test", "Delete shared", "del-1@user.test");
    await send("wolf@acme.test", "Delete personal", "del-2@user.test");
    await send("support@acme.test", "Delete by key", "del-3@user.test");
    const find = async (who: string, mailbox: string, subject: string) =>
      ((await call("query", "inbox:threads", { mailbox }, `user:${who}`)).value.page as any[]).find((t) => t.subject === subject);
    const shared = await find("root-1", "support", "Delete shared");
    const own = await find("wolf", "wolf", "Delete personal");
    // Wolf is a member of support, not an admin: no deleting there.
    expect((await call("mutation", "inbox:deleteThread", { threadId: shared._id }, "user:wolf")).error.message).toMatch(/only an admin/);
    // An admin cannot even see Wolf's personal mailbox.
    expect((await call("mutation", "inbox:deleteThread", { threadId: own._id }, "user:root-1")).error.message).toMatch(/no access/);
    expect((await call("mutation", "inbox:deleteThread", { threadId: shared._id }, "user:root-1")).value).toMatchObject({ deleted: true, mailbox: "support" });
    expect(await find("root-1", "support", "Delete shared")).toBeUndefined();
    expect((await call("mutation", "inbox:deleteThread", { threadId: own._id }, "user:wolf")).value).toMatchObject({ deleted: true });
    // HTTP, full_access: a shared conversation yes, a personal one never.
    const byKey = (await admin.inbox.threads({ mailbox: "support" })).data!.page.find((t) => t.subject === "Delete by key")!;
    const del = await SELF.fetch(`${BASE}/inbox/threads/${byKey._id}`, { method: "DELETE", headers: { authorization: "Bearer admin-secret" } });
    expect(await del.json()).toMatchObject({ object: "thread", deleted: true });
    await send("wolf@acme.test", "Personal again", "del-4@user.test");
    const again = await find("wolf", "wolf", "Personal again");
    const refused = await SELF.fetch(`${BASE}/inbox/threads/${again._id}`, { method: "DELETE", headers: { authorization: "Bearer admin-secret" } });
    expect(refused.status).toBe(403);
  });
  it("views: all, assigned to me, unread and waiting across the member's mailboxes, with counts; personal ones only to their owner", async () => {
    // Two shared mailboxes and two personal ones: Lia sees va, vb and her own; Rui sees va and his own.
    for (const name of ["va", "vb"]) expect((await admin.inbox.upsertMailbox({ name, address: `${name}@acme.test` })).error).toBeNull();
    expect((await admin.inbox.addMember({ user_id: "lia", name: "Lia", mailboxes: ["va", "vb"] })).error).toBeNull();
    expect((await admin.inbox.addMember({ user_id: "rui", name: "Rui", mailboxes: ["va"] })).error).toBeNull();
    expect((await admin.inbox.upsertMailbox({ name: "lia", address: "lia@acme.test", owner: "lia" })).error).toBeNull();
    expect((await admin.inbox.upsertMailbox({ name: "rui", address: "rui@acme.test", owner: "rui" })).error).toBeNull();
    // One message each, oldest first (a few ms apart so "newest first" is unambiguous).
    const ids: Record<string, string> = {};
    for (const [key, to] of [["a1", "va"], ["a2", "va"], ["b1", "vb"], ["a3", "va"], ["p2", "rui"], ["b2", "vb"], ["p1", "lia"]] as const) {
      const m = inbound("ana@user.test", `${to}@acme.test`, mime({ from: "ana@user.test", to: `${to}@acme.test`, subject: `view ${key}`, text: key, id: `view-${key}@user.test` }));
      await worker.email(m.msg as never, env as never, createExecutionContext());
      expect(m.out.rejected).toBeNull();
      const page = (await call("query", "inbox:threads", { mailbox: to }, `user:${to === "rui" ? "rui" : "lia"}`)).value.page as any[];
      ids[key] = page.find((t) => t.subject === `view ${key}`)._id;
      await new Promise((r) => setTimeout(r, 5));
    }
    const view = async (who: string, args: Record<string, unknown>) => (await call("query", "inbox:view", args, `user:${who}`)).value as { page: any[]; isDone: boolean; partial: boolean };
    const keys = (v: { page: any[] }) => v.page.map((t) => t.subject.slice(5));

    // All: merged newest first across va, vb and her own mailbox; never Rui's.
    expect(keys(await view("lia", { view: "all" }))).toEqual(["p1", "b2", "a3", "b1", "a2", "a1"]);
    expect(await view("lia", { view: "all", limit: 2 })).toMatchObject({ isDone: false, partial: false });
    expect(keys(await view("lia", { view: "all", limit: 2 }))).toEqual(["p1", "b2"]);
    expect((await view("lia", { view: "all", limit: 6 })).isDone).toBe(true);
    expect(keys(await view("rui", { view: "all" }))).toEqual(["p2", "a3", "a2", "a1"]);

    // Assign a2 to Lia and a3 to Rui; b1 to Lia, then archived. a1 waits on the contact; a3 and p1 are read.
    for (const [t, userId] of [["a2", "lia"], ["a3", "rui"], ["b1", "lia"]] as const) expect((await call("mutation", "inbox:assign", { threadId: ids[t], userId }, "user:lia")).ok).toBe(true);
    expect((await call("mutation", "inbox:setStatus", { threadId: ids.b1, status: "closed" }, "user:lia")).ok).toBe(true);
    expect((await call("mutation", "inbox:setStatus", { threadId: ids.a1, status: "waiting" }, "user:lia")).ok).toBe(true);
    for (const t of ["a3", "p1"]) expect((await call("mutation", "inbox:markRead", { threadId: ids[t] }, "user:lia")).ok).toBe(true);

    // Assigned to me: open and waiting ones (b1 is archived), or the status asked for.
    expect(keys(await view("lia", { view: "assigned" }))).toEqual(["a2"]);
    expect(keys(await view("lia", { view: "assigned", status: "closed" }))).toEqual(["b1"]);
    expect(keys(await view("rui", { view: "assigned" }))).toEqual(["a3"]);
    // Unread: open and waiting threads with unread messages (b1 is archived, a3 and p1 read).
    expect(keys(await view("lia", { view: "unread" }))).toEqual(["b2", "a2", "a1"]);
    expect(await view("lia", { view: "unread", limit: 2 })).toMatchObject({ isDone: false });
    expect(keys(await view("rui", { view: "unread" }))).toEqual(["p2", "a2", "a1"]);
    // Waiting, and `all` narrowed by status.
    expect(keys(await view("lia", { view: "waiting" }))).toEqual(["a1"]);
    expect(keys(await view("lia", { view: "all", status: "closed" }))).toEqual(["b1"]);

    // The home screen's counts, exact (the component's aggregates): threads and their unread messages.
    expect((await call("query", "inbox:views", {}, "user:lia")).value).toEqual({
      all: { threads: 6, unread: 4, capped: false },
      assigned: { threads: 1, unread: 1, capped: false },
      unread: { threads: 3, unread: 3, capped: false },
      waiting: { threads: 1, unread: 1, capped: false },
      snoozed: { threads: 0, unread: 0, capped: false },
      tags: {},
    });
    expect((await call("query", "inbox:views", {}, "user:rui")).value).toMatchObject({ all: { threads: 4, unread: 3 }, assigned: { threads: 1, unread: 0 }, unread: { threads: 3 } });

    // Members only; an unknown view is refused by the validator.
    expect((await call("query", "inbox:view", { view: "all" }, "user:stranger")).error.message).toMatch(/not a member/);
    expect((await call("query", "inbox:views", {})).error.message).toMatch(/unauthenticated/);
    expect((await call("query", "inbox:view", { view: "starred" }, "user:lia")).error).toBeTruthy();
  });

  // ------------------------------------------------------------------------------------------- composer
  // A shared mailbox `cs` (Cia and Caio are members, Cris an admin) and Cia's personal `cia`.
  const composerSetup = async () => {
    expect((await admin.inbox.upsertMailbox({ name: "cs", address: "cs@acme.test", display_name: "Suporte" })).error).toBeNull();
    expect((await admin.inbox.addMember({ user_id: "cia", name: "Cia", mailboxes: ["cs"] })).error).toBeNull();
    expect((await admin.inbox.addMember({ user_id: "caio", name: "Caio", mailboxes: ["cs"] })).error).toBeNull();
    expect((await admin.inbox.addMember({ user_id: "cris", name: "Cris", admin: true })).error).toBeNull();
    expect((await admin.inbox.upsertMailbox({ name: "cia", address: "cia@acme.test", owner: "cia" })).error).toBeNull();
  };
  const inboundTo = async (to: string, subject: string, id: string) => {
    const m = inbound("marina@user.test", `${to}@acme.test`, mime({ from: '"Marina Costa" <marina@user.test>', to: `${to}@acme.test`, subject, text: "Preciso de ajuda.", id }));
    await worker.email(m.msg as never, env as never, createExecutionContext());
    expect(m.out.rejected).toBeNull();
    const who = to === "cia" ? "cia" : "cris";
    return ((await call("query", "inbox:threads", { mailbox: to }, `user:${who}`)).value.page as any[]).find((t) => t.subject === subject);
  };
  const sentEmail = async (emailId: string) => (await call("query", "testing:email", { id: emailId })).value as { text: string; html: string };
  const upload = async (who: string, bytes: Uint8Array, contentType: string, confirm = true) => {
    const ticket = (await call("mutation", "inbox:generateUploadUrl", { contentType, size: bytes.length }, `user:${who}`)).value;
    if (!confirm) return ticket.storageId as string;
    expect((await SELF.fetch(new URL(ticket.url, BASE).toString(), { method: "PUT", headers: ticket.headers ?? {}, body: bytes })).status).toBeLessThan(300);
    const ok = await SELF.fetch(`${BASE}/api/storage/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: ticket.shard, storageId: ticket.storageId, token: ticket.token }) });
    expect(ok.status).toBe(200);
    return ticket.storageId as string;
  };

  it("signatures: none by default; a mailbox's own over the member's default; personal mailboxes; only one's own", async () => {
    await composerSetup();
    const t = await inboundTo("cs", "Assinatura", "sig-1@user.test");
    const q = (fn: string, args: unknown, who: string) => call("query", fn, args, `user:${who}`);
    const mu = (fn: string, args: unknown, who: string) => call("mutation", fn, args, `user:${who}`);
    // Off until the member saves one: a reply goes without.
    expect((await q("inbox:signatures", {}, "cia")).value).toEqual([]);
    expect((await q("inbox:signature", { mailbox: "cs" }, "cia")).value).toBeNull();
    const plain = await mu("inbox:reply", { threadId: t._id, text: "Sem assinatura." }, "cia");
    expect(plain.error ?? null).toBeNull();
    expect((await sentEmail(plain.value.emailId)).html).not.toContain("gmail_signature");

    // A default for every mailbox, then one for her personal mailbox.
    expect((await mu("inbox:setSignature", { text: "Cia\nEquipe" }, "cia")).error ?? null).toBeNull();
    expect((await mu("inbox:setSignature", { mailbox: "cia", text: "Cia (pessoal)", html: "<p><b>Cia</b> pessoal</p>" }, "cia")).error ?? null).toBeNull();
    expect((await q("inbox:signature", { mailbox: "cs" }, "cia")).value).toEqual({ text: "Cia\nEquipe", html: null, from: null });
    expect((await q("inbox:signature", { mailbox: "cia" }, "cia")).value).toEqual({ text: "Cia (pessoal)", html: "<p><b>Cia</b> pessoal</p>", from: "cia" });
    // Saving again replaces (one per mailbox, one default).
    expect((await mu("inbox:setSignature", { mailbox: null, text: "Cia · Suporte" }, "cia")).error ?? null).toBeNull();
    const mine = (await q("inbox:signatures", {}, "cia")).value as any[];
    expect(mine.map((s) => [s.mailbox ?? null, s.text]).sort()).toEqual([[null, "Cia · Suporte"], ["cia", "Cia (pessoal)"]]);
    expect((await q("inbox:signatures", {}, "caio")).value).toEqual([]);

    // The reply carries the mailbox's effective signature, the composer's HTML and the localized quote line.
    const rich = await mu(
      "inbox:reply",
      { threadId: t._id, text: "Olá, Marina!", bodyHtml: "<p>Olá, <b>Marina</b>!<script>alert(1)</script></p>", quoteHeader: "Em 10 de nov. de 2026, Marina Costa escreveu:" },
      "cia",
    );
    expect(rich.error ?? null).toBeNull();
    const e = await sentEmail(rich.value.emailId);
    expect(e.text).toContain("-- \nCia · Suporte");
    expect(e.html).toContain("gmail_signature");
    expect(e.html).toContain("<b>Marina</b>");
    expect(e.html).not.toContain("<script");
    expect(e.html).toContain("Em 10 de nov. de 2026, Marina Costa escreveu:");
    // signature: false sends none.
    const none = await mu("inbox:reply", { threadId: t._id, text: "Sem.", signature: false }, "cia");
    expect((await sentEmail(none.value.emailId)).text).not.toContain("-- \n");
    // A new conversation from her personal mailbox: that mailbox's signature (its HTML).
    const own = await mu("inbox:compose", { mailbox: "cia", to: ["ana@user.test"], subject: "Oi", text: "Oi Ana." }, "cia");
    expect(own.error ?? null).toBeNull();
    expect((await sentEmail(own.value.emailId)).html).toContain("<b>Cia</b> pessoal");

    // Only mailboxes she sees; the admin never sees her personal one; a signature needs text, within the limits.
    expect((await mu("inbox:setSignature", { mailbox: "privacy", text: "x" }, "cia")).error.message).toMatch(/no access/);
    expect((await mu("inbox:setSignature", { mailbox: "cia", text: "x" }, "cris")).error.message).toMatch(/no access/);
    expect((await q("inbox:signature", { mailbox: "cia" }, "cris")).error.message).toMatch(/no access/);
    expect((await mu("inbox:setSignature", { text: "  " }, "cia")).error.message).toMatch(/text part/);
    expect((await mu("inbox:setSignature", { text: "x".repeat(5001) }, "cia")).error.message).toMatch(/at most 5k/);
    expect((await mu("inbox:setSignature", { text: "x", html: "x".repeat(20_001) }, "cia")).error.message).toMatch(/at most 20k/);
    expect((await call("mutation", "inbox:setSignature", { text: "x" })).error.message).toMatch(/unauthenticated/);
    expect((await call("query", "inbox:drafts", {})).error.message).toMatch(/unauthenticated/);
    expect((await mu("inbox:setSignature", { text: "x" }, "stranger")).error.message).toMatch(/not a member/);

    // Deleting the personal one falls back to the default; deleting twice says there was none.
    expect((await mu("inbox:deleteSignature", { mailbox: "cia" }, "cia")).value).toBe(true);
    expect((await mu("inbox:deleteSignature", { mailbox: "cia" }, "cia")).value).toBe(false);
    expect((await q("inbox:signature", { mailbox: "cia" }, "cia")).value).toMatchObject({ text: "Cia · Suporte", from: null });

    // Caio saves one for cs, then loses cs: it is no longer listed, and he cannot read it.
    expect((await mu("inbox:setSignature", { mailbox: "cs", text: "Caio" }, "caio")).error ?? null).toBeNull();
    expect((await q("inbox:signatures", {}, "caio")).value).toHaveLength(1);
    expect((await admin.inbox.addMember({ user_id: "caio", mailboxes: [] })).error).toBeNull();
    expect((await q("inbox:signatures", {}, "caio")).value).toEqual([]);
    expect((await q("inbox:signature", { mailbox: "cs" }, "caio")).error.message).toMatch(/no access/);
    expect((await admin.inbox.addMember({ user_id: "caio", mailboxes: ["cs"] })).error).toBeNull();
    expect((await q("inbox:signature", { mailbox: "cs" }, "caio")).value).toMatchObject({ text: "Caio", from: "cs" });
  });

  it("drafts: the cap counts only drafts the member can still reach", async () => {
    const mu = (fn: string, args: unknown) => call("mutation", fn, args, "user:dora");
    expect((await admin.inbox.addMember({ user_id: "dora", mailboxes: ["cs"] })).error).toBeNull();
    for (let i = 0; i < 200; i++) expect((await mu("inbox:saveDraft", { kind: "compose", mailbox: "cs", text: `d${i}` })).error ?? null).toBeNull();
    expect((await mu("inbox:saveDraft", { kind: "compose", mailbox: "cs", text: "one more" })).error.message).toMatch(/at most 200 drafts/);
    // Dora moves to privacy: her cs drafts are out of reach, so they make room instead of blocking her.
    expect((await admin.inbox.addMember({ user_id: "dora", mailboxes: ["privacy"] })).error).toBeNull();
    expect((await mu("inbox:saveDraft", { kind: "compose", mailbox: "privacy", text: "novo" })).error ?? null).toBeNull();
    expect((await call("query", "inbox:drafts", {}, "user:dora")).value).toHaveLength(1);
  });

  it("drafts: private to the member, one per thread and kind, kept with their files, removed on send and after 30 days", async () => {
    const t = await inboundTo("cs", "Rascunhos", "draft-1@user.test");
    const q = (fn: string, args: unknown, who: string) => call("query", fn, args, `user:${who}`);
    const mu = (fn: string, args: unknown, who: string) => call("mutation", fn, args, `user:${who}`);
    const file = await upload("cia", new TextEncoder().encode("rascunho"), "text/plain");

    const d1 = await mu("inbox:saveDraft", { kind: "reply", threadId: t._id, text: "Olá", cc: ["fin@user.test"], attachments: [{ file, filename: "r.txt", contentType: "text/plain" }] }, "cia");
    expect(d1.error ?? null).toBeNull();
    // Saving again without the id (another device) replaces the same reply draft.
    // The files are sent back as read (with their size), which the server ignores: sizes come from storage.
    const d2 = await mu("inbox:saveDraft", { kind: "reply", threadId: t._id, text: "Olá, Marina", bodyHtml: "<p>Olá, <b>Marina</b></p>", attachments: [{ file, filename: "r.txt", contentType: "text/plain", size: 1 }] }, "cia");
    expect(d2.value.id).toBe(d1.value.id);
    const note = await mu("inbox:saveDraft", { kind: "note", threadId: t._id, text: "nota" }, "cia");
    expect(note.value.id).not.toBe(d1.value.id);
    const list = (await q("inbox:drafts", {}, "cia")).value as any[];
    expect(list.map((d) => d.kind)).toEqual(["note", "reply"]);
    expect(list[1]).toMatchObject({ _id: d1.value.id, userId: "cia", kind: "reply", threadId: t._id, mailbox: "cs", to: [], cc: [], bcc: [], subject: "", text: "Olá, Marina", bodyHtml: "<p>Olá, <b>Marina</b></p>", attachments: [{ file, filename: "r.txt", contentType: "text/plain" }] });
    // Each file carries its stored size, so a reopened draft knows whether a scheduled send would need links.
    expect(list[1].attachments[0].size).toBe(8);
    expect((await q("inbox:drafts", { threadId: t._id }, "cia")).value).toHaveLength(2);

    // Another member of the mailbox sees none of them and cannot touch them; nor can an admin.
    expect((await q("inbox:drafts", {}, "caio")).value).toEqual([]);
    expect((await q("inbox:drafts", { threadId: t._id }, "caio")).value).toEqual([]);
    expect((await mu("inbox:deleteDraft", { id: d1.value.id }, "caio")).error.message).toMatch(/draft not found/);
    expect((await mu("inbox:saveDraft", { id: d1.value.id, kind: "reply", threadId: t._id, text: "mine" }, "cris")).error.message).toMatch(/draft not found/);
    expect((await mu("inbox:reply", { threadId: t._id, text: "x", draftId: d1.value.id }, "caio")).error.message).toMatch(/draft not found/);
    // Only one's own uploads; only threads and mailboxes one sees; the kind's fields.
    expect((await mu("inbox:saveDraft", { kind: "reply", threadId: t._id, text: "x", attachments: [{ file, filename: "r.txt", contentType: "text/plain" }] }, "caio")).error.message).toMatch(/not an upload of yours/);
    expect((await mu("inbox:saveDraft", { kind: "reply", threadId: t._id, text: "x" }, "agent-2")).error.message).toMatch(/no access/);
    expect((await mu("inbox:saveDraft", { kind: "compose", mailbox: "privacy", text: "x" }, "cia")).error.message).toMatch(/no access/);
    expect((await mu("inbox:saveDraft", { kind: "compose", text: "x" }, "cia")).error.message).toMatch(/mailbox: required/);
    expect((await mu("inbox:saveDraft", { kind: "compose", mailbox: "cs", threadId: t._id, text: "x" }, "cia")).error.message).toMatch(/no thread/);
    expect((await mu("inbox:saveDraft", { kind: "reply", text: "x" }, "cia")).error.message).toMatch(/threadId: required/);
    expect((await mu("inbox:saveDraft", { kind: "forward", threadId: t._id, text: "x" }, "cia")).error.message).toMatch(/not found in this thread/);
    expect((await mu("inbox:saveDraft", { kind: "reply", threadId: t._id, text: "x".repeat(200_001) }, "cia")).error.message).toMatch(/at most 200k/);
    const many = Array.from({ length: 51 }, (_, i) => `p${i}@user.test`);
    expect((await mu("inbox:saveDraft", { kind: "compose", mailbox: "cs", to: many, text: "x" }, "cia")).error.message).toMatch(/at most 50 recipients/);
    // A file still uploading may wait in a draft (it is checked when sent).
    const pending = await upload("cia", new TextEncoder().encode("wait"), "text/plain", false);
    const withPending = await mu("inbox:saveDraft", { kind: "compose", mailbox: "cs", to: ["x@user.test"], subject: "s", text: "t", attachments: [{ file: pending, filename: "p.txt", contentType: "text/plain" }] }, "cia");
    expect(withPending.error ?? null).toBeNull();
    expect((await mu("inbox:deleteDraft", { id: withPending.value.id }, "cia")).value).toBe(true);
    expect((await mu("inbox:deleteDraft", { id: withPending.value.id }, "cia")).value).toBe(false);

    // A failed send keeps the draft; a sent reply deletes it in the same transaction (and only it).
    expect((await mu("inbox:reply", { threadId: t._id, text: "x", cc: many, draftId: d1.value.id }, "cia")).error.message).toMatch(/at most 50/);
    expect(((await q("inbox:drafts", {}, "cia")).value as any[]).some((d) => d._id === d1.value.id)).toBe(true);
    const sent = await mu("inbox:reply", { threadId: t._id, text: "Olá, Marina", attachments: list[1].attachments, draftId: d1.value.id }, "cia");
    expect(sent.error ?? null).toBeNull();
    expect(((await q("inbox:drafts", {}, "cia")).value as any[]).map((d) => d._id)).toEqual([note.value.id]);
    // A draft already gone (sent on another device) does not stop the send.
    expect((await mu("inbox:reply", { threadId: t._id, text: "De novo", draftId: d1.value.id }, "cia")).error ?? null).toBeNull();
    // The note, a forward and a new conversation consume theirs too.
    expect((await mu("inbox:note", { threadId: t._id, text: "nota", draftId: note.value.id }, "cia")).error ?? null).toBeNull();
    const inboundMsg = (await q("inbox:thread", { threadId: t._id }, "cia")).value.messages.find((m: any) => m.direction === "inbound");
    const fwd = await mu("inbox:saveDraft", { kind: "forward", threadId: t._id, messageId: inboundMsg._id, to: ["boss@user.test"], subject: "Fwd: Rascunhos", text: "Veja." }, "cia");
    expect(fwd.error ?? null).toBeNull();
    expect((await mu("inbox:forward", { threadId: t._id, messageId: inboundMsg._id, to: ["boss@user.test"], subject: "Fwd: Rascunhos", text: "Veja.", draftId: fwd.value.id }, "cia")).error ?? null).toBeNull();
    const cmp = await mu("inbox:saveDraft", { kind: "compose", mailbox: "cia", to: ["ana@user.test"], subject: "Pessoal", text: "Oi" }, "cia");
    expect(((await q("inbox:drafts", {}, "cia")).value as any[]).map((d) => d._id)).toEqual([cmp.value.id]);
    expect((await mu("inbox:compose", { mailbox: "cia", to: ["ana@user.test"], subject: "Pessoal", text: "Oi", draftId: cmp.value.id }, "cia")).error ?? null).toBeNull();
    expect((await q("inbox:drafts", {}, "cia")).value).toEqual([]);

    // Lost access: Caio's draft in cs is not returned while he cannot see cs.
    const cd = await mu("inbox:saveDraft", { kind: "compose", mailbox: "cs", to: ["x@user.test"], subject: "s", text: "t" }, "caio");
    expect(cd.error ?? null).toBeNull();
    expect((await admin.inbox.addMember({ user_id: "caio", mailboxes: [] })).error).toBeNull();
    expect((await q("inbox:drafts", {}, "caio")).value).toEqual([]);
    expect((await q("inbox:drafts", { threadId: t._id }, "caio")).error.message).toMatch(/no access/);
    expect((await admin.inbox.addMember({ user_id: "caio", mailboxes: ["cs"] })).error).toBeNull();
    expect(((await q("inbox:drafts", {}, "caio")).value as any[]).map((d) => d._id)).toEqual([cd.value.id]);

    // Deleting the conversation deletes everyone's drafts on it.
    const doomed = await inboundTo("cs", "Rascunho apagado", "draft-2@user.test");
    expect((await mu("inbox:saveDraft", { kind: "reply", threadId: doomed._id, text: "x" }, "caio")).error ?? null).toBeNull();
    expect((await mu("inbox:deleteThread", { threadId: doomed._id }, "cris")).value).toMatchObject({ deleted: true });
    expect(((await q("inbox:drafts", {}, "caio")).value as any[]).map((d) => d._id)).toEqual([cd.value.id]);

    // Untouched for 30 days: removed by the daily prune; a fresher one stays.
    const fresh = await mu("inbox:saveDraft", { kind: "compose", mailbox: "cia", to: [], subject: "", text: "novo" }, "cia");
    await call("mutation", "testing:ageDrafts", { userId: "caio", at: Date.now() - 31 * 24 * 3600 * 1000 });
    expect((await call("mutation", "testing:pruneDrafts", {})).value).toBe(1);
    expect((await q("inbox:drafts", {}, "caio")).value).toEqual([]);
    expect(((await q("inbox:drafts", {}, "cia")).value as any[]).map((d) => d._id)).toEqual([fresh.value.id]);
  });

  it("saved replies: per mailbox, read and created by its members, changed by their author or an admin", async () => {
    const q = (fn: string, args: unknown, who: string) => call("query", fn, args, `user:${who}`);
    const mu = (fn: string, args: unknown, who: string) => call("mutation", fn, args, `user:${who}`);
    const r1 = await mu("inbox:saveSavedReply", { mailbox: "cs", title: "Reembolso", text: "Olá, {primeiro_nome}! Seu reembolso do pedido #{numero} saiu.", bodyHtml: "<p>Olá, {primeiro_nome}!</p>" }, "cia");
    expect(r1.error ?? null).toBeNull();
    expect((await mu("inbox:saveSavedReply", { mailbox: "cs", title: "  agradecimento ", text: "Obrigada, {nome}. {agente}, {caixa}" }, "caio")).error ?? null).toBeNull();
    // Every member of the mailbox reads them, by title; stored as written (the clients fill the variables).
    const list = (await q("inbox:savedReplies", { mailbox: "cs" }, "caio")).value as any[];
    expect(list.map((r) => r.title)).toEqual(["agradecimento", "Reembolso"]);
    expect(list[1]).toMatchObject({ _id: r1.value.id, mailbox: "cs", createdBy: "cia", text: "Olá, {primeiro_nome}! Seu reembolso do pedido #{numero} saiu.", bodyHtml: "<p>Olá, {primeiro_nome}!</p>" });
    expect((await q("inbox:savedReplies", { mailbox: "cs" }, "cris")).value).toHaveLength(2);

    // Only its author or an admin changes or deletes one; the author stays when an admin edits it.
    expect((await mu("inbox:saveSavedReply", { id: r1.value.id, mailbox: "cs", title: "Meu", text: "x" }, "caio")).error.message).toMatch(/only its author or an admin/);
    expect((await mu("inbox:deleteSavedReply", { id: r1.value.id }, "caio")).error.message).toMatch(/only its author or an admin/);
    expect((await mu("inbox:saveSavedReply", { id: r1.value.id, mailbox: "cs", title: "Reembolso aprovado", text: "Olá, {primeiro_nome}!" }, "cris")).error ?? null).toBeNull();
    const edited = ((await q("inbox:savedReplies", { mailbox: "cs" }, "cia")).value as any[]).find((r) => r._id === r1.value.id);
    expect(edited).toMatchObject({ title: "Reembolso aprovado", createdBy: "cia", text: "Olá, {primeiro_nome}!" });
    expect(edited.bodyHtml).toBeUndefined();
    expect((await mu("inbox:saveSavedReply", { id: r1.value.id, mailbox: "cs", title: "De novo", text: "y" }, "cia")).error ?? null).toBeNull();
    // A saved reply stays in its mailbox: editing it as another mailbox's is "not found".
    expect((await mu("inbox:saveSavedReply", { id: r1.value.id, mailbox: "cia", title: "x", text: "y" }, "cia")).error.message).toMatch(/not found/);

    // Members of other mailboxes neither read nor write them; a personal mailbox's are its owner's only.
    expect((await q("inbox:savedReplies", { mailbox: "cs" }, "agent-2")).error.message).toMatch(/no access/);
    expect((await mu("inbox:saveSavedReply", { mailbox: "cs", title: "x", text: "y" }, "agent-2")).error.message).toMatch(/no access/);
    expect((await mu("inbox:deleteSavedReply", { id: r1.value.id }, "agent-2")).error.message).toMatch(/no access/);
    const p = await mu("inbox:saveSavedReply", { mailbox: "cia", title: "Pessoal", text: "Abraço, {agente}" }, "cia");
    expect(p.error ?? null).toBeNull();
    expect((await q("inbox:savedReplies", { mailbox: "cia" }, "cia")).value).toHaveLength(1);
    expect((await q("inbox:savedReplies", { mailbox: "cia" }, "cris")).error.message).toMatch(/no access/);
    expect((await mu("inbox:deleteSavedReply", { id: p.value.id }, "cris")).error.message).toMatch(/no access/);

    // Validation: a title and a text, within the limits.
    expect((await mu("inbox:saveSavedReply", { mailbox: "cs", title: " ", text: "y" }, "cia")).error.message).toMatch(/title: required/);
    expect((await mu("inbox:saveSavedReply", { mailbox: "cs", title: "x".repeat(201), text: "y" }, "cia")).error.message).toMatch(/at most 200 characters/);
    expect((await mu("inbox:saveSavedReply", { mailbox: "cs", title: "x", text: "" }, "cia")).error.message).toMatch(/text: required/);
    expect((await mu("inbox:saveSavedReply", { mailbox: "cs", title: "x", text: "y", bodyHtml: "x".repeat(200_001) }, "cia")).error.message).toMatch(/at most 200k/);

    // The author deletes theirs; an admin deletes anyone's.
    expect((await mu("inbox:deleteSavedReply", { id: r1.value.id }, "cia")).value).toBe(true);
    const other = ((await q("inbox:savedReplies", { mailbox: "cs" }, "cris")).value as any[])[0];
    expect((await mu("inbox:deleteSavedReply", { id: other._id }, "cris")).value).toBe(true);
    expect((await q("inbox:savedReplies", { mailbox: "cs" }, "cia")).value).toEqual([]);
    expect((await mu("inbox:deleteSavedReply", { id: other._id }, "cris")).error.message).toMatch(/not found/);

    // Removing a member removes their drafts and signatures (private data); added again, they start with none.
    expect((await admin.inbox.addMember({ user_id: "cleo", name: "Cleo", mailboxes: ["cs"] })).error).toBeNull();
    expect((await mu("inbox:saveDraft", { kind: "compose", mailbox: "cs", text: "x" }, "cleo")).error ?? null).toBeNull();
    expect((await mu("inbox:setSignature", { text: "Cleo" }, "cleo")).error ?? null).toBeNull();
    const removed = await mu("console:removeMember", { userId: "cleo" }, "cris");
    expect(removed.error ?? null).toBeNull();
    expect(removed.value).toBe(true);
    expect((await admin.inbox.addMember({ user_id: "cleo", name: "Cleo", mailboxes: ["cs"] })).error).toBeNull();
    expect((await q("inbox:drafts", {}, "cleo")).value).toEqual([]);
    expect((await q("inbox:signatures", {}, "cleo")).value).toEqual([]);
  });

  it("composer sends: files past the limit are linked in the HTML body too; text-only sends are unchanged", async () => {
    const t = await inboundTo("cs", "Arquivo grande", "big-1@user.test");
    const big = await upload("cia", new Uint8Array(10 * 1024 * 1024 + 1), "application/octet-stream");
    const r = await call("mutation", "inbox:reply", { threadId: t._id, text: "Segue.", bodyHtml: "<p>Segue.</p>", signature: false, attachments: [{ file: big, filename: "a&b.bin", contentType: "application/octet-stream" }] }, "user:cia");
    expect(r.error ?? null).toBeNull();
    const e = await sentEmail(r.value.emailId);
    expect(e.text).toMatch(/Arquivos para baixar \(links válidos até \d{4}-\d{2}-\d{2}\):\na&b\.bin \(10\.0 MB\): \S+/);
    expect(e.html).toMatch(/Arquivos para baixar[^<]*<br>\s*<a href="[^"]+">a&amp;b\.bin<\/a> \(10\.0 MB\)/);
    // Sent now, the links work 7 days from now.
    expect(e.text).toContain(`links válidos até ${new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)}`);
    // Scheduled, they would have to work 7 days from the send, past what a signed URL lives (7 days from now): refused,
    // with nothing sent. A scheduled send whose files all fit as attachments goes.
    const later = Date.now() + 3_600_000;
    const sched = await call("mutation", "inbox:reply", { threadId: t._id, text: "Amanhã.", sendAt: later, signature: false, attachments: [{ file: big, filename: "a&b.bin", contentType: "application/octet-stream" }] }, "user:cia");
    expect(sched.error.code).toBe("ValidationError");
    expect(sched.error.message).toMatch(/a scheduled send can't link files: past 10\.0 MB in all, files go as download links, which work at most 7 days from now and must work 7 days from the send/);
    expect(await call("query", "inbox:scheduled", { threadId: t._id }, "user:cia")).toMatchObject({ value: [] });
    const small = await upload("cia", new TextEncoder().encode("pequeno"), "text/plain");
    const ok = await call("mutation", "inbox:reply", { threadId: t._id, text: "Amanhã.", sendAt: later, signature: false, attachments: [{ file: small, filename: "p.txt", contentType: "text/plain" }] }, "user:cia");
    expect(ok.value).toMatchObject({ status: "scheduled" });
    expect((await sentEmail(ok.value.emailId)).text).not.toContain("Arquivos para baixar");
    expect((await call("mutation", "inbox:cancelScheduled", { emailId: ok.value.emailId }, "user:cia")).value).toMatchObject({ ok: true });
    // A text-only reply from an old client: the text becomes the HTML (no card), as before.
    const old = await call("mutation", "inbox:reply", { threadId: t._id, text: "Só texto." }, "user:caio");
    expect(old.error ?? null).toBeNull();
    expect((await sentEmail(old.value.emailId)).html).toContain("Só texto.");
    expect((await call("mutation", "inbox:reply", { threadId: t._id, text: "x", quoteHeader: "x".repeat(1001) }, "user:caio")).error.message).toMatch(/quoteHeader: at most 1k/);
  });

  // ------------------------------------------------------------------------------------------- conversation state
  // Shared `ea` (Eva and Edu) and `eb` (Eva and Eli), and Eva's personal `eia`. Edu never sees `eb` or `eia`; Eli never
  // sees `ea` or `eia`.
  let stateReady = false;
  const stateSetup = async () => {
    if (stateReady) return;
    stateReady = true;
    for (const name of ["ea", "eb"]) expect((await admin.inbox.upsertMailbox({ name, address: `${name}@acme.test` })).error).toBeNull();
    expect((await admin.inbox.addMember({ user_id: "eva", name: "Eva", mailboxes: ["ea", "eb"] })).error).toBeNull();
    expect((await admin.inbox.addMember({ user_id: "edu", name: "Edu", mailboxes: ["ea"] })).error).toBeNull();
    expect((await admin.inbox.addMember({ user_id: "eli", name: "Eli", mailboxes: ["eb"] })).error).toBeNull();
    expect((await admin.inbox.upsertMailbox({ name: "eia", address: "eia@acme.test", owner: "eva" })).error).toBeNull();
  };
  const threadIn = async (to: string, subject: string) => {
    const m = inbound("rita@user.test", `${to}@acme.test`, mime({ from: '"Rita Lima" <rita@user.test>', to: `${to}@acme.test`, subject, text: "Oi.", id: `${subject.replace(/\W/g, "-")}@user.test` }));
    await worker.email(m.msg as never, env as never, createExecutionContext());
    expect(m.out.rejected).toBeNull();
    const t = ((await call("query", "inbox:threads", { mailbox: to }, "user:eva")).value.page as any[]).find((x) => x.subject === subject);
    expect(t).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    return t._id as string;
  };
  const q = async (fn: string, args: unknown, who: string) => {
    const r = await call("query", fn, args, `user:${who}`);
    if (r.error) throw new Error(r.error.message);
    return r.value;
  };
  const mu = async (fn: string, args: unknown, who: string) => {
    const r = await call("mutation", fn, args, `user:${who}`);
    if (r.error) throw new Error(r.error.message);
    return r.value;
  };
  const refused = async (kind: "query" | "mutation", fn: string, args: unknown, who: string) => (await call(kind, fn, args, `user:${who}`)).error?.message as string | undefined;
  const subjects = (v: { page: any[] }) => v.page.map((t) => t.subject);

  it("lib:maintain: the email component's own cron (hasUnread backfill, overdue snoozes) runs with the app's", async () => {
    const crons = composeApp({ schema, functions, app, http }).crons;
    expect(JSON.stringify(crons)).toContain("lib:maintain");
  });

  it("tags: per mailbox, managed and applied by who sees it; a view and the counts narrowed by tag", async () => {
    await stateSetup();
    const t1 = await threadIn("ea", "tag one");
    const t2 = await threadIn("ea", "tag two");
    const t3 = await threadIn("ea", "tag three");
    const t4 = await threadIn("eb", "tag four");
    const t5 = await threadIn("eia", "tag five");

    const urgent = (await mu("inbox:createTag", { mailbox: "ea", name: "Urgente", color: "red" }, "edu")) as string;
    const later = (await mu("inbox:createTag", { mailbox: "ea", name: "Depois" }, "eva")) as string;
    const billing = (await mu("inbox:createTag", { mailbox: "eb", name: "Cobrança", color: "blue" }, "eli")) as string;
    const mine = (await mu("inbox:createTag", { mailbox: "eia", name: "Pessoal", color: "purple" }, "eva")) as string;
    expect(await q("inbox:tags", { mailbox: "ea" }, "edu")).toMatchObject([
      { _id: urgent, mailbox: "ea", name: "Urgente", color: "red", order: 0 },
      { _id: later, mailbox: "ea", name: "Depois", color: "gray", order: 1 },
    ]);
    // Without a mailbox: every tag of the mailboxes the member sees, never another's.
    expect(((await q("inbox:tags", {}, "eva")) as any[]).map((t) => t.name).sort()).toEqual(["Cobrança", "Depois", "Pessoal", "Urgente"]);
    expect(((await q("inbox:tags", {}, "edu")) as any[]).map((t) => t._id)).toEqual([urgent, later]);
    expect(await refused("query", "inbox:tags", { mailbox: "eia" }, "edu")).toMatch(/no access/);
    expect(await refused("mutation", "inbox:createTag", { mailbox: "eb", name: "x" }, "edu")).toMatch(/no access/);
    expect(await refused("mutation", "inbox:createTag", { mailbox: "ea", name: "urgente" }, "eva")).toMatch(/already has a tag/);
    expect(await refused("mutation", "inbox:createTag", { mailbox: "ea", name: "x", color: "neon" }, "eva")).toMatch(/tag color/);
    // Rename and recolor; another mailbox's tag (an admin's personal one included) is not found.
    expect(await mu("inbox:updateTag", { tagId: later, name: "Mais tarde", color: "teal" }, "edu")).toBe(later);
    expect((await q("inbox:tags", { mailbox: "ea" }, "eva"))[1]).toMatchObject({ name: "Mais tarde", color: "teal" });
    for (const tagId of [mine, billing]) {
      expect(await refused("mutation", "inbox:updateTag", { tagId, name: "x" }, "edu")).toMatch(/tag not found/);
      expect(await refused("mutation", "inbox:deleteTag", { tagId }, "edu")).toMatch(/tag not found/);
    }

    // On threads: add, set, remove; only a tag of the thread's mailbox, only on a thread the member sees.
    expect(await mu("inbox:addTag", { threadId: t1, tag: urgent }, "edu")).toEqual([urgent]);
    expect(await mu("inbox:setTags", { threadId: t2, tags: [urgent, later] }, "eva")).toEqual([urgent, later]);
    expect(await mu("inbox:setTags", { threadId: t3, tags: [later] }, "eva")).toEqual([later]);
    expect(await mu("inbox:removeTag", { threadId: t2, tag: later }, "edu")).toEqual([urgent]);
    expect(await mu("inbox:addTag", { threadId: t5, tag: mine }, "eva")).toEqual([mine]);
    expect(await refused("mutation", "inbox:addTag", { threadId: t1, tag: billing }, "eva")).toMatch(/not a tag of mailbox ea/);
    expect(await refused("mutation", "inbox:addTag", { threadId: t4, tag: billing }, "edu")).toMatch(/no access/);
    expect(await refused("mutation", "inbox:addTag", { threadId: t5, tag: mine }, "edu")).toMatch(/no access/);
    expect((await q("inbox:thread", { threadId: t2 }, "eva")).thread.tags).toEqual([urgent]);

    // Views by tag: exact, newest first, in the tag's mailbox; a tag the member can't see is not found.
    expect(subjects(await q("inbox:view", { view: "all", tag: urgent }, "edu"))).toEqual(["tag two", "tag one"]);
    expect(subjects(await q("inbox:view", { view: "all", tag: urgent, limit: 1 }, "edu"))).toEqual(["tag two"]);
    expect(await q("inbox:view", { view: "all", tag: urgent, limit: 1 }, "edu")).toMatchObject({ isDone: false, partial: false });
    expect(subjects(await q("inbox:view", { view: "all", tag: later }, "eva"))).toEqual(["tag three"]);
    expect(subjects(await q("inbox:view", { view: "all", tag: mine }, "eva"))).toEqual(["tag five"]);
    expect(await refused("query", "inbox:view", { view: "all", tag: mine }, "edu")).toMatch(/tag not found/);
    expect(subjects((await q("inbox:threads", { mailbox: "ea", tag: urgent }, "edu")) as any)).toEqual(["tag two", "tag one"]);
    await mu("inbox:markRead", { threadId: t1 }, "eva");
    expect(subjects(await q("inbox:view", { view: "unread", tag: urgent }, "eva"))).toEqual(["tag two"]);
    // Counts per tag, for the tags of the member's mailboxes only.
    const counts = (await q("inbox:views", {}, "edu")) as any;
    expect(counts.tags).toEqual({ [urgent]: { threads: 2, unread: 1, capped: false }, [later]: { threads: 1, unread: 1, capped: false } });
    expect(Object.keys(((await q("inbox:views", {}, "eva")) as any).tags).sort()).toEqual([urgent, later, billing, mine].sort());

    // Deleting a tag takes it off its threads.
    expect(await mu("inbox:deleteTag", { tagId: later }, "edu")).toEqual({ deleted: true });
    expect((await q("inbox:thread", { threadId: t3 }, "eva")).thread.tags ?? []).toEqual([]);
    expect(await refused("query", "inbox:view", { view: "all", tag: later }, "eva")).toMatch(/tag not found/);
  });

  it("exact views: assigned, unread, waiting and snoozed across mailboxes, with the counts that match them", async () => {
    await stateSetup();
    const s1 = await threadIn("ea", "exact one");
    const s2 = await threadIn("eb", "exact two");
    const s3 = await threadIn("ea", "exact three");
    const s4 = await threadIn("eia", "exact four");
    // Only these four are open or waiting below: earlier threads of ea/eb/eia go to spam, out of the way.
    for (const mailbox of ["ea", "eb", "eia"]) {
      for (const t of (await q("inbox:threads", { mailbox }, "eva")).page as any[]) {
        if (![s1, s2, s3, s4].includes(t._id)) await mu("inbox:setStatus", { threadId: t._id, status: "spam" }, "eva");
      }
    }
    await mu("inbox:assign", { threadId: s1, userId: "edu" }, "eva");
    await mu("inbox:assign", { threadId: s3, userId: "eva" }, "edu");
    await mu("inbox:assign", { threadId: s2, userId: "eva" }, "eli");
    await mu("inbox:setStatus", { threadId: s2, status: "waiting" }, "eva");
    await mu("inbox:markRead", { threadId: s3 }, "eva");
    expect(await refused("mutation", "inbox:assign", { threadId: s4, userId: "eva" }, "eva")).toMatch(/personal mailbox has no assignment/);

    expect(subjects(await q("inbox:view", { view: "assigned" }, "eva"))).toEqual(["exact three", "exact two"]);
    expect(subjects(await q("inbox:view", { view: "assigned" }, "edu"))).toEqual(["exact one"]);
    expect(subjects(await q("inbox:view", { view: "assigned" }, "eli"))).toEqual([]);
    expect(subjects(await q("inbox:view", { view: "unread" }, "eva"))).toEqual(["exact four", "exact two", "exact one"]);
    expect(subjects(await q("inbox:view", { view: "unread" }, "edu"))).toEqual(["exact one"]);
    expect(subjects(await q("inbox:view", { view: "waiting" }, "eva"))).toEqual(["exact two"]);
    expect(subjects(await q("inbox:threads", { mailbox: "ea", assignee: "edu" }, "eva"))).toEqual(["exact one"]);
    expect(subjects(await q("inbox:threads", { mailbox: "ea", unread: true, status: "open" }, "eva"))).toContain("exact one");

    // The mailbox badges (`inbox:mailboxes`) leave snoozed threads out too.
    const badge = async (who: string, name: string) => {
      const b = ((await q("inbox:mailboxes", {}, who)) as any[]).find((x) => x.name === name);
      return { threads: b.threads, unread: b.unread };
    };
    // Over HTTP (an API key: shared mailboxes only), the same counts, and `snoozed` apart.
    const httpBadge = async (name: string) => (await admin.inbox.mailboxes()).data!.data.find((b) => b.name === name)!;
    const ea0 = await badge("eva", "ea");
    const eia0 = await badge("eva", "eia");
    expect(await httpBadge("ea")).toMatchObject({ ...ea0, snoozed: 0 });
    expect(await httpBadge("eia")).not.toHaveProperty("unread");
    expect(await httpBadge("eia")).not.toHaveProperty("snoozed");

    // Snoozed: out of every other view and count, listed soonest to wake first; Edu can't snooze in eb.
    const now = Date.now();
    expect(await mu("inbox:snooze", { threadId: s1, until: now + 7_200_000 }, "edu")).toBe(now + 7_200_000);
    await mu("inbox:snooze", { threadId: s4, until: now + 3_600_000 }, "eva");
    expect(await badge("eva", "ea")).toEqual({ threads: ea0.threads - 1, unread: ea0.unread - 1 });
    expect(await badge("edu", "ea")).toEqual({ threads: ea0.threads - 1, unread: ea0.unread - 1 });
    expect(await badge("eva", "eia")).toEqual({ threads: eia0.threads - 1, unread: eia0.unread - 1 });
    expect(((await q("inbox:mailboxes", {}, "eva")) as any[]).find((b) => b.name === "ea")).toMatchObject({ snoozed: 1 });
    expect(await httpBadge("ea")).toMatchObject({ threads: ea0.threads - 1, unread: ea0.unread - 1, snoozed: 1 });
    // The badge adds up with the default list.
    const listed = (await admin.inbox.threads({ mailbox: "ea", limit: 100 })).data!.page;
    expect({ threads: listed.length, unread: listed.reduce((n, t) => n + t.unreadCount, 0) }).toEqual({ threads: ea0.threads - 1, unread: ea0.unread - 1 });

    // HTTP: `GET /inbox/threads` leaves them out too; `snoozed=true` lists only them. Never a personal mailbox.
    const byKey = async (qs: string) => SELF.fetch(`${BASE}/inbox/threads?${qs}`, { headers: { authorization: "Bearer admin-secret" } });
    expect(((await admin.inbox.threads({ mailbox: "ea", limit: 100 })).data!.page as any[]).map((t) => t._id)).not.toContain(s1);
    expect(((await admin.inbox.threads({ mailbox: "ea", snoozed: true })).data!.page as any[]).map((t) => t._id)).toEqual([s1]);
    expect(((await (await byKey("mailbox=ea&snoozed=true")).json()) as any).page[0]).toMatchObject({ _id: s1, snoozed: true, snoozedUntil: now + 7_200_000 });
    expect((await byKey("mailbox=ea&snoozed=false")).status).toBe(200);
    expect(await (await byKey("mailbox=ea&snoozed=yes")).json()).toMatchObject({ statusCode: 422, name: "validation_error" });
    expect((await byKey("mailbox=eia&snoozed=true")).status).toBe(403);
    expect(await refused("mutation", "inbox:snooze", { threadId: s2, until: now + 3_600_000 }, "edu")).toMatch(/no access/);
    expect(await refused("mutation", "inbox:snooze", { threadId: s3, until: now - 1000 }, "eva")).toMatch(/in the future/);
    expect(await refused("mutation", "inbox:snooze", { threadId: s3, until: now + 400 * 86_400_000 }, "eva")).toMatch(/366 days/);
    expect(subjects(await q("inbox:view", { view: "snoozed" }, "eva"))).toEqual(["exact four", "exact one"]);
    expect(subjects(await q("inbox:view", { view: "snoozed" }, "edu"))).toEqual(["exact one"]);
    expect(subjects(await q("inbox:view", { view: "all" }, "eva"))).not.toContain("exact one");
    expect(subjects(await q("inbox:view", { view: "unread" }, "eva"))).toEqual(["exact two"]);
    expect(subjects(await q("inbox:view", { view: "assigned" }, "edu"))).toEqual([]);
    const { tags: _, ...eva } = (await q("inbox:views", {}, "eva")) as any;
    // `all` counts every status (the spam ones too), and matches its list.
    const all = (await q("inbox:view", { view: "all", limit: 300 }, "eva")).page as any[];
    expect(eva).toEqual({
      all: { threads: all.length, unread: all.reduce((n, t) => n + t.unreadCount, 0), capped: false },
      assigned: { threads: 2, unread: 1, capped: false },
      unread: { threads: 1, unread: 1, capped: false },
      waiting: { threads: 1, unread: 1, capped: false },
      snoozed: { threads: 2, unread: 2, capped: false },
    });
    expect(await q("inbox:views", {}, "edu")).toMatchObject({ assigned: { threads: 0 }, unread: { threads: 0 }, snoozed: { threads: 1, unread: 1 } });

    // Unsnoozed by hand: back where it was. Snoozed for a moment: it comes back on its own, open and unread, on top.
    await mu("inbox:unsnooze", { threadId: s1 }, "edu");
    expect(subjects(await q("inbox:view", { view: "assigned" }, "edu"))).toEqual(["exact one"]);
    expect(await badge("eva", "ea")).toEqual(ea0);
    await mu("inbox:setStatus", { threadId: s3, status: "closed" }, "eva");
    await mu("inbox:snooze", { threadId: s3, until: Date.now() + 1200 }, "eva");
    expect(await badge("eva", "ea")).toEqual({ threads: ea0.threads - 1, unread: ea0.unread });
    const woke = await until(() => q("inbox:thread", { threadId: s3 }, "eva"), (x: any) => !x.thread.snoozed, 10_000);
    expect(woke.thread).toMatchObject({ status: "open", unreadCount: 1, hasUnread: true });
    // Woken (by time: back as new, unread), it counts again.
    expect(await badge("eva", "ea")).toEqual({ threads: ea0.threads, unread: ea0.unread + 1 });
    expect(await httpBadge("ea")).toMatchObject({ threads: ea0.threads, unread: ea0.unread + 1, snoozed: 0 });
    expect(subjects(await q("inbox:view", { view: "assigned" }, "eva"))[0]).toBe("exact three");
    expect(subjects(await q("inbox:view", { view: "snoozed" }, "eva"))).toEqual(["exact four"]);

    // Members only.
    expect(await refused("query", "inbox:view", { view: "snoozed" }, "stranger")).toMatch(/not a member/);
  });

  it("activity: the thread's timeline with who did each change, for who sees the thread", async () => {
    await stateSetup();
    const t = await threadIn("ea", "timeline");
    const tag = (await mu("inbox:createTag", { mailbox: "ea", name: "Linha" }, "eva")) as string;
    await mu("inbox:addTag", { threadId: t, tag }, "eva");
    await mu("inbox:assign", { threadId: t, userId: "edu" }, "eva");
    await mu("inbox:setStatus", { threadId: t, status: "closed" }, "edu");
    await mu("inbox:setStatus", { threadId: t, status: "open" }, "edu");
    // A reply makes it waiting: its author is the name it was sent with, matched to the member.
    await mu("inbox:reply", { threadId: t, text: "Resolvido." }, "edu");
    await mu("inbox:snooze", { threadId: t, until: Date.now() + 3_600_000 }, "eva");
    await mu("inbox:unsnooze", { threadId: t }, "eva");
    const tl = (await q("inbox:activity", { threadId: t }, "edu")) as any[];
    const brief = tl.filter((e) => e.kind !== "delivery").map((e) => [e.kind, e.actor?.userId ?? null]);
    expect(brief).toEqual([
      ["tag_added", "eva"],
      ["assigned", "eva"],
      ["status", "edu"],
      ["status", "edu"],
      ["status", "edu"],
      ["snoozed", "eva"],
      ["unsnoozed", "eva"],
    ]);
    expect(tl[0]).toMatchObject({ kind: "tag_added", data: { tag, name: "Linha" }, actor: { userId: "eva", name: "Eva" } });
    expect(tl[1]).toMatchObject({ kind: "assigned", data: { from: null, to: "edu", toName: "Edu" } });
    expect(tl[4]).toMatchObject({ kind: "status", data: { from: "open", to: "waiting" }, actor: { userId: "edu", name: "Edu" } });
    expect(tl.find((e) => e.kind === "unsnoozed").data).toMatchObject({ reason: "manual" });
    expect(tl.every((e, i) => i === 0 || e.at >= tl[i - 1].at)).toBe(true);
    expect((await q("inbox:activity", { threadId: t, limit: 2 }, "eva")).length).toBe(2);
    expect(await refused("query", "inbox:activity", { threadId: t }, "eli")).toMatch(/no access/);
    const p = await threadIn("eia", "timeline personal");
    await mu("inbox:setStatus", { threadId: p, status: "closed" }, "eva");
    expect((await q("inbox:activity", { threadId: p }, "eva"))[0]).toMatchObject({ kind: "status", actor: { userId: "eva" } });
    expect(await refused("query", "inbox:activity", { threadId: p }, "edu")).toMatch(/no access/);
  });

  it("scheduled sends and bcc: sendAt on reply, compose and forward; listed, canceled; blind copies kept off headers", async () => {
    await stateSetup();
    const t = await threadIn("ea", "agendado");
    const at = Date.now() + 3_600_000;
    const r = await mu("inbox:reply", { threadId: t, text: "Amanhã cedo.", sendAt: at, bcc: ["chefe@user.test"] }, "edu");
    expect(r.status).toBe("scheduled");
    const list = (await q("inbox:scheduled", { threadId: t }, "eva")) as any[];
    expect(list).toMatchObject([{ emailId: r.emailId, sendAt: at, messageId: r.messageId, author: "Edu" }]);
    const msg = ((await q("inbox:thread", { threadId: t }, "eva")).messages as any[]).find((m) => m._id === r.messageId);
    expect(msg).toMatchObject({ scheduledFor: at, bcc: [{ email: "chefe@user.test" }] });
    expect((await q("inbox:activity", { threadId: t }, "eva")).find((e: any) => e.kind === "scheduled")).toMatchObject({ data: { emailId: r.emailId, sendAt: at }, actor: { userId: "edu" } });
    // Only who sees the thread lists or cancels it.
    expect(await refused("query", "inbox:scheduled", { threadId: t }, "eli")).toMatch(/no access/);
    expect(await refused("mutation", "inbox:cancelScheduled", { emailId: r.emailId }, "eli")).toMatch(/email not found/);
    expect(await refused("mutation", "inbox:cancelScheduled", { emailId: "nope" }, "eva")).toMatch(/email not found/);
    expect(await mu("inbox:cancelScheduled", { emailId: r.emailId }, "eva")).toMatchObject({ ok: true, status: "canceled", messageId: r.messageId });
    expect(await q("inbox:scheduled", { threadId: t }, "eva")).toEqual([]);
    expect(((await q("inbox:thread", { threadId: t }, "eva")).messages as any[]).some((m) => m._id === r.messageId)).toBe(false);
    expect(await mu("inbox:cancelScheduled", { emailId: r.emailId }, "eva")).toEqual({ ok: false, status: "canceled" });
    expect(await refused("mutation", "inbox:reply", { threadId: t, text: "x", sendAt: Date.now() + 400 * 86_400_000 }, "eva")).toMatch(/366 days/);
    // A past sendAt sends now.
    expect((await mu("inbox:reply", { threadId: t, text: "Agora.", sendAt: Date.now() - 60_000 }, "eva")).status).not.toBe("scheduled");

    // A scheduled new conversation canceled: the conversation goes, with the drafts on it.
    const c = await mu("inbox:compose", { mailbox: "ea", to: ["novo@user.test"], subject: "Mais tarde", text: "Oi!", sendAt: at }, "eva");
    expect(c.status).toBe("scheduled");
    await mu("inbox:saveDraft", { kind: "reply", threadId: c.threadId, text: "rascunho" }, "edu");
    expect(await mu("inbox:cancelScheduled", { emailId: c.emailId }, "edu")).toMatchObject({ ok: true, threadDeleted: true });
    expect(await q("inbox:thread", { threadId: c.threadId }, "eva").catch((e) => e.message)).toMatch(/thread not found/);
    expect(await q("inbox:drafts", {}, "edu")).toEqual([]);

    // Bcc: validated like cc; in the email row's envelope (never its headers), kept on the thread's message.
    const b = await mu("inbox:compose", { mailbox: "ea", to: ["ana@user.test"], cc: ["bia@user.test"], bcc: ["oculto@user.test"], subject: "Cópia oculta", text: "Oi." }, "eva");
    const row = (await call("query", "testing:email", { id: b.emailId })).value;
    expect(row).toMatchObject({ bcc: [{ email: "oculto@user.test" }], cc: [{ email: "bia@user.test" }] });
    expect(JSON.stringify(row.headers ?? {})).not.toContain("oculto");
    expect((await q("inbox:thread", { threadId: b.threadId }, "eva")).thread.blind).toEqual(["oculto@user.test"]);
    const many = Array.from({ length: 51 }, (_, i) => `b${i}@user.test`);
    expect(await refused("mutation", "inbox:reply", { threadId: t, text: "x", bcc: many }, "eva")).toMatch(/at most 50 people in blind copy/);
    expect(await refused("mutation", "inbox:compose", { mailbox: "ea", to: ["a@user.test"], cc: many, subject: "s", text: "x" }, "eva")).toMatch(/at most 50 people in copy/);
    expect(await refused("mutation", "inbox:reply", { threadId: t, text: "x", bcc: ["not an address"] }, "eva")).toBeTruthy();
    // Forward takes them too.
    const msgId = ((await q("inbox:thread", { threadId: t }, "eva")).messages as any[]).find((m) => m.direction === "inbound")._id;
    const fw = await mu("inbox:forward", { threadId: t, messageId: msgId, to: ["fin@user.test"], bcc: ["arquivo@user.test"], subject: "Fwd: agendado", text: "Veja.", sendAt: at }, "eva");
    expect(fw.status).toBe("scheduled");
    expect((await call("query", "testing:email", { id: fw.emailId })).value).toMatchObject({ bcc: [{ email: "arquivo@user.test" }] });
  });

  it("presence: who else is viewing or replying on a thread, for who sees it; never oneself", async () => {
    await stateSetup();
    const t = await threadIn("ea", "presença");
    expect(await mu("inbox:setPresence", { threadId: t, state: "viewing" }, "eva")).toBeNull();
    await mu("inbox:setPresence", { threadId: t, state: "replying" }, "edu");
    expect(await q("inbox:presence", { threadId: t }, "eva")).toMatchObject([{ userId: "edu", name: "Edu", state: "replying" }]);
    expect(await q("inbox:presence", { threadId: t }, "edu")).toMatchObject([{ userId: "eva", name: "Eva", state: "viewing" }]);
    expect(await refused("query", "inbox:presence", { threadId: t }, "eli")).toMatch(/no access/);
    expect(await refused("mutation", "inbox:setPresence", { threadId: t, state: "viewing" }, "eli")).toMatch(/no access/);
    expect(await refused("mutation", "inbox:setPresence", { threadId: t, state: "typing" }, "eva")).toBeTruthy();
    await mu("inbox:setPresence", { threadId: t, state: null }, "eva");
    expect(await q("inbox:presence", { threadId: t }, "edu")).toEqual([]);
    const p = await threadIn("eia", "presença pessoal");
    await mu("inbox:setPresence", { threadId: p, state: "viewing" }, "eva");
    expect(await refused("query", "inbox:presence", { threadId: p }, "edu")).toMatch(/no access/);
  });
});
