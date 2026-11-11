// Snooze: a thread leaves every list and count but "Adiadas" until `until`, then comes back on top, unread and open
// (an answer from the contact wakes it sooner). Optimistic (lib/optimistic.ts), with "Desfazer" in the toast: the
// threads go back to how they were (awake, or snoozed until their earlier time).
import { useCallback } from "react";
import { useMutation } from "@freecorps/ember-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/context";
import { plural } from "@/i18n/strings";
import { api, type Thread } from "@/lib/api";
import { formatAt } from "@/lib/when";
import { UNDO_MS } from "./actions";

export interface SnoozeTarget {
  threadId: string;
  /** When it is snoozed until now (undefined: awake), for Desfazer. */
  snoozedUntil?: number;
}

/**
 * The target of a snooze, the one builder every surface uses (keys, rows, the bulk bar, the header, ⌘K). Its wake time
 * counts as "before" (what Desfazer goes back to) only while the thread is snoozed: a thread says so with `snoozed` (a
 * stale `snoozedUntil` on an awake thread is ignored); a list row already carries `snoozedUntil` only then
 * (`threadRow`).
 */
export function snoozeTargetOf(
  t: Pick<Thread, "_id" | "snoozed" | "snoozedUntil"> | { threadId: string; snoozedUntil?: number | null },
): SnoozeTarget {
  if ("threadId" in t) return t.snoozedUntil ? { threadId: t.threadId, snoozedUntil: t.snoozedUntil } : { threadId: t.threadId };
  return t.snoozed === true && t.snoozedUntil ? { threadId: t._id, snoozedUntil: t.snoozedUntil } : { threadId: t._id };
}

const report = (p: Promise<unknown>) => void p.catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));

export function useSnooze() {
  const { t, locale } = useI18n();
  const snoozeM = useMutation(api.inbox.snooze);
  const unsnoozeM = useMutation(api.inbox.unsnooze);

  const snooze = useCallback(
    (targets: readonly SnoozeTarget[], until: number) => {
      if (!targets.length) return;
      const before = targets.map((x) => ({ threadId: x.threadId, until: x.snoozedUntil ?? null }));
      for (const x of targets) report(snoozeM({ threadId: x.threadId, until }));
      const when = formatAt(until, Date.now(), locale);
      const n = targets.length;
      toast(n === 1 ? t("snooze.done", { when }) : t(plural(locale, "snooze.doneMany", n), { count: n, when }), {
        duration: UNDO_MS,
        action: {
          label: t("common.undo"),
          onClick: () => {
            // An earlier time already past would be refused: it wakes instead.
            for (const b of before)
              report(snoozeM({ threadId: b.threadId, until: b.until !== null && b.until > Date.now() ? b.until : null }));
          },
        },
      });
    },
    [snoozeM, t, locale],
  );

  const unsnooze = useCallback(
    (threadId: string, until?: number) => {
      report(unsnoozeM({ threadId }));
      toast(t("snooze.resumed"), {
        duration: UNDO_MS,
        ...(until && until > Date.now()
          ? { action: { label: t("common.undo"), onClick: () => report(snoozeM({ threadId, until })) } }
          : {}),
      });
    },
    [unsnoozeM, snoozeM, t],
  );

  return { snooze, unsnooze };
}
