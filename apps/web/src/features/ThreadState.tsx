// The conversation's state around its messages (Ember 0.7): who else is on it (presence), "Adiada até …" with
// Retomar, the timeline's lines between messages and in the context panel, and a scheduled message's bar ("Agendada
// para …", Editar, Cancelar envio).
import { AlarmClock, CalendarClock, CircleDot, Send, Tag, UserRound, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import type { ActivityEntry, PresenceRow } from "@/lib/api";
import { formatAge, formatFull } from "@/lib/format";
import { useNow } from "@/lib/now";
import { cn } from "@/lib/utils";
import { formatAt } from "@/lib/when";
import { useActivityText } from "@/model/activity";
import { presenceLine } from "@/model/presence";

/** Monograms stacked, at most `max` (then "+N"), each with a ring so they read as separate people. */
function Stack({ names, max = 3 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span className="flex shrink-0 items-center -space-x-1.5" aria-hidden="true">
      {shown.map((n, i) => (
        <Avatar key={`${n}:${i}`} name={n} className="size-5 ring-2 ring-background" />
      ))}
      {rest > 0 && (
        <span className="grid size-5 place-items-center rounded-full bg-muted text-[length:10px] font-semibold text-muted-foreground ring-2 ring-background tabular-nums">
          +{rest}
        </span>
      )}
    </span>
  );
}

/** "Bia está vendo" / "Bia e mais 3 estão respondendo…": quiet, in the header's meta line; everyone in its tooltip. */
export function PresenceBadge({ rows }: { rows: PresenceRow[] }) {
  const { t } = useI18n();
  const line = presenceLine(rows);
  if (!line) return null;
  const text = t(line.key, line.vars);
  const ordered = [...rows].sort((a, b) => Number(b.state === "replying") - Number(a.state === "replying"));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <output className="inline-flex max-w-64 min-w-0 animate-in items-center gap-1.5 text-xs text-muted-foreground duration-(--motion-popover) fade-in">
          <Stack names={ordered.map((r) => r.name)} />
          <span className={cn("truncate", line.state === "replying" && "text-foreground/80")}>{text}</span>
        </output>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        <p className="mb-1 font-medium">{t("presence.list")}</p>
        <ul>
          {ordered.map((r) => (
            <li key={r.userId} className="truncate">
              {r.name} · {t(`presence.state.${r.state}`)}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/** "Adiada até amanhã às 08:00" with Retomar, under the header while the conversation is snoozed. */
export function SnoozedBanner({ until, onResume }: { until: number; onResume: () => void }) {
  const { t, locale } = useI18n();
  const now = useNow();
  return (
    <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-ui sm:px-6">
      <AlarmClock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{t("snooze.until", { when: formatAt(until, now, locale) })}</span>
      <Button variant="ghost" size="xs" onClick={onResume}>
        {t("snooze.resume")}
      </Button>
    </div>
  );
}

const KIND_ICON: Record<ActivityEntry["kind"], LucideIcon> = {
  assigned: UserRound,
  status: CircleDot,
  tag_added: Tag,
  tag_removed: Tag,
  snoozed: AlarmClock,
  unsnoozed: AlarmClock,
  scheduled: CalendarClock,
  scheduled_canceled: CalendarClock,
  delivery: Send,
};

/** One entry as a quiet line: the actor's monogram (or the kind's icon for the system), what, how long ago. */
export function ActivityLine({ entry, inline = false }: { entry: ActivityEntry; inline?: boolean }) {
  const { locale } = useI18n();
  const now = useNow();
  const text = useActivityText()(entry, now);
  if (!text) return null;
  const Icon = KIND_ICON[entry.kind];
  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-xs text-muted-foreground", inline ? "px-4 py-1.5 sm:px-6" : "py-1")}>
      {entry.actor ? (
        <Avatar name={entry.actor.name} className="size-4" />
      ) : (
        <span className="grid size-4 shrink-0 place-items-center">
          <Icon className="size-3" aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 truncate" title={text}>
        {text}
      </span>
      <time className="shrink-0 tabular-nums" dateTime={new Date(entry.at).toISOString()} title={formatFull(entry.at, locale)}>
        · {formatAge(entry.at, now, locale)}
      </time>
    </div>
  );
}

/** A scheduled message's bar: when it goes, Editar (cancel, back into the composer), Cancelar envio. */
export function ScheduledBar({ at, onEdit, onCancel, busy }: { at: number; onEdit: () => void; onCancel: () => void; busy: boolean }) {
  const { t, locale } = useI18n();
  const now = useNow();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/40 px-2.5 py-1.5 text-ui">
      <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 font-medium">{t("schedule.for", { when: formatAt(at, now, locale) })}</span>
      <span className="flex shrink-0 gap-1">
        <Button variant="ghost" size="xs" onClick={onEdit} disabled={busy}>
          {t("schedule.edit")}
        </Button>
        <Button variant="outline" size="xs" onClick={onCancel} disabled={busy}>
          {t("schedule.cancel")}
        </Button>
      </span>
    </div>
  );
}
