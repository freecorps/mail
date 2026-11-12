// Optimistic updates by mutation name (the same rules as apps/mobile/src/offline/optimistic.ts): registered on the
// client, so a reply shows in the thread with a "sending" mark, the thread moves to "waiting", unread counters drop,
// and the server's answer replaces all of it.
import type { OptimisticLocalStore, OptimisticUpdate } from "@freecorps/ember-client";
import {
  VIEWS,
  type Mailbox,
  type TagDoc,
  type Message,
  type Page,
  type SearchHit,
  type SentArgs,
  type SentThread,
  type Thread,
  type ThreadDetail,
  type ThreadStatus,
  type ThreadsArgs,
  type View,
  type ViewArgs,
  type ViewCount,
  type ViewCounts,
  type ViewPage,
} from "./api";

/** Ids of optimistic rows start with this (the UI shows them as pending). */
export const OPTIMISTIC_PREFIX = "optimistic:";
export const isOptimisticId = (id: string): boolean => id.startsWith(OPTIMISTIC_PREFIX);

let seq = 0;
const tempId = (now: number) => `${OPTIMISTIC_PREFIX}${now.toString(36)}-${(seq++).toString(36)}`;

type Store = OptimisticLocalStore;

/** Who is signed in, for the `assigned` view's rule (an optimistic update has no identity; the inbox sets it). */
let viewer: string | null = null;
export function setOptimisticViewer(userId: string | null) {
  viewer = userId;
}

const ACTIVE = new Set(["open", "waiting"]);

/** Whether a thread is snoozed now (Ember 0.7: out of every list and count but "Adiadas"). */
export const isSnoozed = (t: Pick<Thread, "snoozed">): boolean => t.snoozed === true;
const tagged = (t: Thread, tag: string | undefined) => tag === undefined || (t.tags?.includes(tag) ?? false);

/**
 * The server's view rules (apps/api `inbox:view`): which threads a view (and status, and tag) lists. A snoozed thread
 * is only in `snoozed`; every other view leaves it out until it wakes.
 */
export function viewKeeps(view: View, status: string | undefined, tag?: string): (t: Thread) => boolean {
  const inStatus = (t: Thread, fallback: (t: Thread) => boolean) => (status ? t.status === status : fallback(t));
  const rule = ((): ((t: Thread) => boolean) => {
    switch (view) {
      case "all":
        return (t) => inStatus(t, () => true);
      case "waiting":
        return (t) => t.status === "waiting";
      case "assigned":
        return (t) => viewer !== null && t.assignee === viewer && inStatus(t, (x) => ACTIVE.has(x.status));
      case "unread":
        return (t) => t.unreadCount > 0 && inStatus(t, (x) => ACTIVE.has(x.status));
      case "snoozed":
        return (t) => inStatus(t, () => true);
    }
  })();
  const snoozedView = view === "snoozed";
  return (t) => isSnoozed(t) === snoozedView && tagged(t, tag) && rule(t);
}

/** A mailbox list's rule (`inbox:threads`): its status, and no snoozed thread unless it asks for them. */
function listKeeps(args: ThreadsArgs & { snoozed?: boolean; tag?: string }, t: Thread): boolean {
  return (
    args.mailbox === t.mailbox &&
    (args.status === undefined || args.status === t.status) &&
    isSnoozed(t) === (args.snoozed === true) &&
    tagged(t, args.tag)
  );
}

const ZERO: ViewCount = { threads: 0, unread: 0, capped: false };

/** Moves one count for a thread that was (`was`) and is (`is`) counted in it. */
function moved(c: ViewCount, was: boolean, is: boolean, before: Thread, after: Thread): ViewCount {
  return {
    ...c,
    threads: Math.max(0, c.threads + (is ? 1 : 0) - (was ? 1 : 0)),
    unread: Math.max(0, c.unread + (is ? after.unreadCount : 0) - (was ? before.unreadCount : 0)),
  };
}

/**
 * Moves the view counts (`inbox:views`: sidebar, Hoje) for one thread going from `before` to `after`: each view's,
 * and each tag's (its threads that are not snoozed, any status).
 */
export function adjustViewCounts(store: Store, before: Thread, after: Thread) {
  const counts = store.getQuery<any>("inbox:views", {}) as ViewCounts | undefined;
  if (!counts) return;
  const next: ViewCounts = { ...counts };
  for (const view of VIEWS) {
    const c = counts[view];
    if (!c) continue;
    const keeps = viewKeeps(view, undefined);
    const was = keeps(before);
    const is = keeps(after);
    if (was || is) next[view] = moved(c, was, is, before, after);
  }
  if (counts.tags) {
    const tags = { ...counts.tags };
    for (const id of new Set([...(before.tags ?? []), ...(after.tags ?? [])])) {
      const was = !isSnoozed(before) && tagged(before, id);
      const is = !isSnoozed(after) && tagged(after, id);
      if (was || is) tags[id] = moved(tags[id] ?? ZERO, was, is, before, after);
    }
    next.tags = tags;
  }
  store.setQuery<any>("inbox:views", {}, next);
}

/** What a thread adds to its mailbox's badge (`inbox:mailboxes`): snoozed threads count apart. */
const badgeOf = (t: Thread) => (isSnoozed(t) ? { threads: 0, unread: 0, snoozed: 1 } : { threads: 1, unread: t.unreadCount, snoozed: 0 });

/** Moves the mailbox badge for one thread going from `before` to `after`. */
function adjustMailbox(store: Store, before: Thread, after: Thread) {
  const boxes = store.getQuery<any>("inbox:mailboxes", {}) as Mailbox[] | undefined;
  if (!boxes) return;
  const a = badgeOf(before);
  const b = badgeOf(after);
  if (a.threads === b.threads && a.unread === b.unread && a.snoozed === b.snoozed) return;
  store.setQuery<any>(
    "inbox:mailboxes",
    {},
    boxes.map((m) =>
      m.name === after.mailbox
        ? {
            ...m,
            threads: Math.max(0, m.threads + b.threads - a.threads),
            unread: Math.max(0, m.unread + b.unread - a.unread),
            ...(m.snoozed !== undefined || b.snoozed ? { snoozed: Math.max(0, (m.snoozed ?? 0) + b.snoozed - a.snoozed) } : {}),
          }
        : m,
    ),
  );
}

/**
 * Applies `patch` to the thread wherever it is loaded (its detail, every thread-list page, the cross-mailbox views)
 * and moves the view counts with it.
 */
/**
 * Search hits of the thread carry its state (status, unread, assignee) and act like list rows: the same patch applies
 * to them, so a hover or bulk action on a search result toggles the right way the next time too.
 */
function patchSearch(store: Store, threadId: string, patch: (t: Thread) => Thread) {
  for (const { args, value } of store.getAllQueries<any>("inbox:search") as Array<{ args: any; value: SearchHit[] | undefined }>) {
    if (!value?.some((h) => h.threadId === threadId)) continue;
    const next = value.map((h) => {
      if (h.threadId !== threadId) return h;
      const t = patch({
        _id: h.threadId,
        mailbox: h.mailbox,
        subject: h.subject,
        status: h.status,
        unreadCount: h.unreadCount ?? 0,
        assignee: h.assignee,
        assigneeName: h.assigneeName,
        ...(h.tags?.length ? { tags: h.tags } : {}),
        ...(h.snoozedUntil ? { snoozed: true, snoozedUntil: h.snoozedUntil } : {}),
      } as unknown as Thread);
      return {
        ...h,
        status: t.status,
        unreadCount: t.unreadCount,
        assignee: t.assignee ?? undefined,
        assigneeName: t.assigneeName ?? undefined,
        // Tag chips and the tag menu on a search result follow add/remove/set at once, as list rows do.
        tags: t.tags ?? [],
        // Snoozed or woken (snooze, unsnooze, an undo): the hit's wake time follows.
        snoozedUntil: t.snoozed && t.snoozedUntil ? t.snoozedUntil : undefined,
      };
    });
    store.setQuery<any>("inbox:search", args, next);
  }
}

function patchThread(store: Store, threadId: string, patch: (t: Thread) => Thread): Thread | null {
  patchSearch(store, threadId, patch);
  let found = patchLoaded(store, threadId, patch);
  // Loaded nowhere any more (an archive dropped it from the only list showing it): the copy kept when it was dropped
  // lets a later patch, such as "Desfazer", put it back.
  const last = dropped.get(threadId);
  if (!found && last) found = { before: last, after: patch(last) };
  if (!found) return null;
  if (dropped.has(threadId)) remember(found.after);
  rejoin(store, found.after);
  adjustViewCounts(store, found.before, found.after);
  adjustMailbox(store, found.before, found.after);
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
/** "Adiadas" lists the soonest to wake first (with a tag, the component lists newest first). */
const soonerFirst = (a: Thread, b: Thread) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0);
const orderOf = (args: ViewArgs) => (args.view === "snoozed" && args.tag === undefined ? soonerFirst : newerFirst);
/** Whether `t` falls inside what a page has loaded (a complete list, or not past its last row in the list's order). */
const inLoadedRange = (v: { page: Thread[]; isDone: boolean }, t: Thread, order: (a: Thread, b: Thread) => number = newerFirst) =>
  v.isDone || !v.page.length || order(t, v.page[v.page.length - 1]!) <= 0;

/**
 * Puts `t` into every loaded list it now belongs to and is missing from (an unarchived thread back in "Abertas" and the
 * views, a woken one back from "Adiadas"), in the list's order, as the server's answer will. The same rule as mobile
 * (apps/mobile/src/offline/optimistic.ts).
 */
function rejoin(store: Store, t: Thread) {
  for (const { args, value } of store.getAllQueries<any>("inbox:threads") as Array<{
    args: ThreadsArgs;
    value: Page<Thread> | undefined;
  }>) {
    if (!value || !listKeeps(args, t)) continue;
    if (value.page.some((x) => x._id === t._id) || !inLoadedRange(value, t)) continue;
    store.setQuery<any>("inbox:threads", args, { ...value, page: [...value.page, t].sort(newerFirst) });
  }
  for (const { args, value } of store.getAllQueries<any>("inbox:view") as Array<{ args: ViewArgs; value: ViewPage | undefined }>) {
    if (!value || !viewKeeps(args.view, args.status, args.tag)(t)) continue;
    const order = orderOf(args);
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
  for (const { args, value } of store.getAllQueries<any>("inbox:threads") as Array<{
    args: ThreadsArgs;
    value: Page<Thread> | undefined;
  }>) {
    if (!value) continue;
    const i = value.page.findIndex((t) => t._id === threadId);
    if (i < 0) continue;
    const next = patch(value.page[i]!);
    found ??= next;
    // A status filter the thread no longer matches drops it from that list, and so does a snooze.
    const drop = !listKeeps(args, next);
    if (drop) remember(next);
    const page = drop ? value.page.filter((_, j) => j !== i) : value.page.map((t, j) => (j === i ? next : t));
    store.setQuery<any>("inbox:threads", args, { ...value, page });
  }
  // The Sent view lists it too, whatever its status: patched in place (its place is when the mailbox last wrote).
  for (const { args, value } of store.getAllQueries<any>("inbox:sent") as Array<{ args: SentArgs; value: SentPage | undefined }>) {
    const i = value ? value.page.findIndex((t) => t._id === threadId) : -1;
    if (!value || i < 0) continue;
    const next: SentThread = { ...patch(value.page[i]!), lastSentAt: value.page[i]!.lastSentAt };
    found ??= next;
    store.setQuery<any>("inbox:sent", args, { ...value, page: value.page.map((t, j) => (j === i ? next : t)) });
  }
  // The cross-mailbox views: patched in place, or dropped when the thread no longer belongs (read in "unread",
  // archived in "waiting"); `rejoin` adds it to the ones it now belongs to.
  for (const { args, value } of store.getAllQueries<any>("inbox:view") as Array<{ args: ViewArgs; value: ViewPage | undefined }>) {
    const i = value ? value.page.findIndex((t) => t._id === threadId) : -1;
    if (!value || i < 0) continue;
    const next = patch(value.page[i]!);
    found ??= next;
    const rest = value.page.filter((_, j) => j !== i);
    // Adiadas is ordered by wake time: a new time moves the row to its place, or out of what is loaded (past the last
    // row of a list that has more).
    const order = orderOf(args);
    const moves = order === soonerFirst && next.snoozedUntil !== value.page[i]!.snoozedUntil;
    const keep = viewKeeps(args.view, args.status, args.tag)(next) && (!moves || inLoadedRange({ ...value, page: rest }, next, order));
    if (!keep) remember(next);
    const page = !keep ? rest : moves ? [...rest, next].sort(order) : value.page.map((t, j) => (j === i ? next : t));
    store.setQuery<any>("inbox:view", args, { ...value, page });
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

type AppendArgs = { threadId: string; text: string; sendAt?: number; cc?: string[]; bcc?: string[] };

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
      cc: (args.cc ?? []).map((email) => ({ email })),
      ...(args.bcc?.length ? { bcc: args.bcc.map((email) => ({ email })) } : {}),
      // A scheduled send shows as one from the start ("Agendada para …"), as the server's message will.
      ...(direction === "outbound" && args.sendAt !== undefined && args.sendAt > now ? { scheduledFor: args.sendAt } : {}),
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
  for (const fn of ["inbox:threads", "inbox:view"]) {
    for (const { value } of store.getAllQueries<any>(fn) as Array<{ value: { page: Thread[] } | undefined }>) {
      const t = value?.page.find((x) => x._id === threadId);
      if (t) return t.mailbox;
    }
  }
  return null;
}

/** Applies `edit` to every loaded tag list (`inbox:tags`, all mailboxes or one), each kept to its own mailbox and order. */
function editTags(store: Store, mailbox: string | null, edit: (list: TagDoc[]) => TagDoc[]) {
  for (const { args, value } of store.getAllQueries<any>("inbox:tags") as Array<{
    args: { mailbox?: string };
    value: TagDoc[] | undefined;
  }>) {
    if (!value || (mailbox !== null && args.mailbox !== undefined && args.mailbox !== mailbox)) continue;
    // Grouped by mailbox as the server lists them (in the order the mailboxes come), each group in its tags' order.
    // `edit` runs once per list: what it returns is both the groups' source and the list.
    const edited = edit(value);
    const groups = [...new Set([...value, ...edited].map((x) => x.mailbox))];
    const next = edited.filter((x) => args.mailbox === undefined || x.mailbox === args.mailbox);
    const at = (x: TagDoc) => groups.indexOf(x.mailbox);
    store.setQuery<any>(
      "inbox:tags",
      args,
      [...next].sort((a, b) => at(a) - at(b) || a.order - b.order),
    );
  }
}

/** Ids of the loaded threads that carry `tagId` (any list, any open conversation). */
function loadedWithTag(store: Store, tagId: string): Set<string> {
  const ids = new Set<string>();
  for (const fn of ["inbox:threads", "inbox:view", "inbox:sent"]) {
    for (const { value } of store.getAllQueries<any>(fn) as Array<{ value: { page: Thread[] } | undefined }>) {
      for (const t of value?.page ?? []) if (t.tags?.includes(tagId)) ids.add(t._id);
    }
  }
  for (const { value } of store.getAllQueries<any>("inbox:thread") as Array<{ value: ThreadDetail | undefined }>) {
    if (value?.thread.tags?.includes(tagId)) ids.add(value.thread._id);
  }
  return ids;
}

export function inboxOptimisticUpdates(now: () => number = Date.now): Record<string, OptimisticUpdate> {
  const updates: Record<string, OptimisticUpdate> = {
    "inbox:reply": (store, args: AppendArgs) => append(store, args, "outbound", now()),
    "inbox:note": (store, args: { threadId: string; text: string }) => append(store, args, "note", now()),
    // The mailbox badges move with the thread (patchThread), a snoozed one's not at all.
    "inbox:markRead": (store, { threadId }: { threadId: string }) => {
      patchThread(store, threadId, (x) => ({ ...x, unreadCount: 0, hasUnread: false }));
    },
    "inbox:markUnread": (store, { threadId }: { threadId: string }) => {
      patchThread(store, threadId, (x) => ({ ...x, unreadCount: Math.max(1, x.unreadCount), hasUnread: true }));
    },
    "inbox:setStatus": (store, { threadId, status }: { threadId: string; status: ThreadStatus }) => {
      patchThread(store, threadId, (t) => ({ ...t, status }));
    },
    // Spam and back: the status moves at once; the sender rules (if any) are the server's.
    "inbox:reportSpam": (store, { threadId }: { threadId: string }) => {
      patchThread(store, threadId, (t) => ({ ...t, status: "spam" as ThreadStatus }));
    },
    "inbox:notSpam": (store, { threadId }: { threadId: string }) => {
      patchThread(store, threadId, (t) => (t.status === "spam" ? { ...t, status: "open" as ThreadStatus } : t));
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
      const contact = (args.to[0] ?? "")
        .replace(/^.*<([^>]+)>.*$/, "$1")
        .trim()
        .toLowerCase();
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
      for (const { args: qa, value } of store.getAllQueries<any>("inbox:threads") as Array<{
        args: ThreadsArgs;
        value: Page<Thread> | undefined;
      }>) {
        if (!value || qa.mailbox !== args.mailbox || (qa.status !== undefined && qa.status !== "waiting")) continue;
        store.setQuery<any>("inbox:threads", qa, { ...value, page: [thread, ...value.page] });
      }
      // The cross-mailbox views it belongs to (all, waiting) show it on top too, and their counts grow.
      for (const { args: va, value } of store.getAllQueries<any>("inbox:view") as Array<{ args: ViewArgs; value: ViewPage | undefined }>) {
        // A tag's list (`tag`) never takes it: a new conversation has no tags.
        if (!value || !viewKeeps(va.view, va.status, va.tag)(thread)) continue;
        store.setQuery<any>("inbox:view", va, { ...value, page: [thread, ...value.page] });
      }
      const counts = store.getQuery<any>("inbox:views", {}) as ViewCounts | undefined;
      if (counts) {
        const next = { ...counts };
        for (const v of VIEWS) if (counts[v] && viewKeeps(v, undefined)(thread)) next[v] = { ...counts[v], threads: counts[v].threads + 1 };
        store.setQuery<any>("inbox:views", {}, next);
      }
      sentNow(store, thread, at);
    },
  };
  const wake = (t: Thread): Thread => {
    const { snoozed: _s, snoozedUntil: _u, ...rest } = t;
    return rest;
  };
  updates["inbox:snooze"] = (store, { threadId, until }: { threadId: string; until: number | null }) => {
    patchThread(store, threadId, (t) => (until === null ? wake(t) : { ...t, snoozed: true, snoozedUntil: until }));
  };
  updates["inbox:unsnooze"] = (store, { threadId }: { threadId: string }) => {
    patchThread(store, threadId, wake);
  };
  const withTags =
    (tags: string[]) =>
    (t: Thread): Thread =>
      tags.length ? { ...t, tags } : (({ tags: _t, ...rest }) => rest)(t);
  updates["inbox:addTag"] = (store, { threadId, tag }: { threadId: string; tag: string }) => {
    patchThread(store, threadId, (t) => (t.tags?.includes(tag) ? t : withTags([...(t.tags ?? []), tag])(t)));
  };
  updates["inbox:removeTag"] = (store, { threadId, tag }: { threadId: string; tag: string }) => {
    patchThread(store, threadId, (t) => withTags((t.tags ?? []).filter((x) => x !== tag))(t));
  };
  updates["inbox:setTags"] = (store, { threadId, tags }: { threadId: string; tags: string[] }) => {
    patchThread(store, threadId, withTags([...new Set(tags)]));
  };
  updates["inbox:createTag"] = (store, a: { mailbox: string; name: string; color?: string; order?: number }) => {
    const at = now();
    // One tag for every list it joins (the same temporary id everywhere), last in its mailbox unless `order` says.
    const loaded = (store.getAllQueries<any>("inbox:tags") as Array<{ value: TagDoc[] | undefined }>).flatMap((q) => q.value ?? []);
    const order = a.order ?? loaded.filter((x) => x.mailbox === a.mailbox).reduce((n, x) => Math.max(n, x.order + 1), 0);
    const tag: TagDoc = {
      _id: tempId(at),
      _creationTime: at,
      mailbox: a.mailbox,
      name: a.name.trim(),
      nameKey: a.name.trim().toLowerCase(),
      color: a.color ?? "gray",
      order,
      createdAt: at,
    };
    editTags(store, a.mailbox, (list) => [...list, tag]);
  };
  updates["inbox:updateTag"] = (store, a: { tagId: string; name?: string; color?: string; order?: number }) => {
    editTags(store, null, (list) =>
      list.map((x) =>
        x._id === a.tagId
          ? {
              ...x,
              ...(a.name !== undefined ? { name: a.name.trim(), nameKey: a.name.trim().toLowerCase() } : {}),
              ...(a.color !== undefined ? { color: a.color } : {}),
              ...(a.order !== undefined ? { order: a.order } : {}),
            }
          : x,
      ),
    );
  };
  updates["inbox:deleteTag"] = (store, { tagId }: { tagId: string }) => {
    editTags(store, null, (list) => list.filter((x) => x._id !== tagId));
    // Off every loaded thread (their counts move with them), then its own count goes.
    for (const id of loadedWithTag(store, tagId)) patchThread(store, id, (t) => withTags((t.tags ?? []).filter((x) => x !== tagId))(t));
    const counts = store.getQuery<any>("inbox:views", {}) as ViewCounts | undefined;
    if (counts?.tags?.[tagId]) {
      const { [tagId]: _gone, ...tags } = counts.tags;
      store.setQuery<any>("inbox:views", {}, { ...counts, tags });
    }
  };
  updates["inbox:cancelScheduled"] = (store, { emailId }: { emailId: string }) => {
    // The scheduled message leaves its conversation (the server recomputes the rest).
    for (const { args, value } of store.getAllQueries<any>("inbox:thread") as Array<{
      args: { threadId: string };
      value: ThreadDetail | undefined;
    }>) {
      if (!value?.messages.some((m) => m.emailId === emailId)) continue;
      store.setQuery<any>("inbox:thread", args, { ...value, messages: value.messages.filter((m) => m.emailId !== emailId) });
    }
    for (const { args, value } of store.getAllQueries<any>("inbox:scheduled") as Array<{
      args: unknown;
      value: Array<{ emailId: string }> | undefined;
    }>) {
      if (value?.some((x) => x.emailId === emailId))
        store.setQuery<any>(
          "inbox:scheduled",
          args,
          value.filter((x) => x.emailId !== emailId),
        );
    }
  };
  // A forward is a new conversation from the forwarded thread's mailbox: it shows at the top as a compose does.
  updates["inbox:forward"] = (store, args: { threadId: string; to: string[]; subject: string; text: string }, rec) => {
    const mailbox = mailboxOf(store, args.threadId);
    if (mailbox) updates["inbox:compose"]!(store, { mailbox, to: args.to, subject: args.subject, text: args.text }, rec);
  };
  return updates;
}
