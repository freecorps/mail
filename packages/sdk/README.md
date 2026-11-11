# @freecorps/mail-sdk

A typed client for Ember Mail: the self-hosted email service in [`apps/api`](../../apps/api) of
[freecorps/mail](https://github.com/freecorps/mail), built on [Ember](https://github.com/freecorps/ember). The service
runs in your own Cloudflare account. The SDK works like Resend's: every call resolves to `{ data, error }` and never
throws for an API error, so code written for Resend ports by changing the import and the base URL.

```sh
npm install @freecorps/mail-sdk
```

```ts
import { EmberMail } from "@freecorps/mail-sdk";

const mail = new EmberMail(process.env.MAIL_API_KEY!, { baseUrl: process.env.MAIL_API_URL! });

const { data, error } = await mail.emails.send({
  from: "Acme <hello@acme.com>",
  to: "ana@example.com",
  subject: "Welcome",
  html: "<p>Hi Ana</p>",
  text: "Hi Ana",
  tags: [{ name: "order", value: "42" }],
  attachments: [{ filename: "invoice.pdf", content: pdfBytes /* Uint8Array or base64 */ }],
});
```

## Sending, and knowing what happened

`send` queues the email: `{ id }` means the service accepted it, not that it was delivered. To know more:

```ts
await mail.emails.get(id);                                   // last_event: queued → sent → delivered | bounced | ...
await mail.emails.waitFor(id);                               // resolves once sent (or delivered, or failed)
await mail.emails.waitFor(id, { until: ["delivered"], timeoutMs: 60_000 });
await mail.emails.list({ tag: "order:42" });                 // newest first; also status, to, since, until, limit
await mail.emails.events(id);                                // the delivery events (delivered, bounced with reason…)
```

`waitFor` suits a flow that must know an email went out before it answers its user, such as a sign-in code. It
checks every second, resolves with the email once it reaches `until` (default: `sent` or `delivered`) or fails
(`FAILED_STATUSES`: bounced, failed, complained, canceled, suppressed), and resolves with a `timeout` error after
`timeoutMs`.

## Errors and retries

A failed call resolves to `{ data: null, error }`:

| field        | meaning                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `statusCode` | the HTTP status, or 0 with no answer (`network_error`, `timeout`, `aborted`)                          |
| `name`       | `validation_error`, `invalid_from_address`, `restricted_api_key`, `rate_limit_exceeded`, …           |
| `outcome`    | `not_sent`: the API refused it (4xx), nothing went out. `unknown`: it may have gone out              |
| `retryable`  | network error, timeout, 429 or 5xx                                                                   |

The client retries a retryable error itself (`retries`, default 2, with backoff and `Retry-After`). Reads are always
retried. A write is retried only with an idempotency key, so a retry never sends twice. `send` and `batch.send` make a
key up per call when you don't pass one. Pass your own `idempotencyKey` (an order id, an OTP id) to make retries
safe across calls too: the service returns the first email for a key it has seen. After an `unknown` error, retry
with the same key, never a new one.

```ts
const mail = new EmberMail(key, { baseUrl, timeoutMs: 15_000, retries: 3, fetch: globalThis.fetch });
await mail.emails.send(email, { idempotencyKey: `order/${order.id}`, signal: AbortSignal.timeout(20_000) });
```

## Webhooks

A webhook gets the service's events as signed POSTs (Standard Webhooks, the same scheme as Svix and Resend), retried
for about a day and a half when the endpoint does not answer 2xx. Create one with a `full_access` key (or in the web
app's admin screen) and keep its `signing_secret`:

```ts
const { data } = await mail.webhooks.create({
  endpoint: "https://app.example.com/hooks/mail",
  events: ["email.received", "email.delivered", "email.bounced"],
  project: "app",            // optional: only this project's delivery events (then no email.received)
  mailboxes: ["support"],    // optional: only these mailboxes' email.received
});
// data.signing_secret: "whsec_…"
```

Verify each request with the raw body, before parsing it:

```ts
import { verifyWebhook, WebhookVerificationError } from "@freecorps/mail-sdk";

export async function POST(req: Request) {
  try {
    const event = await verifyWebhook({ secret: process.env.MAIL_WEBHOOK_SECRET!, headers: req.headers, body: await req.text() });
    if (event.type === "email.received") { /* event.data.thread_id, .mailbox, .from, .subject, .snippet */ }
    return new Response("ok");
  } catch (e) {
    if (e instanceof WebhookVerificationError) return new Response("bad signature", { status: 400 });
    throw e;
  }
}
```

`webhook-id` is the same on every retry of a delivery: use it to ignore one you already handled.

| Event | `data` |
| --- | --- |
| `email.received` | `mailbox`, `thread_id`, `message_id`, `number`, `new_thread`, `status`, `from` (`{ email, name? }`), `subject`, `snippet`, `auto_submitted`. Spam is not sent |
| `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed` | `email_id`, `project`, `status`, `recipient`, `from`, `to`, `cc`, `subject`, `created_at`, `tags`, `thread_id` (a reply from the inbox) |
| `webhook.test` | `webhook_id`, `message` (from `webhooks.test(id)`) |

Personal mailboxes never reach a webhook: neither their mail nor the delivery events of what they send. Also:
`webhooks.list()`, `get(id)`, `update(id, { enabled: false, … })`, `remove(id)`, `rotateSecret(id)`,
`deliveries(id)` and `retry(deliveryId)`.

## The rest of the API

```ts
await mail.batch.send([{ ... }, { ... }]);                    // up to 100
await mail.emails.cancel(id);                                 // a scheduled email (scheduled_at)
await mail.templates.create({ name: "welcome", subject: "Welcome {{name}}", html: "<p>Hi {{name}}</p>" });
await mail.emails.send({ from: "hello@acme.com", to: "bo@example.com", template: { name: "welcome", data: { name: "Bo" } } });
await mail.suppressions.add("gone@example.com");
await mail.domains.create({ name: "mail.acme.com" });         // DNS records to check, then domains.verify(id)
await mail.apiKeys.create({ name: "app", permission: "sending_access", project: "app", domain: "acme.com" });
await mail.inbox.threads({ mailbox: "support", status: "open" });  // snoozed threads are left out
await mail.inbox.threads({ mailbox: "support", snoozed: true });   // only the snoozed ones, soonest to wake first
await mail.inbox.sent({ mailbox: "support" });                // what it sent, newest first; `next` goes on as `before`
```

A key is scoped to a project (its emails, suppressions and templates) and optionally to one sending domain.

It has no dependencies and runs on Node 20+, Cloudflare Workers, Convex actions, Deno, Bun and browsers (pass
`fetch` when your runtime's is not the global one). License: MIT.
