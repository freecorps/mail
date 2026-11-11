// The inbox for the dashboard and the mobile client (apps/mobile): reactive queries over the email component's
// mailboxes, threads and search, for signed-in members only (identity from the app's auth provider: Ember auth
// via ember/auth.config.ts, or SSO). Members see only their mailboxes; admins see every shared one; a personal mailbox
// only its owner (ember/access.ts). Push devices register here.
import { anyComponents as components, mutationGeneric as mutation, queryGeneric as query, v } from "@freecorps/ember-server";
import { PushNotifications } from "@freecorps/ember-push";
import { canSee, canSeeWith, ownerOf, owners, type Member } from "./access.ts";

const push = new PushNotifications(components.push);
const email = components.email.lib;

type Ctx = { auth: { getUserIdentity(): { subject: string; name?: string; email?: string } | null }; db: any; runQuery: any; storage?: any };

const displayName = (m: Member) => m.name ?? m.userId;

function member(ctx: Ctx) {
  const who = ctx.auth.getUserIdentity();
  if (!who) throw new Error("unauthenticated");
  const m = ctx.db.query("members").withIndex("by_user", (q: any) => q.eq("userId", who.subject)).first();
  if (!m) throw new Error("not a member of any mailbox");
  return m as Member;
}

/** The mailboxes `m` can see: their own (personal) first, so a client opening "the first one" opens theirs. */
function memberMailboxes(ctx: Ctx, m: Member): string[] {
  const personal = owners(ctx.db);
  const names = (ctx.runQuery(email.mailboxes, {}) as Array<{ name: string }>).map((b) => b.name).filter((n) => canSeeWith(personal, m, n));
  return [...names.filter((n) => personal.has(n)), ...names.filter((n) => !personal.has(n))];
}

function allowed(ctx: Ctx, mailbox: string) {
  const m = member(ctx);
  if (!canSee(ctx.db, m, mailbox)) throw new Error(`no access to mailbox ${mailbox}`);
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
 * the text. Every file must be uploaded (ready) already. `list`: the member's own uploads; `trusted`: files already
 * in a thread they can see (a forwarded message's attachments), which need no upload of theirs.
 */
export function withAttachments(ctx: Ctx & { now: number }, m: Member, text: string, list: AttachmentArg[] | undefined, trusted: AttachmentArg[] = []) {
  const own = list ?? [];
  if (!own.length && !trusted.length) return { text, attachments: undefined };
  if (own.length + trusted.length > 20) throw new Error("at most 20 attachments");
  const files = [...trusted.map((a) => ({ ...a, trusted: true })), ...own.map((a) => ({ ...a, trusted: false }))].map(({ trusted: ok, ...a }) => {
    // Only the member's own uploads: a file id seen elsewhere (another mailbox's attachment) is refused.
    const up = ok ? null : (ctx.db.query("uploads").withIndex("by_file", (q: any) => q.eq("file", a.file)).first() as { userId: string } | null);
    if (!ok && (!up || up.userId !== m.userId)) throw new Error(`attachment ${a.filename}: not an upload of yours`);
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
    if (!Number.isSafeInteger(a.size) || a.size <= 0) throw new Error("size must be a positive integer (an empty file is not an attachment)");
    if (a.size > MAX_UPLOAD) throw new Error(`file too large: at most ${mib(MAX_UPLOAD)}`);
    const ticket = ctx.storage.generateUploadUrl(a);
    ctx.db.insert("uploads", { file: ticket.storageId, userId: m.userId, at: ctx.now });
    return ticket;
  },
});

/** Mailboxes this member can see, with unread counts (aggregate); `personal`: their own mailbox, no one else's. */
export const mailboxes = query({
  args: {},
  handler: (ctx) => {
    const m = member(ctx);
    const personal = owners(ctx.db);
    const all = (ctx.runQuery(email.mailboxes, {}) as Array<{ name: string; address: string; displayName?: string }>).filter((b) => canSeeWith(personal, m, b.name));
    const unread = ctx.runQuery(email.unread, { mailboxes: all.map((b) => b.name) }) as Record<string, { unread: number; threads: number }>;
    return all.map((b) => ({ name: b.name, address: b.address, displayName: b.displayName ?? null, personal: personal.has(b.name), ...unread[b.name]! }));
  },
});

export const threads = query({
  args: { mailbox: v.string(), status: v.optional(v.string()), paginationOpts: v.optional(v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) })) },
  handler: (ctx, a) => {
    allowed(ctx, a.mailbox);
    return ctx.runQuery(email.threads, a);
  },
});

// ---------------------------------------------------------------------------------------------- views
// Lists across every mailbox the member can see, for the home screen of the clients (Mail.app's "All Inboxes"):
//
//   all       every thread, newest first (`status` narrows it, as in `threads`)
//   assigned  threads assigned to the member; open and waiting ones unless `status` says otherwise
//   unread    threads with unread messages; open and waiting ones unless `status` says otherwise
//   waiting   threads waiting on the contact
//
// Each mailbox is read through the email component's own index (`threads`: by mailbox, or by mailbox and status, newest
// first) and the pages are merged, so `all` and `waiting` are exact. The component has no index by assignee or by
// unread, so `assigned` and `unread` scan each mailbox's open and waiting threads (what is still being worked on: a new
// message reopens a closed thread) up to VIEW_SCAN, and say `partial` when a mailbox had more than that.

export const VIEWS = ["all", "assigned", "unread", "waiting"] as const;
export type View = (typeof VIEWS)[number];
/** Most threads one `view` read returns (the list grows its `limit` as it scrolls, up to here). */
export const VIEW_MAX = 300;
/** Most threads `assigned` and `unread` read per mailbox and status to find theirs (and `views` to count them). */
export const VIEW_SCAN = 500;
const ACTIVE = ["open", "waiting"] as const;

const statusArg = v.optional(v.union(v.literal("open"), v.literal("waiting"), v.literal("closed"), v.literal("spam")));
type ThreadRow = { _id: string; mailbox: string; status: string; lastMessageAt: number; unreadCount: number; assignee?: string };
type Page = { page: ThreadRow[]; isDone: boolean; continueCursor: string };

/** Which ranges (mailbox × status) a view reads, and which of their threads it keeps. */
function planOf(view: View, status: string | undefined, m: Member, personal: Map<string, string>) {
  switch (view) {
    case "all":
      return { statuses: [status], keep: undefined };
    case "waiting":
      return { statuses: ["waiting"], keep: undefined };
    case "assigned":
      // A personal mailbox has no assignment: nothing to read there.
      return { statuses: status ? [status] : [...ACTIVE], keep: (t: ThreadRow) => t.assignee === m.userId, skip: (mb: string) => personal.has(mb) };
    case "unread":
      return { statuses: status ? [status] : [...ACTIVE], keep: (t: ThreadRow) => t.unreadCount > 0 };
  }
}

/**
 * The newest `want` threads of one mailbox (and status) that `keep` accepts. `done`: no other thread of the range
 * matches; `partial`: the scan stopped at VIEW_SCAN threads before finding `want` or reaching the end.
 */
function rangeOf(ctx: Ctx, mailbox: string, status: string | undefined, keep: ((t: ThreadRow) => boolean) | undefined, want: number) {
  const rows: ThreadRow[] = [];
  let cursor: string | null = null;
  let scanned = 0;
  for (;;) {
    const numItems = keep ? Math.min(100, VIEW_SCAN - scanned) : want;
    const r = ctx.runQuery(email.threads, { mailbox, ...(status ? { status } : {}), paginationOpts: { numItems, cursor } }) as Page;
    scanned += r.page.length;
    rows.push(...(keep ? r.page.filter(keep) : r.page));
    if (rows.length >= want) return { rows: rows.slice(0, want), done: r.isDone && rows.length === want, partial: false };
    if (r.isDone) return { rows, done: true, partial: false };
    if (scanned >= VIEW_SCAN) return { rows, done: false, partial: true };
    cursor = r.continueCursor;
  }
}

const newestFirst = (a: ThreadRow, b: ThreadRow) => b.lastMessageAt - a.lastMessageAt || (a._id < b._id ? 1 : a._id > b._id ? -1 : 0);

/**
 * A view across the member's mailboxes, newest first: `{ page, isDone, partial }`. `limit` grows as the list scrolls
 * (like `sent`), up to VIEW_MAX. `partial`: some mailbox had more open and waiting threads than `assigned`/`unread`
 * scan, so older matches may be missing.
 */
export const view = query({
  args: { view: v.union(...VIEWS.map((x) => v.literal(x))), status: statusArg, limit: v.optional(v.number()) },
  handler: (ctx, a) => {
    const m = member(ctx);
    const want = Math.min(Math.max(Math.trunc(a.limit ?? 30), 1), VIEW_MAX);
    const personal = owners(ctx.db);
    const plan = planOf(a.view as View, a.status, m, personal);
    const skip = "skip" in plan ? plan.skip : undefined;
    const ranges = memberMailboxes(ctx, m)
      .filter((mb) => !skip?.(mb))
      .flatMap((mb) => plan.statuses.map((s) => rangeOf(ctx, mb, s, plan.keep, want)));
    const rows = ranges.flatMap((r) => r.rows).sort(newestFirst);
    return { page: rows.slice(0, want), isDone: rows.length <= want && ranges.every((r) => r.done), partial: ranges.some((r) => r.partial) };
  },
});

/** A view's count: its threads, their unread messages, and `capped` when a mailbox had more than VIEW_SCAN to count. */
export type ViewCount = { threads: number; unread: number; capped: boolean };

/**
 * The home screen's counts, one per view. `all` is the email component's aggregate (exact: every thread and unread
 * message of the member's mailboxes); the others count the open and waiting threads of each mailbox, up to VIEW_SCAN
 * per mailbox and status.
 */
export const views = query({
  args: {},
  handler: (ctx) => {
    const m = member(ctx);
    const personal = owners(ctx.db);
    const boxes = memberMailboxes(ctx, m);
    const agg = ctx.runQuery(email.unread, { mailboxes: boxes }) as Record<string, { unread: number; threads: number }>;
    const zero = (): ViewCount => ({ threads: 0, unread: 0, capped: false });
    const out = { all: zero(), assigned: zero(), unread: zero(), waiting: zero() } satisfies Record<View, ViewCount>;
    for (const mb of boxes) {
      out.all.threads += agg[mb]?.threads ?? 0;
      out.all.unread += agg[mb]?.unread ?? 0;
      for (const status of ACTIVE) {
        const r = rangeOf(ctx, mb, status, undefined, VIEW_SCAN);
        const add = (c: ViewCount, list: ThreadRow[]) => {
          c.threads += list.length;
          c.unread += list.reduce((n, t) => n + t.unreadCount, 0);
          c.capped ||= !r.done;
        };
        if (!personal.has(mb)) add(out.assigned, r.rows.filter((t) => t.assignee === m.userId));
        add(out.unread, r.rows.filter((t) => t.unreadCount > 0));
        if (status === "waiting") add(out.waiting, r.rows);
      }
    }
    return out;
  },
});

/** Most sent conversations one `sent` read returns (the list grows its `limit` as it scrolls, up to here). */
export const SENT_MAX = 300;

/**
 * The mailbox's Sent view: the conversations it wrote in (a reply or a new conversation), by its latest send, newest
 * first. `limit` grows as the list scrolls, like `threads`; the component pages by 100, so this reads its pages on.
 */
export const sent = query({
  args: { mailbox: v.string(), limit: v.optional(v.number()) },
  handler: (ctx, a) => {
    allowed(ctx, a.mailbox);
    const want = Math.min(Math.max(Math.trunc(a.limit ?? 30), 1), SENT_MAX);
    const page: Array<Record<string, unknown>> = [];
    let before: string | undefined;
    // A component page can come back short (it scans a window of sends); a few more reads fill it, bounded.
    for (let reads = 1; ; reads++) {
      const r = ctx.runQuery(email.sent, { mailbox: a.mailbox, limit: Math.min(want - page.length, 100), ...(before ? { before } : {}) }) as {
        page: Array<Record<string, unknown>>;
        next: string | null;
      };
      page.push(...r.page);
      if (!r.next) return { page, isDone: true };
      // At the cap the list ends there (older sends: search); otherwise a bigger `limit` reads on.
      if (page.length >= want || reads >= 10) return { page, isDone: want >= SENT_MAX };
      before = r.next;
    }
  },
});

/**
 * Sent messages per thread that get a delivery marker (the latest ones). Each is one read of its email row in this
 * shard's transaction (no network), and that read is what makes the marker live; the cap bounds a long thread.
 */
export const DELIVERY_MARKED = 50;

/** Delivery events that end in "not delivered": where the shown reason comes from. */
const FAILURE_EVENTS = new Set(["bounced", "failed", "rejected", "complained"]);

/** Statuses where delivery did not happen: their reason is shown (the bounce's, else the send error's). */
const UNDELIVERED = new Set(["bounced", "failed", "suppressed", "complained"]);

/**
 * Where each email the thread sent is (`delivery`: queued, sent, delivered, bounced…), read with the thread so the
 * marker updates live as delivery events arrive. Notes and inbound messages have none.
 */
function withDelivery(ctx: Ctx, t: { thread: unknown; messages: Array<Record<string, any>> }) {
  // Only the latest DELIVERY_MARKED sends get a marker: what is still in flight; older ones settled long ago.
  const marked = new Set(
    t.messages
      .filter((m) => m.direction === "outbound" && m.emailId)
      .slice(-DELIVERY_MARKED)
      .map((m) => m._id),
  );
  const messages = t.messages.map((m) => {
    if (!marked.has(m._id)) return m;
    const e = ctx.runQuery(email.get, { id: m.emailId }) as { _id: string; status: string; error?: { message: string } } | null;
    if (!e) return m;
    let reason: string | null = null;
    if (UNDELIVERED.has(e.status)) {
      const evs = ctx.runQuery(email.events, { id: e._id }) as Array<{ type: string; reason?: string; at: number }>;
      // The reason of the failure itself (a bounce, a rejection), never an earlier delay's.
      const last = evs.filter((x) => x.reason && FAILURE_EVENTS.has(x.type)).sort((x, y) => y.at - x.at)[0];
      reason = (last?.reason ?? e.error?.message ?? null)?.slice(0, 300) ?? null;
    }
    return { ...m, delivery: { status: e.status, reason } };
  });
  return { ...t, messages };
}

export const thread = query({ args: { threadId: v.string() }, handler: (ctx, a) => withDelivery(ctx, threadOf(ctx, a.threadId).t) });

export const search = query({
  args: { query: v.string(), mailbox: v.optional(v.string()) },
  handler: (ctx, a) => {
    const m = member(ctx);
    if (a.mailbox) allowed(ctx, a.mailbox);
    const rows = ctx.runQuery(email.search, { query: a.query, ...(a.mailbox ? { mailbox: a.mailbox } : {}), limit: 50 }) as Array<{ mailbox: string }>;
    const personal = owners(ctx.db);
    return rows.filter((r) => canSeeWith(personal, m, r.mailbox));
  },
});

/** Most people a reply or a forward copies (`cc`), well past any real "reply all". */
export const MAX_CC = 50;

const ccArg = v.optional(v.array(v.string()));
function ccOf(cc: string[] | undefined) {
  if (cc && cc.length > MAX_CC) throw new Error(`at most ${MAX_CC} people in copy`);
  return cc?.length ? { cc } : {};
}

/** Answers the thread's contact; `cc` copies others too (reply all: the client lists who else was on the message). */
export const reply = mutation({
  args: { threadId: v.string(), text: v.string(), cc: ccArg, attachments: attachmentsArg },
  handler: (ctx, a) => {
    const { m } = threadOf(ctx, a.threadId);
    const w = withAttachments(ctx, m, a.text, a.attachments);
    return ctx.runMutation(email.reply, { threadId: a.threadId, text: w.text, author: displayName(m), ...ccOf(a.cc), ...(w.attachments ? { attachments: w.attachments } : {}) });
  },
});

/**
 * Forwards a message of a thread the member can see, as a new conversation from the same mailbox. The client writes
 * `subject` and `text` (what the member wrote above the quoted original, in their language); the original's files go
 * along (attached up to ATTACH_LIMIT, the rest as links), with any the member uploaded. Not a note.
 */
export const forward = mutation({
  args: { threadId: v.string(), messageId: v.string(), to: v.array(v.string()), cc: ccArg, subject: v.string(), text: v.string(), attachments: attachmentsArg },
  handler: (ctx, a) => {
    const { t, m } = threadOf(ctx, a.threadId);
    const msg = (t.messages as Array<{ _id: string; direction: string; attachments: Array<{ file: string; filename: string; contentType: string; inline?: boolean; contentId?: string }> }>).find((x) => x._id === a.messageId);
    if (!msg || msg.direction === "note") throw new Error("message not found in this thread");
    // Not the inline images of its HTML (signature logos): the forward is text, and nothing shows them.
    const original = msg.attachments.filter((f) => !(f.inline && f.contentId)).map((f) => ({ file: f.file, filename: f.filename, contentType: f.contentType }));
    const w = withAttachments(ctx, m, a.text, a.attachments, original);
    return ctx.runMutation(email.compose, {
      mailbox: t.thread.mailbox,
      to: a.to,
      ...ccOf(a.cc),
      subject: a.subject,
      text: w.text,
      author: displayName(m),
      ...(w.attachments ? { attachments: w.attachments } : {}),
    });
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

/**
 * Deletes a conversation for good: its messages, notes and files (the email component's `deleteThread`; a reply still
 * waiting to go is canceled). Admins in a shared mailbox, the owner in a personal one; other members cannot.
 */
export const deleteThread = mutation({
  args: { threadId: v.string() },
  handler: (ctx, a) => {
    const { t, m } = threadOf(ctx, a.threadId);
    const owner = ownerOf(ctx.db, t.thread.mailbox);
    if (owner !== null ? owner !== m.userId : !m.admin) throw new Error("only an admin (or a personal mailbox's owner) deletes a conversation");
    return ctx.runMutation(email.deleteThread, a) as { deleted: boolean; canceled?: number };
  },
});

export const markUnread = mutation({
  args: { threadId: v.string() },
  handler: (ctx, a) => {
    threadOf(ctx, a.threadId);
    return ctx.runMutation(email.markUnread, a);
  },
});

/** Assigns a thread to a member who can see its mailbox (`userId: null` clears it). Not in a personal mailbox. */
export const assign = mutation({
  args: { threadId: v.string(), userId: v.union(v.string(), v.null()) },
  handler: (ctx, a) => {
    const { t } = threadOf(ctx, a.threadId);
    if (ownerOf(ctx.db, t.thread.mailbox) !== null) throw new Error("a personal mailbox has no assignment");
    if (a.userId === null) return ctx.runMutation(email.assign, { threadId: a.threadId, assignee: null });
    const target = ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", a.userId!)).first() as Member | null;
    if (!target || !canSee(ctx.db, target, t.thread.mailbox)) throw new Error(`${a.userId} cannot see mailbox ${t.thread.mailbox}`);
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

/**
 * Asks for access: the signed-in user, not a member yet, is listed for admins (GET /inbox/members `requests`) with the
 * email and name of their sign-in, so an admin grants them (or makes their own mailbox) without asking for an id. A
 * member's call does nothing; calling again keeps the first `at` and only updates a changed email or name.
 */
export const requestAccess = mutation({
  args: {},
  handler: (ctx) => {
    const who = ctx.auth.getUserIdentity();
    if (!who) throw new Error("unauthenticated");
    if (ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", who.subject)).first()) return null;
    // Ember auth puts the sign-in's email and name in the token's claims.
    const claim = (k: string) => (typeof who.claims?.[k] === "string" && who.claims[k] ? (who.claims[k] as string) : null);
    const email = claim("email");
    const name = claim("name");
    const row = { userId: who.subject, at: ctx.now, ...(email ? { email: email.slice(0, 320) } : {}), ...(name ? { name: name.slice(0, 200) } : {}) };
    const prev = ctx.db.query("accessRequests").withIndex("by_user", (q) => q.eq("userId", who.subject)).first();
    if (!prev) ctx.db.insert("accessRequests", row);
    // Asking again keeps when they first asked; only a changed email or name is written.
    else {
      // A sign-in without an email or a name never clears the one stored.
      const changed = { ...(email && email.slice(0, 320) !== prev.email ? { email: email.slice(0, 320) } : {}), ...(name && name.slice(0, 200) !== prev.name ? { name: name.slice(0, 200) } : {}) };
      if (Object.keys(changed).length) ctx.db.patch(prev._id, changed);
    }
    return null;
  },
});

/** Members who can see a mailbox (assignment picker). */
export const members = query({
  args: { mailbox: v.string() },
  handler: (ctx, a) => {
    allowed(ctx, a.mailbox);
    const personal = owners(ctx.db);
    return (ctx.db.query("members").collect() as Member[])
      .filter((m) => canSeeWith(personal, m, a.mailbox))
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
