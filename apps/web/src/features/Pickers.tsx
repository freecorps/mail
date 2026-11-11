// What `openPicker` asks for (model/picker.ts): the snooze dialog (`h`, ⌘K: presets with their number keys, or a date),
// the tag dialog (`l`), a date and time for "Enviar mais tarde", and Settings → Etiquetas. Also the date and time
// fields, shared with the menus' "Escolher data…".
import { lazy, Suspense, useId, useState } from "react";
import { Clock } from "lucide-react";
import { Kbd } from "@/components/Kbd";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/context";
import { useNow } from "@/lib/now";
import { checkPick, defaultPick, formatAt, inputValues, localZone, MAX_AHEAD_DAYS, snoozePresets, zoneName } from "@/lib/when";
import { openPicker, usePicker } from "@/model/picker";
import { useSnooze } from "@/model/snooze";
import { TagCommand } from "./TagMenu";

const TagsSettings = lazy(() => import("./TagsSettings").then((m) => ({ default: m.TagsSettings })));

export function PickerHost() {
  const { t } = useI18n();
  const r = usePicker();
  const close = (open: boolean) => !open && openPicker(null);
  const snooze = useSnooze();
  return (
    <>
      <SnoozeDialog
        key={r?.kind === "snooze" ? `snooze:${r.targets.map((x) => x.threadId).join(",")}:${r.date ? 1 : 0}` : "snooze"}
        open={r?.kind === "snooze"}
        onOpenChange={close}
        startWithDate={r?.kind === "snooze" && !!r.date}
        onPick={(at) => {
          if (r?.kind !== "snooze") return;
          openPicker(null);
          snooze.snooze(r.targets, at);
        }}
      />
      <Dialog open={r?.kind === "tags"} onOpenChange={close}>
        <DialogContent closeLabel={t("common.close")} className="top-[14vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-sm">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("tags.title")}</DialogTitle>
            <DialogDescription>{t("tags.search")}</DialogDescription>
          </DialogHeader>
          {r?.kind === "tags" && <TagCommand targets={r.targets} onClose={() => openPicker(null)} />}
        </DialogContent>
      </Dialog>
      <DateTimeDialog
        key={r?.kind === "sendAt" ? "sendAt:open" : "sendAt"}
        open={r?.kind === "sendAt"}
        onOpenChange={close}
        title={t("schedule.pickTitle")}
        hint={t("schedule.pickHint")}
        confirm={t("schedule.confirm")}
        onConfirm={(at) => {
          if (r?.kind !== "sendAt") return;
          openPicker(null);
          r.onPick(at);
        }}
      />
      {r?.kind === "manageTags" && (
        <Suspense fallback={null}>
          <TagsSettings open mailbox={r.mailbox ?? null} onOpenChange={close} />
        </Suspense>
      )}
    </>
  );
}

/**
 * The date and time inputs (native: keyboard, locale and the platform's own picker), checked as they change. The
 * dialog focuses its first field (or the first preset) on open.
 */
export function DateTimeFields({ initial, onChange }: { initial: number; onChange: (at: number | null) => void }) {
  const { t, locale } = useI18n();
  const ids = { date: useId(), time: useId(), msg: useId() };
  const zone = localZone();
  const now = useNow(30_000);
  const [v, setV] = useState(() => inputValues(initial, zone));
  const check = checkPick(v.date, v.time, now, zone);
  const set = (patch: Partial<typeof v>) => {
    const next = { ...v, ...patch };
    setV(next);
    const c = checkPick(next.date, next.time, Date.now(), zone);
    onChange(c.ok ? c.at : null);
  };
  const max = inputValues(now + (MAX_AHEAD_DAYS - 1) * 86_400_000, zone).date;
  const min = inputValues(now, zone).date;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_8rem] gap-2">
        <div className="space-y-1">
          <Label htmlFor={ids.date} className="text-xs text-muted-foreground">
            {t("picker.date")}
          </Label>
          <Input
            id={ids.date}
            type="date"
            value={v.date}
            min={min}
            max={max}
            onChange={(e) => set({ date: e.target.value })}
            aria-describedby={ids.msg}
            aria-invalid={!check.ok || undefined}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={ids.time} className="text-xs text-muted-foreground">
            {t("picker.time")}
          </Label>
          <Input
            id={ids.time}
            type="time"
            step={300}
            value={v.time}
            onChange={(e) => set({ time: e.target.value })}
            aria-describedby={ids.msg}
            aria-invalid={!check.ok || undefined}
          />
        </div>
      </div>
      <p id={ids.msg} className={`text-xs ${check.ok ? "text-muted-foreground" : "text-destructive"}`} aria-live="polite">
        {check.ok
          ? `${t("picker.preview", { when: formatAt(check.at, now, locale, zone) })} ${t("picker.zone", { zone: zoneName(zone, locale) })}`
          : check.error === "tooFar"
            ? t("picker.tooFar", { days: MAX_AHEAD_DAYS })
            : t("picker.past")}
      </p>
    </div>
  );
}

export function DateTimeDialog({
  open,
  onOpenChange,
  title,
  hint,
  confirm,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  hint: string;
  confirm: string;
  onConfirm: (at: number) => void;
}) {
  const { t } = useI18n();
  const [initial] = useState(() => defaultPick(Date.now()));
  const [at, setAt] = useState<number | null>(initial);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-sm">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            if (at !== null) onConfirm(at);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{hint}</DialogDescription>
          </DialogHeader>
          <DateTimeFields initial={initial} onChange={setAt} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={at === null}>
              {confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** `h`: the presets as a short list (1, 2, 3… pick at once), then a date and time. */
function SnoozeDialog({
  open,
  onOpenChange,
  onPick,
  startWithDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (at: number) => void;
  startWithDate: boolean;
}) {
  const { t, locale } = useI18n();
  const now = useNow(30_000);
  const presets = snoozePresets(now);
  const [initial] = useState(() => defaultPick(Date.now()));
  const [at, setAt] = useState<number | null>(initial);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("common.close")}
        className="sm:max-w-sm"
        onKeyDown={(e) => {
          // 1…n picks a preset (not while typing in the fields).
          const n = Number(e.key);
          if (e.target instanceof HTMLInputElement || !Number.isInteger(n) || n < 1 || n > presets.length) return;
          e.preventDefault();
          onPick(presets[n - 1]!.at);
        }}
      >
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            if (at !== null) onPick(at);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("snooze.pickTitle")}</DialogTitle>
            <DialogDescription>{t("snooze.pickHint")}</DialogDescription>
          </DialogHeader>
          {!startWithDate && (
            <ul className="-mx-2 space-y-px">
              {presets.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onPick(p.at)}
                    className="pressable flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-ui hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1 font-medium">{t(`snooze.${p.id}`)}</span>
                    <span className="text-xs text-muted-foreground">{formatAt(p.at, now, locale)}</span>
                    <Kbd>{String(i + 1)}</Kbd>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <DateTimeFields initial={initial} onChange={setAt} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={at === null}>
              {t("snooze.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
