import { describe, expect, test } from "vitest";
import { EmberMail } from "../src/index.ts";

function fake(status = 200, reply: unknown = { id: "e1" }) {
  const calls: Array<{ url: string; method: string; headers: Headers; body: any }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method!, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(reply, { status });
  }) as typeof fetch;
  return { calls, f };
}

describe("EmberMail", () => {
  test("emails.send: bearer key, Idempotency-Key, Resend aliases, bytes attachments as base64", async () => {
    const { calls, f } = fake();
    const mail = new EmberMail("em_x", { baseUrl: "https://mail.test/", fetch: f });
    const r = await mail.emails.send(
      { from: "a@acme.test", to: ["b@x.test"], subject: "s", html: "<p>h</p>", replyTo: "r@acme.test", scheduledAt: new Date("2026-12-01T00:00:00Z"), attachments: [{ filename: "a.txt", content: new TextEncoder().encode("hi") }] },
      { idempotencyKey: "k1" },
    );
    expect(r).toEqual({ data: { id: "e1" }, error: null });
    expect(calls[0]!.url).toBe("https://mail.test/emails");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer em_x");
    expect(calls[0]!.headers.get("idempotency-key")).toBe("k1");
    expect(calls[0]!.body).toEqual({ from: "a@acme.test", to: ["b@x.test"], subject: "s", html: "<p>h</p>", reply_to: "r@acme.test", scheduled_at: "2026-12-01T00:00:00.000Z", attachments: [{ filename: "a.txt", content: "aGk=" }] });
  });

  test("errors come back as { data: null, error } (never thrown)", async () => {
    const { f } = fake(422, { statusCode: 422, name: "validation_error", message: "to is required" });
    const mail = new EmberMail("em_x", { baseUrl: "https://mail.test", fetch: f });
    expect(await mail.emails.get("nope")).toEqual({ data: null, error: { statusCode: 422, name: "validation_error", message: "to is required", outcome: "not_sent", retryable: false } });
    const down = new EmberMail("em_x", { baseUrl: "https://mail.test", retries: 0, fetch: (async () => { throw new Error("offline"); }) as typeof fetch });
    expect((await down.domains.list()).error).toMatchObject({ name: "network_error", message: "offline", outcome: "unknown", retryable: true });
  });

  test("paths of the other resources", async () => {
    const { calls, f } = fake(200, {});
    const mail = new EmberMail("em_x", { baseUrl: "https://mail.test", fetch: f });
    await mail.batch.send([{ from: "a@acme.test", to: "b@x.test", subject: "s", text: "t" }]);
    await mail.domains.verify("d 1", { enable_routing: true });
    await mail.inbox.threads({ mailbox: "support", status: "open", limit: 10 });
    await mail.inbox.reply("t1", "thanks");
    await mail.apiKeys.remove("k1");
    expect(calls[0]!.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{32,36}$/); // made up for the batch
    expect(calls.map((c) => `${c.method} ${c.url.slice("https://mail.test".length)}`)).toEqual([
      "POST /emails/batch",
      "POST /domains/d%201/verify",
      "GET /inbox/threads?mailbox=support&status=open&limit=10",
      "POST /inbox/threads/t1/reply",
      "DELETE /api-keys/k1",
    ]);
  });

  test("sends retry a server error or no answer with the same idempotency key; a refusal (4xx) is not retried", async () => {
    const keys: string[] = [];
    let n = 0;
    const flaky = (async (_u: string, init: RequestInit) => {
      keys.push(new Headers(init.headers).get("idempotency-key")!);
      n++;
      if (n === 1) throw new Error("reset");
      if (n === 2) return Response.json({ message: "busy" }, { status: 503 });
      return Response.json({ id: "e9" });
    }) as typeof fetch;
    const mail = new EmberMail("em_x", { baseUrl: "https://mail.test", fetch: flaky });
    expect(await mail.emails.send({ from: "a@acme.test", to: "b@x.test", subject: "s", text: "t" })).toEqual({ data: { id: "e9" }, error: null });
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);

    const { calls, f } = fake(403, { statusCode: 403, name: "invalid_from_address", message: "no" });
    const refused = await new EmberMail("em_x", { baseUrl: "https://mail.test", fetch: f }).emails.send({ from: "a@else.test", to: "b@x.test", subject: "s", text: "t" });
    expect(refused.error).toMatchObject({ statusCode: 403, outcome: "not_sent", retryable: false });
    expect(calls).toHaveLength(1);
    // A write without an idempotency key is never retried (it could run twice).
    let posts = 0;
    const once = new EmberMail("em_x", { baseUrl: "https://mail.test", fetch: (async () => (posts++, Response.json({}, { status: 503 }))) as typeof fetch });
    expect((await once.suppressions.add("x@y.test")).error).toMatchObject({ outcome: "unknown", retryable: true });
    expect(posts).toBe(1);
  });

  test("timeout and abort: no answer in time is `timeout` (outcome unknown); an aborted call stops its retries", async () => {
    const hang = (async (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const mail = new EmberMail("em_x", { baseUrl: "https://mail.test", fetch: hang, retries: 0 });
    expect((await mail.emails.get("e1", { timeoutMs: 20 })).error).toMatchObject({ name: "timeout", statusCode: 0, outcome: "unknown" });
    const ctl = new AbortController();
    const p = mail.emails.send({ from: "a@acme.test", to: "b@x.test", subject: "s", text: "t" }, { signal: ctl.signal });
    ctl.abort();
    expect((await p).error).toMatchObject({ name: "aborted", retryable: false });
  });

  test("emails.list: filters in the query string; emails.waitFor polls until sent, delivered or a failure", async () => {
    const { calls, f } = fake(200, { object: "list", data: [], has_more: false, next_cursor: null });
    const mail = new EmberMail("em_x", { baseUrl: "https://mail.test", fetch: f });
    await mail.emails.list({ status: "bounced", tag: "order:42", to: "b@x.test", since: new Date("2026-11-01T00:00:00Z"), limit: 50, cursor: "c1" });
    expect(calls[0]!.url).toBe("https://mail.test/emails?status=bounced&tag=order%3A42&to=b%40x.test&since=2026-11-01T00%3A00%3A00.000Z&limit=50&cursor=c1");

    const seq = ["queued", "sending", "delivered"];
    let i = 0;
    const polling = new EmberMail("em_x", { baseUrl: "https://mail.test", fetch: (async () => Response.json({ id: "e1", last_event: seq[Math.min(i++, seq.length - 1)] })) as typeof fetch });
    expect((await polling.emails.waitFor("e1", { until: ["delivered"], intervalMs: 5 })).data).toMatchObject({ last_event: "delivered" });
    i = 0;
    const bounced = ["queued", "bounced"];
    const failing = new EmberMail("em_x", { baseUrl: "https://mail.test", fetch: (async () => Response.json({ id: "e2", last_event: bounced[Math.min(i++, 1)] })) as typeof fetch });
    expect((await failing.emails.waitFor("e2", { intervalMs: 5 })).data).toMatchObject({ last_event: "bounced" });
    const stuck = new EmberMail("em_x", { baseUrl: "https://mail.test", fetch: (async () => Response.json({ id: "e3", last_event: "queued" })) as typeof fetch });
    expect((await stuck.emails.waitFor("e3", { timeoutMs: 30, intervalMs: 5 })).error).toMatchObject({ name: "timeout", message: expect.stringMatching(/queued/) });
  });
});
