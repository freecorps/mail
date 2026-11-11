// View models of the mailbox and thread-list screens (hooks over live queries; the row builders are pure).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuerySnapshot } from "@freecorps/ember-react-native";
import { api, type InboxView, type Mailbox, type SearchHit, type SentThread, type Thread, type ThreadStatus, type ViewCounts } from "../api";
import type { StringKey } from "../i18n";
import { contactOf, displayAddress } from "../lib/format";
import { isOptimisticId } from "../offline/optimistic";

/** A status, or `sent`: the conversations the mailbox wrote in, by its latest send (not a status). */
export type ThreadFilter = "all" | "open" | "waiting" | "closed" | "sent";
export const THREAD_FILTERS: ThreadFilter[] = ["all", "open", "waiting", "closed", "sent"];
export const PAGE = 30;

/** What a list shows: one mailbox, or a view across the member's mailboxes (apps/api `inbox:view`). */
export type ListSource = { mailbox: string; view?: undefined } | { view: InboxView; mailbox?: undefined };

/** The filters a list offers: a mailbox has a Sent view; "waiting" is already a status; views have no Sent. */
export function filtersFor(source: ListSource): ThreadFilter[] {
  if (source.mailbox !== undefined) return THREAD_FILTERS;
  return source.view === "waiting" ? [] : ["all", "open", "waiting", "closed"];
}

/** A filter's label: in "assigned" and "unread", no status means the open and waiting ones (the server's default). */
export function filterLabelKey(source: ListSource, f: ThreadFilter): StringKey {
  if (f === "all" && (source.view === "assigned" || source.view === "unread")) return "threads.filter.active";
  return `threads.filter.${f}`;
}

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
      unread: false,
      status: null,
      assignee: null,
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
  const mailboxes: Mailbox[] = ownFirst(s.value ?? []);
  return {
    status: (s.status === "success" ? "ready" : s.status) as LoadStatus,
    error: s.error ?? null,
    mailboxes,
    totalUnread: mailboxes.reduce((n, b) => n + b.unread, 0),
    source: sourceOf(s),
  };
}

export const MIN_QUERY = 2;

/** `mailbox`: one mailbox's list (with Sent); `view`: a view across the member's mailboxes (search covers them all). */
export function useThreadList(o: ListSource & { filter: ThreadFilter; query: string; searchOnly?: boolean }) {
  const [limit, setLimit] = useState({ key: "", n: PAGE });
  const key = `${o.mailbox ?? `view:${o.view}`}\u0000${o.filter}`;
  const n = limit.key === key ? limit.n : PAGE;
  const q = o.query.trim();
  const searching = q.length >= MIN_QUERY;
  const mailbox = o.mailbox;
  const sentView = mailbox !== undefined && o.filter === "sent";
  const status = o.filter === "all" || o.filter === "sent" ? {} : { status: o.filter };
  const inbox = useQuerySnapshot(api.inbox.threads, searching || sentView || mailbox === undefined ? "skip" : { mailbox, ...status, paginationOpts: { numItems: n, cursor: null } });
  // The search tab lists nothing until there is a query: no view read (or paged) behind it.
  const view = useQuerySnapshot(api.inbox.view, searching || o.searchOnly || o.view === undefined ? "skip" : { view: o.view, ...(o.view === "waiting" ? {} : status), limit: n });
  const sent = useQuerySnapshot(api.inbox.sent, !searching && sentView ? { mailbox, limit: n } : "skip");
  const list = sentView ? sent : mailbox === undefined ? view : inbox;
  const search = useQuerySnapshot(api.inbox.search, searching ? { query: q, ...(mailbox ? { mailbox } : {}) } : "skip");
  const s = searching ? search : list;
  const fresh = useMemo(
    () =>
      s.value === undefined
        ? null
        : searching
          ? searchRows(search.value ?? [])
          : sentView
            ? (sent.value?.page ?? []).map(sentRow)
            : ((mailbox === undefined ? view.value?.page : inbox.value?.page) ?? []).map(threadRow),
    [searching, sentView, mailbox, s.value, search.value, sent.value, inbox.value, view.value],
  );
  // While a bigger page (or a new search) loads, keep showing the previous rows of the same list.
  const last = useRef<{ key: string; rows: ThreadRow[] }>({ key: "", rows: [] });
  const listKey = `${key}\u0000${searching ? q : ""}`;
  if (fresh) last.current = { key: listKey, rows: fresh };
  const rows = fresh ?? (last.current.key.startsWith(`${key}\u0000`) ? last.current.rows : []);
  return {
    rows,
    searching,
    status: (s.status === "success" ? "ready" : s.status) as LoadStatus,
    error: s.error ?? null,
    source: sourceOf(s),
    optimistic: s.optimistic,
    canLoadMore: !searching && !!list.value && !list.value.isDone,
    /** A view that may miss older matches (the server scans a bounded window per mailbox). */
    partial: !searching && !!view.value?.partial && mailbox === undefined,
    loadMore: () => setLimit({ key, n: n + PAGE }),
  };
}

/** The home screen's counts per view (`inbox:views`); zeros until they load. */
export function useViewCounts(): ViewCounts | null {
  const s = useQuerySnapshot(api.inbox.views, {});
  return s.value ?? null;
}

/** A count as a badge: "99+" past 99, "+" when the server's count is a lower bound. */
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
