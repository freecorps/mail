// The conversation's frame (the back bar) and its loading state. Its own small module: the inbox shows the skeleton
// while the conversation's chunk (ThreadView, the composer) loads, the first time one opens.
import { ArrowLeft } from "lucide-react";
import { Kbd } from "@/components/Kbd";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";

export function Pane({ children, onBack, showBack }: { children: React.ReactNode; onBack: () => void; showBack: boolean }) {
  const { t } = useI18n();
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className={cn("border-b px-2 py-1.5", !showBack && "md:hidden")}>
        <Button variant="ghost" size="sm" onClick={onBack} aria-keyshortcuts="Escape">
          <ArrowLeft aria-hidden="true" />
          <span className="md:hidden">{t("thread.back")}</span>
          <span className="hidden md:inline">{t("layout.back")}</span>
          <Kbd className="ml-1 hidden md:inline-flex">Esc</Kbd>
        </Button>
      </div>
      {children}
    </section>
  );
}

/** A conversation that is not here yet: its header and first message as placeholders. */
export function ThreadSkeleton({ onBack, showBack }: { onBack: () => void; showBack: boolean }) {
  return (
    <Pane onBack={onBack} showBack={showBack}>
      <div className="space-y-3 border-b px-4 py-4 sm:px-6" aria-busy="true">
        <Skeleton className="h-6 w-2/3" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      </div>
      <div className="space-y-3 px-4 py-5 sm:px-6" aria-hidden="true">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    </Pane>
  );
}
