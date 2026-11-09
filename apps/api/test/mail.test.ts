// The mail app on workerd (Miniflare): the SDK against the HTTP API (keys, idempotency, sends through the simulated
// send_email binding), Email Service events through the component's real local queue, inbound mail through the
// Worker's email() handler (postal-mime, attachments in R2, threads, auto-reply, push hook), the inbox API and the
// members-only reactive queries.
import { createExecutionContext, createMessageBatch, env, getQueueResult, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { EmberMail } from "@freecorps/mail-sdk";
import worker from "./worker.ts";
import { removeDomain, resolveAccountId } from "../src/operator.ts";

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
    expect((await call("mutation", "inbox:generateUploadUrl", { size: -1 }, "user:agent-1")).error.message).toMatch(/non-negative/);
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

  it("members: POST /inbox/members is a patch (absent fields keep their stored value)", async () => {
    const member = async () => (await call("mutation", "testing:member", { userId: "boss-1" })).value;
    const names = async () => (await call("query", "inbox:mailboxes", {}, "user:boss-1")).value.map((b: any) => b.name).sort();
    expect((await admin.inbox.addMember({ user_id: "boss-1", mailboxes: ["support"], name: "Boss", admin: true })).error).toBeNull();
    expect(await names()).toEqual(["privacy", "support"]); // admin: every mailbox
    // Changing only the mailboxes keeps admin and the name.
    expect((await admin.inbox.addMember({ user_id: "boss-1", mailboxes: ["privacy"] })).error).toBeNull();
    expect(await member()).toMatchObject({ name: "Boss", admin: true, mailboxes: ["privacy"] });
    expect(await names()).toEqual(["privacy", "support"]);
    // admin: false revokes; mailboxes absent are kept; name: null clears.
    expect((await admin.inbox.addMember({ user_id: "boss-1", admin: false, name: null })).error).toBeNull();
    expect(await member()).toMatchObject({ admin: false, mailboxes: ["privacy"] });
    expect((await member()).name).toBeUndefined();
    expect(await names()).toEqual(["privacy"]);
  });
});
