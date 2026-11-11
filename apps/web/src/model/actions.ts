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
 * The status a thread has before an action changes it: the target's, else the loaded conversation's (both at once),
 * else the server's (one read). Null when it cannot be known (that thread then has nothing to undo).
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

  /**
   * Archives the threads, or reopens them when every one is archived already (the `e` toggle). The toast says what
   * happened and undoes it: each thread goes back to the status it had before (read first when the target does not
   * carry it, so a search hit that was waiting goes back to waiting, and one already archived stays archived).
   */
  const archive = useCallback(
    (targets: readonly ActionTarget[]) => {
      if (!targets.length) return;
      const reopen = targets.every((x) => x.status === "closed");
      const status: ThreadStatus = reopen ? "open" : "closed";
      // Each write waits for its thread's status to be known (no wait when the row or the cache has it).
      const before = targets.map((x) => {
        const was = statusBefore(client, x);
        const write = (s: ThreadStatus | null) => {
          quiet(setStatus({ threadId: x.threadId, status }));
          return { threadId: x.threadId, status: s };
        };
        return was instanceof Promise ? was.then(write) : write(was);
      });
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
            void Promise.all(before).then((was) => {
              for (const x of was) if (x.status && x.status !== status) quiet(setStatus({ threadId: x.threadId, status: x.status }));
            });
          },
        },
      });
    },
    [client, setStatus, t, locale],
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
