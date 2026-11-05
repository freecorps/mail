import { Fragment, useEffect, useRef, type Ref } from "react";
import { Archive, ArchiveRestore, ArrowLeft, Check, Download, FileText, Mail, MailOpen, StickyNote, UserRound } from "lucide-react";
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
import { useMembers, useThread, type MessageItem } from "@/model/thread";
import { Composer, type ComposerHandle } from "./Composer";
import { EmailFrame } from "./EmailFrame";

export function ThreadView({ threadId, onBack, composerRef }: { threadId: string; onBack: () => void; composerRef: Ref<ComposerHandle> }) {
  const { t } = useI18n();
  const vm = useThread(threadId);
  const members = useMembers(vm.thread?.mailbox ?? null);
  const scroller = useRef<HTMLOListElement>(null);
  const count = vm.items.length;
  // Open on the newest message and follow new ones (a reply, a note, a customer's answer) while the reader is at the
  // bottom; HTML messages grow after their frame loads, so sizes are observed too.
  const stick = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !count) return;
    stick.current = true;
    const toBottom = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    toBottom();
    const ro = new ResizeObserver(toBottom);
    for (const li of el.children) ro.observe(li);
    return () => ro.disconnect();
  }, [count]);

  if (vm.status === "error" || (vm.status === "ready" && !vm.thread)) {
    return (
      <Pane onBack={onBack}>
        <p role="alert" className="p-8 text-sm text-muted-foreground">
          {t("thread.notFound")}
        </p>
      </Pane>
    );
  }
  if (!vm.thread) {
    return (
      <Pane onBack={onBack}>
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
    <Pane onBack={onBack}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3.5 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-snug font-semibold tracking-tight text-balance">{th.subject}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {th.number > 0 && <span className="font-mono tabular-nums">#{th.number}</span>}
            <span>{contactOf(th)}</span>
            <StatusBadge status={th.status} />
            {th.assigneeName && <span>{t("thread.assignedTo", { name: th.assigneeName })}</span>}
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
                  <Avatar name={m.name} seed={m.userId} className="size-5 text-[9px]" />
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
        </div>
      </header>

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
            <MessageCard item={item} urls={vm.attachmentUrls} />
          </li>
        ))}
      </ol>

      <Composer ref={composerRef} contactName={contactOf(th)} disabled={!vm.canReply} onReply={vm.reply} onNote={vm.note} />
    </Pane>
  );
}

function Pane({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="border-b px-2 py-1.5 md:hidden">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          {t("thread.back")}
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

function MessageCard({ item, urls }: { item: MessageItem; urls: Record<string, string | null> }) {
  const { t, locale } = useI18n();
  const m = item.message;
  const from = displayAddress(m.from);
  const files = m.attachments.filter((a) => !(a.inline && a.contentId && item.cid[a.contentId.replace(/^<|>$/g, "")]));

  if (m.direction === "note") {
    return (
      <article className="rounded-xl border border-note-border bg-note px-4 py-3 text-note-foreground" aria-label={t("thread.note")}>
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
        "rounded-xl border bg-card",
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
        <time className="shrink-0 text-xs text-muted-foreground" dateTime={new Date(m.at).toISOString()}>
          {item.pending ? t("thread.sending") : formatFull(m.at, locale)}
        </time>
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
                <span className="block max-w-48 truncate text-[13px] font-medium">{a.filename}</span>
                <span className="block text-[11px] text-muted-foreground">{fileSize(a.size, locale) || a.contentType}</span>
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
