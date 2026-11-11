// Optimistic updates by mutation name. Registered on the client (not per call), so a mutation queued offline and
// restored after a restart is still shown: the reply appears in the thread with a "sending" mark, the thread moves to
// "waiting", unread counters drop, and the server's answer replaces all of it when the queue drains.
import type { OptimisticLocalStore, OptimisticUpdate } from "@freecorps/ember-react-native";
import { INBOX_VIEWS, type Address, type Draft, type SaveDraftArgs, type Mailbox, type Message, type Page, type ScheduledSend, type SentArgs, type SentThread, type Tag, type Thread, type ThreadDetail, type ThreadStatus, type ThreadsArgs, type ViewArgs, type ViewCount, type ViewCounts, type ViewPage } from "../api";
import { threadsKeeps, viewKeeps, viewOrder } from "./replica";

/** Ids of optimistic rows start with this (the UI shows them as pending). */
export const OPTIMISTIC_PREFIX = "optimistic:";
export const isOptimisticId = (id: string): boolean => id.startsWith(OPTIMISTIC_PREFIX);

let seq = 0;
const tempId = (now: number) => `${OPTIMISTIC_PREFIX}${now.toString(36)}-${(seq++).toString(36)}`;

type Store = OptimisticLocalStore;

/** A count after a thread left (`was`) and/or joined (`is`) what it counts. */
function moved(c: ViewCount, before: Thread, after: Thread | null, was: boolean, is: boolean): ViewCount {
  return {
    ...c,
    threads: Math.max(0, c.threads + (is ? 1 : 0) - (was ? 1 : 0)),
    unread: Math.max(0, c.unread + (is && after ? after.unreadCount : 0) - (was ? before.unreadCount : 0)),
  };
}

/**
 * Moves the home screen's counts (`inbox:views`) for one thread going from `before` to `after` (null: deleted), by the
 * views' own rules (`viewKeeps`): it leaves or joins a view, and its unread messages go with it. A snoozed thread
 * counts only in "Adiadas"; each tag counts its threads that are not snoozed. The badges (Minhas, the home rows) then
 * follow a read, archive, snooze or assignment at once, offline too.
 */
function adjustViewCounts(store: Store, before: Thread, after: Thread | null) {
  const counts = store.getQuery<any>("inbox:views", {}) as ViewCounts | undefined;
  if (!counts) return;
  const next: ViewCounts = { ...counts };
  for (const view of INBOX_VIEWS) {
    const c = counts[view];
    if (!c) continue;
    const keeps = viewKeeps(view, undefined);
    const was = keeps(before);
    const is = !!after && keeps(after);
    if (was || is) next[view] = moved(c, before, after, was, is);
  }
  if (counts.tags) {
    const tags = { ...counts.tags };
    for (const id of new Set([...(before.tags ?? []), ...(after?.tags ?? [])])) {
      const keeps = viewKeeps("all", undefined, id);
      const was = keeps(before);
      const is = !!after && keeps(after);
      if (!was && !is) continue;
      tags[id] = moved(tags[id] ?? { threads: 0, unread: 0, capped: false }, before, after, was, is);
    }
    next.tags = tags;
  }
  store.setQuery<any>("inbox:views", {}, next);
}

/**
 * The mailbox badges (`inbox:mailboxes`): `threads` and `unread` leave snoozed threads out, `snoozed` counts them (the
 * server's rule), so a snooze moves the thread from the first two to the third, and its wake-up back.
 */
function adjustMailboxCounts(store: Store, before: Thread, after: Thread | null) {
  const boxes = store.getQuery<any>("inbox:mailboxes", {}) as Mailbox[] | undefined;
  if (!boxes) return;
  const part = (t: Thread | null) => (t ? { threads: t.snoozed ? 0 : 1, unread: t.snoozed ? 0 : t.unreadCount, snoozed: t.snoozed ? 1 : 0 } : { threads: 0, unread: 0, snoozed: 0 });
  const a = part(before);
  const b = part(after);
  if (a.threads === b.threads && a.unread === b.unread && a.snoozed === b.snoozed) return;
  store.setQuery<any>(
    "inbox:mailboxes",
    {},
    boxes.map((m) =>
      m.name === before.mailbox
        ? {
            ...m,
            threads: Math.max(0, m.threads + b.threads - a.threads),
            unread: Math.max(0, m.unread + b.unread - a.unread),
            ...(m.snoozed !== undefined || b.snoozed || a.snoozed ? { snoozed: Math.max(0, (m.snoozed ?? 0) + b.snoozed - a.snoozed) } : {}),
          }
        : m,
    ),
  );
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
  adjustMailboxCounts(store, found.before, found.after);
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
/** Whether `t` falls inside what a page has loaded (a complete list, or not past its last row in the list's order). */
const inLoadedRange = (v: { page: Thread[]; isDone: boolean }, t: Thread, order: (a: Thread, b: Thread) => number = newerFirst) =>
  v.isDone || !v.page.length || order(t, v.page[v.page.length - 1]!) <= 0;

/**
 * Puts `t` into every loaded list it now belongs to and is missing from (an unarchived thread back in "Abertas", a
 * woken one back in the views, a snoozed one into "Adiadas"), in the list's order, as the server's answer will.
 */
function rejoin(store: Store, t: Thread) {
  for (const { args, value } of store.getAllQueries<any>("inbox:threads") as Array<{ args: ThreadsArgs; value: Page<Thread> | undefined }>) {
    if (!value || !threadsKeeps(args)(t)) continue;
    const order = args.snoozed ? viewOrder("snoozed") : newerFirst;
    if (value.page.some((x) => x._id === t._id) || !inLoadedRange(value, t, order)) continue;
    store.setQuery<any>("inbox:threads", args, { ...value, page: [...value.page, t].sort(order) });
  }
  for (const { args, value } of store.getAllQueries<any>("inbox:view") as Array<{ args: ViewArgs; value: ViewPage | undefined }>) {
    if (!value || !viewKeeps(args.view, args.status, args.tag)(t)) continue;
    const order = viewOrder(args.view, args.tag);
    if (value.page.some((x) => x._id === t._id) || !inLoadedRange(value, t, order)) continue;
    store.setQuery<any>("inbox:view", args, { ...value, page: [...value.page, t].sort(order) });
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
    // A filter the thread no longer matches (status, unread, tag, snoozed) drops it from that list.
    const drop = !threadsKeeps(args)(next);
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
    const keep = viewKeeps(args.view, args.status, args.tag)(next);
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

const asAddress = (s: string): Address => {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(s);
  return m ? { email: m[2]!.trim(), ...(m[1] ? { name: m[1] } : {}) } : { email: s.trim() };
};

type AppendArgs = { threadId: string; text: string; cc?: string[]; bcc?: string[]; sendAt?: number };

function append(store: Store, args: AppendArgs, direction: "outbound" | "note", now: number) {
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
      cc: (args.cc ?? []).map(asAddress),
      ...(args.bcc?.length ? { bcc: args.bcc.map(asAddress) } : {}),
      // Scheduled: shown at once as "Agendada para …" (the server keeps its message in the thread from now on).
      ...(isScheduled(args, direction, now) ? { scheduledFor: args.sendAt } : {}),
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
  // A scheduled reply has not gone: the conversation only gains its message ("Agendada para …"). It does not move to
  // "waiting", to the top of the lists or of Sent until the server says what it did, so canceling it has nothing else
  // to undo.
  const scheduled = isScheduled(args, direction, now);
  const thread = patchThread(store, args.threadId, (t) =>
    scheduled
      ? { ...t, messageCount: t.messageCount + 1 }
      : {
          ...t,
          messageCount: t.messageCount + 1,
          lastMessageAt: now,
          ...(direction === "note" ? {} : { status: t.status === "spam" ? "spam" : ("waiting" as ThreadStatus), snippet }),
        },
  );
  if (thread && direction === "outbound" && !scheduled) sentNow(store, thread, now);
}

/** A send that waits for its time (`sendAt` ahead of now): not sent, so never in Sent. */
const isScheduled = (a: { sendAt?: number }, direction: string, now: number) => direction === "outbound" && a.sendAt !== undefined && a.sendAt > now;

/** A thread gone for good (deleted, or a scheduled new conversation canceled): out of every list and count. */
function dropThread(store: Store, threadId: string) {
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
    adjustViewCounts(store, found.before, null);
    adjustMailboxCounts(store, found.before, null);
  }
}

/** A woken thread: not snoozed any more (a manual wake only clears the snooze; the server does the same). */
const awake = (t: Thread): Thread => {
  const { snoozed: _s, snoozedUntil: _u, ...rest } = t;
  return rest;
};

const sortTags = (tags: Tag[]) => [...tags].sort((a, b) => (a.mailbox < b.mailbox ? -1 : a.mailbox > b.mailbox ? 1 : a.order - b.order || a._creationTime - b._creationTime));

function tagCaches(store: Store): Array<{ args: { mailbox?: string }; value: Tag[] }> {
  return (store.getAllQueries<any>("inbox:tags") as Array<{ args: { mailbox?: string }; value: Tag[] | undefined }>).filter((q): q is { args: { mailbox?: string }; value: Tag[] } => !!q.value);
}

/** Every thread id the client has loaded (an open thread, any list). */
function loadedThreadIds(store: Store): Set<string> {
  const ids = new Set<string>();
  for (const { value } of store.getAllQueries<any>("inbox:thread") as Array<{ value: ThreadDetail | undefined }>) if (value) ids.add(value.thread._id);
  for (const name of ["inbox:threads", "inbox:view", "inbox:sent"] as const)
    for (const { value } of store.getAllQueries<any>(name) as Array<{ value: { page: Thread[] } | undefined }>) for (const t of value?.page ?? []) ids.add(t._id);
  return ids;
}

/** A thread as loaded anywhere (its detail first). */
function loadedThread(store: Store, threadId: string): Thread | null {
  const open = store.getQuery<any>("inbox:thread", { threadId }) as ThreadDetail | undefined;
  if (open?.thread) return open.thread;
  for (const name of ["inbox:threads", "inbox:view", "inbox:sent"] as const)
    for (const { value } of store.getAllQueries<any>(name) as Array<{ value: { page: Thread[] } | undefined }>) {
      const t = value?.page.find((x) => x._id === threadId);
      if (t) return t;
    }
  return null;
}

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

type DraftLists = Array<{ args: { threadId?: string }; value: Draft[] | undefined }>;
type DraftRef = { id?: string | undefined; kind: Draft["kind"]; threadId?: string | undefined; mailbox?: string | undefined };

/**
 * Which cached rows are this draft (the server's upsert rules): its id; for a reply, note or forward also its thread and
 * kind (one per thread and kind). A first save shows under a temporary id until the server's answer comes in, and the
 * next save (or the send) already carries the real one: a reply/note/forward finds that row by thread and kind; a new
 * message whose id the cache does not know yet is the newest temporary new-message row of its mailbox.
 */
function draftMatcher(cached: DraftLists, a: DraftRef): (d: Draft) => boolean {
  const all = cached.flatMap((q) => q.value ?? []);
  const byKey = (d: Draft) => a.kind !== "compose" && d.kind === a.kind && d.threadId === a.threadId;
  let temp: string | null = null;
  if (a.kind === "compose" && a.id && !all.some((d) => d._id === a.id)) {
    const first = all.filter((d) => d.kind === "compose" && isOptimisticId(d._id) && (!a.mailbox || d.mailbox === a.mailbox)).sort((x, y) => y.updatedAt - x.updatedAt)[0];
    temp = first?._id ?? null;
  }
  return (d) => (a.id !== undefined && d._id === a.id) || d._id === temp || byKey(d);
}

/** Removes a draft from every cached `inbox:drafts` answer (also the row of its first save, under a temporary id). */
function dropDraft(store: Store, ref: DraftRef) {
  const cached = store.getAllQueries<any>("inbox:drafts") as DraftLists;
  const same = draftMatcher(cached, ref);
  for (const { args, value } of cached) {
    if (value?.some(same)) store.setQuery<any>("inbox:drafts", args, value.filter((d) => !same(d)));
  }
}

/** Puts a saved draft into the cached `inbox:drafts` answers it belongs to (the server's upsert rules), newest first. */
function saveDraftLocally(store: Store, a: SaveDraftArgs, at: number) {
  const cached = store.getAllQueries<any>("inbox:drafts") as DraftLists;
  const same = draftMatcher(cached, a);
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

/** The preferences after `inbox:setNotifications` (the server's rule: a mailbox listed once in `muted`). */
export function nextNotificationPrefs(p: { muted: string[]; preview: boolean }, a: { mailbox?: string; enabled?: boolean; preview?: boolean }) {
  const muted = a.mailbox === undefined || a.enabled === undefined ? p.muted : a.enabled ? p.muted.filter((b) => b !== a.mailbox) : [...new Set([...p.muted, a.mailbox])];
  return { muted, preview: a.preview ?? p.preview };
}

export function inboxOptimisticUpdates(now: () => number = Date.now): Record<string, OptimisticUpdate> {
  const updates: Record<string, OptimisticUpdate> = {
    "inbox:reply": (store, args: AppendArgs) => append(store, args, "outbound", now()),
    "inbox:note": (store, args: { threadId: string; text: string }) => append(store, args, "note", now()),
    "inbox:markRead": (store, { threadId }: { threadId: string }) => {
      patchThread(store, threadId, (x) => ({ ...x, unreadCount: 0, hasUnread: false }));
    },
    "inbox:markUnread": (store, { threadId }: { threadId: string }) => {
      patchThread(store, threadId, (x) => ({ ...x, unreadCount: Math.max(1, x.unreadCount), hasUnread: true }));
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
    "inbox:compose": (store, args: { mailbox: string; to: string[]; subject: string; text: string; sendAt?: number }) => {
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
        for (const view of INBOX_VIEWS) if (counts[view] && viewKeeps(view, undefined)(thread)) next[view] = { ...counts[view], threads: counts[view].threads + 1 };
        store.setQuery<any>("inbox:views", {}, next);
      }
      // Scheduled: the new conversation is there (the server makes it at once), but nothing went out, so not in Sent.
      if (!isScheduled(args, "outbound", at)) sentNow(store, thread, at);
    },
  };
  // Snooze: the thread leaves every list and count but "Adiadas" (and joins that one); waking it (`until: null`,
  // `unsnooze`, or "Desfazer") brings it back where it was, like an archive's undo.
  updates["inbox:snooze"] = (store, { threadId, until }: { threadId: string; until: number | null }) => {
    patchThread(store, threadId, (t) => (until === null ? awake(t) : { ...t, snoozed: true, snoozedUntil: until }));
  };
  updates["inbox:unsnooze"] = (store, { threadId }: { threadId: string }) => {
    patchThread(store, threadId, awake);
  };
  // Tags on a thread: its chips change at once, it joins or leaves the tag's lists, the tag's count follows.
  updates["inbox:setTags"] = (store, { threadId, tags }: { threadId: string; tags: string[] }) => {
    patchThread(store, threadId, (t) => ({ ...t, tags: [...new Set(tags)] }));
  };
  updates["inbox:addTag"] = (store, { threadId, tag }: { threadId: string; tag: string }) => {
    patchThread(store, threadId, (t) => (t.tags?.includes(tag) ? t : { ...t, tags: [...(t.tags ?? []), tag] }));
  };
  updates["inbox:removeTag"] = (store, { threadId, tag }: { threadId: string; tag: string }) => {
    patchThread(store, threadId, (t) => ({ ...t, tags: (t.tags ?? []).filter((x) => x !== tag) }));
  };
  // The tag lists (`inbox:tags`, all of them and one mailbox's) follow create, rename/recolor/move and delete.
  updates["inbox:createTag"] = (store, a: { mailbox: string; name: string; color?: string; order?: number }) => {
    const at = now();
    const all = tagCaches(store);
    const last = Math.max(-1, ...all.flatMap((q) => q.value).filter((t) => t.mailbox === a.mailbox).map((t) => t.order));
    const tag: Tag = { _id: tempId(at), _creationTime: at, mailbox: a.mailbox, name: a.name.trim(), nameKey: a.name.trim().toLowerCase(), color: a.color ?? "gray", order: a.order ?? last + 1, createdAt: at };
    for (const q of all) if (q.args.mailbox === undefined || q.args.mailbox === a.mailbox) store.setQuery<any>("inbox:tags", q.args, sortTags([...q.value, tag]));
  };
  updates["inbox:updateTag"] = (store, a: { tagId: string; name?: string; color?: string; order?: number }) => {
    for (const q of tagCaches(store)) {
      if (!q.value.some((t) => t._id === a.tagId)) continue;
      const page = q.value.map((t) =>
        t._id === a.tagId
          ? { ...t, ...(a.name !== undefined ? { name: a.name.trim(), nameKey: a.name.trim().toLowerCase() } : {}), ...(a.color !== undefined ? { color: a.color } : {}), ...(a.order !== undefined ? { order: a.order } : {}) }
          : t,
      );
      store.setQuery<any>("inbox:tags", q.args, sortTags(page));
    }
  };
  updates["inbox:deleteTag"] = (store, { tagId }: { tagId: string }) => {
    for (const q of tagCaches(store)) if (q.value.some((t) => t._id === tagId)) store.setQuery<any>("inbox:tags", q.args, q.value.filter((t) => t._id !== tagId));
    // It comes off every thread (and its lists empty out).
    for (const id of loadedThreadIds(store)) {
      if (loadedThread(store, id)?.tags?.includes(tagId)) patchThread(store, id, (t) => ({ ...t, tags: (t.tags ?? []).filter((x) => x !== tagId) }));
    }
    const counts = store.getQuery<any>("inbox:views", {}) as ViewCounts | undefined;
    if (counts?.tags?.[tagId]) {
      const { [tagId]: _gone, ...tags } = counts.tags;
      store.setQuery<any>("inbox:views", {}, { ...counts, tags });
    }
  };
  // "Cancelar envio": the scheduled message leaves the conversation and its list of scheduled sends; a new conversation
  // left with no message goes altogether (the server deletes it).
  updates["inbox:cancelScheduled"] = (store, { emailId }: { emailId: string }) => {
    let messageId: string | undefined;
    for (const { args, value } of store.getAllQueries<any>("inbox:scheduled") as Array<{ args: { threadId: string }; value: ScheduledSend[] | undefined }>) {
      const hit = value?.find((x) => x.emailId === emailId);
      if (!hit) continue;
      messageId ??= hit.messageId;
      store.setQuery<any>("inbox:scheduled", args, value!.filter((x) => x.emailId !== emailId));
    }
    for (const { args, value } of store.getAllQueries<any>("inbox:thread") as Array<{ args: { threadId: string }; value: ThreadDetail | undefined }>) {
      if (!value) continue;
      const gone = value.messages.find((m) => m.emailId === emailId || (messageId !== undefined && m._id === messageId));
      if (!gone) continue;
      const messages = value.messages.filter((m) => m !== gone);
      store.setQuery<any>("inbox:thread", args, { ...value, messages });
      // What the schedule did is undone: one message fewer, wherever the thread is listed (it never moved for it).
      if (!messages.length) dropThread(store, args.threadId);
      else patchThread(store, args.threadId, (t) => ({ ...t, messageCount: Math.max(0, t.messageCount - 1) }));
    }
  };
  // Drafts: the cached `inbox:drafts` answers follow saves, deletes and sends, so a draft written offline is there when
  // the conversation or the composer opens again (the queued mutations reach the server later, in order).
  updates["inbox:saveDraft"] = (store, args: SaveDraftArgs) => saveDraftLocally(store, args, now());
  // A delete names the draft by id only (the server deletes that document).
  updates["inbox:deleteDraft"] = (store, { id }: { id: string }) => {
    for (const { args, value } of store.getAllQueries<any>("inbox:drafts") as DraftLists) {
      if (value?.some((d) => d._id === id)) store.setQuery<any>("inbox:drafts", args, value.filter((d) => d._id !== id));
    }
  };
  // A deleted conversation leaves every loaded list at once (the conversation screen has already closed).
  updates["inbox:deleteThread"] = (store, { threadId }: { threadId: string }) => dropThread(store, threadId);
  // A forward is a new conversation from the forwarded thread's mailbox: it shows at the top as a compose does.
  updates["inbox:forward"] = (store, args: { threadId: string; to: string[]; subject: string; text: string; sendAt?: number }, rec) => {
    const mailbox = mailboxOf(store, args.threadId);
    if (mailbox) updates["inbox:compose"]!(store, { mailbox, to: args.to, subject: args.subject, text: args.text, ...(args.sendAt !== undefined ? { sendAt: args.sendAt } : {}) }, rec);
  };
  // Ajustes › Notificações: the switches move at once (offline too; the server filters pushes once it lands).
  updates["inbox:setNotifications"] = (store, a: { mailbox?: string; enabled?: boolean; preview?: boolean }) => {
    const p = store.getQuery<any>("inbox:notifications", {}) as { muted: string[]; preview: boolean } | undefined;
    if (p) store.setQuery<any>("inbox:notifications", {}, nextNotificationPrefs(p, a));
  };
  // A send with `draftId` deletes that draft (on the server in the same transaction; here at once, with the row of its
  // first save if that still shows under a temporary id).
  const sentKind = { "inbox:reply": "reply", "inbox:note": "note", "inbox:compose": "compose", "inbox:forward": "forward" } as const;
  for (const name of Object.keys(sentKind) as Array<keyof typeof sentKind>) {
    const base = updates[name]!;
    updates[name] = (store, args: { draftId?: string; threadId?: string; mailbox?: string }, rec) => {
      base(store, args, rec);
      if (args.draftId) dropDraft(store, { id: args.draftId, kind: sentKind[name], threadId: args.threadId, mailbox: args.mailbox });
    };
  }
  return updates;
}
