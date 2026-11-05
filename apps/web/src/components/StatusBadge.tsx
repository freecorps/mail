import type { ThreadStatus } from "@/lib/api";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";

const TONE: Record<ThreadStatus, string> = {
  open: "text-status-open bg-status-open/12",
  waiting: "text-status-waiting bg-status-waiting/14",
  closed: "text-status-closed bg-status-closed/12",
  spam: "text-status-spam bg-status-spam/12",
};

export function StatusBadge({ status, className }: { status: ThreadStatus; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium", TONE[status], className)}>
      {t(`status.${status}`)}
    </span>
  );
}
