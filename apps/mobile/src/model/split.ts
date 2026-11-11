// The iPad (and large Android screen) layout: a conversation list and the open conversation side by side once the
// window is wide enough (iPad full screen, 2/3 and the 13-inch's 1/2 Split View, landscape foldables), the phone's
// push navigation below that (Slide Over, 1/3 Split View, phones). Pure: the screens pass the window size.

/** Narrowest window that gets two panes: about where iPadOS switches to the regular width size class. */
export const SPLIT_MIN_WIDTH = 678;
/** The list column: Mail's width on an 11-inch iPad, narrower or wider with the window, within these bounds. */
const LIST_MIN = 320;
const LIST_MAX = 420;
const LIST_SHARE = 0.38;

export type PaneLayout = { split: false } | { split: true; listWidth: number };

/** One pane (the phone navigation) or two, with the list column's width. */
export function paneLayout(width: number): PaneLayout {
  if (!(width >= SPLIT_MIN_WIDTH)) return { split: false };
  return { split: true, listWidth: Math.round(Math.min(LIST_MAX, Math.max(LIST_MIN, width * LIST_SHARE))) };
}

interface Keyed {
  threadId: string;
}

/**
 * The conversation one step down (`1`) or up (`-1`) from `current` in the list: J/K and the arrow keys. With nothing
 * selected (or a selection the list no longer has) either key starts at the top. Stays put at either end.
 */
export function step<T extends Keyed>(rows: readonly T[], current: string | null, dir: 1 | -1): T | null {
  if (!rows.length) return null;
  const i = current === null ? -1 : rows.findIndex((r) => r.threadId === current);
  if (i < 0) return rows[0]!;
  return rows[Math.min(rows.length - 1, Math.max(0, i + dir))]!;
}

/**
 * What to show once the open conversation leaves (archived, snoozed or deleted from the detail pane): the one below
 * it, or the one above at the end of the list, or nothing (Mail moves on to the next message).
 */
export function nextAfter<T extends Keyed>(rows: readonly T[], current: string): T | null {
  const i = rows.findIndex((r) => r.threadId === current);
  if (i < 0) return null;
  return rows[i + 1] ?? rows[i - 1] ?? null;
}

/**
 * The selection once the list changes. Still listed: kept. Gone (archived on another device, or the list's filter no
 * longer matches): its next surviving neighbor from the list as it was, below it first, else nothing.
 */
export function reselect<T extends Keyed>(before: readonly T[], after: readonly T[], current: string | null): string | null {
  if (current === null) return null;
  const now = new Set(after.map((r) => r.threadId));
  if (now.has(current)) return current;
  const i = before.findIndex((r) => r.threadId === current);
  if (i < 0) return null;
  for (let j = i + 1; j < before.length; j++) if (now.has(before[j]!.threadId)) return before[j]!.threadId;
  for (let j = i - 1; j >= 0; j--) if (now.has(before[j]!.threadId)) return before[j]!.threadId;
  return null;
}

/**
 * The pane's conversation once the list changed. Still listed, it stays. Gone because of an action on it from the list
 * (`acted`: archive, snooze, a move), the selection passes to its surviving neighbor (`reselect`). Gone for any other
 * reason (opening it read it, so it left "Não lidas"; a change made elsewhere), the pane keeps showing it: opening an
 * unread conversation never walks on through the rest, reading each one.
 */
export function afterListChange<T extends Keyed>(before: readonly T[], after: readonly T[], current: string | null, acted: ReadonlySet<string>): string | null {
  if (current === null || after.some((r) => r.threadId === current)) return current;
  return acted.has(current) ? reselect(before, after, current) : current;
}
