// Hooks shared by the admin sections: query state as loading / error / value, and `useRun` (runs a call, toasts its
// failure).
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/context";

/** Query state as one of loading / error / value, for the sections. */
export function useLive<T>(snap: { status: string; value: T | undefined; error?: { message: string } | null }) {
  if (snap.status === "error") return { state: "error" as const, message: snap.error?.message ?? "error" };
  if (snap.value === undefined) return { state: "loading" as const };
  return { state: "ready" as const, value: snap.value };
}

/** Runs a call; on failure, a toast with its message. Returns the value or undefined. `busy` while it runs. */
export function useRun() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const v = await fn();
        if (ok) toast(ok);
        return v;
      } catch (e) {
        toast.error(t("admin.failed", { message: (e as Error)?.message ?? String(e) }));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [t],
  );
  return { run, busy };
}
