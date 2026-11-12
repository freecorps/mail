// Actions on one or many threads (list hover actions, the bulk bar, keys, the thread header). The server has no bulk
// mutations: the client runs one optimistic mutation per thread, so every row changes at once and the server's answers
// replace the guesses. Archiving offers "Desfazer", which puts each thread back to the status it had; the optimistic
// rules bring it back into the lists that dropped it (lib/optimistic.ts `rejoin`).
import { useCallback } from "react";
import type { EmberClient } from "@freecorps/ember-client";
import { useEmberClient, useMutation } from "@freecorps/ember-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/context";
import { plural } from "@/i18n/strings";
import { api, type ThreadStatus } from "@/lib/api";

export interface ActionTarget {
  threadId: string;
  /** Null when the caller does not know it (search hits carry none). */
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

/** A thread's status from its loaded conversation (the open one, or one opened before), if the client has it. */
export const cachedStatus = (client: EmberClient, threadId: string): ThreadStatus | null =>
  client.localQueryResult(api.inbox.thread, { threadId }).value?.thread.status ?? null;

/**
 * The status a thread has before an action changes it, for undo only: the target's, else the loaded conversation's
 * (both known at once; read before the optimistic patch), else the server's, from one read sent before the write (same
 * connection, so it sees the thread as it was). Null when it cannot be known: that thread has nothing to undo.
 */
export function statusBefore(client: EmberClient, x: ActionTarget): ThreadStatus | null | Promise<ThreadStatus | null> {
  const known = x.status ?? cachedStatus(client, x.threadId);
  if (known) return known;
  return client.query(api.inbox.thread, { threadId: x.threadId }).then(
    (d) => d.thread.status,
    () => null,
  );
}

/** How long the "Desfazer" toast stays: long enough to notice and reach it. */
export const UNDO_MS = 6000;

export function useThreadActions() {
  const { t, locale } = useI18n();
  const client = useEmberClient();
  const setStatus = useMutation(api.inbox.setStatus);
  const markRead = useMutation(api.inbox.markRead);
  const markUnread = useMutation(api.inbox.markUnread);
  const assignTo = useMutation(api.inbox.assign);
  const reportSpam = useMutation(api.inbox.reportSpam);
  const notSpam = useMutation(api.inbox.notSpam);

  /**
   * Archives the threads, or reopens them when every one is archived already (the `e` toggle), at once (optimistic).
   * The toast says what happened and undoes it: each thread goes back to the status it had before. Rows without one
   * (search hits) have it read alongside the write; Desfazer waits for that read, and the toast drops Desfazer when
   * nothing turns out to be undoable (statuses unknown, or already what the action set).
   */
  const archive = useCallback(
    (targets: readonly ActionTarget[]) => {
      if (!targets.length) return;
      const reopen = targets.every((x) => x.status === "closed");
      const status: ThreadStatus = reopen ? "open" : "closed";
      // Read first (the cache before the optimistic patch, the server read before the write), never waited on here.
      const before = targets.map((x) => statusBefore(client, x));
      for (const x of targets) quiet(setStatus({ threadId: x.threadId, status }));
      const restore = (was: ReadonlyArray<ThreadStatus | null>) =>
        targets.flatMap((x, i) => (was[i] && was[i] !== status ? [{ threadId: x.threadId, status: was[i]! }] : []));
      const n = targets.length;
      const message =
        n === 1
          ? reopen
            ? t("thread.reopened")
            : t("thread.archived")
          : t(plural(locale, reopen ? "list.reopenedMany" : "list.archivedMany", n), { count: n });
      const id = toast(message, {
        duration: UNDO_MS,
        action: {
          label: t("common.undo"),
          onClick: () => {
            void Promise.all(before).then((was) => {
              for (const x of restore(was)) quiet(setStatus(x));
            });
          },
        },
      });
      if (before.some((b) => b instanceof Promise)) {
        void Promise.all(before).then((was) => {
          if (!restore(was).length) toast(message, { id, duration: UNDO_MS, action: undefined });
        });
      }
    },
    [client, setStatus, t, locale],
  );

  /**
   * Moves the threads to Spam (`!`, the bulk bar, the thread's Spam menu), or out of it when every one is spam
   * already; the sender rules are left alone here (the thread's menu and banner block and unblock). Desfazer puts each
   * one back to the status it had, read as `archive` reads it.
   */
  const spam = useCallback(
    (targets: readonly ActionTarget[]) => {
      if (!targets.length) return;
      const back = targets.every((x) => x.status === "spam");
      const n = targets.length;
      if (back) {
        for (const x of targets) quiet(notSpam({ threadId: x.threadId }));
        toast(n === 1 ? t("spam.unmarked") : t(plural(locale, "spam.unmarkedMany", n), { count: n }), {
          duration: UNDO_MS,
          action: {
            label: t("common.undo"),
            onClick: () => targets.forEach((x) => quiet(setStatus({ threadId: x.threadId, status: "spam" }))),
          },
        });
        return;
      }
      const before = targets.map((x) => statusBefore(client, x));
      for (const x of targets) quiet(reportSpam({ threadId: x.threadId }));
      const message = n === 1 ? t("spam.marked") : t(plural(locale, "spam.markedMany", n), { count: n });
      toast(message, {
        duration: UNDO_MS,
        action: {
          label: t("common.undo"),
          onClick: () => {
            void Promise.all(before.map((b) => Promise.resolve(b))).then((was) => {
              targets.forEach((x, i) => {
                const s = was[i];
                if (s && s !== "spam") quiet(setStatus({ threadId: x.threadId, status: s }));
              });
            });
          },
        },
      });
    },
    [client, notSpam, reportSpam, setStatus, t, locale],
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

  /** Any status; archiving goes through `archive` (it offers Desfazer). */
  const setStatusOf = useCallback(
    (targets: readonly ActionTarget[], status: ThreadStatus) => {
      if (status === "closed") return archive(targets);
      for (const x of targets) quiet(setStatus({ threadId: x.threadId, status }));
    },
    [archive, setStatus],
  );

  return { archive, toggleRead, assign, spam, setStatus: setStatusOf };
}
