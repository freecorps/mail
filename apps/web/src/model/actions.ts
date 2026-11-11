// Actions on one or many threads (list hover actions, the bulk bar, keys, the thread header). The server has no bulk
// mutations: the client runs one optimistic mutation per thread, so every row changes at once and the server's answers
// replace the guesses. Archiving offers "Desfazer", which puts each thread back to the status it had; the optimistic
// rules bring it back into the lists that dropped it (lib/optimistic.ts `rejoin`).
import { useCallback } from "react";
import { useMutation } from "@freecorps/ember-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/context";
import { plural } from "@/i18n/strings";
import { api, type ThreadStatus } from "@/lib/api";

export interface ActionTarget {
  threadId: string;
  status: ThreadStatus | null;
  unread: boolean;
}

/** What an action needs from a list row. */
export const toTarget = (r: { threadId: string; status: ThreadStatus | null; unread: boolean }): ActionTarget => ({
  threadId: r.threadId,
  status: r.status,
  unread: r.unread,
});

const quiet = (p: Promise<unknown>) => void p.catch(() => {});

/** How long the "Desfazer" toast stays: long enough to notice and reach it. */
export const UNDO_MS = 6000;

export function useThreadActions() {
  const { t, locale } = useI18n();
  const setStatus = useMutation(api.inbox.setStatus);
  const markRead = useMutation(api.inbox.markRead);
  const markUnread = useMutation(api.inbox.markUnread);
  const assignTo = useMutation(api.inbox.assign);

  /**
   * Archives the threads, or reopens them when every one is archived already (the `e` toggle). The toast says what
   * happened and undoes it.
   */
  const archive = useCallback(
    (targets: readonly ActionTarget[]) => {
      if (!targets.length) return;
      const reopen = targets.every((x) => x.status === "closed");
      const before = targets.map((x) => ({ threadId: x.threadId, status: x.status ?? "open" }));
      for (const x of before) quiet(setStatus({ threadId: x.threadId, status: reopen ? "open" : "closed" }));
      const n = targets.length;
      const message =
        n === 1
          ? reopen
            ? t("thread.reopened")
            : t("thread.archived")
          : t(plural(locale, reopen ? "list.reopenedMany" : "list.archivedMany", n), { count: n });
      toast(message, {
        duration: UNDO_MS,
        action: {
          label: t("common.undo"),
          onClick: () => {
            for (const x of before) quiet(setStatus({ threadId: x.threadId, status: x.status }));
          },
        },
      });
    },
    [setStatus, t, locale],
  );

  /** Marks them read when any is unread, else unread (the bulk bar's one toggle). */
  const toggleRead = useCallback(
    (targets: readonly ActionTarget[]) => {
      const read = targets.some((x) => x.unread);
      for (const x of targets) {
        if (read && x.unread) quiet(markRead({ threadId: x.threadId }));
        else if (!read) quiet(markUnread({ threadId: x.threadId }));
      }
    },
    [markRead, markUnread],
  );

  const assign = useCallback(
    (targets: readonly ActionTarget[], userId: string | null) => {
      for (const x of targets) quiet(assignTo({ threadId: x.threadId, userId }));
    },
    [assignTo],
  );

  return { archive, toggleRead, assign };
}
