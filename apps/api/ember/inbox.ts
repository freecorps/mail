// The inbox for the dashboard and the mobile client (apps/mobile): reactive queries over the email component's
// mailboxes, threads and search, for signed-in members only (identity from the app's auth provider: Ember auth
// via ember/auth.config.ts, or SSO). Members see only their mailboxes; admins see all. Push devices register here.
import { anyComponents as components, mutationGeneric as mutation, queryGeneric as query, v } from "@freecorps/ember-server";
import { PushNotifications } from "@freecorps/ember-push";

const push = new PushNotifications(components.push);
const email = components.email.lib;

type Ctx = { auth: { getUserIdentity(): { subject: string; name?: string; email?: string } | null }; db: any; runQuery: any; storage?: any };
type Member = { userId: string; mailboxes: string[]; admin?: boolean; name?: string };

const displayName = (m: Member) => m.name ?? m.userId;

function member(ctx: Ctx) {
  const who = ctx.auth.getUserIdentity();
  if (!who) throw new Error("unauthenticated");
  const m = ctx.db.query("members").withIndex("by_user", (q: any) => q.eq("userId", who.subject)).first();
  if (!m) throw new Error("not a member of any mailbox");
  return m as Member;
}

function memberMailboxes(ctx: Ctx, m: Member): string[] {
  const all = (ctx.runQuery(email.mailboxes, {}) as Array<{ name: string }>).map((b) => b.name);
  return m.admin ? all : all.filter((n) => m.mailboxes.includes(n));
}

function allowed(ctx: Ctx, mailbox: string) {
  const m = member(ctx);
  if (!m.admin && !m.mailboxes.includes(mailbox)) throw new Error(`no access to mailbox ${mailbox}`);
  return m;
}

function threadOf(ctx: Ctx, threadId: string) {
  const t = ctx.runQuery(email.thread, { threadId });
  if (!t) throw new Error("thread not found");
  const m = allowed(ctx, t.thread.mailbox);
  return { t, m };
}

// ---------------------------------------------------------------------------------------------- attachments
// The app uploads each file straight to R2 (presigned, multipart above 32 MiB) with a ticket from
// `generateUploadUrl`, then sends its file id with the reply or the new conversation. Up to ATTACH_LIMIT in all goes
// as attachments; anything past it goes as a download link in the text (valid LINK_TTL_S), so a 300 MB file still
// reaches the customer. The thread's message keeps every file either way.

/** Bytes sent as MIME attachments per email (the rest become links): well under providers' ~25 MB messages. */
export const ATTACH_LIMIT = 10 * 1024 * 1024;
/** The largest file a member may upload. */
export const MAX_UPLOAD = 2 * 1024 ** 3;
/** How long a download link in an email works (Ember's signed URLs go up to 7 days). */
export const LINK_TTL_S = 7 * 24 * 3600;

const attachmentsArg = v.optional(v.array(v.object({ file: v.string(), filename: v.string(), contentType: v.string() })));
type AttachmentArg = { file: string; filename: string; contentType: string };

const mib = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Splits the files into attachments and links (smallest attach first, up to ATTACH_LIMIT) and appends the links to
 * the text. Every file must be uploaded (ready) already.
 */
export function withAttachments(ctx: Ctx & { now: number }, m: Member, text: string, list: AttachmentArg[] | undefined) {
  if (!list?.length) return { text, attachments: undefined };
  if (list.length > 20) throw new Error("at most 20 attachments");
  const files = list.map((a) => {
    // Only the member's own uploads: a file id seen elsewhere (another mailbox's attachment) is refused.
    const up = ctx.db.query("uploads").withIndex("by_file", (q: any) => q.eq("file", a.file)).first() as { userId: string } | null;
    if (!up || up.userId !== m.userId) throw new Error(`attachment ${a.filename}: not an upload of yours`);
    const meta = ctx.storage.getMetadata(a.file) as { size: number | null; state: string } | null;
    if (!meta) throw new Error(`attachment ${a.filename}: file not found`);
    if (meta.state !== "ready") throw new Error(`attachment ${a.filename}: still uploading`);
    return { ...a, size: meta.size ?? 0 };
  });
  let attached = 0;
  const link = new Set<string>();
  for (const f of [...files].sort((x, y) => x.size - y.size)) {
    if (attached + f.size <= ATTACH_LIMIT) attached += f.size;
    else link.add(f.file);
  }
  if (!link.size) return { text, attachments: files.map(({ size: _, ...a }) => a) };
  const until = new Date(ctx.now + LINK_TTL_S * 1000).toISOString().slice(0, 10);
  const lines = files
    .filter((f) => link.has(f.file))
    .map((f) => `${f.filename} (${mib(f.size)}): ${ctx.storage.getUrl(f.file, { download: f.filename, expiresIn: LINK_TTL_S })}`);
  return {
    text: `${text}\n\n—\nArquivos para baixar (links válidos até ${until}):\n${lines.join("\n")}`,
    attachments: files.map(({ size: _, ...a }) => (link.has(a.file) ? { ...a, link: true } : a)),
  };
}

/** An upload ticket for an attachment (members only). */
export const generateUploadUrl = mutation({
  args: { contentType: v.optional(v.string()), size: v.number(), sha256: v.optional(v.string()), multipart: v.optional(v.boolean()) },
  handler: (ctx, a) => {
    const m = member(ctx);
    if (!Number.isSafeInteger(a.size) || a.size < 0) throw new Error("size must be a non-negative integer");
    if (a.size > MAX_UPLOAD) throw new Error(`file too large: at most ${mib(MAX_UPLOAD)}`);
    const ticket = ctx.storage.generateUploadUrl(a);
    ctx.db.insert("uploads", { file: ticket.storageId, userId: m.userId, at: ctx.now });
    return ticket;
  },
});

/** Mailboxes this member can see, with unread counts (aggregate). */
export const mailboxes = query({
  args: {},
  handler: (ctx) => {
    const m = member(ctx);
    const all = (ctx.runQuery(email.mailboxes, {}) as Array<{ name: string; address: string; displayName?: string }>).filter((b) => m.admin || m.mailboxes.includes(b.name));
    const unread = ctx.runQuery(email.unread, { mailboxes: all.map((b) => b.name) }) as Record<string, { unread: number; threads: number }>;
    return all.map((b) => ({ name: b.name, address: b.address, displayName: b.displayName ?? null, ...unread[b.name]! }));
  },
});

export const threads = query({
  args: { mailbox: v.string(), status: v.optional(v.string()), paginationOpts: v.optional(v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) })) },
  handler: (ctx, a) => {
    allowed(ctx, a.mailbox);
    return ctx.runQuery(email.threads, a);
  },
});

export const thread = query({ args: { threadId: v.string() }, handler: (ctx, a) => threadOf(ctx, a.threadId).t });

export const search = query({
  args: { query: v.string(), mailbox: v.optional(v.string()) },
  handler: (ctx, a) => {
    const m = member(ctx);
    if (a.mailbox) allowed(ctx, a.mailbox);
    const rows = ctx.runQuery(email.search, { query: a.query, ...(a.mailbox ? { mailbox: a.mailbox } : {}), limit: 50 }) as Array<{ mailbox: string }>;
    return rows.filter((r) => m.admin || m.mailboxes.includes(r.mailbox));
  },
});

export const reply = mutation({
  args: { threadId: v.string(), text: v.string(), attachments: attachmentsArg },
  handler: (ctx, a) => {
    const { m } = threadOf(ctx, a.threadId);
    const w = withAttachments(ctx, m, a.text, a.attachments);
    return ctx.runMutation(email.reply, { threadId: a.threadId, text: w.text, author: displayName(m), ...(w.attachments ? { attachments: w.attachments } : {}) });
  },
});

export const note = mutation({
  args: { threadId: v.string(), text: v.string() },
  handler: (ctx, a) => {
    const { m } = threadOf(ctx, a.threadId);
    return ctx.runMutation(email.note, { threadId: a.threadId, text: a.text, author: displayName(m) });
  },
});

export const markRead = mutation({
  args: { threadId: v.string() },
  handler: (ctx, a) => {
    threadOf(ctx, a.threadId);
    return ctx.runMutation(email.markRead, a);
  },
});

export const setStatus = mutation({
  args: { threadId: v.string(), status: v.union(v.literal("open"), v.literal("waiting"), v.literal("closed"), v.literal("spam")) },
  handler: (ctx, a) => {
    threadOf(ctx, a.threadId);
    return ctx.runMutation(email.setStatus, a);
  },
});

export const markUnread = mutation({
  args: { threadId: v.string() },
  handler: (ctx, a) => {
    threadOf(ctx, a.threadId);
    return ctx.runMutation(email.markUnread, a);
  },
});

/** Assigns a thread to a member who can see its mailbox (`userId: null` clears it). */
export const assign = mutation({
  args: { threadId: v.string(), userId: v.union(v.string(), v.null()) },
  handler: (ctx, a) => {
    const { t } = threadOf(ctx, a.threadId);
    if (a.userId === null) return ctx.runMutation(email.assign, { threadId: a.threadId, assignee: null });
    const target = ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", a.userId!)).first() as Member | null;
    if (!target || (!target.admin && !target.mailboxes.includes(t.thread.mailbox))) throw new Error(`${a.userId} cannot see mailbox ${t.thread.mailbox}`);
    return ctx.runMutation(email.assign, { threadId: a.threadId, assignee: target.userId, assigneeName: displayName(target) });
  },
});

/** A new conversation from a mailbox (answers join it through the thread token). */
export const compose = mutation({
  args: { mailbox: v.string(), to: v.array(v.string()), cc: v.optional(v.array(v.string())), subject: v.string(), text: v.string(), attachments: attachmentsArg },
  handler: (ctx, a) => {
    const m = allowed(ctx, a.mailbox);
    const { attachments: list, ...rest } = a;
    const w = withAttachments(ctx, m, a.text, list);
    return ctx.runMutation(email.compose, { ...rest, text: w.text, author: displayName(m), ...(w.attachments ? { attachments: w.attachments } : {}) });
  },
});

/** Who the signed-in user is for the inbox: null when signed out or not a member (the app shows "ask an admin"). */
export const me = query({
  args: {},
  handler: (ctx) => {
    const who = ctx.auth.getUserIdentity();
    if (!who) return null;
    const m = ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", who.subject)).first() as Member | null;
    if (!m) return { userId: who.subject, member: false as const, name: null, admin: false, mailboxes: [] as string[] };
    return { userId: m.userId, member: true as const, name: m.name ?? null, admin: !!m.admin, mailboxes: memberMailboxes(ctx, m) };
  },
});

/** Members who can see a mailbox (assignment picker). */
export const members = query({
  args: { mailbox: v.string() },
  handler: (ctx, a) => {
    allowed(ctx, a.mailbox);
    return (ctx.db.query("members").collect() as Member[])
      .filter((m) => m.admin || m.mailboxes.includes(a.mailbox))
      .map((m) => ({ userId: m.userId, name: displayName(m) }));
  },
});

/**
 * Download URLs of a thread's attachments, by file id (signed, stable within a 5-minute window). Separate from
 * `thread` so that query keeps returning complete documents (offline replicas store them as they are).
 */
export const attachments = query({
  args: { threadId: v.string() },
  handler: (ctx, a) => {
    const { t } = threadOf(ctx, a.threadId);
    const out: Record<string, string | null> = {};
    for (const msg of t.messages as Array<{ attachments: Array<{ file: string; filename: string }> }>) {
      for (const f of msg.attachments) out[f.file] = ctx.storage.getUrl(f.file, { download: f.filename });
    }
    return out;
  },
});

/**
 * The member's latest threads with all their messages (complete documents). The mobile app keeps this subscribed
 * (`sync`), so its offline replica — and its local FTS5 search — covers recent mail of every mailbox it can see.
 */
export const recent = query({
  args: { threads: v.optional(v.number()) },
  handler: (ctx, a) => {
    const m = member(ctx);
    return ctx.runQuery(email.recent, { mailboxes: memberMailboxes(ctx, m), threads: a.threads ?? 50 });
  },
});

/**
 * The mobile app registers its push token after sign-in. `provider` is "expo" (an Expo push token) or "apns" / "fcm"
 * (the direct transport: the native token, its APNs environment and the device's public key, so the push component
 * seals each notification to it).
 */
export const registerDevice = mutation({
  args: {
    token: v.string(),
    provider: v.optional(v.string()),
    platform: v.optional(v.string()),
    deviceName: v.optional(v.string()),
    environment: v.optional(v.string()),
    publicKey: v.optional(v.string()),
  },
  handler: (ctx, a) => {
    const m = member(ctx);
    return push.register(ctx, {
      userId: m.userId,
      token: a.token,
      ...(a.provider ? { provider: a.provider } : {}),
      ...(a.platform ? { platform: a.platform } : {}),
      ...(a.deviceName ? { deviceName: a.deviceName } : {}),
      ...(a.environment ? { environment: a.environment } : {}),
      ...(a.publicKey ? { publicKey: a.publicKey } : {}),
    });
  },
});

export const unregisterDevice = mutation({ args: { token: v.string() }, handler: (ctx, a) => (member(ctx), push.unregister(ctx, a.token)) });
