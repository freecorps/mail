// The admin screen of the web app (apps/web, "Administração"): reactive queries and mutations over the service's
// setup, for members with `admin` only. They mirror what the HTTP API does with a full_access key (domains, API
// keys, mailboxes, members, sent emails, suppressions, webhooks), with one rule the HTTP API also keeps: a personal mailbox
// (ember/access.ts) stays its owner's business. Admins see that it exists and who owns it, never its counts, its
// sent emails or its suppressions.
import {
  actionGeneric as action,
  anyComponents as components,
  internalQueryGeneric as internalQuery,
  mutationGeneric as mutation,
  queryGeneric as query,
  v,
} from "@freecorps/ember-server";
import { isDomainName } from "@freecorps/ember-email/cloudflare";
import { newToken, sha256Hex } from "../src/api.ts";
import { newSecret } from "../src/webhooks.ts";
import { owners, type Member } from "./access.ts";
import { PERMISSIONS } from "./keys.ts";

const email = components.email.lib;

type Ctx = { auth: { getUserIdentity(): { subject: string } | null }; db: any; runQuery: any };

/** The signed-in admin, or an error (the screen shows it). */
export function adminOf(ctx: Ctx): Member {
  const who = ctx.auth.getUserIdentity();
  if (!who) throw new Error("unauthenticated");
  const m = ctx.db.query("members").withIndex("by_user", (q: any) => q.eq("userId", who.subject)).first() as Member | null;
  if (!m?.admin) throw new Error("admins only");
  return m;
}

/** Sending projects of personal mailboxes (`mailbox:<name>`): their emails and suppressions are not listed. */
const personalProjects = (db: Ctx["db"]) => new Set([...owners(db).keys()].map((n) => `mailbox:${n}`));

function sharedProject(ctx: Ctx, project: string) {
  if (personalProjects(ctx.db).has(project)) throw new Error("a personal mailbox's emails are its owner's business");
}

// ---------------------------------------------------------------------------------------------- server

/** For actions: whether the caller is an admin (actions read the identity through a query). */
export const isAdmin = internalQuery({
  args: {},
  handler: (ctx) => {
    adminOf(ctx);
    return true;
  },
});

/**
 * What the Worker runs: project and environment, the Ember release (EMBER_RUNTIME_VERSION, set by `ember deploy`),
 * the Worker version, and whether it can manage domains itself (a Cloudflare token among its secrets). An action:
 * only actions read the env.
 */
export const server = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery("console:isAdmin" as any, {});
    const env = ctx.env;
    const str = (k: string) => (typeof env[k] === "string" && env[k] ? (env[k] as string) : null);
    const ver = env.EMBER_VERSION as { id?: unknown; tag?: unknown; timestamp?: unknown } | undefined;
    return {
      project: str("EMBER_PROJECT"),
      env: str("EMBER_ENV"),
      ember: str("EMBER_RUNTIME_VERSION"),
      worker: ver && typeof ver.id === "string" ? { id: ver.id, tag: typeof ver.tag === "string" && ver.tag ? ver.tag : null, deployedAt: typeof ver.timestamp === "string" ? ver.timestamp : null } : null,
      manageDomains: !!str("CLOUDFLARE_API_TOKEN") && !!str("CLOUDFLARE_ACCOUNT_ID"),
      files: !!env.EMBER_FILES,
    };
  },
});

/** Counts for the overview (mailbox counts exclude personal mailboxes). */
export const overview = query({
  args: {},
  handler: (ctx) => {
    adminOf(ctx);
    const personal = owners(ctx.db);
    const boxes = ctx.runQuery(email.mailboxes, {}) as Array<{ name: string }>;
    const shared = boxes.map((b) => b.name).filter((n) => !personal.has(n));
    const unread = ctx.runQuery(email.unread, { mailboxes: shared }) as Record<string, { unread: number; threads: number }>;
    const domains = ctx.db.query("domains").collect() as Array<{ status: string }>;
    return {
      domains: domains.length,
      domainsVerified: domains.filter((d) => d.status === "verified").length,
      mailboxes: boxes.length,
      personalMailboxes: personal.size,
      threads: shared.reduce((n, b) => n + (unread[b]?.threads ?? 0), 0),
      unread: shared.reduce((n, b) => n + (unread[b]?.unread ?? 0), 0),
      keys: (ctx.db.query("apiKeys").collect() as Array<{ revokedAt?: number }>).filter((k) => !k.revokedAt).length,
      members: ctx.db.query("members").collect().length,
      requests: ctx.db.query("accessRequests").collect().length,
    };
  },
});

// ---------------------------------------------------------------------------------------------- domains

export const domains = query({
  args: {},
  handler: (ctx) => {
    adminOf(ctx);
    return (ctx.db.query("domains").collect() as any[])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({
        id: d._id as string,
        name: d.name as string,
        status: d.status as string,
        sending: !!d.sending,
        receiving: !!d.receiving,
        routingStatus: (d.routingStatus ?? null) as string | null,
        records: d.records as Array<{ type: string; name: string; value: string; priority?: number; ttl?: number; purpose: string }>,
        notes: d.notes as string[],
        rules: (d.ruleIds as string[]).length,
        events: !!d.subscriptionId,
        catchAll: !!d.catchAll,
        createdAt: d.createdAt as number,
        checkedAt: (d.checkedAt ?? null) as number | null,
      }));
  },
});

/**
 * Re-checks a domain (or adds one) through the Worker's own Cloudflare token. Without that token (the usual setup:
 * domains are onboarded from the operator's machine, scripts/domains.ts) it fails with the command to run.
 */
export const syncDomain = action({
  args: { name: v.string(), sending: v.optional(v.boolean()), receiving: v.optional(v.boolean()), enableRouting: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    await ctx.runQuery("console:isAdmin" as any, {});
    const name = a.name.trim().toLowerCase();
    if (!isDomainName(name)) throw new Error(`Invalid domain name ${JSON.stringify(a.name)}`);
    if (typeof ctx.env.CLOUDFLARE_API_TOKEN !== "string" || typeof ctx.env.CLOUDFLARE_ACCOUNT_ID !== "string") {
      throw new Error(`this Worker has no Cloudflare token: run "bun run domains add ${name}" in apps/api`);
    }
    return (await ctx.runAction("domains:sync" as any, {
      name,
      ...(a.sending !== undefined ? { sending: a.sending } : {}),
      ...(a.receiving !== undefined ? { receiving: a.receiving } : {}),
      ...(a.enableRouting !== undefined ? { enableRouting: a.enableRouting } : {}),
    })) as { name: string; status: string; notes: string[] };
  },
});

// ---------------------------------------------------------------------------------------------- api keys

export const keys = query({
  args: {},
  handler: (ctx) => {
    adminOf(ctx);
    return (ctx.db.query("apiKeys").collect() as any[])
      .filter((k) => !k.revokedAt)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((k) => ({ id: k._id as string, name: k.name as string, prefix: k.prefix as string, permission: k.permission as string, project: k.project as string, domain: (k.domain ?? null) as string | null, createdAt: k.createdAt as number }));
  },
});

/** A new API key: the token is returned once (only its hash is stored). An action: tokens need a secure random. */
export const createKey = action({
  args: { name: v.string(), permission: v.string(), project: v.string(), domain: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await ctx.runQuery("console:isAdmin" as any, {});
    const name = a.name.trim();
    if (!name || name.length > 100) throw new Error("name: 1 to 100 characters");
    if (!(PERMISSIONS as readonly string[]).includes(a.permission)) throw new Error(`permission must be one of ${PERMISSIONS.join(", ")}`);
    const project = a.project.trim();
    if (!/^[a-z0-9][a-z0-9:._-]{0,63}$/.test(project)) throw new Error("project: lowercase letters, digits, and : . _ - (up to 64)");
    if (project.startsWith("mailbox:")) throw new Error("mailbox:<name> projects belong to the inbox");
    const domain = a.domain?.trim().toLowerCase() || undefined;
    if (domain && !isDomainName(domain)) throw new Error(`Invalid domain name ${JSON.stringify(a.domain)}`);
    if (domain && a.permission !== "sending_access") throw new Error("only sending_access keys are limited to a domain");
    const { token, prefix } = newToken();
    const id = (await ctx.runMutation("keys:insert" as any, { name, prefix, hash: await sha256Hex(token), permission: a.permission, project, ...(domain ? { domain } : {}) })) as string;
    return { id, token, prefix };
  },
});

export const revokeKey = mutation({
  args: { id: v.string() },
  handler: (ctx, a) => {
    adminOf(ctx);
    return ctx.runMutation("keys:revoke" as any, a) as boolean;
  },
});

// ---------------------------------------------------------------------------------------------- mailboxes

export const mailboxes = query({
  args: {},
  handler: (ctx) => {
    adminOf(ctx);
    const personal = owners(ctx.db);
    const members = ctx.db.query("members").collect() as Member[];
    const boxes = (ctx.runQuery(email.mailboxes, {}) as any[]).sort((a, b) => a.name.localeCompare(b.name));
    const unread = ctx.runQuery(email.unread, { mailboxes: boxes.map((b) => b.name).filter((n) => !personal.has(n)) }) as Record<string, { unread: number; threads: number }>;
    return boxes.map((b) => {
      const owner = personal.get(b.name) ?? null;
      const ownerMember = owner ? members.find((m) => m.userId === owner) : undefined;
      return {
        name: b.name as string,
        address: b.address as string,
        displayName: (b.displayName ?? null) as string | null,
        owner,
        ownerName: ownerMember?.name ?? null,
        catchAll: !!b.catchAll,
        autoReply: (b.autoReply ?? null) as { subject: string; text: string; html?: string } | null,
        retention: (b.retention ?? null) as { closedDays?: number; spamDays?: number } | null,
        // Members granted this mailbox (admins see every shared one anyway).
        granted: owner ? [] : members.filter((m) => m.mailboxes.includes(b.name)).map((m) => ({ userId: m.userId, name: m.name ?? null })),
        ...(owner ? { counts: null } : { counts: unread[b.name] ?? { unread: 0, threads: 0 } }),
      };
    });
  },
});

/**
 * Creates or edits a mailbox. Absent fields keep their value; null clears (display name, auto-reply, retention). A
 * new address on a receiving domain still needs its routing rule: `domains:sync` adds it (the screen offers it when
 * the Worker can, or shows the command).
 */
export const saveMailbox = mutation({
  args: {
    name: v.string(),
    address: v.string(),
    displayName: v.optional(v.union(v.string(), v.null())),
    autoReply: v.optional(v.union(v.object({ subject: v.string(), text: v.string() }), v.null())),
    retention: v.optional(v.union(v.object({ closedDays: v.optional(v.number()), spamDays: v.optional(v.number()) }), v.null())),
  },
  handler: (ctx, a) => {
    adminOf(ctx);
    const name = a.name.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new Error("name: lowercase letters, digits, _ and - (up to 64)");
    const retention = a.retention === undefined ? undefined : a.retention && (a.retention.closedDays || a.retention.spamDays) ? a.retention : null;
    return ctx.runMutation(email.upsertMailbox, {
      name,
      address: a.address.trim(),
      ...(a.displayName !== undefined ? { displayName: a.displayName?.trim() || null } : {}),
      ...(a.autoReply !== undefined ? { autoReply: a.autoReply && a.autoReply.text.trim() ? a.autoReply : null } : {}),
      ...(retention !== undefined ? { retention } : {}),
    }) as string;
  },
});

// ---------------------------------------------------------------------------------------------- members

export const members = query({
  args: {},
  handler: (ctx) => {
    const me = adminOf(ctx);
    const r = ctx.runQuery("admin:listMembers" as any, {}) as {
      data: Array<{ user_id: string; name: string | null; mailboxes: string[]; admin: boolean; personal_mailbox: string | null }>;
      requests: Array<{ user_id: string; email: string | null; name: string | null; requested_at: string }>;
    };
    return {
      me: me.userId,
      members: r.data.map((m) => ({ userId: m.user_id, name: m.name, mailboxes: m.mailboxes, admin: m.admin, personalMailbox: m.personal_mailbox })),
      requests: r.requests.map((q) => ({ userId: q.user_id, email: q.email, name: q.name, requestedAt: Date.parse(q.requested_at) })),
    };
  },
});

/** Grants (or answers a request): only the fields sent change. An admin cannot take their own admin away. */
export const saveMember = mutation({
  args: { userId: v.string(), name: v.optional(v.union(v.string(), v.null())), mailboxes: v.optional(v.array(v.string())), admin: v.optional(v.boolean()) },
  handler: (ctx, a) => {
    const me = adminOf(ctx);
    if (a.userId === me.userId && a.admin === false) throw new Error("you cannot remove your own admin access");
    if (a.mailboxes) {
      const personal = owners(ctx.db);
      const known = new Set((ctx.runQuery(email.mailboxes, {}) as Array<{ name: string }>).map((b) => b.name));
      for (const b of a.mailboxes) {
        if (!known.has(b)) throw new Error(`mailbox ${b} not found`);
        if (personal.has(b)) throw new Error(`${b} is a personal mailbox: only its owner reads it`);
      }
    }
    return ctx.runMutation("admin:upsertMember" as any, {
      userId: a.userId,
      ...(a.name !== undefined ? { name: a.name?.trim() || null } : {}),
      ...(a.mailboxes !== undefined ? { mailboxes: [...new Set(a.mailboxes)] } : {}),
      ...(a.admin !== undefined ? { admin: a.admin } : {}),
    }) as string;
  },
});

/** Takes a member's access away (not one who owns a personal mailbox: make it shared or give it to someone first). */
export const removeMember = mutation({
  args: { userId: v.string() },
  handler: (ctx, a) => {
    const me = adminOf(ctx);
    if (a.userId === me.userId) throw new Error("you cannot remove yourself");
    const own = ctx.db.query("personal").withIndex("by_user", (q: any) => q.eq("userId", a.userId)).first() as { mailbox: string } | null;
    if (own) throw new Error(`they own the personal mailbox ${own.mailbox}`);
    const m = ctx.db.query("members").withIndex("by_user", (q: any) => q.eq("userId", a.userId)).first();
    if (m) ctx.db.delete(m._id);
    return !!m;
  },
});

/** Declines an access request (they can ask again by signing in). */
export const dismissRequest = mutation({
  args: { userId: v.string() },
  handler: (ctx, a) => {
    adminOf(ctx);
    const r = ctx.db.query("accessRequests").withIndex("by_user", (q: any) => q.eq("userId", a.userId)).first();
    if (r) ctx.db.delete(r._id);
    return !!r;
  },
});

// ---------------------------------------------------------------------------------------------- emails & suppressions

/** Sending projects to browse: the API keys' tenants, the shared mailboxes' `mailbox:<name>`, and "default". */
export const projects = query({
  args: {},
  handler: (ctx) => {
    adminOf(ctx);
    const personal = owners(ctx.db);
    const keyProjects = (ctx.db.query("apiKeys").collect() as Array<{ project: string; revokedAt?: number }>).map((k) => k.project);
    const boxes = (ctx.runQuery(email.mailboxes, {}) as Array<{ name: string }>).map((b) => b.name).filter((n) => !personal.has(n));
    // The API keys' tenants first (what admins look for), then the shared mailboxes', then the admin token's "default".
    return [...new Set([...keyProjects.sort(), ...boxes.map((b) => `mailbox:${b}`), "default"])];
  },
});

const pageArg = v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) });

/** A project's emails, newest first (paginated). */
export const emails = query({
  args: { project: v.string(), paginationOpts: pageArg },
  handler: (ctx, a) => {
    adminOf(ctx);
    sharedProject(ctx, a.project);
    const r = ctx.runQuery(email.list, { project: a.project, paginationOpts: { numItems: Math.min(100, a.paginationOpts.numItems), cursor: a.paginationOpts.cursor } }) as { page: any[]; isDone: boolean; continueCursor: string };
    return {
      ...r,
      page: r.page.map((e) => ({
        id: e._id as string,
        createdAt: e._creationTime as number,
        from: e.from as { email: string; name?: string },
        to: (e.to as Array<{ email: string }>).map((x) => x.email),
        cc: ((e.cc ?? []) as Array<{ email: string }>).map((x) => x.email),
        subject: (e.subject ?? "") as string,
        status: e.status as string,
        sentAt: (e.sentAt ?? null) as number | null,
        error: (e.error ?? null) as { code: string; message: string } | null,
        tags: (e.tags ?? {}) as Record<string, string>,
        threadId: (e.threadId ?? null) as string | null,
      })),
    };
  },
});

/** Delivery events of one email (the screen's detail row). */
export const emailEvents = query({
  args: { id: v.string() },
  handler: (ctx, a) => {
    adminOf(ctx);
    const e = ctx.runQuery(email.get, { id: a.id }) as { _id: string; project: string } | null;
    if (!e) throw new Error("email not found");
    sharedProject(ctx, e.project);
    return (ctx.runQuery(email.events, { id: e._id }) as any[]).map((x) => ({
      type: x.type as string,
      recipient: (x.recipient ?? null) as string | null,
      at: x.at as number,
      reason: (x.reason ?? null) as string | null,
      bounceType: (x.bounceType ?? null) as string | null,
    }));
  },
});

export const suppressions = query({
  args: { project: v.string(), paginationOpts: pageArg },
  handler: (ctx, a) => {
    adminOf(ctx);
    sharedProject(ctx, a.project);
    const r = ctx.runQuery(email.suppressions, { project: a.project, paginationOpts: { numItems: Math.min(100, a.paginationOpts.numItems), cursor: a.paginationOpts.cursor } }) as { page: any[]; isDone: boolean; continueCursor: string };
    return { ...r, page: r.page.map((s) => ({ email: s.email as string, reason: s.reason as string, at: s.at as number })) };
  },
});

export const suppress = mutation({
  args: { project: v.string(), email: v.string() },
  handler: (ctx, a) => {
    adminOf(ctx);
    sharedProject(ctx, a.project);
    return ctx.runMutation(email.suppress, { project: a.project, email: a.email, reason: "manual" }) as string;
  },
});

export const unsuppress = mutation({
  args: { project: v.string(), email: v.string() },
  handler: (ctx, a) => {
    adminOf(ctx);
    sharedProject(ctx, a.project);
    return ctx.runMutation(email.unsuppress, a) as boolean;
  },
});

// ---------------------------------------------------------------------------------------------- webhooks

const webhookFields = {
  endpoint: v.string(),
  events: v.array(v.string()),
  project: v.optional(v.union(v.string(), v.null())),
  mailboxes: v.optional(v.union(v.array(v.string()), v.null())),
  description: v.optional(v.union(v.string(), v.null())),
};

export const webhooks = query({
  args: {},
  handler: (ctx) => {
    adminOf(ctx);
    return ctx.runQuery("webhooks:list" as any, {}) as unknown[];
  },
});

export const webhookDeliveries = query({
  args: { id: v.string() },
  handler: (ctx, a) => {
    adminOf(ctx);
    return ctx.runQuery("webhooks:deliveries" as any, { id: a.id, limit: 50 }) as unknown[];
  },
});

/** The signing secret, on demand (the screen hides it until asked). */
export const webhookSecret = query({
  args: { id: v.string() },
  handler: (ctx, a) => {
    adminOf(ctx);
    return ctx.runQuery("webhooks:secret" as any, a) as string;
  },
});

/** A new webhook: an action, for the secret's random. Returns its id and secret. */
export const createWebhook = action({
  args: webhookFields,
  handler: async (ctx, a) => {
    await ctx.runQuery("console:isAdmin" as any, {});
    const secret = newSecret();
    const id = (await ctx.runMutation("webhooks:create" as any, { ...a, secret })) as string;
    return { id, secret };
  },
});

export const updateWebhook = mutation({
  args: {
    id: v.string(),
    endpoint: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    project: v.optional(v.union(v.string(), v.null())),
    mailboxes: v.optional(v.union(v.array(v.string()), v.null())),
    description: v.optional(v.union(v.string(), v.null())),
    enabled: v.optional(v.boolean()),
  },
  handler: (ctx, a) => {
    adminOf(ctx);
    return ctx.runMutation("webhooks:update" as any, a);
  },
});

export const deleteWebhook = mutation({
  args: { id: v.string() },
  handler: (ctx, a) => {
    adminOf(ctx);
    return ctx.runMutation("webhooks:remove" as any, a) as boolean;
  },
});

export const rotateWebhookSecret = action({
  args: { id: v.string() },
  handler: async (ctx, a) => {
    await ctx.runQuery("console:isAdmin" as any, {});
    const secret = newSecret();
    await ctx.runMutation("webhooks:update" as any, { id: a.id, secret });
    return { secret };
  },
});

export const testWebhook = mutation({
  args: { id: v.string() },
  handler: (ctx, a) => {
    adminOf(ctx);
    return ctx.runMutation("webhooks:test" as any, a) as string;
  },
});

export const redeliverWebhook = mutation({
  args: { id: v.string() },
  handler: (ctx, a) => {
    adminOf(ctx);
    return ctx.runMutation("webhooks:redeliver" as any, a) as boolean;
  },
});
