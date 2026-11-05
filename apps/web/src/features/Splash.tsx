import { Logo } from "@/components/Logo";
import { useI18n } from "@/i18n/context";

export function Splash() {
  const { t } = useI18n();
  return (
    <output className="grid h-full place-items-center" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Logo className="size-8 animate-pulse" />
        <span className="sr-only">{t("common.loading")}</span>
      </div>
    </output>
  );
}
