import { Kbd } from "@/components/Kbd";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/context";
import { SHORTCUTS } from "@/model/keys";

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("shortcuts.title")}</DialogDescription>
        </DialogHeader>
        <dl className="divide-y text-sm">
          {SHORTCUTS.map((s) => (
            <div key={s.action} className="flex items-center justify-between py-2">
              <dt className="text-muted-foreground">{t(`shortcuts.${s.action}`)}</dt>
              <dd className="flex gap-1">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
