// Optimistic updates by mutation name (the same rules as apps/mobile/src/offline/optimistic.ts): registered on the
// client, so a reply shows in the thread with a "sending" mark, the thread moves to "waiting", unread counters drop,
// and the server's answer replaces all of it.
import type { OptimisticLocalStore, OptimisticUpdate } from "@freecorps/ember-client";
import type { Mailbox, Message, Page, Thread, ThreadDetail, ThreadStatus, ThreadsArgs } from "./api";

/** Ids of optimistic rows start with this (the UI shows them as pending). */
export const OPTIMISTIC_PREFIX = "optimistic:";
export const isOptimisticId = (id: string): boolean => id.startsWith(OPTIMISTIC_PREFIX);

let seq = 0;
const tempId = (now: number) => `${OPTIMISTIC_PREFIX}${now.toString(36)}-${(seq++).toString(36)}`;

type Store = OptimisticLocalStore;

/** Applies `patch` to the thread wherever it is loaded: its detail and every thread-list page. */
function patchThread(store: Store, threadId: string, patch: (t: Thread) => Thread): Thread | null {
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
    // A status filter the thread no longer matches drops it from that list.
    const page =
      args.status !== undefined && args.status !== next.status
        ? value.page.filter((_, j) => j !== i)
        : value.page.map((t, j) => (j === i ? next : t));
    store.setQuery<any>("inbox:threads", args, { ...value, page });
  }
  return found;
}

function adjustUnread(store: Store, mailbox: string, delta: number) {
  const boxes = store.getQuery<any>("inbox:mailboxes", {}) as Mailbox[] | undefined;
  if (!boxes) return;
  store.setQuery<any>(
    "inbox:mailboxes",
    {},
    boxes.map((b) => (b.name === mailbox ? { ...b, unread: Math.max(0, b.unread + delta) } : b)),
  );
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
  patchThread(store, args.threadId, (t) => ({
    ...t,
    messageCount: t.messageCount + 1,
    lastMessageAt: now,
    ...(direction === "note" ? {} : { status: t.status === "spam" ? "spam" : ("waiting" as ThreadStatus), snippet }),
  }));
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
    },
  };
  // A forward is a new conversation from the forwarded thread's mailbox: it shows at the top as a compose does.
  updates["inbox:forward"] = (store, args: { threadId: string; to: string[]; subject: string; text: string }, rec) => {
    const mailbox = mailboxOf(store, args.threadId);
    if (mailbox) updates["inbox:compose"]!(store, { mailbox, to: args.to, subject: args.subject, text: args.text }, rec);
  };
  return updates;
}
