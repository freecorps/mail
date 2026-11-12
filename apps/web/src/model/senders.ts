// Blocking a conversation's sender (the thread's Spam menu, ⌘K) and taking them off again (the menu, the Spam banner).
// The rules are the email component's (inbox:setSenderRule…), per mailbox; the clients only offer the whole domain when
// the server says it is no shared free-mail domain (`SenderInfo.domainBlockable`).
import { useCallback } from "react";
import { useMutation } from "@freecorps/ember-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/context";
import { api, type SenderAction, type SenderInfo, type SenderRule, type ThreadStatus } from "@/lib/api";
import { UNDO_MS } from "./actions";

const report = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/** The rule that decides the sender's mail, when it blocks (spam or reject) and this member may remove it. */
export function blockingRule(s: SenderInfo | null | undefined): SenderRule | null {
  const r = s?.effective;
  return r && r.action !== "allow" ? r : null;
}

export const canEditRule = (r: SenderRule, s: Pick<SenderInfo, "canEditGlobal">) => r.mailbox !== null || s.canEditGlobal;

/** A sender pattern as people type it: an address or a domain (two labels at least). The server has the last word. */
export function senderPatternOk(input: string): boolean {
  let s = input.trim().toLowerCase();
  s = s.replace(/^\*@|^@|^\*\./, "");
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  const domain = new RegExp(`^${label}(?:\\.${label})+\\.?$`);
  if (s.includes("@")) {
    const at = s.lastIndexOf("@");
    return at > 0 && !/[\s<>@",;:()[\]\\]/.test(s.slice(0, at)) && domain.test(s.slice(at + 1));
  }
  return domain.test(s) && !/\.\d+\.?$/.test(s);
}

export function useSenderActions() {
  const { t } = useI18n();
  const reportSpam = useMutation(api.inbox.reportSpam);
  const notSpam = useMutation(api.inbox.notSpam);
  const setRule = useMutation(api.inbox.setSenderRule);
  const removeRule = useMutation(api.inbox.removeSenderRule);
  const setStatus = useMutation(api.inbox.setStatus);

  /**
   * Blocks the thread's sender (`spam`: their mail goes to Spam; `reject`: it bounces) by address or domain, and
   * moves the conversation to Spam. Desfazer removes the rule and puts the conversation back.
   */
  const block = useCallback(
    (
      thread: { threadId: string; mailbox: string; status: ThreadStatus },
      how: "address" | "domain",
      action: "spam" | "reject" = "spam",
    ) => {
      const was = thread.status;
      reportSpam({ threadId: thread.threadId, block: how, action })
        .then((r) => {
          const pattern = r.rule?.pattern ?? "";
          toast(t(action === "reject" ? "spam.rejected" : "spam.blocked", { pattern }), {
            duration: UNDO_MS,
            action: {
              label: t("common.undo"),
              onClick: () => {
                if (pattern) removeRule({ mailbox: thread.mailbox, pattern }).catch(report);
                if (was !== "spam") setStatus({ threadId: thread.threadId, status: was }).catch(report);
              },
            },
          });
        })
        .catch(report);
    },
    [reportSpam, removeRule, setStatus, t],
  );

  /** Always accepts the sender's address in this mailbox (and takes the conversation out of Spam). */
  const allow = useCallback(
    (thread: { threadId: string; mailbox: string; status: ThreadStatus }, email: string) => {
      setRule({ mailbox: thread.mailbox, pattern: email, action: "allow" })
        .then((r) => {
          if (thread.status === "spam") notSpam({ threadId: thread.threadId }).catch(report);
          toast(t("spam.allowed", { pattern: r.pattern }), {
            duration: UNDO_MS,
            action: { label: t("common.undo"), onClick: () => removeRule({ mailbox: r.mailbox, pattern: r.pattern }).catch(report) },
          });
        })
        .catch(report);
    },
    [setRule, notSpam, removeRule, t],
  );

  /** Removes one rule (unblock, or stop always accepting). Desfazer sets it again. */
  const unrule = useCallback(
    (r: SenderRule) => {
      removeRule({ mailbox: r.mailbox, pattern: r.pattern })
        .then(() =>
          toast(t(r.action === "allow" ? "senders.removed" : "spam.unblocked", { pattern: r.pattern }), {
            duration: UNDO_MS,
            action: {
              label: t("common.undo"),
              onClick: () => setRule({ mailbox: r.mailbox, pattern: r.pattern, action: r.action }).catch(report),
            },
          }),
        )
        .catch(report);
    },
    [removeRule, setRule, t],
  );

  /** "Não é spam" from the banner: out of Spam, and the sender's blocking rules in this mailbox go too. */
  const notSpamUnblock = useCallback(
    (threadId: string) => {
      notSpam({ threadId, unblock: true })
        .then((r) => toast(r.removed ? t("spam.unblockedToo") : t("spam.unmarked")))
        .catch(report);
    },
    [notSpam, t],
  );

  const setAction = useCallback(
    (r: SenderRule, action: SenderAction) => setRule({ mailbox: r.mailbox, pattern: r.pattern, action }).catch(report),
    [setRule],
  );

  return { block, allow, unrule, notSpamUnblock, setAction };
}
