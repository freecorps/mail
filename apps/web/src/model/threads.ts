// View models of the mailbox and thread-list screens (hooks over live queries; the row builders are pure).
import { useEffect, useMemo, useState } from "react";
import { useQuerySnapshot } from "@freecorps/ember-react";
import { api, type Mailbox, type SearchHit, type SentThread, type Thread, type ThreadStatus, type View } from "@/lib/api";
import { contactOf, displayAddress } from "@/lib/format";
import { isOptimisticId } from "@/lib/optimistic";
import { useDevData } from "@/dev/data";
import { FIXTURES } from "@/dev/fixtures";

/**
 * What a mailbox's list shows: a status (`spam` included), or `sent`, the conversations the mailbox wrote in, by its
 * latest send (not a status). The tabs over the list are the working statuses; Sent and Spam are sidebar destinations.
 */
export type ThreadFilter = "all" | "open" | "waiting" | "closed" | "sent" | "spam";
export const THREAD_FILTERS: ThreadFilter[] = ["all", "open", "waiting", "closed", "sent", "spam"];
export const STATUS_TABS: ThreadFilter[] = ["all", "open", "waiting", "closed"];
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
  assignee: string | null;
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
    assignee: t.assignee ?? null,
    assigneeName: t.assigneeName ?? null,
    pending: isOptimisticId(t._id),
  };
}

/** A Sent row: the thread, at when the mailbox last wrote in it (not its latest message, maybe an answer). */
export const sentRow = (t: SentThread): ThreadRow => ({ ...threadRow(t), at: t.lastSentAt });

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
      // The thread's state rides on the hit, so hover and bulk actions toggle the right way (null: an older server).
      unread: (h.unreadCount ?? 0) > 0,
      status: h.status ?? null,
      assignee: h.assignee ?? null,
      assigneeName: h.assigneeName ?? null,
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
  const dev = useDevData();
  const mailboxes: Mailbox[] = ownFirst(import.meta.env.DEV && dev ? FIXTURES[dev].mailboxes : (s.value ?? []));
  return {
    status: (s.status === "success" ? "ready" : s.status) as LoadStatus,
    error: s.error ?? null,
    mailboxes,
    totalUnread: mailboxes.reduce((n, b) => n + b.unread, 0),
    source: sourceOf(s),
  };
}

export const MIN_QUERY = 2;

/** Most threads one `inbox:view` read returns (apps/api VIEW_MAX). */
export const VIEW_MAX = 300;

/** The statuses a view's list can be narrowed to with the tabs: only "all mailboxes" takes every status. */
export const viewTakesTabs = (view: View | null) => view === null || view === "all";

/**
 * The list: a view across mailboxes (`view`), or one mailbox's list (`filter`: a status, Sent, Spam); a search query of
 * two characters or more replaces either (across every mailbox in a view, in the mailbox otherwise).
 */
export function useThreadList(o: { mailbox: string; view?: View | null; filter: ThreadFilter; query: string }) {
  const view = o.view ?? null;
  const [limit, setLimit] = useState({ key: "", n: PAGE });
  const key = `${view ?? o.mailbox}\u0000${o.filter}`;
  const n = limit.key === key ? limit.n : PAGE;
  const q = o.query.trim();
  const searching = q.length >= MIN_QUERY;
  const sentView = !view && o.filter === "sent";
  // No mailbox and no view (a member without mailboxes): nothing to read.
  const none = !view && !o.mailbox;
  const status = o.filter === "all" || o.filter === "sent" ? undefined : (o.filter as ThreadStatus);
  const inbox = useQuerySnapshot(
    api.inbox.threads,
    searching || sentView || view || none
      ? "skip"
      : { mailbox: o.mailbox, ...(status ? { status } : {}), paginationOpts: { numItems: n, cursor: null } },
  );
  const sent = useQuerySnapshot(api.inbox.sent, !searching && sentView && !none ? { mailbox: o.mailbox, limit: n } : "skip");
  const across = useQuerySnapshot(
    api.inbox.view,
    !searching && view
      ? { view, ...(viewTakesTabs(view) && status && status !== "spam" ? { status } : {}), limit: Math.min(n, VIEW_MAX) }
      : "skip",
  );
  const list = view ? across : sentView ? sent : inbox;
  const search = useQuerySnapshot(api.inbox.search, searching && !none ? { query: q, ...(view ? {} : { mailbox: o.mailbox }) } : "skip");
  const s = searching ? search : list;
  const fresh = useMemo(
    () =>
      s.value === undefined
        ? null
        : searching
          ? searchRows(search.value ?? [])
          : view
            ? (across.value?.page ?? []).map(threadRow)
            : sentView
              ? (sent.value?.page ?? []).map(sentRow)
              : (inbox.value?.page ?? []).map(threadRow),
    [searching, view, sentView, s.value, search.value, across.value, sent.value, inbox.value],
  );
  // While a bigger page (or a new search) loads, keep showing the previous rows of the same list.
  const [last, setLast] = useState<{ key: string; rows: ThreadRow[] }>({ key: "", rows: [] });
  const listKey = `${key}\u0000${searching ? q : ""}`;
  // Derived state, updated during render (React re-renders at once with it).
  if (fresh && (last.rows !== fresh || last.key !== listKey)) setLast({ key: listKey, rows: fresh });
  const kept = fresh ?? (last.key.startsWith(`${key}\u0000`) ? last.rows : []);
  const dev = useDevData();
  const [devNow] = useState(() => Date.now());
  const devRows = useMemo(() => (import.meta.env.DEV && dev ? FIXTURES[dev].list(devNow).map(threadRow) : null), [dev, devNow]);
  const rows = devRows ?? kept;
  return {
    rows,
    /** Rows in date order (lists), not by relevance (search): the list groups them by day. */
    dated: !searching,
    searching,
    status: (s.status === "success" ? "ready" : s.status) as LoadStatus,
    error: s.error ?? null,
    source: sourceOf(s),
    optimistic: s.optimistic,
    canLoadMore: !devRows && !searching && !!list.value && !list.value.isDone && (!view || n < VIEW_MAX),
    loadMore: () => setLimit({ key, n: n + PAGE }),
  };
}

/** Whether a mailbox has any spam (the sidebar lists Spam only then). */
export function useHasSpam(mailbox: string | null): boolean {
  const s = useQuerySnapshot(
    api.inbox.threads,
    mailbox ? { mailbox, status: "spam", paginationOpts: { numItems: 1, cursor: null } } : "skip",
  );
  const dev = useDevData();
  if (import.meta.env.DEV && dev) return FIXTURES[dev].hasSpam;
  return (s.value?.page.length ?? 0) > 0;
}

/** The view counts (`inbox:views`) for the sidebar and Hoje; null while loading. */
export function useViewCounts() {
  const s = useQuerySnapshot(api.inbox.views, {});
  const dev = useDevData();
  if (import.meta.env.DEV && dev) return FIXTURES[dev].counts;
  return s.value ?? null;
}

/**
 * The number beside a view, as on mobile: unread messages for "all" and "unread" (what a mail app counts), the
 * threads themselves for "assigned" and "waiting" (a to-do list, worked on whether read or not). Null when zero.
 */
export function viewBadge(view: View, counts: Record<View, { threads: number; unread: number; capped: boolean }> | null): string | null {
  const c = counts?.[view];
  if (!c) return null;
  const n = view === "all" || view === "unread" ? c.unread : c.threads;
  return n > 0 ? badge(n, c.capped) : null;
}

/** A count for a badge: "99+" past 99, "+" when the server stopped counting. */
export function badge(n: number, capped = false): string {
  return n > 99 ? "99+" : `${n}${capped ? "+" : ""}`;
}

/** Your own mailbox first, then the shared ones as the server lists them (stable). */
export function ownFirst<T extends { personal?: boolean }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(!!b.personal) - Number(!!a.personal));
}

/**
 * What the composer does: the mode picked, except where notes do not exist (a personal mailbox), where it is always a
 * reply. Derived, not reset: a note picked before the mailbox was known to be personal never goes out as a note.
 */
export function composerMode(picked: "reply" | "note", notes: boolean | undefined): "reply" | "note" {
  return notes === false ? "reply" : picked;
}

/** Whether `mailbox` is the signed-in person's own (personal) mailbox; false while unknown or for a shared one. */
export function isPersonal(list: readonly { name: string; personal?: boolean }[], mailbox: string | null | undefined): boolean {
  return mailbox != null && list.some((b) => b.name === mailbox && b.personal === true);
}
