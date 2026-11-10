// Webhooks: HTTPS endpoints that get the service's events, signed (Standard Webhooks, src/webhooks.ts) and retried.
//
// Events: `email.received` (a new inbound message, from the email component's onInbound hook) and the delivery
// events of sent emails (`email.delivered`, `.delivery_delayed`, `.bounced`, `.complained`, `.failed`, from its
// onEvent hook). A webhook may be limited to one sending project (the API key tenant) and to some mailboxes. Personal
// mailboxes (ember/access.ts) never reach a webhook: neither their inbound mail nor the delivery events of what they
// sent (`mailbox:<name>` projects).
//
// Each event becomes a delivery row per matching webhook (the body is fixed then, so every attempt sends the same
// bytes with a fresh timestamp and signature) and an action that POSTs it. A non-2xx answer, a timeout or a network
// error retries on RETRY_DELAYS_S, then the delivery fails. Deliveries are kept 30 days (crons.ts).
import { anyComponents as components, internalActionGeneric as internalAction, internalMutationGeneric as internalMutation, internalQueryGeneric as internalQuery, v } from "@freecorps/ember-server";
import { checkEndpoint, EVENT_TYPES, MAX_ATTEMPTS, RETRY_DELAYS_S, sign, TIMEOUT_MS, type WebhookEventType } from "../src/webhooks.ts";
import { owners } from "./access.ts";

const email = components.email.lib;
const KEEP_MS = 30 * 86_400_000;

type Db = { query(t: string): any; insert(t: string, d: unknown): string; get(id: string): any; patch(id: string, d: unknown): void; delete(id: string): void; normalizeId(t: string, id: string): string | null };
type MCtx = { db: Db; now: number; scheduler: { runAfter(ms: number, fn: any, args: unknown): string; cancel(id: string): void }; runQuery: any };

export type WebhookDoc = {
  _id: string;
  endpoint: string;
  events: string[];
  secret: string;
  project?: string;
  mailboxes?: string[];
  description?: string;
  enabled: boolean;
  createdAt: number;
  /** Consecutive failed deliveries (reset by a success): the admin screen flags a broken endpoint. */
  failures?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
};

const iso = (t: number) => new Date(t).toISOString();

export function checkEvents(events: string[]): WebhookEventType[] {
  if (!Array.isArray(events) || !events.length) throw new Error("events: at least one event type");
  for (const e of events) if (!(EVENT_TYPES as readonly string[]).includes(e)) throw new Error(`events: unknown type ${e} (one of ${EVENT_TYPES.join(", ")})`);
  return [...new Set(events)] as WebhookEventType[];
}

/** Queues `body` for one webhook and schedules its first attempt. */
function queue(ctx: MCtx, w: WebhookDoc, type: string, body: string) {
  const id = ctx.db.insert("webhookDeliveries", { webhookId: w._id, type, body, status: "pending", attempts: 0, at: ctx.now, nextAt: ctx.now });
  const jobId = ctx.scheduler.runAfter(0, "webhooks:deliver" as any, { id });
  ctx.db.patch(id, { jobId });
  return id;
}

/**
 * Fans an event out to the enabled webhooks that take it. `scope.mailbox`: an inbound message's mailbox;
 * `scope.project`: a sent email's project. Personal mailboxes and their projects never go out.
 */
export function emit(ctx: MCtx, type: WebhookEventType, data: Record<string, unknown>, scope: { mailbox?: string; project?: string }): number {
  const personal = owners(ctx.db);
  if (scope.mailbox && personal.has(scope.mailbox)) return 0;
  if (scope.project?.startsWith("mailbox:") && personal.has(scope.project.slice(8))) return 0;
  const hooks = (ctx.db.query("webhooks").collect() as WebhookDoc[]).filter(
    (w) =>
      w.enabled &&
      w.events.includes(type) &&
      (!w.project || !scope.project || w.project === scope.project) &&
      (!w.mailboxes?.length || !scope.mailbox || w.mailboxes.includes(scope.mailbox)) &&
      // A project filter means "this tenant's emails": inbound mail is no tenant's.
      !(w.project && scope.mailbox && !scope.project),
  );
  if (!hooks.length) return 0;
  const body = JSON.stringify({ type, created_at: iso(ctx.now), data });
  for (const w of hooks) queue(ctx, w, type, body);
  return hooks.length;
}

/** `email.*` delivery event data, Resend-like. */
export function emailEventData(ctx: MCtx, e: { emailId: string; project: string; type: string; status: string; recipient?: string | null; tags?: Record<string, string> }) {
  const doc = ctx.runQuery(email.get, { id: e.emailId }) as { _creationTime: number; from: { email: string; name?: string }; to: Array<{ email: string }>; cc?: Array<{ email: string }>; subject?: string; threadId?: string } | null;
  return {
    email_id: e.emailId,
    project: e.project,
    status: e.status,
    recipient: e.recipient ?? null,
    from: doc ? (doc.from.name ? `${doc.from.name} <${doc.from.email}>` : doc.from.email) : null,
    to: doc ? doc.to.map((x) => x.email) : [],
    cc: doc?.cc?.map((x) => x.email) ?? [],
    subject: doc?.subject ?? null,
    created_at: doc ? iso(doc._creationTime) : null,
    tags: e.tags ?? {},
    ...(doc?.threadId ? { thread_id: doc.threadId } : {}),
  };
}

// ---------------------------------------------------------------------------------------------- delivery

export const load = internalQuery({
  args: { id: v.string() },
  handler: (ctx, a) => {
    const id = ctx.db.normalizeId("webhookDeliveries", a.id);
    const d = id ? (ctx.db.get(id) as any) : null;
    if (!d) return null;
    const w = ctx.db.get(d.webhookId) as WebhookDoc | null;
    return { delivery: { id: d._id as string, body: d.body as string, status: d.status as string }, webhook: w ? { endpoint: w.endpoint, secret: w.secret, enabled: w.enabled } : null };
  },
});

/** One attempt: POST the stored body, signed, within TIMEOUT_MS; the outcome goes to `record`. */
export const deliver = internalAction({
  args: { id: v.string() },
  handler: async (ctx, a) => {
    const r = (await ctx.runQuery("webhooks:load" as any, a)) as { delivery: { id: string; body: string; status: string }; webhook: { endpoint: string; secret: string; enabled: boolean } | null } | null;
    if (!r || r.delivery.status !== "pending") return null;
    if (!r.webhook || !r.webhook.enabled) {
      await ctx.runMutation("webhooks:record" as any, { id: a.id, ok: false, error: r.webhook ? "webhook disabled" : "webhook deleted", final: true });
      return null;
    }
    const ts = Math.floor(Date.now() / 1000);
    const started = Date.now();
    let ok = false;
    let status: number | undefined;
    let error: string | undefined;
    try {
      const res = await fetch(r.webhook.endpoint, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "content-type": "application/json",
          "user-agent": "EmberMail-Webhooks/1",
          "webhook-id": r.delivery.id,
          "webhook-timestamp": String(ts),
          "webhook-signature": await sign(r.webhook.secret, r.delivery.id, ts, r.delivery.body),
        },
        body: r.delivery.body,
      });
      status = res.status;
      ok = res.status >= 200 && res.status < 300;
      if (!ok) error = `HTTP ${res.status}${(await res.text().catch(() => "")).slice(0, 200).replace(/^(.)/, " $1")}`;
      else await res.body?.cancel();
    } catch (e) {
      error = (e as Error)?.name === "TimeoutError" ? `timeout after ${TIMEOUT_MS / 1000} s` : String((e as Error)?.message ?? e).slice(0, 300);
    }
    await ctx.runMutation("webhooks:record" as any, { id: a.id, ok, ...(status !== undefined ? { status } : {}), ...(error ? { error } : {}), ms: Date.now() - started });
    return ok;
  },
});

export const record = internalMutation({
  args: { id: v.string(), ok: v.boolean(), status: v.optional(v.number()), error: v.optional(v.string()), ms: v.optional(v.number()), final: v.optional(v.boolean()) },
  handler: (ctx, a) => {
    const id = ctx.db.normalizeId("webhookDeliveries", a.id);
    const d = id ? (ctx.db.get(id) as any) : null;
    if (!d || d.status !== "pending") return null;
    const attempts = d.attempts + 1;
    const last = { lastAt: ctx.now, ...(a.status !== undefined ? { lastStatus: a.status } : { lastStatus: undefined }), lastError: a.ok ? undefined : a.error, ...(a.ms !== undefined ? { lastMs: a.ms } : {}) };
    const w = ctx.db.get(d.webhookId) as WebhookDoc | null;
    if (a.ok) {
      ctx.db.patch(d._id, { ...last, attempts, status: "succeeded", deliveredAt: ctx.now, jobId: undefined });
      if (w) ctx.db.patch(w._id as any, { failures: 0, lastSuccessAt: ctx.now });
      return "succeeded";
    }
    if (w) ctx.db.patch(w._id as any, { failures: (w.failures ?? 0) + 1, lastFailureAt: ctx.now });
    if (a.final || attempts >= MAX_ATTEMPTS) {
      ctx.db.patch(d._id, { ...last, attempts, status: "failed", jobId: undefined });
      return "failed";
    }
    const delay = RETRY_DELAYS_S[attempts - 1]! * 1000;
    const jobId = ctx.scheduler.runAfter(delay, "webhooks:deliver" as any, { id: d._id });
    ctx.db.patch(d._id, { ...last, attempts, nextAt: ctx.now + delay, jobId });
    return "retry";
  },
});

/** Deletes deliveries older than 30 days (daily, crons.ts): 500 per run, then again while there are more. */
export const prune = internalMutation({
  args: {},
  handler: (ctx) => {
    const old = ctx.db.query("webhookDeliveries").withIndex("by_at", (q) => q.lt("at", ctx.now - KEEP_MS)).take(500) as Array<{ _id: string; status: string; jobId?: string }>;
    for (const d of old) {
      if (d.jobId) ctx.scheduler.cancel(d.jobId);
      ctx.db.delete(d._id as any);
    }
    if (old.length === 500) ctx.scheduler.runAfter(0, "webhooks:prune" as any, {});
    return old.length;
  },
});

// ---------------------------------------------------------------------------------------------- management
// Shared by the HTTP API (full_access keys) and the admin screen (console.ts). Secrets are generated in actions
// (crypto.getRandomValues) and passed in.

export const view = (w: WebhookDoc) => ({
  id: w._id,
  endpoint: w.endpoint,
  events: w.events,
  project: w.project ?? null,
  mailboxes: w.mailboxes ?? [],
  description: w.description ?? null,
  enabled: w.enabled,
  created_at: iso(w.createdAt),
  failures: w.failures ?? 0,
  last_success_at: w.lastSuccessAt ? iso(w.lastSuccessAt) : null,
  last_failure_at: w.lastFailureAt ? iso(w.lastFailureAt) : null,
});

const webhookArgs = {
  endpoint: v.string(),
  events: v.array(v.string()),
  project: v.optional(v.union(v.string(), v.null())),
  mailboxes: v.optional(v.union(v.array(v.string()), v.null())),
  description: v.optional(v.union(v.string(), v.null())),
};

function checkScope(ctx: { db: Db; runQuery: any }, a: { project?: string | null; mailboxes?: string[] | null }) {
  if (a.project && a.project.startsWith("mailbox:") && owners(ctx.db).has(a.project.slice(8))) throw new Error("a personal mailbox's emails never go to a webhook");
  if (a.mailboxes?.length) {
    const personal = owners(ctx.db);
    const known = new Set((ctx.runQuery(email.mailboxes, {}) as Array<{ name: string }>).map((b) => b.name));
    for (const m of a.mailboxes) {
      if (!known.has(m)) throw new Error(`mailbox ${m} not found`);
      if (personal.has(m)) throw new Error(`${m} is a personal mailbox: its mail never goes to a webhook`);
    }
  }
}

export const create = internalMutation({
  args: { ...webhookArgs, secret: v.string() },
  handler: (ctx, a) => {
    const endpoint = checkEndpoint(a.endpoint);
    const events = checkEvents(a.events);
    checkScope(ctx as any, a);
    if ((ctx.db.query("webhooks").collect() as unknown[]).length >= 20) throw new Error("at most 20 webhooks");
    return ctx.db.insert("webhooks", {
      endpoint,
      events,
      secret: a.secret,
      ...(a.project ? { project: a.project } : {}),
      ...(a.mailboxes?.length ? { mailboxes: [...new Set(a.mailboxes)] } : {}),
      ...(a.description?.trim() ? { description: a.description.trim().slice(0, 200) } : {}),
      enabled: true,
      createdAt: ctx.now,
    }) as string;
  },
});

const byId = (ctx: { db: Db }, id: string) => {
  const n = ctx.db.normalizeId("webhooks", id);
  const w = n ? (ctx.db.get(n) as WebhookDoc | null) : null;
  if (!w) throw new Error("webhook not found");
  return w;
};

/** Patch: absent fields keep their value; null clears project, mailboxes and description. */
export const update = internalMutation({
  args: {
    id: v.string(),
    endpoint: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    project: v.optional(v.union(v.string(), v.null())),
    mailboxes: v.optional(v.union(v.array(v.string()), v.null())),
    description: v.optional(v.union(v.string(), v.null())),
    enabled: v.optional(v.boolean()),
    secret: v.optional(v.string()),
  },
  handler: (ctx, a) => {
    const w = byId(ctx as any, a.id);
    checkScope(ctx as any, a);
    ctx.db.patch(w._id as any, {
      ...(a.endpoint !== undefined ? { endpoint: checkEndpoint(a.endpoint) } : {}),
      ...(a.events !== undefined ? { events: checkEvents(a.events) } : {}),
      ...(a.project !== undefined ? { project: a.project || undefined } : {}),
      ...(a.mailboxes !== undefined ? { mailboxes: a.mailboxes?.length ? [...new Set(a.mailboxes)] : undefined } : {}),
      ...(a.description !== undefined ? { description: a.description?.trim().slice(0, 200) || undefined } : {}),
      ...(a.enabled !== undefined ? { enabled: a.enabled, ...(a.enabled ? { failures: 0 } : {}) } : {}),
      ...(a.secret !== undefined ? { secret: a.secret } : {}),
    });
    return view(ctx.db.get(w._id as any) as WebhookDoc);
  },
});

/** Deletes a webhook and its deliveries (pending attempts are canceled). */
export const remove = internalMutation({
  args: { id: v.string() },
  handler: (ctx, a) => {
    const w = byId(ctx as any, a.id);
    for (const d of ctx.db.query("webhookDeliveries").withIndex("by_webhook", (q) => q.eq("webhookId", w._id)).take(1000) as Array<{ _id: string; jobId?: string }>) {
      if (d.jobId) ctx.scheduler.cancel(d.jobId);
      ctx.db.delete(d._id as any);
    }
    ctx.db.delete(w._id as any);
    return true;
  },
});

export const list = internalQuery({ args: {}, handler: (ctx) => (ctx.db.query("webhooks").collect() as WebhookDoc[]).sort((a, b) => a.createdAt - b.createdAt).map(view) });
export const get = internalQuery({ args: { id: v.string() }, handler: (ctx, a) => ({ ...view(byId(ctx as any, a.id)), signing_secret: byId(ctx as any, a.id).secret }) });

export const deliveries = internalQuery({
  args: { id: v.string(), limit: v.optional(v.number()) },
  handler: (ctx, a) => {
    const w = byId(ctx as any, a.id);
    return (ctx.db.query("webhookDeliveries").withIndex("by_webhook", (q) => q.eq("webhookId", w._id)).order("desc").take(Math.min(100, a.limit ?? 50)) as any[]).map((d) => ({
      id: d._id as string,
      type: d.type as string,
      status: d.status as "pending" | "succeeded" | "failed",
      attempts: d.attempts as number,
      created_at: iso(d.at),
      next_attempt_at: d.status === "pending" ? iso(d.nextAt) : null,
      last_attempt_at: d.lastAt ? iso(d.lastAt) : null,
      last_status: (d.lastStatus ?? null) as number | null,
      last_error: (d.lastError ?? null) as string | null,
      duration_ms: (d.lastMs ?? null) as number | null,
    }));
  },
});

/** A `webhook.test` event to this webhook only (whatever its event types), to check the endpoint and the secret. */
export const test = internalMutation({
  args: { id: v.string() },
  handler: (ctx, a) => {
    const w = byId(ctx as any, a.id);
    const body = JSON.stringify({ type: "webhook.test", created_at: iso(ctx.now), data: { webhook_id: w._id, message: "A test event from Ember Mail." } });
    return queue(ctx as any, w, "webhook.test", body);
  },
});

/** Sends a delivery again, as it was (same id and body), from the first attempt. */
export const redeliver = internalMutation({
  args: { id: v.string() },
  handler: (ctx, a) => {
    const n = ctx.db.normalizeId("webhookDeliveries", a.id);
    const d = n ? (ctx.db.get(n) as any) : null;
    if (!d) throw new Error("delivery not found");
    if (d.jobId) ctx.scheduler.cancel(d.jobId);
    const jobId = ctx.scheduler.runAfter(0, "webhooks:deliver" as any, { id: d._id });
    ctx.db.patch(d._id, { status: "pending", attempts: 0, nextAt: ctx.now, jobId });
    return true;
  },
});
