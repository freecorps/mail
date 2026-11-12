// Thread-list actions as pure data: which action a swipe side runs, where a released swipe settles, what a bulk
// action does with a selection, and what undoing an archive restores. No React Native here (tested in vitest); the
// swipe math runs as worklets on the UI thread too, hence the "worklet" directives.
import type { ThreadStatus } from "../api";
import type { ListSource, ThreadFilter, ThreadRow } from "./threads";

/** What a swipe side does (Settings › Swipe actions, like Mail.app). */
export type SwipeKind = "read" | "archive" | "snooze" | "assign" | "spam" | "none";
export const SWIPE_KINDS: SwipeKind[] = ["read", "archive", "snooze", "assign", "spam", "none"];

export interface ListPrefs {
  /** Show the monogram avatar (off: a compact list, dot and text only). */
  avatars: boolean;
  /** Lines of preview text under the subject. */
  previewLines: 1 | 2 | 3;
  /** Leading swipe (finger moves right): one action, a full swipe runs it. */
  swipeLeading: SwipeKind;
  /** Trailing swipe (finger moves left): this action at the edge (full swipe runs it), plus Assign beside it. */
  swipeTrailing: SwipeKind;
}

export const DEFAULT_LIST_PREFS: ListPrefs = { avatars: true, previewLines: 2, swipeLeading: "read", swipeTrailing: "archive" };

/** Stored prefs (JSON from AsyncStorage) over the defaults; anything unknown or malformed falls back. */
export function parseListPrefs(raw: string | null | undefined): ListPrefs {
  let v: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") v = parsed as Record<string, unknown>;
  } catch {
    /* defaults */
  }
  const kind = (k: unknown, d: SwipeKind): SwipeKind => (SWIPE_KINDS.includes(k as SwipeKind) ? (k as SwipeKind) : d);
  const lines = v.previewLines === 1 || v.previewLines === 2 || v.previewLines === 3 ? v.previewLines : DEFAULT_LIST_PREFS.previewLines;
  return {
    avatars: typeof v.avatars === "boolean" ? v.avatars : DEFAULT_LIST_PREFS.avatars,
    previewLines: lines,
    swipeLeading: kind(v.swipeLeading, DEFAULT_LIST_PREFS.swipeLeading),
    swipeTrailing: kind(v.swipeTrailing, DEFAULT_LIST_PREFS.swipeTrailing),
  };
}

/** Whether a row takes actions at all: search hits (no status) and optimistic rows (not on the server yet) do not. */
export const actionable = (r: Pick<ThreadRow, "pending" | "status">): boolean => !r.pending && r.status !== null;

/**
 * The kinds a row's swipe sides run, after what the row allows: assign needs a shared mailbox, nothing runs on a row
 * that takes no actions. The trailing side adds Assign next to its edge action (unless that already is Assign).
 */
export function swipeKinds(row: Pick<ThreadRow, "pending" | "status">, prefs: Pick<ListPrefs, "swipeLeading" | "swipeTrailing">, canAssign: boolean) {
  if (!actionable(row)) return { leading: null, trailing: [] as SwipeKind[] };
  const ok = (k: SwipeKind) => k !== "none" && (k !== "assign" || canAssign);
  const leading = ok(prefs.swipeLeading) ? prefs.swipeLeading : null;
  const trailing: SwipeKind[] = [];
  if (ok(prefs.swipeTrailing)) trailing.push(prefs.swipeTrailing);
  if (canAssign && prefs.swipeTrailing !== "assign" && prefs.swipeLeading !== "assign") trailing.push("assign");
  return { leading, trailing };
}

/** Width of one revealed swipe button (Mail.app's is about 74 pt). */
export const SWIPE_BUTTON = 74;

/** Where a finger would come to rest if it kept decelerating (Apple's exponential decay; velocity in pt/s). */
export function project(velocity: number, decelerationRate = 0.998): number {
  "worklet";
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Past an edge, the row follows less and less (rubber band). */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  "worklet";
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** A full swipe arms past this share of the row's width (Mail.app commits around the middle). */
export const FULL_SWIPE = 0.55;

/**
 * Where a released swipe settles. `x` is the row's offset (positive: leading side revealed), `vx` the release velocity,
 * `width` the row's width, `leadingButtons` / `trailingButtons` how many buttons each side has.
 * - `commit`: the edge action of that side runs (the finger passed the full-swipe point, or flung past it);
 * - `open`: the side's buttons stay revealed;
 * - `close`: back to rest.
 */
export function settleSwipe(x: number, vx: number, width: number, leadingButtons: number, trailingButtons: number): { to: "commit" | "open" | "close"; side: "leading" | "trailing" | null } {
  "worklet";
  if (x === 0) return { to: "close", side: null };
  const side = x > 0 ? "leading" : "trailing";
  const buttons = side === "leading" ? leadingButtons : trailingButtons;
  if (buttons === 0) return { to: "close", side: null };
  const dist = Math.abs(x);
  // Velocity toward the side's direction (a flick back toward rest closes).
  const v = side === "leading" ? vx : -vx;
  const projected = dist + Math.max(-dist, project(v));
  const full = width * FULL_SWIPE;
  if (dist >= full || (projected >= full * 1.25 && v > 800)) return { to: "commit", side };
  const reveal = buttons * SWIPE_BUTTON;
  if (v < -300) return { to: "close", side: null };
  if (projected >= reveal / 2) return { to: "open", side };
  return { to: "close", side: null };
}

/** The mark a bulk read/unread applies: read when anything selected is unread, otherwise unread (like Mail). */
export function bulkReadTarget(rows: readonly Pick<ThreadRow, "unread">[]): "read" | "unread" {
  return rows.some((r) => r.unread) ? "read" : "unread";
}

/** The selection after the list changed: only threads still listed (and actionable) stay selected. */
export function pruneSelection(selected: ReadonlySet<string>, rows: readonly Pick<ThreadRow, "threadId" | "pending" | "status">[]): Set<string> {
  const listed = new Set(rows.filter(actionable).map((r) => r.threadId));
  const out = new Set<string>();
  for (const id of selected) if (listed.has(id)) out.add(id);
  return out.size === selected.size ? (selected as Set<string>) : out;
}

export function toggleSelected(selected: ReadonlySet<string>, threadId: string): Set<string> {
  const out = new Set(selected);
  if (out.has(threadId)) out.delete(threadId);
  else out.add(threadId);
  return out;
}

/** What an archive changed, so "Desfazer" can put each thread back to the status it had. */
export interface ArchiveRecord {
  threadId: string;
  before: ThreadStatus;
}

/** The rows an archive applies to (not already archived), with their status before. */
export function archivable(rows: readonly Pick<ThreadRow, "threadId" | "status" | "pending">[]): ArchiveRecord[] {
  return rows.filter((r) => actionable(r) && r.status !== "closed").map((r) => ({ threadId: r.threadId, before: r.status as ThreadStatus }));
}

/** What Spam does to a selection: take them out when every one is spam already, else move the others in. */
export function spamTarget(rows: readonly Pick<ThreadRow, "status">[]): "spam" | "notSpam" {
  return rows.length > 0 && rows.every((r) => r.status === "spam") ? "notSpam" : "spam";
}

/** The rows a move to Spam applies to (not spam already), with their status before (for Desfazer). */
export function spammable(rows: readonly Pick<ThreadRow, "threadId" | "status" | "pending">[]): ArchiveRecord[] {
  return rows.filter((r) => actionable(r) && r.status !== "spam").map((r) => ({ threadId: r.threadId, before: r.status as ThreadStatus }));
}

/**
 * Whether the list still shows a thread once archived (then a swipe-archive springs back instead of sliding out):
 * a mailbox's All / Archived / Sent lists and the All view do; open, waiting, unread and assigned lists drop it.
 */
export function keepsArchived(source: ListSource, filter: ThreadFilter): boolean {
  if (source.view === "snoozed") return true;
  if (source.mailbox !== undefined) return filter === "all" || filter === "closed" || filter === "sent";
  return source.view === "all" && (filter === "all" || filter === "closed");
}

/**
 * Whether the list still shows a thread once it is moved to Spam (or out of it): lists of every status ("Todas" of a
 * mailbox, the "Todas" view, "Adiadas") keep it, with its spam mark; a status filter, Spam's own, and the views of
 * open work (assigned, unread, waiting) drop it.
 */
export function keepsSpam(source: ListSource, filter: ThreadFilter): boolean {
  if (filter !== "all") return false;
  return source.mailbox !== undefined || source.view === "all" || source.view === "snoozed";
}

/** Whether the list still shows a thread once snoozed: only "Adiadas" (a re-snooze moves it there). */
export const keepsSnoozed = (source: ListSource): boolean => source.view === "snoozed";
