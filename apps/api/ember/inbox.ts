// The inbox for the dashboard and the mobile client (apps/mobile): reactive queries over the email component's
// mailboxes, threads and search, for signed-in members only (identity from the app's auth provider: Ember auth
// via ember/auth.config.ts, or SSO). Members see only their mailboxes; admins see every shared one; a personal mailbox
// only its owner (ember/access.ts). Push devices register here.
import { anyComponents as components, internalMutationGeneric as internalMutation, mutationGeneric as mutation, queryGeneric as query, v } from "@freecorps/ember-server";
import { escapeHtml } from "@freecorps/ember-email";
import { PushNotifications } from "@freecorps/ember-push";
import { canSee, canSeeWith, ownerOf, owners, type Member } from "./access.ts";
import {
  checkDraft,
  checkSavedReply,
  checkSignature,
  COMPOSER_LIMITS as L,
  DRAFT_KINDS,
  DRAFT_TTL_MS,
  effectiveSignature,
  sendExtras,
  signaturesOf,
  type DraftAttachment,
  type DraftDoc,
  type SavedReplyDoc,
} from "./composer.ts";

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
 * the text, and to the composer's HTML body when there is one. Every file must be uploaded (ready) already. `list`:
 * the member's own uploads; `trusted`: files already in a thread they can see (a forwarded message's attachments),
 * which need no upload of theirs.
 */
export function withAttachments(ctx: Ctx & { now: number }, m: Member, text: string, list: AttachmentArg[] | undefined, trusted: AttachmentArg[] = [], bodyHtml?: string) {
  const own = list ?? [];
  if (!own.length && !trusted.length) return { text, bodyHtml, attachments: undefined };
  if (own.length + trusted.length > L.attachments) throw new Error(`at most ${L.attachments} attachments`);
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
  if (!link.size) return { text, bodyHtml, attachments: files.map(({ size: _, ...a }) => a) };
  const until = new Date(ctx.now + LINK_TTL_S * 1000).toISOString().slice(0, 10);
  const head = `Arquivos para baixar (links válidos até ${until}):`;
  const linked = files.filter((f) => link.has(f.file)).map((f) => ({ ...f, url: ctx.storage.getUrl(f.file, { download: f.filename, expiresIn: LINK_TTL_S }) as string }));
  const html = linked.map((f) => `<a href="${escapeHtml(f.url)}">${escapeHtml(f.filename)}</a> (${mib(f.size)})`).join("<br>");
  return {
    text: `${text}\n\n—\n${head}\n${linked.map((f) => `${f.filename} (${mib(f.size)}): ${f.url}`).join("\n")}`,
    bodyHtml: bodyHtml === undefined ? undefined : `${bodyHtml}<p>—<br>${escapeHtml(head)}<br>${html}</p>`,
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

// What the composer adds to a send (reply, compose, forward), all optional, so text-only callers keep working:
//
//   bodyHtml     the rich body, an HTML fragment (`text` stays required: the text/plain part); Ember sanitizes it
//   signature    false: none; default (true): the member's signature for the mailbox (`inbox:signature`), if any
//   quoteHeader  reply only: the localized attribution line above the quote ("Em 5 de nov. de 2026, Ana escreveu:")
//   draftId      a draft of the member's (`inbox:saveDraft`), deleted in the same transaction once the send succeeds
const composerArgs = { bodyHtml: v.optional(v.string()), signature: v.optional(v.boolean()), draftId: v.optional(v.string()) };

/** The member's draft a send consumes: null when it is gone already (sent or deleted on another device). */
function draftOf(ctx: Ctx, m: Member, draftId: string | undefined): string | null {
  if (draftId === undefined) return null;
  const id = ctx.db.normalizeId("drafts", draftId);
  const d = id ? (ctx.db.get(id) as DraftDoc | null) : null;
  if (!d) return null;
  if (d.userId !== m.userId) throw new Error("draft not found");
  return d._id;
}

/** Answers the thread's contact; `cc` copies others too (reply all: the client lists who else was on the message). */
export const reply = mutation({
  args: { threadId: v.string(), text: v.string(), cc: ccArg, attachments: attachmentsArg, quoteHeader: v.optional(v.string()), ...composerArgs },
  handler: (ctx, a) => {
    const { t, m } = threadOf(ctx, a.threadId);
    const draft = draftOf(ctx, m, a.draftId);
    const extras = sendExtras(ctx.db, m.userId, t.thread.mailbox, a);
    const w = withAttachments(ctx, m, a.text, a.attachments, [], extras.bodyHtml);
    const sent = ctx.runMutation(email.reply, {
      threadId: a.threadId,
      text: w.text,
      author: displayName(m),
      ...ccOf(a.cc),
      ...extras,
      ...(w.bodyHtml !== undefined ? { bodyHtml: w.bodyHtml } : {}),
      ...(w.attachments ? { attachments: w.attachments } : {}),
    });
    if (draft) ctx.db.delete(draft as any);
    return sent;
  },
});

/**
 * Forwards a message of a thread the member can see, as a new conversation from the same mailbox. The client writes
 * `subject` and `text` (what the member wrote above the quoted original, in their language; `bodyHtml` the same in
 * HTML); the original's files go along (attached up to ATTACH_LIMIT, the rest as links), with any the member
 * uploaded. Not a note.
 */
export const forward = mutation({
  args: { threadId: v.string(), messageId: v.string(), to: v.array(v.string()), cc: ccArg, subject: v.string(), text: v.string(), attachments: attachmentsArg, ...composerArgs },
  handler: (ctx, a) => {
    const { t, m } = threadOf(ctx, a.threadId);
    const msg = (t.messages as Array<{ _id: string; direction: string; attachments: Array<{ file: string; filename: string; contentType: string; inline?: boolean; contentId?: string }> }>).find((x) => x._id === a.messageId);
    if (!msg || msg.direction === "note") throw new Error("message not found in this thread");
    const draft = draftOf(ctx, m, a.draftId);
    // Not the inline images of its HTML (signature logos): nothing in the forward shows them.
    const original = msg.attachments.filter((f) => !(f.inline && f.contentId)).map((f) => ({ file: f.file, filename: f.filename, contentType: f.contentType }));
    const extras = sendExtras(ctx.db, m.userId, t.thread.mailbox, a);
    const w = withAttachments(ctx, m, a.text, a.attachments, original, extras.bodyHtml);
    const sent = ctx.runMutation(email.compose, {
      mailbox: t.thread.mailbox,
      to: a.to,
      ...ccOf(a.cc),
      subject: a.subject,
      text: w.text,
      author: displayName(m),
      ...extras,
      ...(w.bodyHtml !== undefined ? { bodyHtml: w.bodyHtml } : {}),
      ...(w.attachments ? { attachments: w.attachments } : {}),
    });
    if (draft) ctx.db.delete(draft as any);
    return sent;
  },
});

/** An internal note on the thread (never sent); `draftId`: the note's draft, deleted with it. */
export const note = mutation({
  args: { threadId: v.string(), text: v.string(), draftId: v.optional(v.string()) },
  handler: (ctx, a) => {
    const { m } = threadOf(ctx, a.threadId);
    const draft = draftOf(ctx, m, a.draftId);
    const r = ctx.runMutation(email.note, { threadId: a.threadId, text: a.text, author: displayName(m) });
    if (draft) ctx.db.delete(draft as any);
    return r;
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
    // Everyone's drafts on it go with it (they hold their uploads).
    for (const d of ctx.db.query("drafts").withIndex("by_thread", (q) => q.eq("threadId", a.threadId)).collect()) ctx.db.delete(d._id);
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
  args: { mailbox: v.string(), to: v.array(v.string()), cc: v.optional(v.array(v.string())), subject: v.string(), text: v.string(), attachments: attachmentsArg, ...composerArgs },
  handler: (ctx, a) => {
    const m = allowed(ctx, a.mailbox);
    const draft = draftOf(ctx, m, a.draftId);
    const extras = sendExtras(ctx.db, m.userId, a.mailbox, a);
    const w = withAttachments(ctx, m, a.text, a.attachments, [], extras.bodyHtml);
    const sent = ctx.runMutation(email.compose, {
      mailbox: a.mailbox,
      to: a.to,
      ...(a.cc ? { cc: a.cc } : {}),
      subject: a.subject,
      text: w.text,
      author: displayName(m),
      ...extras,
      ...(w.bodyHtml !== undefined ? { bodyHtml: w.bodyHtml } : {}),
      ...(w.attachments ? { attachments: w.attachments } : {}),
    });
    if (draft) ctx.db.delete(draft as any);
    return sent;
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

// ---------------------------------------------------------------------------------------------- composer
// Signatures, drafts and saved replies (rules and limits: ember/composer.ts, shared with the clients as
// `@freecorps/mail-email-html/compose`). Signatures and drafts are the member's own, never anyone else's; saved
// replies belong to a mailbox.

const optionalMailbox = v.optional(v.union(v.string(), v.null()));

/** The member's signatures: their default (`mailbox` absent) and per mailbox, for the mailboxes they still see. */
export const signatures = query({
  args: {},
  handler: (ctx) => {
    const m = member(ctx);
    const personal = owners(ctx.db);
    return signaturesOf(ctx.db, m.userId).filter((s) => s.mailbox === undefined || canSeeWith(personal, m, s.mailbox));
  },
});

/**
 * The signature the member's mail from `mailbox` carries (the composer's preview): the one saved for that mailbox,
 * else their default, else null (no signature). `from`: that mailbox, or null for the default.
 */
export const signature = query({
  args: { mailbox: v.string() },
  handler: (ctx, a) => {
    const m = allowed(ctx, a.mailbox);
    const s = effectiveSignature(ctx.db, m.userId, a.mailbox);
    return s ? { text: s.text, html: s.html ?? null, from: s.from } : null;
  },
});

/**
 * Saves the member's signature for `mailbox` (one they see, shared or personal), or their default for every mailbox
 * with `mailbox` absent or null. `text` is the text part (at most 5k), `html` the rich one (at most 20k, sanitized by
 * Ember when sent). Returns the signature's id.
 */
export const setSignature = mutation({
  args: { mailbox: optionalMailbox, text: v.string(), html: v.optional(v.string()) },
  handler: (ctx, a) => {
    const m = a.mailbox ? allowed(ctx, a.mailbox) : member(ctx);
    checkSignature(a.text, a.html);
    const mailbox = a.mailbox ?? undefined;
    const doc = { userId: m.userId, ...(mailbox ? { mailbox } : {}), text: a.text, ...(a.html !== undefined && a.html.trim() ? { html: a.html } : {}), updatedAt: ctx.now };
    const prev = signaturesOf(ctx.db, m.userId).find((s) => s.mailbox === mailbox);
    if (!prev) return ctx.db.insert("signatures", doc);
    ctx.db.replace(prev._id as any, doc);
    return prev._id;
  },
});

/** Deletes the member's signature for `mailbox` (or their default): true when there was one. */
export const deleteSignature = mutation({
  args: { mailbox: optionalMailbox },
  handler: (ctx, a) => {
    const m = member(ctx);
    const prev = signaturesOf(ctx.db, m.userId).find((s) => s.mailbox === (a.mailbox ?? undefined));
    if (prev) ctx.db.delete(prev._id as any);
    return !!prev;
  },
});

/**
 * The member's drafts, newest first (complete documents, for offline replicas), only for mailboxes they still see.
 * `threadId`: that thread's drafts (reply, note, forward), which needs access to it.
 */
export const drafts = query({
  args: { threadId: v.optional(v.string()) },
  handler: (ctx, a) => {
    const m = member(ctx);
    if (a.threadId !== undefined) {
      threadOf(ctx, a.threadId);
      return (ctx.db.query("drafts").withIndex("by_thread", (q) => q.eq("threadId", a.threadId)).collect() as DraftDoc[])
        .filter((d) => d.userId === m.userId)
        .sort((x, y) => y.updatedAt - x.updatedAt);
    }
    const personal = owners(ctx.db);
    const mine = ctx.db.query("drafts").withIndex("by_user", (q) => q.eq("userId", m.userId)).order("desc").take(L.draftsPerMember) as DraftDoc[];
    return mine.filter((d) => canSeeWith(personal, m, d.mailbox));
  },
});

const kindArg = v.union(...DRAFT_KINDS.map((k) => v.literal(k)));

/**
 * Saves a draft (clients debounce). `id`: the draft to replace (the member's own); without it, a reply, note or
 * forward replaces the member's draft of the same kind on that thread (one per thread and kind, so two devices
 * write the same one), and a new conversation is a new draft. Every call writes the whole draft.
 *
 *   reply | note  threadId (the mailbox is the thread's)
 *   forward       threadId and messageId (the message forwarded; its files go along when sent)
 *   compose       mailbox (one the member sees)
 *
 * `attachments`: the member's own uploads (`generateUploadUrl`), kept while the draft waits. Returns `{ id, updatedAt }`.
 */
export const saveDraft = mutation({
  args: {
    id: v.optional(v.string()),
    kind: kindArg,
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    mailbox: v.optional(v.string()),
    to: v.optional(v.array(v.string())),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    text: v.string(),
    bodyHtml: v.optional(v.string()),
    attachments: attachmentsArg,
  },
  handler: (ctx, a) => {
    const m = member(ctx);
    let mailbox: string;
    if (a.kind === "compose") {
      if (!a.mailbox) throw new Error("mailbox: required for a new conversation");
      if (a.threadId !== undefined || a.messageId !== undefined) throw new Error("a new conversation's draft has no thread");
      allowed(ctx, a.mailbox);
      mailbox = a.mailbox;
    } else {
      if (!a.threadId) throw new Error(`threadId: required for a ${a.kind} draft`);
      const { t } = threadOf(ctx, a.threadId);
      mailbox = t.thread.mailbox;
      if (a.kind === "forward") {
        const msg = a.messageId && (t.messages as Array<{ _id: string; direction: string }>).find((x) => x._id === a.messageId);
        if (!msg || msg.direction === "note") throw new Error("message not found in this thread");
      } else if (a.messageId !== undefined) throw new Error(`a ${a.kind} draft has no messageId`);
    }
    const attachments = (a.attachments ?? []) as DraftAttachment[];
    const doc = {
      userId: m.userId,
      kind: a.kind,
      ...(a.kind !== "compose" ? { threadId: a.threadId! } : {}),
      ...(a.kind === "forward" ? { messageId: a.messageId! } : {}),
      mailbox,
      to: a.to ?? [],
      cc: a.cc ?? [],
      bcc: a.bcc ?? [],
      subject: a.subject ?? "",
      text: a.text,
      ...(a.bodyHtml !== undefined && a.bodyHtml.trim() ? { bodyHtml: a.bodyHtml } : {}),
      attachments,
      updatedAt: ctx.now,
    };
    checkDraft(doc);
    for (const f of attachments) {
      // Only the member's own uploads, as when sending (a draft never holds another mailbox's file).
      const up = ctx.db.query("uploads").withIndex("by_file", (q) => q.eq("file", f.file)).first() as { userId: string } | null;
      if (!up || up.userId !== m.userId) throw new Error(`attachment ${f.filename}: not an upload of yours`);
      if (!ctx.storage.getMetadata(f.file)) throw new Error(`attachment ${f.filename}: file not found`);
    }
    let prev: DraftDoc | null = null;
    if (a.id !== undefined) {
      const id = ctx.db.normalizeId("drafts", a.id);
      prev = id ? (ctx.db.get(id) as DraftDoc | null) : null;
      if (!prev || prev.userId !== m.userId) throw new Error("draft not found");
    } else if (a.kind !== "compose") {
      prev = (ctx.db.query("drafts").withIndex("by_thread", (q) => q.eq("threadId", a.threadId!)).collect() as DraftDoc[]).find((d) => d.userId === m.userId && d.kind === a.kind) ?? null;
    }
    if (prev) {
      ctx.db.replace(prev._id as any, doc);
      return { id: prev._id, updatedAt: ctx.now };
    }
    const mine = ctx.db.query("drafts").withIndex("by_user", (q) => q.eq("userId", m.userId)).take(L.draftsPerMember) as DraftDoc[];
    if (mine.length >= L.draftsPerMember) {
      // Drafts in mailboxes the member no longer sees are unreachable (`inbox:drafts` hides them): they give their
      // place back instead of counting against the cap.
      const personal = owners(ctx.db);
      const hidden = mine.filter((d) => !canSeeWith(personal, m, d.mailbox));
      for (const d of hidden) ctx.db.delete(d._id as any);
      if (mine.length - hidden.length >= L.draftsPerMember) throw new Error(`at most ${L.draftsPerMember} drafts: send or delete some`);
    }
    return { id: ctx.db.insert("drafts", doc) as string, updatedAt: ctx.now };
  },
});

/** Deletes one of the member's drafts: true when it was there (false when already gone). */
export const deleteDraft = mutation({
  args: { id: v.string() },
  handler: (ctx, a) => {
    const m = member(ctx);
    const id = ctx.db.normalizeId("drafts", a.id);
    const d = id ? (ctx.db.get(id) as DraftDoc | null) : null;
    if (!d) return false;
    if (d.userId !== m.userId) throw new Error("draft not found");
    ctx.db.delete(d._id as any);
    return true;
  },
});

/** Daily (ember/crons.ts): removes drafts untouched for 30 days, 500 per run, then runs again if there were more. */
export const pruneDrafts = internalMutation({
  args: {},
  handler: (ctx) => {
    const old = ctx.db.query("drafts").withIndex("by_updated", (q) => q.lt("updatedAt", ctx.now - DRAFT_TTL_MS)).take(500) as DraftDoc[];
    for (const d of old) ctx.db.delete(d._id as any);
    if (old.length === 500) ctx.scheduler.runAfter(0, "inbox:pruneDrafts" as any, {});
    return old.length;
  },
});

/**
 * A mailbox's saved replies, by title (complete documents, for offline replicas). Templates as written: the clients
 * fill their variables when inserting one (`fillSavedReply` and the variable set in
 * `@freecorps/mail-email-html/compose`: {nome}, {primeiro_nome}, {email}, {caixa}, {agente}, {numero}).
 * A member may change one when `createdBy` is them or they are an admin.
 */
export const savedReplies = query({
  args: { mailbox: v.string() },
  handler: (ctx, a) => {
    allowed(ctx, a.mailbox);
    return (ctx.db.query("savedReplies").withIndex("by_mailbox", (q) => q.eq("mailbox", a.mailbox)).collect() as SavedReplyDoc[]).sort(
      (x, y) => x.title.localeCompare(y.title, "pt-BR", { sensitivity: "base" }) || x._creationTime - y._creationTime,
    );
  },
});

function savedReplyOf(ctx: Ctx, id: string) {
  const nid = ctx.db.normalizeId("savedReplies", id);
  const r = nid ? (ctx.db.get(nid) as SavedReplyDoc | null) : null;
  if (!r) throw new Error("saved reply not found");
  const m = allowed(ctx, r.mailbox);
  if (r.createdBy !== m.userId && !m.admin) throw new Error("only its author or an admin changes a saved reply");
  return r;
}

/**
 * Creates a saved reply in `mailbox` (any member who sees it), or with `id` replaces one of that mailbox (its author
 * or an admin). `title` at most 200, `text` and `bodyHtml` at most 200k. Returns `{ id, updatedAt }`.
 */
export const saveSavedReply = mutation({
  args: { id: v.optional(v.string()), mailbox: v.string(), title: v.string(), text: v.string(), bodyHtml: v.optional(v.string()) },
  handler: (ctx, a) => {
    const m = allowed(ctx, a.mailbox);
    checkSavedReply(a);
    const body = { mailbox: a.mailbox, title: a.title.trim(), text: a.text, ...(a.bodyHtml !== undefined && a.bodyHtml.trim() ? { bodyHtml: a.bodyHtml } : {}), updatedAt: ctx.now };
    if (a.id !== undefined) {
      const prev = savedReplyOf(ctx, a.id);
      if (prev.mailbox !== a.mailbox) throw new Error("saved reply not found");
      ctx.db.replace(prev._id as any, { ...body, createdBy: prev.createdBy });
      return { id: prev._id, updatedAt: ctx.now };
    }
    if (ctx.db.query("savedReplies").withIndex("by_mailbox", (q) => q.eq("mailbox", a.mailbox)).take(L.savedRepliesPerMailbox).length >= L.savedRepliesPerMailbox) {
      throw new Error(`at most ${L.savedRepliesPerMailbox} saved replies per mailbox`);
    }
    return { id: ctx.db.insert("savedReplies", { ...body, createdBy: m.userId }) as string, updatedAt: ctx.now };
  },
});

/** Deletes a saved reply (its author or an admin). */
export const deleteSavedReply = mutation({
  args: { id: v.string() },
  handler: (ctx, a) => {
    ctx.db.delete(savedReplyOf(ctx, a.id)._id as any);
    return true;
  },
});
