import { Fragment, useEffect, useMemo, useRef, useState, type Ref } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ban,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  Download,
  FileText,
  Forward,
  Mail,
  MailOpen,
  StickyNote,
  Trash2,
  UserRound,
} from "lucide-react";
import { useMutation } from "@freecorps/ember-react";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/Kbd";
import { useI18n } from "@/i18n/context";
import type { Attachment, Message } from "@/lib/api";
import { linkifyText } from "@/lib/emailHtml";
import { contactOf, displayAddress, fileSize, formatFull } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deliveryState, useMembers, useThread, type DeliveryState, type MessageItem } from "@/model/thread";
import { isPersonal, useMailboxes } from "@/model/threads";
import { forwardedFiles, forwardSubject, forwardText, replyAllCc } from "@/model/forward";
import { ComposeDialog, type ForwardSource } from "./ComposeDialog";
import { Composer, type ComposerHandle } from "./Composer";
import { EmailFrame } from "./EmailFrame";
import { Confirm } from "./admin/parts";
import { api } from "@/lib/api";

export function ThreadView({
  threadId,
  onBack,
  showBack = false,
  composerRef,
  onOpenThread,
  admin = false,
}: {
  threadId: string;
  onBack: () => void;
  /** The back button also shows on wide windows (the conversation covers the list: full and focus modes). */
  showBack?: boolean;
  /** The signed-in member is an admin: they may delete a shared mailbox's conversation. */
  admin?: boolean;
  composerRef: Ref<ComposerHandle>;
  /** Opens another thread (a forwarded message's new conversation). */
  onOpenThread?: (threadId: string) => void;
}) {
  const { t, locale } = useI18n();
  const vm = useThread(threadId);
  const members = useMembers(vm.thread?.mailbox ?? null);
  const boxes = useMailboxes().mailboxes;
  // In your own mailbox there is nobody to assign to and nobody to leave a note for.
  const personal = isPersonal(boxes, vm.thread?.mailbox);
  // Deleting is for admins (shared mailboxes) and for the owner (their own mailbox).
  const canDelete = personal || admin;
  const deleteThread = useMutation(api.inbox.deleteThread);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const own = boxes.find((b) => b.name === vm.thread?.mailbox)?.address ?? "";
  const others = useMemo(
    () =>
      vm.thread
        ? replyAllCc(
            vm.items.map((i) => i.message),
            own,
            vm.thread.contact,
          )
        : [],
    [vm.items, vm.thread, own],
  );
  // The message being forwarded stays while the dialog is closed, so a failed send can reopen it with its draft.
  const [forwarding, setForwarding] = useState<ForwardSource | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const forward = (m: Message) => {
    setForwardOpen(true);
    setForwarding({
      threadId,
      messageId: m._id,
      mailbox: m.mailbox,
      subject: forwardSubject(m.subject || (vm.thread?.subject ?? "")),
      text: forwardText(
        m,
        {
          header: t("forward.header"),
          from: t("forward.from"),
          date: t("forward.date"),
          subject: t("forward.subject"),
          to: t("forward.to"),
        },
        formatFull(m.at, locale),
      ),
      files: forwardedFiles(m.attachments).map((a) => a.filename),
    });
  };
  const scroller = useRef<HTMLOListElement>(null);
  const count = vm.items.length;
  // Open on the newest message (the view is keyed by thread, so `stick` starts true per thread) and follow new ones
  // only while the reader is at the bottom — someone reading history is not yanked down by a customer's answer. The
  // reader's own reply/note (pending) always scrolls into view. HTML messages grow after their frame loads, so sizes
  // are observed too.
  const stick = useRef(true);
  const ownNew = vm.items.at(-1)?.pending === true;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !count) return;
    if (ownNew) stick.current = true;
    const toBottom = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    toBottom();
    const ro = new ResizeObserver(toBottom);
    for (const li of el.children) ro.observe(li);
    return () => ro.disconnect();
  }, [count, ownNew]);

  if (vm.status === "error" || (vm.status === "ready" && !vm.thread)) {
    return (
      <Pane onBack={onBack} showBack={showBack}>
        <p role="alert" className="p-8 text-sm text-muted-foreground">
          {t("thread.notFound")}
        </p>
      </Pane>
    );
  }
  if (!vm.thread) {
    return (
      <Pane onBack={onBack} showBack={showBack}>
        <div className="space-y-4 p-8" aria-busy="true">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Pane>
    );
  }

  const th = vm.thread;
  const archived = th.status === "closed";
  const unread = th.unreadCount > 0;
  return (
    <Pane onBack={onBack} showBack={showBack}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3.5 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-balance sm:text-lg">{th.subject}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {th.number > 0 && <span className="font-mono tabular-nums">#{th.number}</span>}
            <span>{contactOf(th)}</span>
            <StatusBadge status={th.status} />
            {th.assigneeName && !personal && <span>{t("thread.assignedTo", { name: th.assigneeName })}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Action
            label={archived ? t("thread.unarchive") : t("thread.archive")}
            kbd="e"
            onClick={() => {
              vm.toggleArchive();
              toast(archived ? t("thread.reopened") : t("thread.archived"));
            }}
          >
            {archived ? <ArchiveRestore /> : <Archive />}
          </Action>
          <Action label={unread ? t("thread.markRead") : t("thread.markUnread")} kbd="u" onClick={vm.toggleRead}>
            {unread ? <MailOpen /> : <Mail />}
          </Action>
          {canDelete && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("thread.delete")} onClick={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("thread.delete")}</TooltipContent>
            </Tooltip>
          )}
          {!personal && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" aria-label={t("thread.assign")} className="gap-1.5">
                      <UserRound aria-hidden="true" />
                      <span className="hidden max-w-28 truncate lg:inline">{th.assigneeName ?? t("thread.unassigned")}</span>
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t("thread.assign")}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground">{t("assign.title")}</DropdownMenuLabel>
                {members.members.map((m) => (
                  <DropdownMenuItem key={m.userId} onSelect={() => vm.assign(m.userId)}>
                    <Avatar name={m.name} seed={m.userId} className="size-5" />
                    <span className="flex-1 truncate">{m.name}</span>
                    {th.assignee === m.userId && <Check aria-label="✓" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => vm.assign(null)}>
                  <span className="flex-1">{t("assign.nobody")}</span>
                  {!th.assignee && <Check aria-label="✓" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("thread.deleteTitle")}
        body={t("thread.deleteBody")}
        action={t("thread.delete")}
        onConfirm={() => {
          setConfirmDelete(false);
          deleteThread({ threadId })
            .then(() => {
              toast(t("thread.deleted"));
              onBack();
            })
            .catch((e: Error) => toast.error(e.message));
        }}
      />

      <ol
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6"
        aria-label={th.subject}
      >
        {vm.items.map((item) => (
          <li key={item.message._id}>
            <MessageCard
              item={item}
              urls={vm.attachmentUrls}
              onForward={item.pending || item.message.direction === "note" ? undefined : () => forward(item.message)}
            />
          </li>
        ))}
      </ol>

      <Composer
        ref={composerRef}
        contactName={contactOf(th)}
        disabled={!vm.canReply}
        onReply={vm.reply}
        onNote={vm.note}
        notes={!personal}
        others={others}
      />
      <ComposeDialog
        key={forwarding?.messageId ?? "none"}
        open={forwardOpen && forwarding !== null}
        onOpenChange={setForwardOpen}
        mailboxes={boxes}
        defaultMailbox={vm.thread?.mailbox ?? null}
        forward={forwarding}
        onSent={(id) => onOpenThread?.(id)}
      />
    </Pane>
  );
}

function Pane({ children, onBack, showBack }: { children: React.ReactNode; onBack: () => void; showBack: boolean }) {
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

function Action({ label, kbd, onClick, children }: { label: string; kbd: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} aria-keyshortcuts={kbd} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        <Kbd className="border-background/20 bg-background/15 text-background">{kbd}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

function MessageCard({ item, urls, onForward }: { item: MessageItem; urls: Record<string, string | null>; onForward?: () => void }) {
  const { t, locale } = useI18n();
  const m = item.message;
  const from = displayAddress(m.from);
  const files = m.attachments.filter((a) => !(a.inline && a.contentId && item.cid[a.contentId.replace(/^<|>$/g, "")]));

  if (m.direction === "note") {
    return (
      <article className="rounded-lg border border-note-border bg-note px-4 py-3 text-note-foreground" aria-label={t("thread.note")}>
        <header className="mb-1.5 flex items-center gap-2 text-xs">
          <StickyNote className="size-3.5" aria-hidden="true" />
          <span className="font-medium">{t("thread.note")}</span>
          {m.author && <span>· {m.author}</span>}
          <span className="ml-auto opacity-80">{item.pending ? t("thread.sending") : formatFull(m.at, locale)}</span>
        </header>
        <PlainText text={m.text} />
      </article>
    );
  }

  const outbound = m.direction === "outbound";
  return (
    <article
      className={cn(
        "rounded-lg border bg-card",
        outbound && "border-primary/20 bg-primary/[0.035] dark:bg-primary/[0.06]",
        item.pending && "opacity-75",
      )}
    >
      <header className="flex items-start gap-3 px-4 pt-3.5 pb-2.5">
        <Avatar name={outbound && m.author ? m.author : from} seed={outbound ? m.mailbox : m.fromEmail} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium">{outbound && m.author ? m.author : from}</span>
            <span className="truncate text-xs text-muted-foreground">{outbound ? m.fromEmail : m.from.email}</span>
          </p>
          {m.to.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">{t("thread.to", { to: m.to.map(displayAddress).join(", ") })}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <time className="text-xs text-muted-foreground" dateTime={new Date(m.at).toISOString()}>
            {item.pending ? t("thread.sending") : formatFull(m.at, locale)}
          </time>
          {!item.pending && <DeliveryMarker message={m} />}
        </div>
        {onForward && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-2" aria-label={t("thread.forward")} onClick={onForward}>
                <Forward aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("thread.forward")}</TooltipContent>
          </Tooltip>
        )}
      </header>
      <div className="px-4 pb-4">
        {m.html && m.direction === "inbound" ? (
          <EmailFrame html={m.html} cid={item.cid} title={t("thread.messageFrame", { from })} />
        ) : (
          <PlainText text={m.text} />
        )}
        {files.length > 0 && <Attachments files={files} urls={urls} />}
      </div>
    </article>
  );
}

const DELIVERY_ICON: Record<DeliveryState, typeof Check> = {
  pending: Clock,
  sent: Check,
  delivered: CheckCheck,
  delayed: Clock,
  failed: CircleAlert,
  spam: CircleAlert,
  canceled: Ban,
};

/** Where the email this message sent is: sending, sent, delivered, delayed, not delivered (with why). */
function DeliveryMarker({ message }: { message: Message }) {
  const { t } = useI18n();
  const state = deliveryState(message);
  if (!state) return null;
  const Icon = DELIVERY_ICON[state];
  const bad = state === "failed" || state === "spam";
  const hint =
    bad || state === "canceled"
      ? (message.delivery?.reason ?? null)
      : state === "sent" || state === "delivered" || state === "delayed"
        ? t(`delivery.hint.${state}`)
        : null;
  const label = (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        bad ? "text-destructive" : state === "delivered" ? "text-primary" : "text-muted-foreground",
      )}
      data-delivery={state}
    >
      <Icon className="size-3" aria-hidden="true" />
      {t(`delivery.${state}`)}
    </span>
  );
  if (!hint) return label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="cursor-default rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{hint}</TooltipContent>
    </Tooltip>
  );
}

function PlainText({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed break-words whitespace-pre-wrap">
      {linkifyText(text).map((p, i) =>
        p.kind === "link" ? (
          <a
            key={i}
            href={p.value}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-2"
          >
            {p.value}
          </a>
        ) : (
          <Fragment key={i}>{p.value}</Fragment>
        ),
      )}
    </div>
  );
}

function Attachments({ files, urls }: { files: Attachment[]; urls: Record<string, string | null> }) {
  const { t, locale } = useI18n();
  return (
    <div className="mt-3 border-t pt-3">
      <h3 className="sr-only">{t("thread.attachments")}</h3>
      <ul className="flex flex-wrap gap-2">
        {files.map((a: Attachment) => {
          const url = urls[a.file];
          const body = (
            <>
              <span className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground">
                <FileText className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block max-w-48 truncate text-ui font-medium">{a.filename}</span>
                <span className="block text-xs text-muted-foreground">{fileSize(a.size, locale) || a.contentType}</span>
              </span>
              {url && <Download className="size-4 text-muted-foreground" aria-hidden="true" />}
            </>
          );
          return (
            <li key={a.file}>
              {url ? (
                <a
                  href={url}
                  download={a.filename}
                  rel="noopener noreferrer"
                  aria-label={t("thread.download", { name: a.filename })}
                  className="pressable flex items-center gap-2.5 rounded-lg border bg-background py-1.5 pr-3 pl-1.5 hover:bg-accent"
                >
                  {body}
                </a>
              ) : (
                <span className="flex items-center gap-2.5 rounded-lg border py-1.5 pr-3 pl-1.5 opacity-60">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type { Message };
