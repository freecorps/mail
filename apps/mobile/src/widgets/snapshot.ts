// What the home-screen widgets show, pure (tested). Widgets cannot run the Ember client: the app builds these small
// snapshots from what it already holds (the mailbox list, `inbox:views`, the "assigned" view, the push preview
// preference), in its own language, and hands them to the system (src/widgets/store.*). Every string a widget draws
// comes from here; the layouts (src/widgets/*-widget.tsx on iOS, modules/mail-system/android on Android) only place
// them. A tap opens one of the app's deep links (src/navigation.ts).
import type { Mailbox, Thread, ViewCounts } from "../api";
import { translate, type Locale } from "../i18n/strings";
import { contactOf } from "../lib/format";
import { badge, ownFirst } from "../model/threads";

/** The app's URL scheme (app.config.ts `scheme`). */
export const WIDGET_SCHEME = "embermail";
/** Snapshot format: a widget built for another one draws its "open the app" state instead of guessing. */
export const WIDGET_SNAPSHOT_VERSION = 1;
/** Medium "Não lidas": up to this many mailboxes. */
export const UNREAD_ROWS = 4;
/** Medium "Minhas": the latest few conversations. */
export const MINE_ROWS = 3;
/** At most one write per this many ms while the inbox changes (live counts move often). */
export const WIDGET_WRITE_INTERVAL_MS = 15_000;

/**
 * The deep links a widget opens (expo-router routes, see src/navigation.ts). Never empty or dangling: a mailbox or
 * thread without a name or id opens the list it belongs to instead.
 */
export const widgetUrls = {
  home: `${WIDGET_SCHEME}://`,
  unread: `${WIDGET_SCHEME}://view/unread`,
  mine: `${WIDGET_SCHEME}://mine`,
  mailbox: (name: string) => (name ? `${WIDGET_SCHEME}://mailbox/${encodeURIComponent(name)}` : `${WIDGET_SCHEME}://`),
  thread: (id: string) => (id ? `${WIDGET_SCHEME}://thread/${encodeURIComponent(id)}` : `${WIDGET_SCHEME}://mine`),
};

/**
 * - `ready`: the member's inbox.
 * - `signedOut`: nobody is signed in on this device (or not a member yet): nothing of an inbox, only "sign in".
 * - `empty` (never written by the app): the widget's own state before the app first runs.
 */
export type WidgetState = "ready" | "signedOut" | "empty";

export interface UnreadRow {
  label: string;
  /** "12", "99+". */
  count: string;
  unread: number;
  url: string;
}

export interface UnreadSnapshot {
  v: number;
  state: WidgetState;
  /** "Não lidas". */
  title: string;
  /** Unread messages across the member's mailboxes, and as drawn ("99+"). */
  total: number;
  totalText: string;
  /** "12 não lidas" (lock screen inline, accessibility). */
  caption: string;
  /**
   * The mailbox with the most unread (small size); absent when nothing is unread. Never null: expo-widgets' iOS bridge
   * refuses props holding a null (the native call throws and the widget keeps its previous state).
   */
  top?: UnreadRow;
  /** Medium size: mailboxes with unread first (most first), then the rest in the app's order. */
  rows: UnreadRow[];
  /** "Tudo lido" / "Entre no Ember Mail". */
  message: string;
  url: string;
}

export interface MineRow {
  sender: string;
  subject: string;
  unread: boolean;
  url: string;
}

export interface MineSnapshot {
  v: number;
  state: WidgetState;
  /** "Minhas". */
  title: string;
  /** Open (and waiting) conversations assigned to the member: what the Minhas tab lists. */
  count: number;
  countText: string;
  /** "3 conversas abertas" (lock screen, accessibility, medium). */
  caption: string;
  /** "abertas": under the big count of the small size (one word: it fits a 2x2 cell at the largest text sizes). */
  label: string;
  /** The latest few; empty when previews are off (counts only), or when the page has none to list. */
  rows: MineRow[];
  /** Rows withheld because "Mostrar prévia" is off (or not known): the widget says so, instead of "nothing here". */
  hidden: boolean;
  /** "Nada atribuído a você" / "Prévias desligadas" / "Entre no Ember Mail". */
  message: string;
  url: string;
}

export interface WidgetSnapshots {
  unread: UnreadSnapshot;
  mine: MineSnapshot;
}

export interface WidgetInputs {
  locale: Locale;
  mailboxes: readonly Mailbox[];
  counts: ViewCounts | null;
  /** The "assigned" view's first page (open and waiting, latest first); null while it loads. */
  assigned: readonly Thread[] | null;
  /**
   * The member's "Mostrar prévia" (`inbox:notifications`). Off, or not known yet: no sender or subject on the widget,
   * the same promise the setting makes for notifications on a shared or locked device.
   */
  preview: boolean | null;
}

/** Longest text a widget row carries: one line of a medium widget, with room to spare (it is cut there anyway). */
const WIDGET_TEXT_MAX = 80;

/**
 * A name or subject as one widget line: whitespace and line breaks collapsed (a pasted subject keeps its newlines),
 * capped by characters as the eye counts them (never half an emoji), `fallback` when nothing is left.
 */
export function widgetLine(s: string | null | undefined, fallback: string): string {
  const one = (s ?? "").replace(/\s+/g, " ").trim();
  if (!one) return fallback;
  const chars = Array.from(one);
  return chars.length > WIDGET_TEXT_MAX ? `${chars.slice(0, WIDGET_TEXT_MAX - 1).join("").trimEnd()}…` : one;
}

/** The member's inbox as the two widgets show it. */
export function buildWidgetSnapshots(i: WidgetInputs): WidgetSnapshots {
  const t = (k: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) => translate(i.locale, k, vars);
  const boxes = ownFirst(i.mailboxes).map((b, order) => ({ b, order }));
  const rowOf = (b: Mailbox): UnreadRow => ({ label: widgetLine(b.displayName, widgetLine(b.name, b.address)), count: badge(b.unread), unread: b.unread, url: widgetUrls.mailbox(b.name) });
  const ranked = [...boxes].sort((x, y) => y.b.unread - x.b.unread || x.order - y.order).map((x) => x.b);
  const total = boxes.reduce((n, x) => n + x.b.unread, 0);
  const top = ranked[0] && ranked[0].unread > 0 ? rowOf(ranked[0]) : undefined;

  const assigned = i.counts?.assigned;
  const count = assigned?.threads ?? i.assigned?.length ?? 0;
  const showRows = i.preview === true;
  const hidden = count > 0 && !showRows;
  const rows = showRows
    ? (i.assigned ?? [])
        .slice(0, MINE_ROWS)
        .map((th) => ({ sender: widgetLine(contactOf(th), th.contact), subject: widgetLine(th.subject, t("threads.noSubject")), unread: th.unreadCount > 0, url: widgetUrls.thread(th._id) }))
    : [];

  return {
    unread: {
      v: WIDGET_SNAPSHOT_VERSION,
      state: "ready",
      title: t("widget.unread.title"),
      total,
      totalText: badge(total),
      caption: total > 0 ? t("widget.unread.caption", { count: total }) : t("widget.unread.none"),
      ...(top ? { top } : {}),
      rows: ranked.slice(0, UNREAD_ROWS).map(rowOf),
      message: boxes.length === 0 ? t("widget.unread.noMailboxes") : t("widget.unread.none"),
      url: total > 0 ? widgetUrls.unread : widgetUrls.home,
    },
    mine: {
      v: WIDGET_SNAPSHOT_VERSION,
      state: "ready",
      title: t("widget.mine.title"),
      count,
      countText: badge(count, assigned?.capped ?? false),
      caption: count > 0 ? t("widget.mine.caption", { count }) : t("widget.mine.none"),
      label: t("widget.mine.label", { count }),
      rows,
      hidden,
      message: count === 0 ? t("widget.mine.none") : hidden ? t("widget.mine.private") : "",
      url: widgetUrls.mine,
    },
  };
}

export type QueryStatus = "loading" | "success" | "error";

/**
 * Whether the inputs are settled enough to write: the mailboxes and counts loaded, and the "assigned" page and the
 * preview preference no longer loading. A write before that would show a state the next one takes back ("Prévias
 * desligadas" while the preference loads, no rows while the page loads). A query that failed counts as settled: its
 * part is left out (no rows, counts only), which is true of what the widget can show.
 */
export function widgetInputsReady(s: { mailboxes: QueryStatus; counts: ViewCounts | null; assigned: QueryStatus; notifications: QueryStatus }): boolean {
  return s.mailboxes === "success" && s.counts !== null && s.assigned !== "loading" && s.notifications !== "loading";
}

/** Signed out (or not a member): no count, name or subject of anyone's inbox, in the app's language. */
export function signedOutSnapshots(locale: Locale): WidgetSnapshots {
  const signIn = translate(locale, "widget.signIn");
  return {
    unread: { v: WIDGET_SNAPSHOT_VERSION, state: "signedOut", title: translate(locale, "widget.unread.title"), total: 0, totalText: "", caption: signIn, rows: [], message: signIn, url: widgetUrls.home },
    mine: { v: WIDGET_SNAPSHOT_VERSION, state: "signedOut", title: translate(locale, "widget.mine.title"), count: 0, countText: "", caption: signIn, label: "", rows: [], hidden: false, message: signIn, url: widgetUrls.home },
  };
}

export type Timers = { now(): number; set(fn: () => void, ms: number): unknown; clear(id: unknown): void };
const realTimers: Timers = { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };

export interface SnapshotWriter {
  /** A new snapshot: written now if the last write is old enough, else once the interval is up (the latest wins). */
  push(s: WidgetSnapshots): void;
  /** Writes what is waiting now (the app leaves the screen: it may not get another chance). */
  flush(): void;
  /** Drops what is waiting (sign-out: nothing of the member is written after it). */
  cancel(): void;
}

/**
 * Throttled, deduplicated writes: the widgets reload only when what they draw changed, at most once per `intervalMs`
 * while the inbox is busy, and the last change is never lost (a trailing write, or `flush`). Each widget kind is written
 * on its own, so a new unread count does not reload "Minhas".
 */
export function snapshotWriter(write: (kind: keyof WidgetSnapshots, json: string) => void, intervalMs = WIDGET_WRITE_INTERVAL_MS, timers: Timers = realTimers): SnapshotWriter {
  const written: Partial<Record<keyof WidgetSnapshots, string>> = {};
  let lastAt = -Infinity;
  let pending: WidgetSnapshots | null = null;
  let timer: unknown = null;

  const cancel = () => {
    pending = null;
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const commit = () => {
    const s = pending;
    cancel();
    if (!s) return;
    let wrote = false;
    for (const kind of ["unread", "mine"] as const) {
      const json = JSON.stringify(s[kind]);
      if (written[kind] === json) continue;
      written[kind] = json;
      wrote = true;
      write(kind, json);
    }
    if (wrote) lastAt = timers.now();
  };

  return {
    push(s) {
      const same = (["unread", "mine"] as const).every((k) => written[k] === JSON.stringify(s[k]));
      if (same) {
        // Back to what is on screen: a waiting change is moot.
        cancel();
        return;
      }
      pending = s;
      const wait = lastAt + intervalMs - timers.now();
      if (wait <= 0) commit();
      else if (timer === null) timer = timers.set(commit, wait);
    },
    flush: commit,
    cancel,
  };
}
