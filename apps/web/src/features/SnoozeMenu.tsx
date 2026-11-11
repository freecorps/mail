// "Adiar" as a menu (the row's hover action, the conversation header, the bulk bar): the presets with their times in
// the member's zone, "Escolher data…" (the date dialog), and "Retomar" on a snoozed conversation.
import { AlarmClockOff, CalendarClock, Clock } from "lucide-react";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/context";
import { useNow } from "@/lib/now";
import { formatAt, snoozePresets } from "@/lib/when";
import { openPicker } from "@/model/picker";
import { useSnooze, type SnoozeTarget } from "@/model/snooze";

/** The menu's items (inside a DropdownMenuContent; mounted on open, so the times are fresh). */
export function SnoozeItems({ targets, onResume }: { targets: SnoozeTarget[]; onResume?: () => void }) {
  const { t, locale } = useI18n();
  const now = useNow(30_000);
  const { snooze } = useSnooze();
  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">{t("snooze.menu")}</DropdownMenuLabel>
      {snoozePresets(now).map((p) => (
        <DropdownMenuItem key={p.id} onSelect={() => snooze(targets, p.at)}>
          <Clock aria-hidden="true" />
          <span className="flex-1">{t(`snooze.${p.id}`)}</span>
          <span className="pl-3 text-xs text-muted-foreground">{formatAt(p.at, now, locale)}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem onSelect={() => openPicker({ kind: "snooze", targets, date: true })}>
        <CalendarClock aria-hidden="true" />
        {t("snooze.pick")}
      </DropdownMenuItem>
      {onResume && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onResume}>
            <AlarmClockOff aria-hidden="true" />
            {t("snooze.resume")}
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
