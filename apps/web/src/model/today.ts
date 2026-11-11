// "Hoje", the empty reading pane: what needs you today across every mailbox. Counts from `inbox:views`, the threads
// assigned to you and the ones waiting on the contact for more than a day from `inbox:view`. The pure parts are tested.
import { useQuerySnapshot } from "@freecorps/ember-react";
import { api, type Thread, type View, type ViewCount } from "@/lib/api";
import type { LoadStatus } from "./threads";

/** A conversation waiting on the contact for longer than this is due a follow-up. */
export const STALE_MS = 24 * 3_600_000;
/** Rows per section; the rest is a count. */
export const TODAY_ROWS = 5;
/** Waiting threads read to find the stale ones (newest first, so the stale ones are the tail). */
export const WAITING_SCAN = 100;

/** Waiting threads whose last message is older than `ms`, the longest waiting first. */
export function staleWaiting(rows: readonly Thread[], now: number, ms = STALE_MS): Thread[] {
  return rows.filter((t) => now - t.lastMessageAt > ms).sort((a, b) => a.lastMessageAt - b.lastMessageAt);
}

export interface TodaySection {
  status: LoadStatus;
  rows: Thread[];
  /** How many match in all (at least `rows.length`); `more` when the server stopped counting. */
  total: number;
  more: boolean;
}

const statusOf = (s: { status: string }): LoadStatus => (s.status === "success" ? "ready" : (s.status as LoadStatus));

export function useToday(now: number) {
  const counts = useQuerySnapshot(api.inbox.views, {});
  const assigned = useQuerySnapshot(api.inbox.view, { view: "assigned", limit: TODAY_ROWS + 1 });
  const waiting = useQuerySnapshot(api.inbox.view, { view: "waiting", limit: WAITING_SCAN });
  const stale = staleWaiting(waiting.value?.page ?? [], now);
  const mine: TodaySection = {
    status: statusOf(assigned),
    rows: (assigned.value?.page ?? []).slice(0, TODAY_ROWS),
    total: counts.value?.assigned.threads ?? assigned.value?.page.length ?? 0,
    more: counts.value?.assigned.capped ?? false,
  };
  const overdue: TodaySection = {
    status: statusOf(waiting),
    rows: stale.slice(0, TODAY_ROWS),
    total: stale.length,
    // Every scanned row was stale and there are more: older ones are stale too.
    more: !!waiting.value && !waiting.value.isDone && stale.length === waiting.value.page.length,
  };
  return {
    counts: { status: statusOf(counts), value: (counts.value ?? null) as Record<View, ViewCount> | null },
    mine,
    overdue,
  };
}
