// Resend-compatible-ish HTTP API (same paths and shapes where they overlap, so Resend's DX carries over):
//
//   POST   /emails                 { from, to, subject, html?, text?, cc?, bcc?, reply_to?, headers?, attachments?,
//                                     tags?, scheduled_at?, template?: { name, data } }   Idempotency-Key header
//   POST   /emails/batch           [ ...same ]
//   GET    /emails/:id             POST /emails/:id/cancel
//   GET    /domains                POST /domains { name, receiving?, sending? }
//   GET    /domains/:id            POST /domains/:id/verify { enable_routing? }   DELETE /domains/:id
//   POST   /domains/import         POST /domains/:id/forget (record only; for scripts/domains.ts)
//   GET    /emails?status=&tag=name:value&to=&since=&until=&limit=&cursor=&project=
//   GET    /api-keys               POST /api-keys { name, permission?, project?, domain? }   DELETE /api-keys/:id
//   GET    /templates              POST /templates { name, subject, html, text?, layout? }   DELETE /templates/:name
//   POST   /suppressions { email } DELETE /suppressions/:email
//   GET    /inbox/mailboxes        POST /inbox/mailboxes { name, address, display_name?, auto_reply?, owner?, catch_all?, retention? }
//   GET    /inbox/threads?mailbox=&status=&cursor=   GET /inbox/threads/:id   POST /inbox/threads/:id/reply { text }
//   GET    /inbox/search?q=&mailbox=                  POST /inbox/members { user_id, mailboxes, admin? }
//   DELETE /inbox/threads/:id (full_access: the conversation, its messages and files, for good)
//   GET    /inbox/sent?mailbox=&before=&limit=     GET /inbox/members (members + access requests)
//   GET    /webhooks               POST /webhooks { endpoint, events, project?, mailboxes?, description? } → signing_secret
//   GET    /webhooks/:id (no secret: create and rotate return it)   PATCH /webhooks/:id { endpoint?, events?, project?, mailboxes?, description?, enabled? }
//   DELETE /webhooks/:id           POST /webhooks/:id/rotate | /test     GET /webhooks/:id/deliveries
//   POST   /webhooks/deliveries/:id/retry
//
// Auth: `Authorization: Bearer em_...` (API keys, hashed at rest) or the Worker's EMBER_ADMIN_TOKEN (bootstrap).
import { anyComponents as components, httpActionGeneric as httpAction, httpRouter, type ActionCtx } from "@freecorps/ember-server";
import { parseAddress, domainOf, type SendInput } from "@freecorps/ember-email";
import { isDomainName } from "@freecorps/ember-email/cloudflare";
import { ApiError, authenticate, body, errorResponse, iso, json, need, newToken, parseWhen, sha256Hex, type Principal } from "../src/api.ts";
import { newSecret } from "../src/webhooks.ts";

const email = components.email.lib;
const http = httpRouter();

/** The personal mailboxes and their owners (ember/access.ts): no key reads or answers them. */
const personalMailboxes = async (ctx: ActionCtx) => (await ctx.runQuery("access:personalMailboxes" as any, {})) as Record<string, string>;
const notPersonal = (personal: Record<string, string>, mailbox: string) => {
  if (Object.hasOwn(personal, mailbox)) throw new ApiError(403, "personal_mailbox", "A personal mailbox is read only in its owner's inbox");
};

type Handler = (ctx: ActionCtx, request: Request, p: Principal, url: URL) => Promise<Response>;
const route = (h: Handler) =>
  httpAction(async (ctx, request) => {
    try {
      const p = await authenticate(request, ctx.env, (hash) => ctx.runQuery("keys:byHash" as any, { hash }) as Promise<any>);
      return await h(ctx, request, p, new URL(request.url));
    } catch (e) {
      return errorResponse(e);
    }
  });
/** `?limit=`: absent → `fallback`; a positive integer, capped at 100; anything else is a 422 (never NaN downstream). */
const pageLimit = (url: URL, fallback: number) => {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(422, "validation_error", "limit must be a positive integer");
  return Math.min(100, n);
};
const tail = (url: URL, prefix: string) => decodeURIComponent(url.pathname.slice(prefix.length)).split("/").filter(Boolean);

// ------------------------------------------------------------------------------------------------ emails

type ResendEmail = {
  from: string;
  to: string | string[];
  subject?: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string | string[];
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; content?: string; content_type?: string; content_id?: string }>;
  tags?: Array<{ name: string; value: string }>;
  scheduled_at?: string | number;
  template?: { name?: string; id?: string; data?: unknown; variables?: unknown };
};

async function toSendInput(ctx: ActionCtx, p: Principal, e: ResendEmail, key?: string): Promise<SendInput> {
  if (!e || typeof e !== "object") throw new ApiError(422, "validation_error", "each email must be an object");
  if (typeof e.from !== "string" && typeof e.from !== "object") throw new ApiError(422, "missing_required_field", "from is required");
  if (!e.to) throw new ApiError(422, "missing_required_field", "to is required");
  const fromDomain = domainOf(parseAddress(e.from as string).email);
  if (p.domain && fromDomain !== p.domain) throw new ApiError(403, "invalid_from_address", `This API key can only send from ${p.domain}`);
  const d = (await ctx.runQuery("domains:get" as any, { name: fromDomain })) as { sending: boolean; status: string } | null;
  if (!d || !d.sending || d.status === "failed") throw new ApiError(403, "invalid_from_address", `The ${fromDomain} domain is not set up for sending (POST /domains)`);
  const attachments: NonNullable<SendInput["attachments"]> = [];
  for (const a of e.attachments ?? []) {
    if (!a?.filename || typeof a.content !== "string") throw new ApiError(422, "validation_error", "attachments need filename and base64 content");
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(a.content), (c) => c.charCodeAt(0));
    } catch {
      throw new ApiError(422, "validation_error", `attachment ${a.filename}: content must be base64`);
    }
    const contentType = a.content_type ?? "application/octet-stream";
    const file = await ctx.storage.store(bytes, { contentType });
    attachments.push({ filename: a.filename, contentType, file, ...(a.content_id ? { contentId: a.content_id, inline: true } : {}) });
  }
  const replyTo = Array.isArray(e.reply_to) ? e.reply_to[0] : e.reply_to;
  const sendAt = parseWhen(e.scheduled_at);
  const tpl = e.template ? { name: e.template.name ?? e.template.id ?? "", data: e.template.data ?? e.template.variables ?? {} } : undefined;
  return {
    project: p.project,
    from: e.from,
    to: e.to,
    ...(e.cc ? { cc: e.cc } : {}),
    ...(e.bcc ? { bcc: e.bcc } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(e.subject !== undefined ? { subject: e.subject } : {}),
    ...(e.html !== undefined ? { html: e.html } : {}),
    ...(e.text !== undefined ? { text: e.text } : {}),
    ...(e.headers ? { headers: e.headers } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(e.tags?.length ? { tags: Object.fromEntries(e.tags.map((t) => [t.name, t.value])) } : {}),
    ...(sendAt ? { sendAt } : {}),
    ...(tpl ? { template: tpl } : {}),
    ...(key ? { idempotencyKey: key } : {}),
  };
}

const idemKey = (request: Request) => {
  const k = request.headers.get("idempotency-key");
  if (k !== null && (!k || k.length > 256)) throw new ApiError(422, "invalid_idempotency_key", "Idempotency-Key must be 1-256 characters");
  return k ?? undefined;
};

http.route({
  path: "/emails",
  method: "POST",
  handler: route(async (ctx, request, p) => {
    need(p, "sending_access");
    const input = await toSendInput(ctx, p, await body<ResendEmail>(request), idemKey(request));
    const r = (await ctx.runMutation(email.send, input)) as { id: string; duplicate?: true };
    return json({ id: r.id }, 200, r.duplicate ? { "idempotent-replayed": "true" } : {});
  }),
});

http.route({
  path: "/emails/batch",
  method: "POST",
  handler: route(async (ctx, request, p) => {
    need(p, "sending_access");
    const list = await body<ResendEmail[]>(request);
    if (!Array.isArray(list) || !list.length || list.length > 100) throw new ApiError(422, "validation_error", "the body must be an array of 1 to 100 emails");
    const key = idemKey(request);
    const inputs = [];
    for (const [i, e] of list.entries()) inputs.push(await toSendInput(ctx, p, e, key ? `${key}#${i}` : undefined));
    const r = (await ctx.runMutation(email.sendBatch, { emails: inputs })) as Array<{ id: string }>;
    return json({ data: r.map((x) => ({ id: x.id })) });
  }),
});

const emailView = (e: any) => ({
  object: "email",
  id: e._id,
  to: e.to.map((a: any) => a.email),
  from: e.from.name ? `${e.from.name} <${e.from.email}>` : e.from.email,
  created_at: iso(e._creationTime),
  subject: e.subject,
  html: e.html ?? null,
  text: e.text ?? null,
  cc: (e.cc ?? []).map((a: any) => a.email),
  bcc: (e.bcc ?? []).map((a: any) => a.email),
  reply_to: e.replyTo ? [e.replyTo.email] : null,
  last_event: e.status,
  /** Email Service's message id (what delivery events refer to). */
  message_id: e.messageId ?? null,
  scheduled_at: e.status === "scheduled" ? iso(e.sendAt) : null,
  tags: e.tags ? Object.entries(e.tags).map(([name, value]) => ({ name, value })) : [],
  ...(e.error ? { error: e.error } : {}),
});

// The project's emails, newest first, filtered (status, tag, recipient, time). Filters apply over pages of the project's
// emails, so a page can come back with fewer than `limit` items and still a `next_cursor`: keep going until it is null.
const LIST_SCAN_PAGES = 20;
http.route({
  path: "/emails",
  method: "GET",
  handler: route(async (ctx, _r, p, url) => {
    need(p, "sending_access");
    const q = url.searchParams;
    const project = q.get("project") && p.permission === "full_access" ? q.get("project")! : p.project;
    const limit = pageLimit(url, 20);
    const status = q.get("status");
    const to = q.get("to")?.trim().toLowerCase() || null;
    const tag = q.get("tag");
    const [tagName, tagValue] = tag ? [tag.slice(0, tag.indexOf(":") < 0 ? tag.length : tag.indexOf(":")), tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : null] : [null, null];
    const when = (k: string) => {
      const raw = q.get(k);
      if (!raw) return null;
      const t = Date.parse(raw);
      if (!Number.isFinite(t)) throw new ApiError(422, "validation_error", `${k} must be an ISO 8601 date`);
      return t;
    };
    const since = when("since");
    const until = when("until");
    const keep = (e: any) =>
      (!p.domain || domainOf(e.from.email) === p.domain) &&
      (!status || e.status === status) &&
      (!to || [...e.to, ...(e.cc ?? []), ...(e.bcc ?? [])].some((a: any) => a.email.toLowerCase() === to)) &&
      (!tagName || (e.tags && Object.hasOwn(e.tags, tagName) && (tagValue === null || e.tags[tagName] === tagValue))) &&
      (since === null || e._creationTime >= since) &&
      (until === null || e._creationTime < until);
    const data: unknown[] = [];
    let cursor: string | null = q.get("cursor");
    let done = false;
    // Each read asks for at most the items still missing, so a page is never cut midway (the cursor would skip the rest).
    for (let i = 0; i < LIST_SCAN_PAGES && data.length < limit && !done; i++) {
      const page = (await ctx.runQuery(email.list, { project, paginationOpts: { numItems: limit - data.length, cursor } })) as { page: any[]; isDone: boolean; continueCursor: string };
      for (const e of page.page) {
        // Newest first: past `since`, nothing older can match.
        if (since !== null && e._creationTime < since) {
          done = true;
          break;
        }
        if (keep(e)) data.push(emailView(e));
      }
      cursor = page.continueCursor;
      done ||= page.isDone;
    }
    return json({ object: "list", data, has_more: !done, next_cursor: done ? null : cursor });
  }),
});

http.route({
  pathPrefix: "/emails/",
  method: "GET",
  handler: route(async (ctx, _request, p, url) => {
    need(p, "sending_access");
    const [id, sub] = tail(url, "/emails/");
    const e = id ? ((await ctx.runQuery(email.get, { id })) as any) : null;
    if (!e || (e.project !== p.project && p.permission !== "full_access")) throw new ApiError(404, "not_found", "Email not found");
    if (sub === "events") {
      const evs = (await ctx.runQuery(email.events, { id: e._id })) as any[];
      return json({ data: evs.map((x) => ({ id: x.eventId, type: x.type, recipient: x.recipient ?? null, at: iso(x.at), received_at: iso(x.receivedAt), terminal: x.terminal, reason: x.reason ?? null, bounce_type: x.bounceType ?? null, smtp_status: x.smtpStatus ?? null, duplicates: x.duplicates ?? 0 })) });
    }
    if (sub) throw new ApiError(404, "not_found", "Not found");
    return json(emailView(e));
  }),
});

http.route({
  pathPrefix: "/emails/",
  method: "POST",
  handler: route(async (ctx, _request, p, url) => {
    need(p, "sending_access");
    const [id, action] = tail(url, "/emails/");
    if (action !== "cancel" || !id) throw new ApiError(404, "not_found", "Not found");
    const e = (await ctx.runQuery(email.get, { id })) as any;
    if (!e || (e.project !== p.project && p.permission !== "full_access")) throw new ApiError(404, "not_found", "Email not found");
    const r = (await ctx.runMutation(email.cancel, { id: e._id })) as { ok: boolean; status: string };
    if (!r.ok) throw new ApiError(422, "validation_error", `Email is ${r.status} and cannot be canceled`);
    return json({ object: "email", id: e._id });
  }),
});

// ------------------------------------------------------------------------------------------------ domains

const domainView = (d: any) => ({
  object: "domain",
  id: d._id,
  name: d.name,
  status: d.status,
  created_at: iso(d.createdAt),
  capabilities: { sending: d.sending ? "enabled" : "disabled", receiving: d.receiving ? "enabled" : "disabled" },
  records: d.records.map((r: any) => ({ record: r.purpose === "receiving" ? "Receiving" : "Sending", type: r.type, name: r.name, value: r.value, ttl: r.ttl === 1 || !r.ttl ? "Auto" : String(r.ttl), ...(r.priority !== undefined ? { priority: r.priority } : {}) })),
  routing_status: d.routingStatus ?? null,
  /** What onboarding created in Cloudflare (ids only): removed with the domain. */
  cloudflare: { zone_id: d.zoneId ?? null, sending_tag: d.sendingTag ?? null, rule_ids: d.ruleIds, subscription_id: d.subscriptionId ?? null, created_sending: !!d.createdSending, catch_all: d.catchAll ?? null },
  notes: d.notes,
});

http.route({
  path: "/domains",
  method: "GET",
  handler: route(async (ctx, _r, p) => {
    need(p);
    return json({ data: ((await ctx.runQuery("domains:list" as any, {})) as any[]).map(domainView) });
  }),
});
http.route({
  path: "/domains",
  method: "POST",
  handler: route(async (ctx, request, p) => {
    need(p);
    const b = await body<{ name?: string; sending?: boolean; receiving?: boolean; enable_routing?: boolean }>(request);
    if (typeof b.name !== "string") throw new ApiError(422, "missing_required_field", "name is required");
    // Checked here: an error thrown inside the domains:sync action reaches us as an ActionCallError (no status).
    if (!isDomainName(b.name.toLowerCase())) throw new ApiError(422, "validation_error", `Invalid domain name ${JSON.stringify(b.name)}`);
    await ctx.runAction("domains:sync" as any, { name: b.name, ...(b.sending !== undefined ? { sending: b.sending } : {}), ...(b.receiving !== undefined ? { receiving: b.receiving } : {}), ...(b.enable_routing ? { enableRouting: true } : {}) });
    return json(domainView(await ctx.runQuery("domains:get" as any, { name: b.name.toLowerCase() })), 201);
  }),
});
/** Records a domain onboarded from the operator's machine (scripts/domains.ts): the Worker holds no CF token. */
http.route({
  path: "/domains/import",
  method: "POST",
  handler: route(async (ctx, request, p) => {
    need(p);
    const d = await body<Record<string, unknown>>(request);
    // Same normalization as POST /domains: names are stored lowercase.
    if (typeof d.name === "string") d.name = d.name.toLowerCase();
    if (typeof d.name !== "string" || !isDomainName(d.name)) throw new ApiError(422, "validation_error", `Invalid domain name ${JSON.stringify(d.name)}`);
    await ctx.runMutation("domains:save" as any, d);
    return json(domainView(await ctx.runQuery("domains:get" as any, { name: String(d.name) })), 201);
  }),
});
const domainById = async (ctx: ActionCtx, id: string | undefined) => {
  const d = id ? ((await ctx.runQuery("domains:getById" as any, { id })) as any) : null;
  if (!d) throw new ApiError(404, "not_found", "Domain not found");
  return d;
};
http.route({
  pathPrefix: "/domains/",
  method: "GET",
  handler: route(async (ctx, _r, p, url) => {
    need(p);
    return json(domainView(await domainById(ctx, tail(url, "/domains/")[0])));
  }),
});
http.route({
  pathPrefix: "/domains/",
  method: "POST",
  handler: route(async (ctx, request, p, url) => {
    need(p);
    const [id, action] = tail(url, "/domains/");
    if (action === "forget") {
      // Record only: the operator already deleted the Cloudflare side (scripts/domains.ts remove). DELETE does both.
      const d = await domainById(ctx, id);
      await ctx.runMutation("domains:remove" as any, { name: d.name });
      return json({ object: "domain", id: d._id, deleted: true });
    }
    if (action !== "verify") throw new ApiError(404, "not_found", "Not found");
    const d = await domainById(ctx, id);
    const b = request.headers.get("content-type")?.includes("json") ? await body<{ enable_routing?: boolean }>(request).catch(() => ({}) as { enable_routing?: boolean }) : {};
    await ctx.runAction("domains:sync" as any, { name: d.name, ...(b.enable_routing ? { enableRouting: true } : {}) });
    return json(domainView(await ctx.runQuery("domains:get" as any, { name: d.name })));
  }),
});
http.route({
  pathPrefix: "/domains/",
  method: "DELETE",
  handler: route(async (ctx, _r, p, url) => {
    need(p);
    const d = await domainById(ctx, tail(url, "/domains/")[0]);
    const r = (await ctx.runAction("domains:destroy" as any, { name: d.name })) as { deleted: boolean; errors: string[] };
    if (!r.deleted) throw new ApiError(502, "application_error", r.errors.join("; "));
    return json({ object: "domain", id: d._id, deleted: true });
  }),
});

// ------------------------------------------------------------------------------------------------ api keys

http.route({
  path: "/api-keys",
  method: "POST",
  handler: route(async (ctx, request, p) => {
    need(p);
    const b = await body<{ name?: string; permission?: string; project?: string; domain_id?: string; domain?: string }>(request);
    if (!b.name) throw new ApiError(422, "missing_required_field", "name is required");
    const { token, prefix } = newToken();
    const id = await ctx.runMutation("keys:insert" as any, {
      name: b.name,
      prefix,
      hash: await sha256Hex(token),
      permission: b.permission ?? "full_access",
      project: b.project ?? p.project,
      ...(b.domain ? { domain: b.domain.toLowerCase() } : {}),
    });
    return json({ id, token }, 201);
  }),
});
http.route({ path: "/api-keys", method: "GET", handler: route(async (ctx, _r, p) => (need(p), json({ data: await ctx.runQuery("keys:list" as any, {}) }))) });
http.route({
  pathPrefix: "/api-keys/",
  method: "DELETE",
  handler: route(async (ctx, _r, p, url) => {
    need(p);
    const ok = await ctx.runMutation("keys:revoke" as any, { id: tail(url, "/api-keys/")[0] ?? "" });
    if (!ok) throw new ApiError(404, "not_found", "API key not found");
    return json({ deleted: true });
  }),
});

// ------------------------------------------------------------------------------------------------ templates & suppressions

http.route({
  path: "/templates",
  method: "POST",
  handler: route(async (ctx, request, p) => {
    need(p);
    const b = await body<{ name: string; subject: string; html: string; text?: string; layout?: unknown }>(request);
    const id = await ctx.runMutation(email.upsertTemplate, { project: p.project, name: b.name, subject: b.subject, html: b.html, ...(b.text ? { text: b.text } : {}), ...(b.layout ? { layout: b.layout } : {}) });
    return json({ object: "template", id, name: b.name }, 201);
  }),
});
http.route({ path: "/templates", method: "GET", handler: route(async (ctx, _r, p) => (need(p, "sending_access"), json({ data: await ctx.runQuery(email.templates, { project: p.project }) }))) });
http.route({
  pathPrefix: "/templates/",
  method: "DELETE",
  handler: route(async (ctx, _r, p, url) => (need(p), json({ deleted: await ctx.runMutation(email.removeTemplate, { project: p.project, name: tail(url, "/templates/")[0] ?? "" }) }))),
});
http.route({
  path: "/suppressions",
  method: "POST",
  handler: route(async (ctx, request, p) => {
    need(p, "sending_access");
    const b = await body<{ email: string; reason?: string }>(request);
    return json({ id: await ctx.runMutation(email.suppress, { project: p.project, email: b.email, reason: b.reason ?? "manual" }) }, 201);
  }),
});
http.route({
  pathPrefix: "/suppressions/",
  method: "DELETE",
  handler: route(async (ctx, _r, p, url) => (need(p, "sending_access"), json({ deleted: await ctx.runMutation(email.unsuppress, { project: p.project, email: tail(url, "/suppressions/")[0] ?? "" }) }))),
});

// ------------------------------------------------------------------------------------------------ webhooks (full_access)

/** Errors thrown by webhooks:* (an internal mutation) → 404 / 422 with their message. */
const hookError = (e: unknown): never => {
  const m = (e as Error)?.message ?? String(e);
  // Validation first: "mailbox x not found" is a bad field, not a missing webhook.
  if (/^(endpoint|events|at most|mailbox|a personal|.* is a personal|webhook is paused)/.test(m)) throw new ApiError(422, "validation_error", m);
  if (/not found/.test(m)) throw new ApiError(404, "not_found", m);
  throw e;
};
const hookCall = async <T>(f: () => Promise<T>) => {
  try {
    return await f();
  } catch (e) {
    return hookError(e);
  }
};
type HookBody = { endpoint?: string; events?: string[]; project?: string | null; mailboxes?: string[] | null; description?: string | null; enabled?: boolean };
const hookFields = (b: HookBody) => {
  if (b.events !== undefined && (!Array.isArray(b.events) || b.events.some((x) => typeof x !== "string"))) throw new ApiError(422, "validation_error", "events must be an array of event types");
  if (b.mailboxes !== undefined && b.mailboxes !== null && (!Array.isArray(b.mailboxes) || b.mailboxes.some((x) => typeof x !== "string"))) throw new ApiError(422, "validation_error", "mailboxes must be an array of names");
  if (b.enabled !== undefined && typeof b.enabled !== "boolean") throw new ApiError(422, "validation_error", "enabled must be a boolean");
  if (b.project !== undefined && b.project !== null && typeof b.project !== "string") throw new ApiError(422, "validation_error", "project must be a string, or null");
  if (b.description !== undefined && b.description !== null && typeof b.description !== "string") throw new ApiError(422, "validation_error", "description must be a string, or null");
  return {
    ...(b.endpoint !== undefined ? { endpoint: String(b.endpoint) } : {}),
    ...(b.events !== undefined ? { events: b.events } : {}),
    ...(b.project !== undefined ? { project: b.project } : {}),
    ...(b.mailboxes !== undefined ? { mailboxes: b.mailboxes } : {}),
    ...(b.description !== undefined ? { description: b.description } : {}),
    ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
  };
};

http.route({ path: "/webhooks", method: "GET", handler: route(async (ctx, _r, p) => (need(p), json({ object: "list", data: await ctx.runQuery("webhooks:list" as any, {}) }))) });
http.route({
  path: "/webhooks",
  method: "POST",
  handler: route(async (ctx, request, p) => {
    need(p);
    const b = await body<HookBody>(request);
    if (typeof b.endpoint !== "string") throw new ApiError(422, "missing_required_field", "endpoint is required");
    if (!b.events) throw new ApiError(422, "missing_required_field", "events is required");
    const secret = newSecret();
    const { enabled: _, ...fields } = hookFields(b);
    const id = await hookCall(() => ctx.runMutation("webhooks:create" as any, { ...fields, secret }) as Promise<string>);
    return json({ object: "webhook", id, signing_secret: secret }, 201);
  }),
});
http.route({
  pathPrefix: "/webhooks/",
  method: "GET",
  handler: route(async (ctx, _r, p, url) => {
    need(p);
    const [id, sub] = tail(url, "/webhooks/");
    if (sub === "deliveries") return json({ object: "list", data: await hookCall(() => ctx.runQuery("webhooks:deliveries" as any, { id: id ?? "", limit: pageLimit(url, 50) })) });
    if (sub) throw new ApiError(404, "not_found", "Not found");
    return json({ object: "webhook", ...((await hookCall(() => ctx.runQuery("webhooks:get" as any, { id: id ?? "" }))) as object) });
  }),
});
http.route({
  pathPrefix: "/webhooks/",
  method: "PATCH",
  handler: route(async (ctx, request, p, url) => {
    need(p);
    const [id, sub] = tail(url, "/webhooks/");
    if (sub) throw new ApiError(404, "not_found", "Not found");
    const fields = hookFields(await body<HookBody>(request));
    return json({ object: "webhook", ...((await hookCall(() => ctx.runMutation("webhooks:update" as any, { id: id ?? "", ...fields }))) as object) });
  }),
});
http.route({
  pathPrefix: "/webhooks/",
  method: "POST",
  handler: route(async (ctx, _r, p, url) => {
    need(p);
    const [a, b, c] = tail(url, "/webhooks/");
    if (a === "deliveries" && b && c === "retry") return json({ ok: await hookCall(() => ctx.runMutation("webhooks:redeliver" as any, { id: b })) });
    if (b === "rotate") {
      const secret = newSecret();
      await hookCall(() => ctx.runMutation("webhooks:update" as any, { id: a ?? "", secret }));
      return json({ object: "webhook", id: a, signing_secret: secret });
    }
    if (b === "test") return json({ object: "delivery", id: await hookCall(() => ctx.runMutation("webhooks:test" as any, { id: a ?? "" })) }, 201);
    throw new ApiError(404, "not_found", "Not found");
  }),
});
http.route({
  pathPrefix: "/webhooks/",
  method: "DELETE",
  handler: route(async (ctx, _r, p, url) => {
    need(p);
    const [id, sub] = tail(url, "/webhooks/");
    if (sub) throw new ApiError(404, "not_found", "Not found");
    await hookCall(() => ctx.runMutation("webhooks:remove" as any, { id: id ?? "" }));
    return json({ object: "webhook", id, deleted: true });
  }),
});

// ------------------------------------------------------------------------------------------------ inbox (dashboard, scripts)

http.route({
  path: "/inbox/mailboxes",
  method: "GET",
  handler: route(async (ctx, _r, p) => {
    need(p, "inbox");
    const boxes = (await ctx.runQuery(email.mailboxes, {})) as any[];
    const unread = await ctx.runQuery(email.unread, {});
    const personal = await personalMailboxes(ctx);
    // A personal mailbox is listed (with its owner) but its counts are its owner's business.
    return json({
      data: boxes.map((b) => ({
        name: b.name,
        address: b.address,
        display_name: b.displayName ?? null,
        owner: personal[b.name] ?? null,
        catch_all: !!b.catchAll,
        retention: b.retention ? { closed_days: b.retention.closedDays ?? null, spam_days: b.retention.spamDays ?? null } : null,
        ...(Object.hasOwn(personal, b.name) ? {} : (unread as any)[b.name]),
      })),
    });
  }),
});
/**
 * `retention` of POST /inbox/mailboxes: `{ closed_days?, spam_days? }` (whole days; a missing or null kind is kept
 * forever), null clears the policy, absent keeps it. The component validates the numbers.
 */
function retentionArg(r: unknown): { closedDays?: number; spamDays?: number } | null | undefined {
  if (r === undefined || r === null) return r;
  if (typeof r !== "object" || Array.isArray(r)) throw new ApiError(422, "validation_error", "retention must be { closed_days?, spam_days? } or null");
  const { closed_days, spam_days, ...rest } = r as Record<string, unknown>;
  if (Object.keys(rest).length) throw new ApiError(422, "validation_error", `retention: unknown field ${Object.keys(rest)[0]}`);
  const out: { closedDays?: number; spamDays?: number } = {};
  for (const [k, v, to] of [["closed_days", closed_days, "closedDays"], ["spam_days", spam_days, "spamDays"]] as const) {
    if (v === undefined || v === null) continue;
    if (typeof v !== "number") throw new ApiError(422, "validation_error", `retention.${k} must be a number of days`);
    out[to] = v;
  }
  return out.closedDays === undefined && out.spamDays === undefined ? null : out;
}

http.route({
  path: "/inbox/mailboxes",
  method: "POST",
  handler: route(async (ctx, request, p) => {
    need(p);
    const b = await body<{ name: string; address: string; display_name?: string | null; auto_reply?: { subject: string; text: string; html?: string } | null; owner?: string | null; catch_all?: boolean | null; retention?: { closed_days?: number | null; spam_days?: number | null } | null }>(request);
    if (b.catch_all !== undefined && b.catch_all !== null && typeof b.catch_all !== "boolean") throw new ApiError(422, "validation_error", "catch_all must be a boolean");
    const retention = retentionArg(b.retention);
    if (b.owner !== undefined && b.owner !== null && (typeof b.owner !== "string" || !b.owner)) throw new ApiError(422, "validation_error", "owner must be a user id, or null to make the mailbox shared");
    // Absent fields keep their stored value; null (or "" for display_name) clears them.
    const id = await ctx.runMutation(email.upsertMailbox, { name: b.name, address: b.address, ...(b.display_name !== undefined ? { displayName: b.display_name || null } : {}), ...(b.auto_reply !== undefined ? { autoReply: b.auto_reply } : {}), ...(b.catch_all !== undefined ? { catchAll: b.catch_all } : {}), ...(retention !== undefined ? { retention } : {}) });
    // `owner`: personal to that user (only they see it); null: shared again; absent: as it was.
    if (b.owner !== undefined) await ctx.runMutation("access:setOwner" as any, { mailbox: b.name, userId: b.owner });
    return json({ id }, 201);
  }),
});
http.route({
  path: "/inbox/threads",
  method: "GET",
  handler: route(async (ctx, _r, p, url) => {
    need(p, "inbox");
    const mailbox = url.searchParams.get("mailbox");
    if (!mailbox) throw new ApiError(422, "missing_required_field", "mailbox is required");
    notPersonal(await personalMailboxes(ctx), mailbox);
    const status = url.searchParams.get("status");
    const r = await ctx.runQuery(email.threads, { mailbox, ...(status ? { status } : {}), paginationOpts: { numItems: pageLimit(url, 30), cursor: url.searchParams.get("cursor") } });
    return json(r);
  }),
});
// The mailbox's Sent view: conversations it wrote in, newest send first; `next` goes on as `before`.
http.route({
  path: "/inbox/sent",
  method: "GET",
  handler: route(async (ctx, _r, p, url) => {
    need(p, "inbox");
    const mailbox = url.searchParams.get("mailbox");
    if (!mailbox) throw new ApiError(422, "missing_required_field", "mailbox is required");
    notPersonal(await personalMailboxes(ctx), mailbox);
    const before = url.searchParams.get("before");
    return json(await ctx.runQuery(email.sent, { mailbox, limit: pageLimit(url, 30), ...(before ? { before } : {}) }));
  }),
});
http.route({
  pathPrefix: "/inbox/threads/",
  method: "GET",
  handler: route(async (ctx, _r, p, url) => {
    need(p, "inbox");
    const t = await ctx.runQuery(email.thread, { threadId: tail(url, "/inbox/threads/")[0] ?? "" });
    if (!t) throw new ApiError(404, "not_found", "Thread not found");
    notPersonal(await personalMailboxes(ctx), (t as any).thread.mailbox);
    return json(t);
  }),
});
http.route({
  pathPrefix: "/inbox/threads/",
  method: "POST",
  handler: route(async (ctx, request, p, url) => {
    need(p, "inbox");
    const [id, action] = tail(url, "/inbox/threads/");
    const b = await body<{ text?: string; status?: string; author?: string }>(request);
    const t = (await ctx.runQuery(email.thread, { threadId: id ?? "" })) as { thread: { mailbox: string } } | null;
    if (!t) throw new ApiError(404, "not_found", "Thread not found");
    notPersonal(await personalMailboxes(ctx), t.thread.mailbox);
    if (action === "reply") return json(await ctx.runMutation(email.reply, { threadId: id ?? "", text: b.text ?? "", ...(b.author ? { author: b.author } : {}) }), 201);
    if (action === "status") return json({ status: await ctx.runMutation(email.setStatus, { threadId: id ?? "", status: b.status ?? "" }) });
    if (action === "read") return json({ ok: await ctx.runMutation(email.markRead, { threadId: id ?? "" }) });
    throw new ApiError(404, "not_found", "Not found");
  }),
});
http.route({
  pathPrefix: "/inbox/threads/",
  method: "DELETE",
  handler: route(async (ctx, _r, p, url) => {
    need(p);
    const [id, sub] = tail(url, "/inbox/threads/");
    if (sub) throw new ApiError(404, "not_found", "Not found");
    const t = (await ctx.runQuery(email.thread, { threadId: id ?? "" })) as { thread: { mailbox: string } } | null;
    if (!t) throw new ApiError(404, "not_found", "Thread not found");
    notPersonal(await personalMailboxes(ctx), t.thread.mailbox);
    return json({ object: "thread", id, ...((await ctx.runMutation(email.deleteThread, { threadId: id ?? "" })) as object) });
  }),
});
http.route({
  path: "/inbox/search",
  method: "GET",
  handler: route(async (ctx, _r, p, url) => {
    need(p, "inbox");
    const mailbox = url.searchParams.get("mailbox");
    const personal = await personalMailboxes(ctx);
    if (mailbox) notPersonal(personal, mailbox);
    const rows = (await ctx.runQuery(email.search, { query: url.searchParams.get("q") ?? "", ...(mailbox ? { mailbox } : {}) })) as Array<{ mailbox: string }>;
    return json({ data: rows.filter((r) => !Object.hasOwn(personal, r.mailbox)) });
  }),
});
// Members, and who signed in asking for access (their email and name), for full-access keys and the admin token.
http.route({
  path: "/inbox/members",
  method: "GET",
  handler: route(async (ctx, _r, p) => (need(p), json(await ctx.runQuery("admin:listMembers" as any, {})))),
});
http.route({
  path: "/inbox/members",
  method: "POST",
  handler: route(async (ctx, request, p) => {
    need(p);
    const b = await body<{ user_id?: string; name?: string | null; mailboxes?: string[]; admin?: boolean }>(request);
    if (typeof b.user_id !== "string" || !b.user_id) throw new ApiError(422, "missing_required_field", "user_id is required");
    if (b.mailboxes !== undefined && (!Array.isArray(b.mailboxes) || b.mailboxes.some((m) => typeof m !== "string"))) throw new ApiError(422, "validation_error", "mailboxes must be an array of names");
    if (b.admin !== undefined && typeof b.admin !== "boolean") throw new ApiError(422, "validation_error", "admin must be a boolean");
    // Patch: only the fields sent change (admin: false revokes; name: null clears).
    return json({ id: await ctx.runMutation("admin:upsertMember" as any, { userId: b.user_id, ...(b.mailboxes !== undefined ? { mailboxes: b.mailboxes } : {}), ...(b.name !== undefined ? { name: b.name || null } : {}), ...(b.admin !== undefined ? { admin: b.admin } : {}) }) }, 201);
  }),
});

export default http;
