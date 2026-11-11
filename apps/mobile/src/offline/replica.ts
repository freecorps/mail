// The device's offline replica of the inbox (PLAN §10 "Offline completo", contracts.md "Offline").
//
// The server's `inbox:*` queries call into the email component (`ctx.runQuery(components.email.lib.threads)`), and
// component calls cannot run on a replica. So the app registers *local twins* under the same names: plain `query()`
// handlers that read the replicated component tables directly (`email$threads`, `email$messages`, the physical
// names the component's tables have in the server's composed schema). Online, the server answers as usual and its
// complete documents are replicated row by row; offline or on a cold start, the twins run over expo-sqlite with the
// server's SQL compiler — `inbox:search` runs on FTS5 (`unicode61 remove_diacritics 2`), so "fatura" finds "Fátura".
//
// Access control stays on the server: the replica only ever holds rows the server returned to this member, and it
// is wiped on sign-out (`clearReplica`).
import { emailSchema } from "@freecorps/ember-email/schema";
import { composeApp, defineApp, defineComponent, defineSchema, query, v, type LocalSchema } from "@freecorps/ember-server";
import type { SyncSpec } from "@freecorps/ember-react-native";
import { api, type InboxView, type Message, type SearchHit, type Thread, type ViewCount } from "../api";

/** The email component's tables under their installed names (`email$<table>`, ids `email$<prefix>_…`). */
export const replicaSchema: LocalSchema = composeApp({
  schema: defineSchema({ tables: {} }),
  app: defineApp().use(defineComponent({ name: "email", schema: emailSchema, functions: {} })),
}).schema;

const THREADS = "email$threads";
const MESSAGES = "email$messages";
const pageV = v.optional(v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) }));

/**
 * Who is signed in, for the `assigned` view offline (a local query has no identity; the session sets it once
 * `inbox:me` answers, and clears it on sign-out).
 */
let replicaUser: string | null = null;
export function setReplicaUser(userId: string | null) {
  replicaUser = userId;
}

const ACTIVE = new Set(["open", "waiting"]);

/** The server's view rules (apps/api `inbox:view`) over the replicated threads (every one the member was sent). */
export function viewKeeps(view: InboxView, status: string | undefined): (t: Thread) => boolean {
  const inStatus = (t: Thread, fallback: (t: Thread) => boolean) => (status ? t.status === status : fallback(t));
  switch (view) {
    case "all":
      return (t) => inStatus(t, () => true);
    case "waiting":
      return (t) => t.status === "waiting";
    case "assigned":
      return (t) => replicaUser !== null && t.assignee === replicaUser && inStatus(t, (x) => ACTIVE.has(x.status));
    case "unread":
      return (t) => t.unreadCount > 0 && inStatus(t, (x) => ACTIVE.has(x.status));
  }
}

const newestFirst = (a: Thread, b: Thread) => b.lastMessageAt - a.lastMessageAt || (a._id < b._id ? 1 : a._id > b._id ? -1 : 0);

/** Same names and arguments as apps/api/ember/inbox.ts; same results, computed from the replica. */
export const localQueries = {
  "inbox:threads": query({
    args: { mailbox: v.string(), status: v.optional(v.string()), paginationOpts: pageV },
    handler: (ctx: any, a: { mailbox: string; status?: string; paginationOpts?: { numItems: number; cursor: string | null } }) => {
      const q =
        a.status === undefined
          ? ctx.db.query(THREADS).withIndex("by_mailbox_last", (r: any) => r.eq("mailbox", a.mailbox))
          : ctx.db.query(THREADS).withIndex("by_mailbox_status", (r: any) => r.eq("mailbox", a.mailbox).eq("status", a.status));
      return q.order("desc").paginate(a.paginationOpts ?? { numItems: 30, cursor: null });
    },
  }),
  "inbox:view": query({
    args: { view: v.string(), status: v.optional(v.string()), limit: v.optional(v.number()) },
    handler: (ctx: any, a: { view: string; status?: string; limit?: number }) => {
      const want = Math.min(Math.max(Math.trunc(a.limit ?? 30), 1), 300);
      const rows = (ctx.db.query(THREADS).collect() as Thread[]).filter(viewKeeps(a.view as InboxView, a.status)).sort(newestFirst);
      return { page: rows.slice(0, want), isDone: rows.length <= want, partial: false };
    },
  }),
  "inbox:views": query({
    args: {},
    handler: (ctx: any) => {
      const all = ctx.db.query(THREADS).collect() as Thread[];
      const count = (view: InboxView): ViewCount => {
        const rows = all.filter(viewKeeps(view, undefined));
        return { threads: rows.length, unread: rows.reduce((n, t) => n + t.unreadCount, 0), capped: false };
      };
      return { all: count("all"), assigned: count("assigned"), unread: count("unread"), waiting: count("waiting") };
    },
  }),
  // No `delivery` marker here: the component's `emails` table is not replicated. Online the server's answer has it.
  "inbox:thread": query({
    args: { threadId: v.string() },
    handler: (ctx: any, a: { threadId: string }) => {
      const thread = ctx.db.normalizeId(THREADS, a.threadId) ? (ctx.db.get(a.threadId) as Thread | null) : null;
      if (!thread) throw new Error("thread not found");
      const messages = ctx.db.query(MESSAGES).withIndex("by_thread", (r: any) => r.eq("threadId", thread._id)).collect() as Message[];
      return { thread, messages };
    },
  }),
  "inbox:search": query({
    args: { query: v.string(), mailbox: v.optional(v.string()) },
    handler: (ctx: any, a: { query: string; mailbox?: string }): SearchHit[] => {
      const rows = ctx.db
        .query(MESSAGES)
        .withSearchIndex("search", (s: any) => {
          const b = s.search("searchText", a.query);
          return a.mailbox === undefined ? b : b.eq("mailbox", a.mailbox);
        })
        .take(50) as Message[];
      return rows.map((m) => ({ messageId: m._id, threadId: m.threadId, mailbox: m.mailbox, direction: m.direction, subject: m.subject, from: m.from, snippet: m.snippet, at: m.at }));
    },
  }),
};

/** Kept subscribed while signed in: the latest threads of every visible mailbox, with their messages. */
export const RECENT_THREADS = 50;
export const replicaSync: SyncSpec[] = [{ query: api.inbox.recent, args: { threads: RECENT_THREADS } }];
