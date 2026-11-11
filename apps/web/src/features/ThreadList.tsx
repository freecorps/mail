// The thread list: a virtualized column of rows under sticky date headers, with hover actions, multi-select and a
// bulk bar, and the next page loading as the end comes into view.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import {
  Archive,
  ArchiveRestore,
  Check,
  Clock,
  Inbox as InboxIcon,
  Loader2,
  Mail,
  MailOpen,
  Search,
  SearchX,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Kbd } from "@/components/Kbd";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import { plural } from "@/i18n/strings";
import type { ThreadStatus } from "@/lib/api";
import { formatRowTime, formatWhen } from "@/lib/format";
import { useNow } from "@/lib/now";
import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { toTarget, useThreadActions } from "@/model/actions";
import { cursorIndex, listItems, loadMoreDue, selectable, visibleSelection, type ListItem } from "@/model/listItems";
import { rowDomId, STATUS_TABS, type ThreadFilter, type ThreadRow } from "@/model/threads";
import { AssignItems } from "./AssignMenu";

export interface ThreadListProps {
  title: string;
  /** Under the title (the mailbox of a Sent or Spam list). */
  subtitle?: string;
  mailboxPicker?: React.ReactNode;
  /** The status tabs apply to this list (a mailbox, or all mailboxes). */
  tabs: boolean;
  /** What an empty list says (a search says "nothing found" itself). */
  empty: { title: string; hint: string };
  /** Rows come from several mailboxes: each says which (mailbox name → display name). */
  mailboxNames?: Record<string, string>;
  /** Mailboxes that are someone's own: nobody to assign to there. */
  personal: ReadonlySet<string>;
  /** The list fills a wide area (focus mode): keep its rows to a readable measure, centered. */
  wide?: boolean;
  /** Buttons at the right of the title (the layout menu). */
  actions?: React.ReactNode;
  rows: ThreadRow[];
  /** Rows are in date order: group them under day headers (not search results). */
  dated: boolean;
  loading: boolean;
  error: string | null;
  searching: boolean;
  query: string;
  onQuery: (q: string) => void;
  filter: ThreadFilter;
  onFilter: (f: ThreadFilter) => void;
  openId: string | null;
  cursorId: string | null;
  onOpen: (threadId: string) => void;
  selected: ReadonlySet<string>;
  /** `range`: shift-click, from the last toggled row. */
  onSelect: (threadId: string, mode: "toggle" | "range") => void;
  onSelectAll: (all: boolean) => void;
  /** Which list this is (view, mailbox, status, search): each pages on its own. */
  place: string;
  canLoadMore: boolean;
  onLoadMore: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  className?: string;
}

const HEADER_H = 28;
/** First-guess heights; every row is measured once rendered. */
const ROW_H = { comfortable: 82, compact: 52 } as const;

export function ThreadList({ searchRef, ...p }: ThreadListProps) {
  const { t, locale } = useI18n();
  const now = useNow();
  const { density } = usePrefs();
  const scroller = useRef<HTMLDivElement>(null);
  const actions = useThreadActions();

  const items = useMemo(() => listItems(p.rows, { grouped: p.dated, now, locale }), [p.rows, p.dated, now, locale]);
  const headers = useMemo(() => items.flatMap((it, i) => (it.kind === "group" ? [i] : [])), [items]);
  const activeHeader = useRef<number | null>(null);
  const rangeExtractor = useCallback(
    (range: Range) => {
      activeHeader.current = [...headers].reverse().find((i) => range.startIndex >= i) ?? null;
      const next = new Set(defaultRangeExtractor(range));
      if (activeHeader.current !== null) next.add(activeHeader.current);
      return [...next].sort((a, b) => a - b);
    },
    [headers],
  );
  // oxlint-disable-next-line react/incompatible-library -- no React Compiler here; the virtualizer is read every render.
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (items[i]?.kind === "group" ? HEADER_H : ROW_H[density]),
    getItemKey: (i) => items[i]!.key,
    overscan: 8,
    paddingEnd: 8,
    // A row scrolled to by j/k lands under the sticky header, not behind it.
    scrollPaddingStart: p.dated ? HEADER_H : 0,
    rangeExtractor,
    initialRect: { width: 400, height: 800 },
  });
  const virtual = virtualizer.getVirtualItems();

  // Keep the keyboard cursor in view when it moves (no smooth scroll: j/k is repeated many times a minute). Only then:
  // the list changing under it (pages, new mail, the minute tick) must not pull the scroll back to it.
  const followed = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!p.cursorId) followed.current = null;
    const i = cursorIndex(items, p.cursorId, followed.current);
    if (i < 0) return;
    followed.current = p.cursorId;
    virtualizer.scrollToIndex(i, { align: "auto" });
  }, [p.cursorId, items, virtualizer]);

  // Another list (view, mailbox, status, search) starts at its top: the list stays mounted (the search box keeps its
  // focus), so a scroll left from the previous one would land mid-page and make infinite scroll load page two at once.
  const { place, canLoadMore, loading, onLoadMore } = p;
  const shownPlace = useRef(place);
  useLayoutEffect(() => {
    if (shownPlace.current === place) return;
    shownPlace.current = place;
    followed.current = null;
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [place]);

  // Infinite scroll: the next page loads when the last rows come into view (once per page of each list).
  const asked = useRef<{ place: string; count: number } | null>(null);
  const lastIndex = virtual.at(-1)?.index ?? -1;
  useEffect(() => {
    if (!loadMoreDue({ place, count: items.length, lastIndex, canLoadMore, loading, asked: asked.current })) return;
    asked.current = { place, count: items.length };
    onLoadMore();
  }, [place, lastIndex, items.length, canLoadMore, loading, onLoadMore]);

  // Pending rows are never part of it (nor of "all"): their checkbox is disabled and nothing may act on them yet.
  const selectedRows = useMemo(() => visibleSelection(p.selected, p.rows), [p.rows, p.selected]);
  const selectableCount = useMemo(() => selectable(p.rows).length, [p.rows]);
  const selecting = selectedRows.length > 0;

  // The filters are tabs over the list: the list is the active tab's panel (Radix links them with aria-controls).
  // While searching, and in lists without statuses (Sent, Spam, most views), the list is a plain region.
  const tabbed = p.tabs && !p.searching;
  const measure = p.wide ? "mx-auto w-full max-w-3xl" : undefined;
  // A status glyph says something only where the list mixes statuses.
  const statusShown = (s: ThreadStatus | null) => !!s && s !== "open" && s !== p.filter;

  const body = (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="thread-scroller">
      {p.loading && !p.rows.length ? (
        <SkeletonRows className={measure} />
      ) : p.error && !p.rows.length ? (
        <p role="alert" className="p-6 text-sm text-destructive">
          {p.error}
        </p>
      ) : !p.rows.length ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          {p.searching ? (
            <SearchX className="size-6 text-muted-foreground" aria-hidden="true" />
          ) : (
            <InboxIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          )}
          <p className="max-w-full text-sm font-medium [overflow-wrap:anywhere]">
            {p.searching ? t("threads.emptySearch", { query: p.query.trim() }) : p.empty.title}
          </p>
          {!p.searching && <p className="max-w-56 text-xs text-muted-foreground">{p.empty.hint}</p>}
        </div>
      ) : (
        <div className={cn("px-1.5", measure)}>
          <ul className="relative" style={{ height: virtualizer.getTotalSize() }} aria-busy={p.loading || undefined}>
            {virtual.map((v) => {
              const it = items[v.index]!;
              const sticky = activeHeader.current === v.index;
              return (
                <li
                  key={v.key}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  className={cn("top-0 left-0 w-full", it.kind === "group" && "z-10 bg-background", sticky ? "sticky" : "absolute")}
                  style={sticky ? undefined : { transform: `translateY(${v.start}px)` }}
                >
                  {it.kind === "group" ? (
                    <GroupHeader item={it} />
                  ) : (
                    <Row
                      row={it.row}
                      now={now}
                      dated={p.dated}
                      open={it.row.threadId === p.openId}
                      cursor={it.row.threadId === p.cursorId}
                      checked={!it.row.pending && p.selected.has(it.row.threadId)}
                      selecting={selecting}
                      showStatus={statusShown(it.row.status)}
                      mailboxName={p.mailboxNames ? (p.mailboxNames[it.row.mailbox] ?? it.row.mailbox) : null}
                      personal={p.personal.has(it.row.mailbox)}
                      onOpen={p.onOpen}
                      onSelect={p.onSelect}
                      actions={actions}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {p.loading && p.rows.length > 0 && p.canLoadMore && (
            <output className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {t("list.loadingMore")}
            </output>
          )}
        </div>
      )}
    </div>
  );

  const allChecked = selecting && selectedRows.length === selectableCount;
  return (
    <Tabs asChild value={p.filter} onValueChange={(v) => p.onFilter(v as ThreadFilter)} activationMode="manual">
      <section aria-label={t("threads.list")} className={cn("flex min-w-0 flex-col bg-background", p.className)}>
        <header className={cn("space-y-3 border-b px-4 pt-3.5", tabbed ? "pb-0" : "pb-3")}>
          {selecting ? (
            <BulkBar
              className={measure}
              rows={selectedRows}
              all={allChecked}
              personal={p.personal}
              onSelectAll={p.onSelectAll}
              actions={actions}
            />
          ) : (
            <div className={cn("flex h-7 items-center justify-between gap-2", measure)}>
              <span className="flex min-w-0 items-baseline gap-2">
                {p.mailboxPicker ?? <h1 className="truncate text-base font-semibold">{p.title}</h1>}
                {p.subtitle && <span className="hidden truncate text-ui text-muted-foreground md:inline">{p.subtitle}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {p.searching && !p.loading && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t(plural(locale, "threads.results", p.rows.length), { count: new Intl.NumberFormat(locale).format(p.rows.length) })}
                  </span>
                )}
                {p.actions}
              </span>
            </div>
          )}
          <div className={cn("relative", measure)}>
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={searchRef}
              type="search"
              value={p.query}
              onChange={(e) => p.onQuery(e.target.value)}
              placeholder={t("threads.search")}
              aria-label={t("threads.search")}
              enterKeyHint="search"
              className="h-8 pr-8 pl-8 text-sm"
            />
            {!p.query && <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>}
          </div>
          {tabbed && (
            <TabsList aria-label={t("threads.filters")} className={cn("-mb-px gap-4", measure)}>
              {STATUS_TABS.map((f) => (
                <TabsTrigger key={f} value={f}>
                  {t(`threads.filter.${f}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          )}
        </header>

        {!tabbed ? (
          body
        ) : (
          <TabsContent value={p.filter} className="flex min-h-0 flex-1 flex-col">
            {body}
          </TabsContent>
        )}
      </section>
    </Tabs>
  );
}

function GroupHeader({ item }: { item: Extract<ListItem, { kind: "group" }> }) {
  return (
    <h2 className="flex h-7 items-end px-(--row-x) pb-1 text-xs font-medium text-muted-foreground" style={{ height: HEADER_H }}>
      {item.label}
    </h2>
  );
}

const STATUS_ICON: Partial<Record<ThreadStatus, typeof Clock>> = { waiting: Clock, closed: Archive, spam: ShieldAlert };
const STATUS_TONE: Partial<Record<ThreadStatus, string>> = {
  waiting: "text-status-waiting",
  closed: "text-muted-foreground",
  spam: "text-status-spam",
};

type Actions = ReturnType<typeof useThreadActions>;

/**
 * One row. The whole row opens the thread (the main button's hit area is stretched over it); the avatar is the
 * selection checkbox (it shows as one on hover and while selecting, and a tap on it selects on touch screens), and the
 * hover actions take the time's place. Memoized: the list re-renders on every cursor move.
 */
const Row = memo(function Row({
  row: r,
  now,
  dated,
  open,
  cursor,
  checked,
  selecting,
  showStatus,
  mailboxName,
  personal,
  onOpen,
  onSelect,
  actions,
}: {
  row: ThreadRow;
  now: number;
  /** Under a date header (the time can leave the day out). */
  dated: boolean;
  open: boolean;
  cursor: boolean;
  checked: boolean;
  selecting: boolean;
  showStatus: boolean;
  mailboxName: string | null;
  personal: boolean;
  onOpen: (threadId: string) => void;
  onSelect: (threadId: string, mode: "toggle" | "range") => void;
  actions: Actions;
}) {
  const { t, locale } = useI18n();
  const StatusIcon = showStatus && r.status ? STATUS_ICON[r.status] : undefined;
  const target = [toTarget(r)];
  const archived = r.status === "closed";
  return (
    <div
      className={cn(
        "group/row relative my-px flex gap-2 rounded-md py-(--row-y) pr-(--row-x) pl-1.5 transition-colors duration-(--motion-hover) select-none",
        open ? "bg-selected" : checked ? "bg-selected/55" : "hover:bg-accent/70",
        cursor && !open && "ring-1 ring-ring/40 ring-inset",
        cursor && !open && !checked && "bg-accent",
        r.pending && "opacity-70",
      )}
    >
      <span aria-hidden="true" className={cn("mt-[13px] size-1.5 shrink-0 rounded-full", r.unread ? "bg-primary" : "bg-transparent")} />
      <button
        type="button"
        aria-pressed={checked}
        aria-label={t("list.select", { name: r.title })}
        disabled={r.pending}
        onClick={(e) => onSelect(r.threadId, e.shiftKey ? "range" : "toggle")}
        className="pressable relative z-10 grid size-8 shrink-0 place-items-center rounded-full compact:size-7"
      >
        <Avatar
          name={r.title}
          className={cn(
            "size-8 transition-opacity duration-(--motion-hover) compact:size-7",
            (checked || selecting) && "opacity-0",
            "group-hover/row:opacity-0",
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 m-auto grid size-4 place-items-center rounded-sm border transition-opacity duration-(--motion-hover)",
            checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50 bg-background",
            checked || selecting ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
          )}
        >
          {checked && <Check className="size-3" strokeWidth={2.5} />}
        </span>
      </button>
      <button
        id={rowDomId(r.threadId)}
        type="button"
        aria-current={open ? "true" : undefined}
        onClick={(e) => {
          if (e.shiftKey) onSelect(r.threadId, "range");
          else if (e.metaKey || e.ctrlKey) onSelect(r.threadId, "toggle");
          else onOpen(r.threadId);
        }}
        className="min-w-0 flex-1 rounded-md text-left outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
      >
        <span className="flex items-baseline gap-2">
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className={cn("min-w-0 truncate text-sm", r.unread ? "font-semibold text-foreground" : "font-medium text-foreground/85")}>
              {r.title}
            </span>
            {mailboxName && <span className="max-w-[35%] shrink-0 truncate text-xs text-muted-foreground">{mailboxName}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 self-center group-hover/row:invisible group-has-[:focus-visible]/row:invisible group-has-[[aria-expanded=true]]/row:invisible">
            {StatusIcon && (
              <span className={cn("inline-flex", STATUS_TONE[r.status!])} title={t(`status.${r.status!}`)}>
                <StatusIcon className="size-3.5" aria-hidden="true" />
                <span className="sr-only">{t(`status.${r.status!}`)}</span>
              </span>
            )}
            {r.assigneeName && !personal && (
              <span className="inline-flex" title={t("list.assignedTo", { name: r.assigneeName })}>
                <Avatar name={r.assigneeName} className="size-4" />
                <span className="sr-only">{t("list.assignedTo", { name: r.assigneeName })}</span>
              </span>
            )}
            <time className="text-xs text-muted-foreground tabular-nums" dateTime={new Date(r.at).toISOString()}>
              {dated ? formatRowTime(r.at, now, locale) : formatWhen(r.at, now, locale)}
            </time>
          </span>
        </span>
        <span className={cn("mt-0.5 block truncate text-ui", r.unread ? "text-foreground" : "text-foreground/75")}>
          {r.unread && <span className="sr-only">{t("threads.unread")}: </span>}
          {r.subject.trim() || t("thread.noSubject")}
        </span>
        {r.snippet && <span className="mt-0.5 line-clamp-1 text-ui text-muted-foreground compact:hidden">{r.snippet}</span>}
      </button>
      {/* Hover actions, in the time's place (none on a row the server has not confirmed yet). Snooze slots in first once
          the API has it (plan E2). A pointer affordance: hidden, they take no taps (a tap there opens the row), and they
          show for a hovering pointer (`group-hover` only applies where the device can hover), keyboard focus in the row
          (focus-visible, not the focus a tap leaves), or their open menu (`aria-expanded`: the tooltip around the trigger
          overrides the menu's `data-state`). */}
      {!r.pending && (
        <div className="pointer-events-none absolute top-[calc(var(--row-y)-4px)] right-1.5 z-10 flex items-center opacity-0 transition-opacity duration-(--motion-hover) group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-has-[:focus-visible]/row:pointer-events-auto group-has-[:focus-visible]/row:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100">
          <QuickAction label={archived ? t("thread.unarchive") : t("thread.archive")} onClick={() => actions.archive(target)}>
            {archived ? <ArchiveRestore /> : <Archive />}
          </QuickAction>
          <QuickAction label={r.unread ? t("thread.markRead") : t("thread.markUnread")} onClick={() => actions.toggleRead(target)}>
            {r.unread ? <MailOpen /> : <Mail />}
          </QuickAction>
          {!personal && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      aria-label={t("thread.assign")}
                    >
                      <UserRound className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t("thread.assign")}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-56">
                <AssignItems mailboxes={[r.mailbox]} current={r.assignee} onAssign={(id) => actions.assign(target, id)} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
});

function QuickAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={onClick}
          className="size-7 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Replaces the title row while rows are selected: select all, the count, and what to do with them. */
function BulkBar({
  rows,
  all,
  personal,
  onSelectAll,
  actions,
  className,
}: {
  rows: ThreadRow[];
  all: boolean;
  personal: ReadonlySet<string>;
  onSelectAll: (all: boolean) => void;
  actions: Actions;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const targets = rows.map(toTarget);
  const archived = rows.every((r) => r.status === "closed");
  const unread = rows.some((r) => r.unread);
  const assignable = rows.every((r) => !personal.has(r.mailbox) && !r.pending);
  const assignees = new Set(rows.map((r) => r.assignee));
  return (
    <div
      className={cn("flex h-7 items-center gap-1", className)}
      role="toolbar"
      aria-label={t(plural(locale, "list.selected", rows.length), { count: rows.length })}
    >
      <span className="grid size-7 place-items-center">
        <Checkbox
          checked={all ? true : "indeterminate"}
          onCheckedChange={(v) => onSelectAll(v === true)}
          aria-label={t("list.selectAll")}
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums" aria-live="polite">
        {t(plural(locale, "list.selected", rows.length), { count: new Intl.NumberFormat(locale).format(rows.length) })}
      </span>
      <BarAction
        label={archived ? t("thread.unarchive") : t("thread.archive")}
        kbd="e"
        onClick={() => {
          // Like `e`: the archived threads leave the selection (they may leave the list too).
          actions.archive(targets);
          onSelectAll(false);
        }}
      >
        {archived ? <ArchiveRestore /> : <Archive />}
      </BarAction>
      <BarAction label={unread ? t("thread.markRead") : t("thread.markUnread")} onClick={() => actions.toggleRead(targets)}>
        {unread ? <MailOpen /> : <Mail />}
      </BarAction>
      {assignable && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="size-7" aria-label={t("thread.assign")}>
                  <UserRound />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("thread.assign")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-60">
            <AssignItems
              mailboxes={rows.map((r) => r.mailbox)}
              current={assignees.size === 1 ? [...assignees][0] : undefined}
              onAssign={(id) => actions.assign(targets, id)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <BarAction label={t("list.clearSelection")} kbd="Esc" onClick={() => onSelectAll(false)}>
        <X />
      </BarAction>
    </div>
  );
}

function BarAction({ label, kbd, onClick, children }: { label: string; kbd?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-7" aria-label={label} aria-keyshortcuts={kbd} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        {kbd && <Kbd className="border-background/20 bg-background/15 text-background">{kbd}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** The first load: rows shaped like the real ones (dot, monogram, sender and time, subject, preview). */
function SkeletonRows({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-px p-1.5", className)} aria-hidden="true">
      <Skeleton className="mx-(--row-x) mt-2 mb-2.5 h-3 w-12" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex gap-2 py-(--row-y) pr-(--row-x) pl-1.5">
          <span className="size-1.5 shrink-0" />
          <Skeleton className="size-8 shrink-0 rounded-full compact:size-7" />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <div className="flex justify-between gap-6">
              <Skeleton className="h-3.5" style={{ width: `${32 + ((i * 17) % 28)}%` }} />
              <Skeleton className="h-3 w-9" />
            </div>
            <Skeleton className="h-3" style={{ width: `${58 + ((i * 23) % 30)}%` }} />
            <Skeleton className="h-3 w-4/5 compact:hidden" />
          </div>
        </div>
      ))}
    </div>
  );
}
