import { useEffect, useRef, type RefObject } from "react";
import { useNow } from "@/lib/now";
import { Inbox as InboxIcon, Loader2, Search, SearchX } from "lucide-react";
import { Kbd } from "@/components/Kbd";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/context";
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rowDomId, THREAD_FILTERS, type ThreadFilter, type ThreadRow } from "@/model/threads";

export interface ThreadListProps {
  title: string;
  mailboxPicker?: React.ReactNode;
  rows: ThreadRow[];
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
  canLoadMore: boolean;
  onLoadMore: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  className?: string;
}

export function ThreadList({ searchRef, ...p }: ThreadListProps) {
  const { t, locale } = useI18n();
  const now = useNow();
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the keyboard cursor visible (no smooth scroll: j/k is repeated many times a minute).
  useEffect(() => {
    if (!p.cursorId) return;
    document.getElementById(rowDomId(p.cursorId))?.scrollIntoView({ block: "nearest" });
  }, [p.cursorId]);

  return (
    <section aria-label={t("threads.list")} className={cn("flex min-w-0 flex-col border-r bg-background", p.className)}>
      <header className="space-y-3 border-b px-4 pt-3.5 pb-3">
        <div className="flex h-7 items-center justify-between gap-2">
          {p.mailboxPicker ?? <h1 className="truncate text-base font-semibold tracking-tight">{p.title}</h1>}
          {p.searching && !p.loading && (
            <span className="text-xs text-muted-foreground tabular-nums">{t("threads.results", { count: p.rows.length })}</span>
          )}
        </div>
        <div className="relative">
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
            className="h-8 pr-8 pl-8 text-sm"
          />
          {!p.query && <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>}
        </div>
        {!p.searching && (
          <ToggleGroup
            type="single"
            value={p.filter}
            onValueChange={(v) => v && p.onFilter(v as ThreadFilter)}
            aria-label={t("threads.filters")}
            variant="outline"
            size="sm"
            className="w-full"
          >
            {THREAD_FILTERS.map((f) => (
              <ToggleGroupItem key={f} value={f} className="flex-1 text-xs data-[state=on]:bg-selected data-[state=on]:text-foreground">
                {t(`threads.filter.${f}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {p.loading && !p.rows.length ? (
          <div className="space-y-px p-2" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2 px-3 py-3">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
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
            <p className="text-sm font-medium">{p.searching ? t("threads.emptySearch", { query: p.query.trim() }) : t("threads.empty")}</p>
            {!p.searching && (
              <p className="max-w-56 text-xs text-muted-foreground">
                {t(p.filter === "sent" ? "threads.emptyHintSent" : "threads.emptyHint")}
              </p>
            )}
          </div>
        ) : (
          <ul ref={listRef} className="p-1.5">
            {p.rows.map((r) => {
              const open = r.threadId === p.openId;
              const cursor = r.threadId === p.cursorId;
              return (
                <li key={r.key}>
                  <button
                    id={rowDomId(r.threadId)}
                    type="button"
                    onClick={() => p.onOpen(r.threadId)}
                    aria-current={open ? "true" : undefined}
                    className={cn(
                      "group relative flex w-full gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-100",
                      open ? "bg-selected" : "hover:bg-accent/70",
                      cursor && !open && "bg-accent ring-1 ring-ring/40 ring-inset",
                      r.pending && "opacity-70",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", r.unread ? "bg-primary" : "bg-transparent")}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn("truncate text-sm", r.unread ? "font-semibold text-foreground" : "font-medium text-foreground/85")}
                        >
                          {r.title}
                        </span>
                        <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={new Date(r.at).toISOString()}>
                          {formatWhen(r.at, now, locale)}
                        </time>
                      </span>
                      <span className={cn("mt-0.5 block truncate text-[13px]", r.unread ? "text-foreground" : "text-foreground/75")}>
                        {r.unread && <span className="sr-only">{t("threads.unread")}: </span>}
                        {r.subject}
                      </span>
                      <span className="mt-0.5 line-clamp-1 text-[13px] text-muted-foreground">{r.snippet}</span>
                      {(r.status || r.assigneeName) && (
                        <span className="mt-1.5 flex items-center gap-1.5">
                          {r.status && r.status !== "open" && <StatusBadge status={r.status} />}
                          {r.assigneeName && (
                            <span className="truncate text-[11px] text-muted-foreground">
                              {t("thread.assignedTo", { name: r.assigneeName })}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {p.canLoadMore && (
          <div className="p-3 pt-1">
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={p.onLoadMore} disabled={p.loading}>
              {p.loading && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t("threads.loadMore")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
