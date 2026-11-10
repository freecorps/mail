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
import { api, type Message, type SearchHit, type Thread } from "../api";

/** The email component's tables under their installed names (`email$<table>`, ids `email$<prefix>_…`). */
export const replicaSchema: LocalSchema = composeApp({
  schema: defineSchema({ tables: {} }),
  app: defineApp().use(defineComponent({ name: "email", schema: emailSchema, functions: {} })),
}).schema;

const THREADS = "email$threads";
const MESSAGES = "email$messages";
const pageV = v.optional(v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) }));

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
