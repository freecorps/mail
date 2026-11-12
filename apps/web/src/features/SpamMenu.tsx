// Spam and blocked senders on the open conversation: the header's Spam menu (mark as spam or not, block the sender's
// address or whole domain, refuse their mail, always accept them, unblock) and, on a spam conversation, the banner that
// says why it is there with "Não é spam". The sender and their rules come from `inbox:sender`, read when the menu opens
// (and always on a spam conversation, for the banner).
import { useState } from "react";
import { Ban, Check, ShieldAlert, ShieldCheck, ShieldOff, UserX } from "lucide-react";
import { useQuerySnapshot } from "@freecorps/ember-react";
import { Kbd } from "@/components/Kbd";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import { api, type Message, type SenderInfo, type ThreadStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { openPicker } from "@/model/picker";
import { blockingRule, canEditRule, useSenderActions } from "@/model/senders";

export interface SpamThread {
  threadId: string;
  mailbox: string;
  status: ThreadStatus;
}

/** The header button: Spam (`!`) and what to do with the sender. */
export function SpamMenu({ thread, onSpam }: { thread: SpamThread; onSpam: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const spam = thread.status === "spam";
  const sender = useQuerySnapshot(api.inbox.sender, open || spam ? { threadId: thread.threadId } : "skip").value ?? null;
  const acts = useSenderActions();
  const label = spam ? t("spam.notSpam") : t("spam.mark");
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("spam.action")}
              aria-keyshortcuts="!"
              className={cn("text-muted-foreground hover:text-foreground", spam && "text-status-spam hover:text-status-spam")}
            >
              <ShieldAlert />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-2">
          {t("spam.action")}
          <Kbd className="border-background/20 bg-background/15 text-background">!</Kbd>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onSelect={spam ? () => acts.notSpamUnblock(thread.threadId) : onSpam}>
          {spam ? <ShieldCheck aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
          <span className="flex-1">{label}</span>
          <Kbd>!</Kbd>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <SenderItems thread={thread} sender={sender} acts={acts} />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openPicker({ kind: "manageSenders", mailbox: thread.mailbox })}>
          <span className="flex-1 pl-6">{t("spam.manage")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SenderItems({
  thread,
  sender,
  acts,
}: {
  thread: SpamThread;
  sender: SenderInfo | null;
  acts: ReturnType<typeof useSenderActions>;
}) {
  const { t } = useI18n();
  if (!sender) {
    return <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("common.loading")}</DropdownMenuLabel>;
  }
  const blocking = blockingRule(sender);
  const allowed = sender.effective?.action === "allow" ? sender.effective : null;
  return (
    <>
      <DropdownMenuLabel className="flex min-w-0 flex-col gap-0.5 text-xs font-normal text-muted-foreground">
        <span>{t("spam.sender")}</span>
        <span dir="auto" className="truncate font-medium text-foreground">
          {sender.email}
        </span>
      </DropdownMenuLabel>
      {blocking ? (
        canEditRule(blocking, sender) ? (
          <DropdownMenuItem onSelect={() => acts.unrule(blocking)}>
            <ShieldOff aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t("spam.unblock", { pattern: blocking.pattern })}</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("spam.globalRule")}</DropdownMenuLabel>
        )
      ) : (
        <>
          <DropdownMenuItem onSelect={() => acts.block(thread, "address")}>
            <UserX aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t("spam.blockAddress", { email: sender.email })}</span>
          </DropdownMenuItem>
          {sender.domainBlockable && (
            <DropdownMenuItem onSelect={() => acts.block(thread, "domain")}>
              <UserX aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t("spam.blockDomain", { domain: sender.domain })}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => acts.block(thread, "address", "reject")}>
            <Ban aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t("spam.rejectAddress", { email: sender.email })}</span>
          </DropdownMenuItem>
        </>
      )}
      {allowed
        ? canEditRule(allowed, sender) && (
            <DropdownMenuItem onSelect={() => acts.unrule(allowed)}>
              <Check aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t("spam.unallow", { pattern: allowed.pattern })}</span>
            </DropdownMenuItem>
          )
        : !blocking && (
            <DropdownMenuItem onSelect={() => acts.allow(thread, sender.email)}>
              <ShieldCheck aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t("spam.allowAddress", { email: sender.email })}</span>
            </DropdownMenuItem>
          )}
    </>
  );
}

/**
 * Under the header of a spam conversation: why it is in Spam (the sender rule that filed its latest message, or the
 * per-hour limit) and "Não é spam", which also removes the rules that block the sender in this mailbox.
 */
export function SpamBanner({ threadId, lastInbound }: { threadId: string; lastInbound: Message | null }) {
  const { t } = useI18n();
  const acts = useSenderActions();
  const why = lastInbound?.spam;
  const text =
    why?.reason === "rule" && why.pattern
      ? t("spam.banner.rule", { pattern: why.pattern })
      : why?.reason === "rate"
        ? t("spam.banner.rate")
        : t("spam.banner");
  return (
    <div className="flex items-center gap-2 border-b bg-status-spam/8 px-4 py-1.5 text-ui sm:px-6" role="status">
      <ShieldAlert className="size-3.5 shrink-0 text-status-spam" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {text}
      </span>
      <Button variant="ghost" size="xs" onClick={() => acts.notSpamUnblock(threadId)}>
        {t("spam.notSpam")}
      </Button>
    </div>
  );
}
