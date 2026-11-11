// Optimistic updates by mutation name. Registered on the client (not per call), so a mutation queued offline and
// restored after a restart is still shown: the reply appears in the thread with a "sending" mark, the thread moves to
// "waiting", unread counters drop, and the server's answer replaces all of it when the queue drains.
import type { OptimisticLocalStore, OptimisticUpdate } from "@freecorps/ember-react-native";
import { INBOX_VIEWS, type Draft, type SaveDraftArgs, type Mailbox, type Message, type Page, type SentArgs, type SentThread, type Thread, type ThreadDetail, type ThreadStatus, type ThreadsArgs, type ViewArgs, type ViewCounts, type ViewPage } from "../api";
import { viewKeeps } from "./replica";

/** Ids of optimistic rows start with this (the UI shows them as pending). */
export const OPTIMISTIC_PREFIX = "optimistic:";
export const isOptimisticId = (id: string): boolean => id.startsWith(OPTIMISTIC_PREFIX);

let seq = 0;
const tempId = (now: number) => `${OPTIMISTIC_PREFIX}${now.toString(36)}-${(seq++).toString(36)}`;

type Store = OptimisticLocalStore;

/**
 * Moves the home screen's counts (`inbox:views`) for one thread going from `before` to `after`, by the views' own rules
 * (`viewKeeps`): it leaves or joins a view, and its unread messages go with it. The badges (Minhas, the home rows) then
 * follow a read, archive or assignment at once, offline too.
 */
function adjustViewCounts(store: Store, before: Thread, after: Thread) {
  const counts = store.getQuery<any>("inbox:views", {}) as ViewCounts | undefined;
  if (!counts) return;
  const next = { ...counts };
  for (const view of INBOX_VIEWS) {
    const keeps = viewKeeps(view, undefined);
    const was = keeps(before);
    const is = keeps(after);
    if (!was && !is) continue;
    const c = counts[view];
    next[view] = {
      ...c,
      threads: Math.max(0, c.threads + (is ? 1 : 0) - (was ? 1 : 0)),
      unread: Math.max(0, c.unread + (is ? after.unreadCount : 0) - (was ? before.unreadCount : 0)),
    };
  }
  store.setQuery<any>("inbox:views", {}, next);
}

/**
 * Applies `patch` to the thread wherever it is loaded (its detail and every thread-list page) and moves the view counts
 * with it.
 */
function patchThread(store: Store, threadId: string, patch: (t: Thread) => Thread): Thread | null {
  let found = patchLoaded(store, threadId, patch);
  // Loaded nowhere any more (an archive dropped it from the only list showing it): the copy kept when it was dropped
  // lets a later patch, such as "Desfazer", put it back.
  const last = dropped.get(threadId);
  if (!found && last) found = { before: last, after: patch(last) };
  if (!found) return null;
  if (dropped.has(threadId)) remember(found.after);
  rejoin(store, found.after);
  adjustViewCounts(store, found.before, found.after);
  return found.after;
}

/** Threads an optimistic patch dropped from a list (newest last), so a later patch can bring them back. */
const dropped = new Map<string, Thread>();
function remember(t: Thread) {
  dropped.delete(t._id);
  dropped.set(t._id, t);
  if (dropped.size > 200) dropped.delete(dropped.keys().next().value!);
}

const newerFirst = (a: Thread, b: Thread) => b.lastMessageAt - a.lastMessageAt;
/** Whether `t` falls inside what a page has loaded (a complete list, or not older than its last row). */
const inLoadedRange = (v: { page: Thread[]; isDone: boolean }, t: Thread) => v.isDone || !v.page.length || t.lastMessageAt >= v.page[v.page.length - 1]!.lastMessageAt;

/**
 * Puts `t` into every loaded list it now belongs to and is missing from (an unarchived thread back in "Abertas" and the
 * views), in date order, as the server's answer will.
 */
function rejoin(store: Store, t: Thread) {
  for (const { args, value } of store.getAllQueries<any>("inbox:threads") as Array<{ args: ThreadsArgs; value: Page<Thread> | undefined }>) {
    if (!value || args.mailbox !== t.mailbox || (args.status !== undefined && args.status !== t.status)) continue;
    if (value.page.some((x) => x._id === t._id) || !inLoadedRange(value, t)) continue;
    store.setQuery<any>("inbox:threads", args, { ...value, page: [...value.page, t].sort(newerFirst) });
  }
  for (const { args, value } of store.getAllQueries<any>("inbox:view") as Array<{ args: ViewArgs; value: ViewPage | undefined }>) {
    if (!value || !viewKeeps(args.view, args.status)(t)) continue;
    if (value.page.some((x) => x._id === t._id) || !inLoadedRange(value, t)) continue;
    store.setQuery<any>("inbox:view", args, { ...value, page: [...value.page, t].sort(newerFirst) });
  }
}

function patchLoaded(store: Store, threadId: string, rawPatch: (t: Thread) => Thread): { before: Thread; after: Thread } | null {
  let original: Thread | null = null;
  const patch = (t: Thread) => ((original ??= t), rawPatch(t));
  let found: Thread | null = null;
  const detail = store.getQuery<any>("inbox:thread", { threadId }) as ThreadDetail | undefined;
  if (detail) {
    found = patch(detail.thread);
    store.setQuery<any>("inbox:thread", { threadId }, { ...detail, thread: found });
  }
  for (const { args, value } of store.getAllQueries<any>("inbox:threads") as Array<{ args: ThreadsArgs; value: Page<Thread> | undefined }>) {
    if (!value) continue;
    const i = value.page.findIndex((t) => t._id === threadId);
    if (i < 0) continue;
    const next = patch(value.page[i]!);
    found ??= next;
    // A status filter the thread no longer matches drops it from that list.
    const drop = args.status !== undefined && args.status !== next.status;
    if (drop) remember(next);
    const page = drop ? value.page.filter((_, j) => j !== i) : value.page.map((t, j) => (j === i ? next : t));
    store.setQuery<any>("inbox:threads", args, { ...value, page });
  }
  // The cross-mailbox views: patched in place, or dropped when it no longer belongs (read in "unread", archived in
  // "waiting"); `rejoin` adds it to the ones it now belongs to.
  for (const { args, value } of store.getAllQueries<any>("inbox:view") as Array<{ args: ViewArgs; value: ViewPage | undefined }>) {
    const i = value ? value.page.findIndex((t) => t._id === threadId) : -1;
    if (!value || i < 0) continue;
    const next = patch(value.page[i]!);
    found ??= next;
    const keep = viewKeeps(args.view, args.status)(next);
    if (!keep) remember(next);
    const page = keep ? value.page.map((t, j) => (j === i ? next : t)) : value.page.filter((_, j) => j !== i);
    store.setQuery<any>("inbox:view", args, { ...value, page });
  }
  // The Sent view lists it too, whatever its status: patched in place (its place is when the mailbox last wrote).
  for (const { args, value } of store.getAllQueries<any>("inbox:sent") as Array<{ args: SentArgs; value: SentPage | undefined }>) {
    const i = value ? value.page.findIndex((t) => t._id === threadId) : -1;
    if (!value || i < 0) continue;
    const next: SentThread = { ...patch(value.page[i]!), lastSentAt: value.page[i]!.lastSentAt };
    found ??= next;
    store.setQuery<any>("inbox:sent", args, { ...value, page: value.page.map((t, j) => (j === i ? next : t)) });
  }
  return found && original ? { before: original, after: found } : null;
}

type SentPage = { page: SentThread[]; isDone: boolean };

/** The mailbox just wrote in `thread`: it goes to the top of that mailbox's Sent lists (once). */
function sentNow(store: Store, thread: Thread, at: number) {
  for (const { args, value } of store.getAllQueries<any>("inbox:sent") as Array<{ args: SentArgs; value: SentPage | undefined }>) {
    if (!value || args.mailbox !== thread.mailbox) continue;
    const { lastSentAt: _l, ...plain } = thread as SentThread;
    const rest = value.page.filter((t) => t._id !== thread._id);
    store.setQuery<any>("inbox:sent", args, { ...value, page: [{ ...plain, lastSentAt: at }, ...rest] });
  }
}

function adjustUnread(store: Store, mailbox: string, delta: number) {
  const boxes = store.getQuery<any>("inbox:mailboxes", {}) as Mailbox[] | undefined;
  if (!boxes) return;
  store.setQuery<any>("inbox:mailboxes", {}, boxes.map((b) => (b.name === mailbox ? { ...b, unread: Math.max(0, b.unread + delta) } : b)));
}

function append(store: Store, args: { threadId: string; text: string }, direction: "outbound" | "note", now: number) {
  const detail = store.getQuery<any>("inbox:thread", { threadId: args.threadId }) as ThreadDetail | undefined;
  const snippet = args.text.replace(/\s+/g, " ").trim().slice(0, 140);
  if (detail) {
    const t = detail.thread;
    const msg: Message = {
      _id: tempId(now),
      _creationTime: now,
      threadId: t._id,
      mailbox: t.mailbox,
      direction,
      references: [],
      from: { email: t.mailbox },
      fromEmail: t.mailbox,
      to: direction === "note" ? [] : [{ email: t.contact, ...(t.contactName ? { name: t.contactName } : {}) }],
      cc: [],
      subject: t.subject,
      text: args.text,
      snippet,
      searchText: "",
      attachments: [],
      autoSubmitted: false,
      at: now,
    };
    store.setQuery<any>("inbox:thread", { threadId: args.threadId }, { ...detail, messages: [...detail.messages, msg] });
  }
  const thread = patchThread(store, args.threadId, (t) => ({
    ...t,
    messageCount: t.messageCount + 1,
    lastMessageAt: now,
    ...(direction === "note" ? {} : { status: t.status === "spam" ? "spam" : ("waiting" as ThreadStatus), snippet }),
  }));
  if (thread && direction === "outbound") sentNow(store, thread, now);
}

/** `now` is injectable for tests. */
/** The mailbox of a thread as the client has it loaded (its open thread, or any list it is in). */
function mailboxOf(store: OptimisticLocalStore, threadId: string): string | null {
  const open = store.getQuery<any>("inbox:thread", { threadId }) as ThreadDetail | undefined;
  if (open?.thread) return open.thread.mailbox;
  for (const { value } of store.getAllQueries<any>("inbox:threads") as Array<{ value: Page<Thread> | undefined }>) {
    const t = value?.page.find((x) => x._id === threadId);
    if (t) return t.mailbox;
  }
  return null;
}

/** Removes a draft from every cached `inbox:drafts` answer. */
function dropDraft(store: Store, id: string) {
  for (const { args, value } of store.getAllQueries<any>("inbox:drafts") as Array<{ args: { threadId?: string }; value: Draft[] | undefined }>) {
    if (value?.some((d) => d._id === id)) store.setQuery<any>("inbox:drafts", args, value.filter((d) => d._id !== id));
  }
}

/** Puts a saved draft into the cached `inbox:drafts` answers it belongs to (the server's upsert rules), newest first. */
function saveDraftLocally(store: Store, a: SaveDraftArgs, at: number) {
  const cached = store.getAllQueries<any>("inbox:drafts") as Array<{ args: { threadId?: string }; value: Draft[] | undefined }>;
  // By id; a reply, note or forward also by thread and kind (one per thread and kind on the server).
  const same = (d: Draft) => (a.id ? d._id === a.id : a.kind !== "compose" && d.threadId === a.threadId && d.kind === a.kind);
  // One id for the draft in every list it shows in.
  const id = a.id ?? cached.flatMap((q) => q.value ?? []).find(same)?._id ?? tempId(at);
  for (const { args, value } of cached) {
    if (!value || (args.threadId !== undefined && args.threadId !== a.threadId)) continue;
    const prev = value.find(same);
    const draft: Draft = {
      _id: id,
      _creationTime: prev?._creationTime ?? at,
      userId: prev?.userId ?? "",
      kind: a.kind,
      ...(a.threadId ? { threadId: a.threadId } : {}),
      ...(a.messageId ? { messageId: a.messageId } : {}),
      mailbox: a.mailbox ?? prev?.mailbox ?? "",
      to: a.to ?? [],
      cc: a.cc ?? [],
      bcc: a.bcc ?? [],
      subject: a.subject ?? "",
      text: a.text,
      ...(a.bodyHtml ? { bodyHtml: a.bodyHtml } : {}),
      attachments: a.attachments ?? [],
      updatedAt: at,
    };
    store.setQuery<any>("inbox:drafts", args, [draft, ...value.filter((d) => !same(d))]);
  }
}

export function inboxOptimisticUpdates(now: () => number = Date.now): Record<string, OptimisticUpdate> {
  const updates: Record<string, OptimisticUpdate> = {
    "inbox:reply": (store, args: { threadId: string; text: string }) => append(store, args, "outbound", now()),
    "inbox:note": (store, args: { threadId: string; text: string }) => append(store, args, "note", now()),
    "inbox:markRead": (store, { threadId }: { threadId: string }) => {
      let before = 0;
      const t = patchThread(store, threadId, (x) => ((before = x.unreadCount), { ...x, unreadCount: 0 }));
      if (t && before) adjustUnread(store, t.mailbox, -before);
    },
    "inbox:markUnread": (store, { threadId }: { threadId: string }) => {
      let before = 0;
      const t = patchThread(store, threadId, (x) => ((before = x.unreadCount), { ...x, unreadCount: Math.max(1, x.unreadCount) }));
      if (t && !before) adjustUnread(store, t.mailbox, +1);
    },
    "inbox:setStatus": (store, { threadId, status }: { threadId: string; status: ThreadStatus }) => {
      patchThread(store, threadId, (t) => ({ ...t, status }));
    },
    "inbox:assign": (store, { threadId, userId }: { threadId: string; userId: string | null }) => {
      patchThread(store, threadId, (t) => {
        if (userId === null) {
          const { assignee: _a, assigneeName: _n, ...rest } = t;
          return rest;
        }
        const members = store.getQuery<any>("inbox:members", { mailbox: t.mailbox }) as Array<{ userId: string; name: string }> | undefined;
        return { ...t, assignee: userId, assigneeName: members?.find((m) => m.userId === userId)?.name ?? userId };
      });
    },
    "inbox:compose": (store, args: { mailbox: string; to: string[]; subject: string; text: string }) => {
      const at = now();
      const contact = (args.to[0] ?? "").replace(/^.*<([^>]+)>.*$/, "$1").trim().toLowerCase();
      const thread: Thread = {
        _id: tempId(at),
        _creationTime: at,
        mailbox: args.mailbox,
        number: 0,
        subject: args.subject.trim() || "(no subject)",
        subjectKey: "",
        contact,
        status: "waiting",
        token: "",
        messageCount: 1,
        unreadCount: 0,
        lastMessageAt: at,
        snippet: args.text.replace(/\s+/g, " ").trim().slice(0, 140),
      };
      for (const { args: qa, value } of store.getAllQueries<any>("inbox:threads") as Array<{ args: ThreadsArgs; value: Page<Thread> | undefined }>) {
        if (!value || qa.mailbox !== args.mailbox || (qa.status !== undefined && qa.status !== "waiting")) continue;
        store.setQuery<any>("inbox:threads", qa, { ...value, page: [thread, ...value.page] });
      }
      // The cross-mailbox views it belongs to (all, waiting) show it on top too, and their counts grow with it.
      for (const { args: va, value } of store.getAllQueries<any>("inbox:view") as Array<{ args: ViewArgs; value: ViewPage | undefined }>) {
        if (!value || !viewKeeps(va.view, va.status)(thread)) continue;
        store.setQuery<any>("inbox:view", va, { ...value, page: [thread, ...value.page] });
      }
      const counts = store.getQuery<any>("inbox:views", {}) as ViewCounts | undefined;
      if (counts) {
        const next = { ...counts };
        for (const view of INBOX_VIEWS) if (viewKeeps(view, undefined)(thread)) next[view] = { ...counts[view], threads: counts[view].threads + 1 };
        store.setQuery<any>("inbox:views", {}, next);
      }
      sentNow(store, thread, at);
    },
  };
  // Drafts: the cached `inbox:drafts` answers follow saves, deletes and sends, so a draft written offline is there when
  // the conversation or the composer opens again (the queued mutations reach the server later, in order).
  updates["inbox:saveDraft"] = (store, args: SaveDraftArgs) => saveDraftLocally(store, args, now());
  updates["inbox:deleteDraft"] = (store, { id }: { id: string }) => dropDraft(store, id);
  // A deleted conversation leaves every loaded list at once (the conversation screen has already closed).
  updates["inbox:deleteThread"] = (store, { threadId }: { threadId: string }) => {
    const found = patchLoaded(store, threadId, (t) => t);
    for (const name of ["inbox:threads", "inbox:view", "inbox:sent"] as const) {
      for (const { args, value } of store.getAllQueries<any>(name) as Array<{ args: unknown; value: { page: Thread[] } | undefined }>) {
        if (!value || !value.page.some((t) => t._id === threadId)) continue;
        store.setQuery<any>(name, args as never, { ...value, page: value.page.filter((t) => t._id !== threadId) });
      }
    }
    // Gone everywhere at once: search hits of it, and the conversation itself (its screen shows "not found").
    for (const { args, value } of store.getAllQueries<any>("inbox:search") as Array<{ args: unknown; value: Array<{ threadId: string }> | undefined }>) {
      if (value?.some((h) => h.threadId === threadId)) store.setQuery<any>("inbox:search", args as never, value.filter((h) => h.threadId !== threadId));
    }
    if (store.getQuery<any>("inbox:thread", { threadId } as never) !== undefined) store.setQuery<any>("inbox:thread", { threadId } as never, null);
    dropped.delete(threadId);
    if (found) {
      const counts = store.getQuery<any>("inbox:views", {}) as ViewCounts | undefined;
      if (counts) {
        const next = { ...counts };
        for (const view of INBOX_VIEWS) {
          if (!viewKeeps(view, undefined)(found.before)) continue;
          const c = counts[view];
          next[view] = { ...c, threads: Math.max(0, c.threads - 1), unread: Math.max(0, c.unread - found.before.unreadCount) };
        }
        store.setQuery<any>("inbox:views", {}, next);
      }
      if (found.before.unreadCount) adjustUnread(store, found.before.mailbox, -found.before.unreadCount);
    }
  };
  // A forward is a new conversation from the forwarded thread's mailbox: it shows at the top as a compose does.
  updates["inbox:forward"] = (store, args: { threadId: string; to: string[]; subject: string; text: string }, rec) => {
    const mailbox = mailboxOf(store, args.threadId);
    if (mailbox) updates["inbox:compose"]!(store, { mailbox, to: args.to, subject: args.subject, text: args.text }, rec);
  };
  // A send with `draftId` deletes that draft (on the server in the same transaction; here at once).
  for (const name of ["inbox:reply", "inbox:note", "inbox:compose", "inbox:forward"] as const) {
    const base = updates[name]!;
    updates[name] = (store, args: { draftId?: string }, rec) => {
      base(store, args, rec);
      if (args.draftId) dropDraft(store, args.draftId);
    };
  }
  return updates;
}
