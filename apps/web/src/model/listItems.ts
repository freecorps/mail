// The thread list as the virtualizer sees it (pure; tested): rows under date headers (Hoje, Ontem, Esta semana, then
// one per month), and the selection rules (`x`, shift-click, shift+j/k).
import { translate, type Locale } from "@/i18n/strings";
import type { ThreadRow } from "./threads";

export type ListItem = { kind: "group"; key: string; label: string } | { kind: "row"; key: string; row: ThreadRow };

const dayStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
};
const daysBefore = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() - n);
  return x.getTime();
};

/** First day of the week in the locale, as `Intl.Locale` week info numbers it (1 = Monday … 7 = Sunday). */
export function firstDayOfWeek(locale: Locale): number {
  try {
    const l = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    return l.getWeekInfo?.().firstDay ?? l.weekInfo?.firstDay ?? 7;
  } catch {
    return 7;
  }
}

/** The date group of a row: today, yesterday, earlier this week, else its month (with the year when not this one). */
export function dateGroup(at: number, now: number, locale: Locale): { key: string; label: string } {
  const today = dayStart(now);
  if (at >= today.getTime()) return { key: "today", label: translate(locale, "list.group.today") };
  if (at >= daysBefore(today, 1)) return { key: "yesterday", label: translate(locale, "list.group.yesterday") };
  const back = (today.getDay() - (firstDayOfWeek(locale) % 7) + 7) % 7;
  if (at >= daysBefore(today, back)) return { key: "week", label: translate(locale, "list.group.week") };
  const d = new Date(at);
  const sameYear = d.getFullYear() === today.getFullYear();
  const label = new Intl.DateTimeFormat(locale, sameYear ? { month: "long" } : { month: "long", year: "numeric" }).format(d);
  return { key: `m:${d.getFullYear()}-${d.getMonth()}`, label: label.charAt(0).toLocaleUpperCase(locale) + label.slice(1) };
}

/**
 * Rows with a header before each date group. Lists in date order get headers; search results (by relevance) do not.
 * A header's key is unique per group, so the same group never shows twice even if the order is off by a row.
 */
export function listItems(rows: readonly ThreadRow[], o: { grouped: boolean; now: number; locale: Locale }): ListItem[] {
  if (!o.grouped) return rows.map((row) => ({ kind: "row", key: row.key, row }));
  const out: ListItem[] = [];
  let last: string | null = null;
  for (const row of rows) {
    const g = dateGroup(row.at, o.now, o.locale);
    if (g.key !== last) {
      out.push({ kind: "group", key: `group:${g.key}:${out.length}`, label: g.label });
      last = g.key;
    }
    out.push({ kind: "row", key: row.key, row });
  }
  return out;
}

/** `x` / ⌘-click: one thread in or out of the selection. */
export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** Shift-click: everything between the anchor (the last thread toggled) and `id` joins the selection. */
export function selectRange(ids: readonly string[], selected: ReadonlySet<string>, anchor: string | null, id: string): Set<string> {
  const next = new Set(selected);
  const a = anchor === null ? -1 : ids.indexOf(anchor);
  const b = ids.indexOf(id);
  if (b < 0) return next;
  if (a < 0) return next.add(id);
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(ids[i]!);
  return next;
}

/** shift+j / shift+k: the cursor moves one row and the selection grows over both rows (Gmail). */
export function extendSelection(
  ids: readonly string[],
  selected: ReadonlySet<string>,
  cursor: string | null,
  delta: 1 | -1,
): { selected: Set<string>; cursor: string | null } {
  if (!ids.length) return { selected: new Set(selected), cursor: null };
  const i = cursor === null ? -1 : ids.indexOf(cursor);
  const from = i < 0 ? (delta > 0 ? 0 : ids.length - 1) : i;
  const to = i < 0 ? from : Math.min(ids.length - 1, Math.max(0, from + delta));
  const next = new Set(selected);
  next.add(ids[from]!);
  next.add(ids[to]!);
  return { selected: next, cursor: ids[to]! };
}

/** Rows that can be selected: not ones the server has not confirmed yet (their checkbox is disabled, no actions). */
export const selectable = <T extends { pending?: boolean }>(rows: readonly T[]): T[] => rows.filter((r) => !r.pending);

/**
 * The selection as the list has it now: threads that left the list (archived away, another page) drop out, and so do
 * pending rows (shift+j/k can step over one; no action may target an id the server has not confirmed).
 */
export function visibleSelection<T extends { threadId: string; pending?: boolean }>(
  selected: ReadonlySet<string>,
  rows: readonly T[],
): T[] {
  if (!selected.size) return [];
  return rows.filter((r) => !r.pending && selected.has(r.threadId));
}

/**
 * The index to scroll to so the keyboard cursor stays in view, or -1. Only when the cursor moved since the last scroll
 * (`followed`: the id scrolled to then): the list changing under a cursor that scrolled away (a page loading, a new
 * message, an archive) leaves the scroll where the reader put it. A cursor whose row has not loaded yet waits for it.
 */
export function cursorIndex(items: readonly ListItem[], cursorId: string | null, followed: string | null): number {
  if (!cursorId || cursorId === followed) return -1;
  return items.findIndex((it) => it.kind === "row" && it.row.threadId === cursorId);
}

/**
 * Whether the next page should load: the last rows are in view (`lastIndex`, within 6 of the end), more can load, and
 * this list has not asked at this length yet. `asked` is per list (`place`: view, mailbox, status, search), so a list
 * that happens to have the length another one asked at still pages.
 */
export function loadMoreDue(o: {
  place: string;
  count: number;
  lastIndex: number;
  canLoadMore: boolean;
  loading: boolean;
  asked: { place: string; count: number } | null;
}): boolean {
  if (!o.canLoadMore || o.loading) return false;
  if (o.asked && o.asked.place === o.place && o.asked.count === o.count) return false;
  return o.lastIndex >= o.count - 6;
}
