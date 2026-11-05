// View models of the mailbox and thread-list screens (hooks over live queries; the row builders are pure).
import { useEffect, useMemo, useState } from "react";
import { useQuerySnapshot } from "@freecorps/ember-react";
import { api, type Mailbox, type SearchHit, type Thread, type ThreadStatus } from "@/lib/api";
import { contactOf, displayAddress } from "@/lib/format";
import { isOptimisticId } from "@/lib/optimistic";

export type ThreadFilter = "all" | "open" | "waiting" | "closed";
export const THREAD_FILTERS: ThreadFilter[] = ["all", "open", "waiting", "closed"];
export const PAGE = 30;

export interface ThreadRow {
  key: string;
  threadId: string;
  mailbox: string;
  number: number;
  title: string;
  subject: string;
  snippet: string;
  at: number;
  unread: boolean;
  status: ThreadStatus | null;
  assigneeName: string | null;
  /** Created offline / not confirmed by the server yet. */
  pending: boolean;
}

/** DOM id of a thread row (keyboard cursor scrolls it into view). */
export const rowDomId = (threadId: string) => `thread-row-${threadId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

export type Source = "server" | "local" | "cache";
export type LoadStatus = "loading" | "ready" | "error";

export function threadRow(t: Thread): ThreadRow {
  return {
    key: t._id,
    threadId: t._id,
    mailbox: t.mailbox,
    number: t.number,
    title: contactOf(t),
    subject: t.subject,
    snippet: t.snippet,
    at: t.lastMessageAt,
    unread: t.unreadCount > 0,
    status: t.status,
    assigneeName: t.assigneeName ?? null,
    pending: isOptimisticId(t._id),
  };
}

/** Search hits are messages: one row per thread (its best-ranked hit). */
export function searchRows(hits: readonly SearchHit[]): ThreadRow[] {
  const seen = new Set<string>();
  const out: ThreadRow[] = [];
  for (const h of hits) {
    if (seen.has(h.threadId)) continue;
    seen.add(h.threadId);
    out.push({
      key: h.messageId,
      threadId: h.threadId,
      mailbox: h.mailbox,
      number: 0,
      title: displayAddress(h.from),
      subject: h.subject,
      snippet: h.snippet,
      at: h.at,
      unread: false,
      status: null,
      assigneeName: null,
      pending: false,
    });
  }
  return out;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const sourceOf = (s: { source?: "local" | "cache" }): Source => s.source ?? "server";

export function useMailboxes() {
  const s = useQuerySnapshot(api.inbox.mailboxes, {});
  const mailboxes: Mailbox[] = s.value ?? [];
  return {
    status: (s.status === "success" ? "ready" : s.status) as LoadStatus,
    error: s.error ?? null,
    mailboxes,
    totalUnread: mailboxes.reduce((n, b) => n + b.unread, 0),
    source: sourceOf(s),
  };
}

export const MIN_QUERY = 2;

export function useThreadList(o: { mailbox: string; filter: ThreadFilter; query: string }) {
  const [limit, setLimit] = useState({ key: "", n: PAGE });
  const key = `${o.mailbox}\u0000${o.filter}`;
  const n = limit.key === key ? limit.n : PAGE;
  const q = o.query.trim();
  const searching = q.length >= MIN_QUERY;
  const list = useQuerySnapshot(
    api.inbox.threads,
    searching
      ? "skip"
      : { mailbox: o.mailbox, ...(o.filter === "all" ? {} : { status: o.filter }), paginationOpts: { numItems: n, cursor: null } },
  );
  const search = useQuerySnapshot(api.inbox.search, searching ? { query: q, mailbox: o.mailbox } : "skip");
  const s = searching ? search : list;
  const fresh = useMemo(
    () => (s.value === undefined ? null : searching ? searchRows(search.value ?? []) : (list.value?.page ?? []).map(threadRow)),
    [searching, s.value, search.value, list.value],
  );
  // While a bigger page (or a new search) loads, keep showing the previous rows of the same list.
  const [last, setLast] = useState<{ key: string; rows: ThreadRow[] }>({ key: "", rows: [] });
  const listKey = `${key}\u0000${searching ? q : ""}`;
  // Derived state, updated during render (React re-renders at once with it).
  if (fresh && (last.rows !== fresh || last.key !== listKey)) setLast({ key: listKey, rows: fresh });
  const rows = fresh ?? (last.key.startsWith(`${key}\u0000`) ? last.rows : []);
  return {
    rows,
    searching,
    status: (s.status === "success" ? "ready" : s.status) as LoadStatus,
    error: s.error ?? null,
    source: sourceOf(s),
    optimistic: s.optimistic,
    canLoadMore: !searching && !!list.value && !list.value.isDone,
    loadMore: () => setLimit({ key, n: n + PAGE }),
  };
}
