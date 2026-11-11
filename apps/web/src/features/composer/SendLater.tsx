// "Enviar mais tarde": the arrow next to Enviar (a split button), with tomorrow morning, tomorrow afternoon, Monday
// morning and a date and time (⌘/Ctrl+Shift+Enter opens that one from the editor). Blocked ahead of time, with why,
// when the files would go as links (past 10 MB in all): the server refuses those for a scheduled send.
import { CalendarClock, ChevronDown, Clock, Info } from "lucide-react";
import { Kbd } from "@/components/Kbd";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import { fileSize } from "@/lib/format";
import { useNow } from "@/lib/now";
import { formatAt, sendPresets } from "@/lib/when";
import { modKey } from "@/model/keys";
import { openPicker } from "@/model/picker";
import { ATTACH_LIMIT, type SendLaterCheck } from "@/model/schedule";

export function SendLaterButton({ check, disabled, onPick }: { check: SendLaterCheck; disabled?: boolean; onPick: (at: number) => void }) {
  const { t, locale } = useI18n();
  const now = useNow(30_000);
  const blocked = !check.ok;
  const label = t("schedule.later");
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <Button
              type="button"
              size="sm"
              className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
              aria-label={label}
              aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-2">
          {label}
          <span className="flex gap-0.5">
            <Kbd className="border-background/20 bg-background/15 text-background">{modKey()}</Kbd>
            <Kbd className="border-background/20 bg-background/15 text-background">⇧</Kbd>
            <Kbd className="border-background/20 bg-background/15 text-background">Enter</Kbd>
          </span>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" side="top" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
        {blocked && (
          <p role="note" className="mx-2 mb-1 flex gap-2 rounded-md bg-muted px-2 py-1.5 text-xs text-foreground/80">
            <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              {t("schedule.blocked")}{" "}
              <span className="text-muted-foreground">
                {t("schedule.blockedSize", { size: fileSize(check.total, locale), limit: fileSize(ATTACH_LIMIT, locale) })}
              </span>
            </span>
          </p>
        )}
        {sendPresets(now).map((p) => (
          <DropdownMenuItem key={p.id} disabled={blocked} onSelect={() => onPick(p.at)}>
            <Clock aria-hidden="true" />
            <span className="flex-1">{t(`schedule.${p.id}`)}</span>
            <span className="pl-3 text-xs text-muted-foreground">{formatAt(p.at, now, locale)}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={blocked} onSelect={() => openPicker({ kind: "sendAt", onPick })}>
          <CalendarClock aria-hidden="true" />
          {t("schedule.pick")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
