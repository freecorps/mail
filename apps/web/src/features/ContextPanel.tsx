// The conversation's context (`i`): who the contact is, their earlier conversations (server search on their address,
// across every mailbox the member sees), and every file in this conversation. Beside the messages on wide panes,
// over them on narrow ones.
import { useMemo, useState } from "react";
import { Check, Copy, Download, FileText, X } from "lucide-react";
import { useQuerySnapshot } from "@freecorps/ember-react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/context";
import { plural } from "@/i18n/strings";
import { api, type Attachment, type Thread } from "@/lib/api";
import { contactOf, fileSize, formatWhen } from "@/lib/format";
import { useNow } from "@/lib/now";
import { cn } from "@/lib/utils";
import type { MessageItem } from "@/model/thread";
import { useMailboxes } from "@/model/threads";

/** Earlier conversations shown (newest first). */
const HISTORY_MAX = 8;

export function ContextPanel({
  thread,
  items,
  urls,
  overlay,
  onClose,
  onOpenThread,
}: {
  thread: Thread;
  items: MessageItem[];
  urls: Record<string, string | null>;
  /** Over the messages (narrow pane) instead of beside them. */
  overlay: boolean;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
}) {
  const { t, locale } = useI18n();
  const now = useNow();
  const boxes = useMailboxes().mailboxes;
  const mailboxName = (name: string) => boxes.find((b) => b.name === name)?.displayName ?? name;
  const contact = thread.contact.toLowerCase();
  const search = useQuerySnapshot(api.inbox.search, contact.includes("@") ? { query: contact } : "skip");
  const history = useMemo(() => {
    const seen = new Set<string>([thread._id]);
    const out: Array<{ threadId: string; subject: string; at: number; mailbox: string }> = [];
    for (const h of search.value ?? []) {
      if (seen.has(h.threadId) || h.from.email.toLowerCase() !== contact) continue;
      seen.add(h.threadId);
      out.push({ threadId: h.threadId, subject: h.subject, at: h.at, mailbox: h.mailbox });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, HISTORY_MAX);
  }, [search.value, thread._id, contact]);
  const files = useMemo(
    () =>
      items.flatMap((i) =>
        i.message.attachments
          .filter((a) => !(a.inline && a.contentId && i.cid[a.contentId.replace(/^<|>$/g, "")]))
          .map((file) => ({ file, at: i.message.at })),
      ),
    [items],
  );
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard?.writeText(thread.contact).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  return (
    <aside
      aria-label={t("context.title")}
      className={cn(
        "flex w-72 shrink-0 flex-col border-l bg-background",
        overlay && "absolute inset-y-0 right-0 z-20 w-[min(20rem,100%)] shadow-overlay",
      )}
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b pr-2 pl-4">
        <h3 className="text-ui font-medium">{t("context.title")}</h3>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("context.close")} onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4">
        <section className="flex items-start gap-3">
          <Avatar name={contactOf(thread)} className="size-10" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium [overflow-wrap:anywhere]">{contactOf(thread)}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="min-w-0 [overflow-wrap:anywhere] select-text">{thread.contact}</span>
              <button
                type="button"
                onClick={copy}
                aria-label={copied ? t("context.copied") : t("context.copy")}
                title={copied ? t("context.copied") : t("context.copy")}
                className="pressable grid size-5 shrink-0 place-items-center rounded-sm hover:bg-accent hover:text-foreground"
              >
                {copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
              </button>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(plural(locale, "context.messages", thread.messageCount), { count: thread.messageCount })}
            </p>
          </div>
        </section>

        <section aria-labelledby="context-history">
          <h4 id="context-history" className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t("context.history")}
          </h4>
          {search.status === "loading" ? (
            <div className="space-y-2 py-1" aria-hidden="true">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3.5 w-3/5" />
            </div>
          ) : !history.length ? (
            <p className="text-ui text-muted-foreground">{t("context.historyEmpty")}</p>
          ) : (
            <ul className="-mx-2">
              {history.map((h) => (
                <li key={h.threadId}>
                  <button
                    type="button"
                    onClick={() => onOpenThread(h.threadId)}
                    className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-ui">{h.subject.trim() || t("thread.noSubject")}</span>
                      <time className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatWhen(h.at, now, locale)}</time>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{mailboxName(h.mailbox)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="context-files">
          <h4 id="context-files" className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t("context.files")}
          </h4>
          {!files.length ? (
            <p className="text-ui text-muted-foreground">{t("context.filesEmpty")}</p>
          ) : (
            <Files files={files.map((f) => f.file)} urls={urls} stacked />
          )}
        </section>
      </div>
    </aside>
  );
}

/** File tiles: a download link each (signed, short-lived URLs from `inbox:attachments`). */
export function Files({
  files,
  urls,
  stacked = false,
  className,
}: {
  files: Attachment[];
  urls: Record<string, string | null>;
  /** One per line, full width (the context panel). */
  stacked?: boolean;
  className?: string;
}) {
  const { t, locale } = useI18n();
  return (
    <div className={className}>
      <h3 className="sr-only">{t("thread.attachments")}</h3>
      <ul className={cn("flex gap-2", stacked ? "flex-col" : "flex-wrap")}>
        {files.map((a, i) => {
          const url = urls[a.file];
          const body = (
            <>
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <FileText className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-ui font-medium", !stacked && "max-w-48")}>{a.filename}</span>
                <span className="block text-xs text-muted-foreground">{fileSize(a.size, locale) || a.contentType}</span>
              </span>
              {url && <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            </>
          );
          return (
            <li key={`${a.file}:${i}`}>
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
