// "Hoje": the reading pane while no conversation is open. Counts per view, the threads assigned to you, the ones
// waiting on the contact for more than a day, and the keys that matter. Plain layout on the page (no cards): numbers,
// hairlines and rows, like the rest of the shell.
import { Kbd } from "@/components/Kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/context";
import type { Thread, View } from "@/lib/api";
import { contactOf, formatAge } from "@/lib/format";
import { useNow } from "@/lib/now";
import { cn } from "@/lib/utils";
import { modKey } from "@/model/keys";
import { useToday, type TodaySection } from "@/model/today";

/** The views in the order the sidebar and mobile list them. */
const COUNT_ORDER: View[] = ["unread", "assigned", "waiting", "all"];

export function Today({
  mailboxNames,
  onOpen,
  onView,
  className,
}: {
  /** Mailbox name → display name, to say where each thread lives. */
  mailboxNames: Record<string, string>;
  onOpen: (threadId: string) => void;
  /** Opens a view's list (when the shell routes views). */
  onView?: (view: View) => void;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const now = useNow();
  const today = useToday(now);
  const nf = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now);

  return (
    // Sized by its pane, not the window (the reader can be 360px on a wide screen): container queries.
    <section aria-labelledby="today-title" className={cn("@container min-h-0 flex-1 overflow-y-auto", className)}>
      <div className="mx-auto w-full max-w-xl px-5 pt-8 pb-12 @md:px-8 @md:pt-10">
        <header>
          <h2 id="today-title" className="text-lg font-semibold">
            {t("today.title")}
          </h2>
          <p className="mt-0.5 text-ui text-muted-foreground first-letter:uppercase">{date}</p>
        </header>

        <ul
          aria-label={t("today.counts")}
          aria-busy={today.counts.status === "loading"}
          className="mt-6 grid grid-cols-2 gap-y-4 border-y py-4 @md:grid-cols-4"
        >
          {COUNT_ORDER.map((v) => {
            const c = today.counts.value?.[v];
            const value = c ? `${nf.format(c.threads)}${c.capped ? "+" : ""}` : null;
            const body = (
              <>
                <span className="block text-xl font-semibold tabular-nums">
                  {value ?? (today.counts.status === "error" ? "–" : <Skeleton className="my-1 h-6 w-8" />)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{v === "all" ? t("today.count.all") : t(`views.${v}`)}</span>
              </>
            );
            return (
              <li key={v} className="min-w-0 pr-3">
                {onView && value ? (
                  <button
                    type="button"
                    onClick={() => onView(v)}
                    className="pressable -mx-2 -my-1 block rounded-md px-2 py-1 text-left hover:bg-accent"
                  >
                    {body}
                  </button>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>

        <Section
          id="today-mine"
          title={t("today.mine")}
          section={today.mine}
          empty={t("today.mineEmpty")}
          onOpen={onOpen}
          render={(th) => ({ mailbox: mailboxNames[th.mailbox] ?? th.mailbox, meta: formatAge(th.lastMessageAt, now, locale) })}
          onMore={onView ? () => onView("assigned") : undefined}
        />
        <Section
          id="today-overdue"
          title={t("today.overdue")}
          section={today.overdue}
          empty={t("today.overdueEmpty")}
          onOpen={onOpen}
          render={(th) => ({ mailbox: mailboxNames[th.mailbox] ?? th.mailbox, meta: formatAge(th.lastMessageAt, now, locale) })}
          onMore={onView ? () => onView("waiting") : undefined}
        />

        <section aria-labelledby="today-keys" className="mt-8">
          <h3 id="today-keys" className="text-ui font-medium">
            {t("today.keys")}
          </h3>
          <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-ui text-muted-foreground @md:grid-cols-2">
            {HINTS.map((h) => (
              <li key={h.label} className="flex items-center gap-2">
                <span className="flex gap-1">
                  {h.keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
                {t(h.label)}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

const HINTS = [
  { keys: [modKey(), "K"], label: "today.key.palette" },
  { keys: ["j", "k"], label: "today.key.move" },
  { keys: ["Enter"], label: "today.key.open" },
  { keys: ["c"], label: "today.key.compose" },
  { keys: ["/"], label: "today.key.search" },
  { keys: ["["], label: "today.key.sidebar" },
  { keys: ["?"], label: "today.key.all" },
] as const;

function Section({
  id,
  title,
  section,
  empty,
  onOpen,
  render,
  onMore,
}: {
  id: string;
  title: string;
  section: TodaySection;
  empty: string;
  onOpen: (threadId: string) => void;
  render: (t: Thread) => { mailbox: string; meta: string };
  onMore?: () => void;
}) {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale);
  const extra = section.total - section.rows.length;
  return (
    <section aria-labelledby={id} className="mt-8">
      <h3 id={id} className="flex items-baseline gap-2 text-ui font-medium">
        {title}
        {section.status === "ready" && section.total > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {nf.format(section.total)}
            {section.more ? "+" : ""}
          </span>
        )}
      </h3>
      {section.status === "loading" && !section.rows.length ? (
        <div className="mt-2 space-y-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 flex-1" />
            </div>
          ))}
        </div>
      ) : section.status === "error" && !section.rows.length ? (
        <p role="alert" className="mt-2 text-ui text-muted-foreground">
          {t("common.error")}
        </p>
      ) : !section.rows.length ? (
        <p className="mt-2 text-ui text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1.5 -mx-2">
          {section.rows.map((th) => {
            const r = render(th);
            const unread = th.unreadCount > 0;
            return (
              <li key={th._id}>
                <button
                  type="button"
                  onClick={() => onOpen(th._id)}
                  className="pressable flex w-full min-w-0 items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-ui hover:bg-accent"
                >
                  {/* Names and subjects come from mail: any script (dir="auto"), any length (title shows the rest). */}
                  <span
                    dir="auto"
                    title={contactOf(th)}
                    className={cn(
                      "w-28 shrink-0 truncate text-start @md:w-36",
                      unread ? "font-semibold" : "font-medium text-foreground/85",
                    )}
                  >
                    {unread && <span className="sr-only">{t("threads.unread")}: </span>}
                    {contactOf(th)}
                  </span>
                  <span
                    dir="auto"
                    title={th.subject.trim() || undefined}
                    className="min-w-0 flex-1 truncate text-start text-muted-foreground"
                  >
                    {th.subject.trim() || <span className="italic">{t("thread.noSubject")}</span>}
                  </span>
                  <span dir="auto" title={r.mailbox} className="hidden max-w-28 shrink-0 truncate text-xs text-muted-foreground @lg:inline">
                    {r.mailbox}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{r.meta}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {extra > 0 && onMore && (
        <button type="button" onClick={onMore} className="mt-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground">
          {t("today.more", { count: `${nf.format(extra)}${section.more ? "+" : ""}` })}
        </button>
      )}
    </section>
  );
}
