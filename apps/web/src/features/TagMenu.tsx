// The header's tag button: a popover around the tag menu (TagCommand.tsx). The menu (cmdk and the tag logic) is its own
// chunk, fetched when the browser is idle (Inbox) or on first open, so it stays out of the first load.
import { lazy, Suspense } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/context";
import type { TagTarget } from "@/model/picker";
import { loadTagCommand } from "./tagCommandLoad";

const LazyTagCommand = lazy(() => loadTagCommand().then((m) => ({ default: m.TagCommand })));

/** The tag menu, loaded on demand; a one-line placeholder for the few ms it may take the first time. */
export function TagCommand(p: { targets: TagTarget[]; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Suspense fallback={<p className="p-3 text-ui text-muted-foreground">{t("common.loading")}</p>}>
      <LazyTagCommand {...p} />
    </Suspense>
  );
}

export function TagMenu({
  targets,
  open,
  onOpenChange,
  children,
}: {
  targets: TagTarget[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trigger (asChild). */
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <TagCommand targets={targets} onClose={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  );
}
