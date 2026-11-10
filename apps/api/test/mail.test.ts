// The mail app on workerd (Miniflare): the SDK against the HTTP API (keys, idempotency, sends through the simulated
// send_email binding), Email Service events through the component's real local queue, inbound mail through the
// Worker's email() handler (postal-mime, attachments in R2, threads, auto-reply, push hook), the inbox API and the
// members-only reactive queries.
import { createExecutionContext, createMessageBatch, env, getQueueResult, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { EmberMail } from "@freecorps/mail-sdk";
import worker from "./worker.ts";
import { addDomain, removeDomain, resolveAccountId } from "../src/operator.ts";

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

const call = async (kind: "query" | "mutation", fn: string, args: unknown, token?: string) => {
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
    expect(box.find((b) => b.name === "wolf")).toEqual({ name: "wolf", address: "wolf@acme.test", display_name: "Wolf", owner: "wolf", catch_all: false });
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
    expect((await call("query", "inbox:search", { query: "lunch" }, "user:wolf")).value).toMatchObject([{ threadId: t._id }]);
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
});
