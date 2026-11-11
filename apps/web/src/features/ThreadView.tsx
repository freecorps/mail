// The open conversation: a header with status and assignee as menus and previous/next, the messages as one column
// of email "paper" separated by hairlines (older ones collapsed to a line, the latest open, quoted text behind
// "•••"), internal notes as tinted blocks, the composer under them, and the context panel (`i`) at the side.
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  AlarmClock,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  CircleDot,
  Clock,
  CornerUpRight,
  Ellipsis,
  Forward,
  Mail,
  MailOpen,
  PanelRight,
  ShieldAlert,
  StickyNote,
  Tags,
  Trash2,
  UserRound,
} from "lucide-react";
import { useMutation } from "@freecorps/ember-react";
import { snippetWithoutQuote, splitQuotedHtml, splitQuotedText } from "@freecorps/mail-email-html/quote";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { Kbd } from "@/components/Kbd";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import { plural } from "@/i18n/strings";
import { api, type Message, type ThreadStatus } from "@/lib/api";
import { onContextToggle, useEscapeCloses } from "@/lib/contextPanel";
import { linkifyText } from "@/lib/emailHtml";
import { contactOf, displayAddress, formatFull, formatWhen, quoteHeader } from "@/lib/format";
import { openWindow } from "@/model/dock";
import { undoSend, useScheduled, type Scheduled } from "@/model/outbox";
import { useNow } from "@/lib/now";
import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { useThreadActions } from "@/model/actions";
import { forwardedFiles, forwardSubject, forwardText, replyAllCc } from "@/model/forward";
import { deliveryState, foldMessages, useThread, type DeliveryState, type MessageItem } from "@/model/thread";
import { isPersonal, useMailboxes } from "@/model/threads";
import { AssignItems } from "./AssignMenu";
import { Composer, type ComposerHandle } from "./Composer";
import { ContextPanel, Files } from "./ContextPanel";
import { EmailFrame } from "./EmailFrame";
import { Confirm } from "./admin/parts";
import { SnoozeItems } from "./SnoozeMenu";
import { TagMenu } from "./TagMenu";
import { ActivityLine, PresenceBadge, ScheduledBar, SnoozedBanner } from "./ThreadState";
import { TagChip } from "@/components/TagChip";
import { textToHtml } from "@/lib/editorText";
import { placeEntries, useActivity } from "@/model/activity";
import { useOwnPresence, usePresence } from "@/model/presence";
import { isScheduled } from "@/model/schedule";
import { useSnooze } from "@/model/snooze";
import { threadTags, useTagActions, useTagIndex } from "@/model/tags";
import type { ActivityEntry, Address } from "@/lib/api";

/** Width of the conversation pane from which the context panel sits beside the messages (else it covers them). */
const SIDE_PANEL_MIN = 760;

export function ThreadView({
  threadId,
  onBack,
  onPrev,
  onNext,
  showBack = false,
  composerRef,
  onOpenThread,
  admin = false,
}: {
  threadId: string;
  onBack: () => void;
  /** The neighbors in the list (undefined at either end, or when the thread is not in the list). */
  onPrev?: () => void;
  onNext?: () => void;
  /** The back button also shows on wide windows (the conversation covers the list: full and focus modes). */
  showBack?: boolean;
  /** The signed-in member is an admin: they may delete a shared mailbox's conversation. */
  admin?: boolean;
  composerRef: RefObject<ComposerHandle | null>;
  /** Opens another thread (a forwarded message's new conversation, an earlier conversation of the contact). */
  onOpenThread?: (threadId: string) => void;
}) {
  const { t, locale } = useI18n();
  const vm = useThread(threadId);
  const tagIndex = useTagIndex();
  const tagActions = useTagActions();
  const snoozer = useSnooze();
  const activity = useActivity(threadId, vm.thread !== null);
  const others_ = usePresence(threadId);
  const [replying, setReplying] = useState(false);
  useOwnPresence(threadId, replying, vm.thread !== null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const cancelM = useMutation(api.inbox.cancelScheduled);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const after = useMemo(
    () =>
      placeEntries(
        vm.items.map((i) => i.message),
        activity.entries ?? [],
      ),
    [vm.items, activity.entries],
  );
  const actions = useThreadActions();
  const scheduled = useScheduled(threadId);
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

  // The context panel: beside the messages where the pane has room (remembered), over them where it has not (asked
  // for each time). `i` and the header button flip whichever applies.
  const prefs = usePrefs();
  const loaded = vm.thread !== null;
  const pane = useRef<HTMLDivElement>(null);
  // Null until the pane is measured (the skeleton and "not found" have none): no panel shows and `i` does nothing, so
  // it never flips the remembered side panel on a pane that may turn out narrow.
  const [roomy, setRoomy] = useState<boolean | null>(null);
  const [overlay, setOverlay] = useState(false);
  // Measured before the first paint (a layout effect), so a narrow pane never shows the side panel for a frame.
  useLayoutEffect(() => {
    const el = pane.current;
    if (!el) {
      setRoomy(null);
      return;
    }
    setRoomy(el.clientWidth >= SIDE_PANEL_MIN);
    const ro = new ResizeObserver(() => setRoomy(el.clientWidth >= SIDE_PANEL_MIN));
    ro.observe(el);
    return () => ro.disconnect();
    // The pane exists once the thread has loaded (the skeleton has none).
  }, [loaded]);
  // The overlay is for a narrow pane only: widening past the side column closes it, so narrowing again does not bring
  // it back on its own.
  useEffect(() => {
    if (roomy) setOverlay(false);
  }, [roomy]);
  const contextShown = roomy === null ? false : roomy ? prefs.contextPanel : overlay;
  const { contextPanel, setContextPanel } = prefs;
  const toggleContext = useCallback(() => {
    if (roomy === null) return;
    if (roomy) setContextPanel(!contextPanel);
    else setOverlay((o) => !o);
  }, [roomy, contextPanel, setContextPanel]);
  useEffect(() => (roomy === null ? undefined : onContextToggle(toggleContext)), [roomy, toggleContext]);
  // Over the messages, the panel is the top layer: Escape hides it before it closes the conversation.
  useEscapeCloses(roomy === false && overlay, toggleContext);

  /** Cancels a scheduled send; with `edit`, its content goes back into a composer (the reply box, or a window). */
  const cancelSend = (m: Message, edit: boolean) => {
    const emailId = m.emailId;
    if (!emailId || busyEmail) return;
    setBusyEmail(emailId);
    const chip = (a: Address) => (a.name ? `${a.name} <${a.email}>` : a.email);
    const files = m.attachments.map((a) => ({ file: a.file, filename: a.filename, contentType: a.contentType }));
    const html = m.html ?? textToHtml(m.text);
    cancelM({ emailId })
      .then((r) => {
        if (!r.ok) return void toast(t("schedule.gone"));
        if (r.threadDeleted && edit) {
          // A new conversation canceled before it went is gone: it comes back as a "Nova mensagem" window.
          openWindow(
            {
              kind: "compose",
              restore: {
                mailbox: m.mailbox,
                to: m.to.map(chip),
                cc: m.cc.map(chip),
                bcc: (m.bcc ?? []).map(chip),
                subject: m.subject,
                html,
                text: m.text,
                attachments: files,
                signature: true,
                draftId: null,
              },
            },
            { always: true },
          );
        } else if (edit) {
          composerRef.current?.load({ html, cc: m.cc.map(chip), bcc: (m.bcc ?? []).map(chip), attachments: files });
        }
        toast(edit ? t("schedule.editing") : t("schedule.canceled"));
        if (r.threadDeleted) onBack();
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusyEmail(null));
  };

  const forward = (m: Message) => {
    const opened = openWindow({
      kind: "forward",
      forward: {
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
        sizes: forwardedFiles(m.attachments).map((a) => a.size),
      },
    });
    if (!opened) toast(t("compose.tooMany"));
  };

  // Opens at the top of the latest message (a long email starts where it starts), and keeps it there while frames
  // above load and grow, until the reader scrolls. After that, new messages follow only while the reader is at the
  // bottom; the reader's own reply or note (pending) always scrolls into view.
  const scroller = useRef<HTMLOListElement>(null);
  const anchored = useRef(true);
  const stick = useRef(false);
  // The reader opened something (a message, the older ones, a quote): the pane stays where they are, neither on the
  // latest message nor at the bottom (what they opened would scroll away). Reaching the bottom again sticks again.
  const readerGrows = () => {
    anchored.current = false;
    stick.current = false;
  };
  // Which messages are open: the latest by default, any the reader toggled, and the one that was latest before the
  // reader's own reply arrived (so answering does not fold what they were answering).
  const count = vm.items.length;
  const lastId = vm.items.at(-1)?.message._id ?? null;
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [prevLast, setPrevLast] = useState(lastId);
  if (prevLast !== lastId) {
    setPrevLast(lastId);
    // Only for the reader's own reply (pending): mail that arrives while reading folds the previous one as usual.
    if (prevLast && !toggled.has(prevLast) && vm.items.at(-1)?.pending) setToggled(new Map(toggled).set(prevLast, true));
  }
  const isOpen = (id: string) => toggled.get(id) ?? id === lastId;
  const toggle = (id: string) => {
    readerGrows();
    setToggled((m) => new Map(m).set(id, !isOpen(id)));
  };
  const [showAll, setShowAll] = useState(false);
  const folds = foldMessages(count, showAll);

  const ownNew = vm.items.at(-1)?.pending === true;
  // The pending reply that already pulled the pane down: re-runs for other reasons (unfolding the older messages while
  // it is still sending, or queued offline) leave the reader where they are.
  const stuckFor = useRef<string | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !count) return;
    if (ownNew && stuckFor.current !== lastId) {
      stuckFor.current = lastId;
      anchored.current = false;
      stick.current = true;
    }
    const place = () => {
      if (anchored.current) {
        const last = el.lastElementChild as HTMLElement | null;
        if (last) el.scrollTop = Math.max(0, last.offsetTop - 8);
      } else if (stick.current) el.scrollTop = el.scrollHeight;
    };
    place();
    const ro = new ResizeObserver(place);
    for (const li of el.children) ro.observe(li);
    return () => ro.disconnect();
  }, [count, ownNew, showAll, lastId]);
  // Any scrolling by the reader (wheel, touch, the scrollbar, keys) ends the anchoring.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const release = () => {
      anchored.current = false;
    };
    const kinds = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const k of kinds) el.addEventListener(k, release, { passive: true });
    return () => {
      for (const k of kinds) el.removeEventListener(k, release);
    };
  }, [loaded]);

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
        <div className="space-y-3 border-b px-4 py-4 sm:px-6" aria-busy="true">
          <Skeleton className="h-6 w-2/3" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
        </div>
        <div className="space-y-3 px-4 py-5 sm:px-6" aria-hidden="true">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      </Pane>
    );
  }

  const th = vm.thread;
  // Ember quotes the latest message received; its attribution line is written here, in the UI language.
  const lastInbound = vm.items.findLast((i) => i.message.direction === "inbound")?.message ?? null;
  const archived = th.status === "closed";
  const unread = th.unreadCount > 0;
  const target = [{ threadId, status: th.status, unread }];
  const tags = threadTags(th.tags, tagIndex);
  const snoozedUntil = th.snoozed ? (th.snoozedUntil ?? null) : null;
  const snoozeTarget = [{ threadId, ...(snoozedUntil ? { snoozedUntil } : {}) }];
  return (
    <Pane onBack={onBack} showBack={showBack}>
      <div ref={pane} className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b px-4 pt-3 pb-3 sm:px-6">
            <div className="flex items-start gap-3">
              <h2 className="min-w-0 flex-1 pt-0.5 text-base font-semibold text-balance [overflow-wrap:anywhere] sm:text-lg">
                {th.subject.trim() || t("thread.noSubject")}
              </h2>
              <div className="-mr-1.5 flex shrink-0 items-center">
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("snooze.action")}
                          aria-keyshortcuts="h"
                          className={cn("text-muted-foreground hover:text-foreground", snoozedUntil && "text-foreground")}
                        >
                          <AlarmClock />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent className="flex items-center gap-2">
                      {t("snooze.action")}
                      <Kbd className="border-background/20 bg-background/15 text-background">h</Kbd>
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="w-64">
                    <SnoozeItems
                      targets={snoozeTarget}
                      onResume={snoozedUntil ? () => snoozer.unsnooze(threadId, snoozedUntil) : undefined}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
                <TagMenu targets={[{ threadId, mailbox: th.mailbox, tags: th.tags ?? [] }]} open={tagsOpen} onOpenChange={setTagsOpen}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("tags.button")}
                    aria-keyshortcuts="l"
                    title={t("tags.button")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Tags />
                  </Button>
                </TagMenu>
                <Action label={archived ? t("thread.unarchive") : t("thread.archive")} kbd="e" onClick={() => actions.archive(target)}>
                  {archived ? <ArchiveRestore /> : <Archive />}
                </Action>
                <Action label={unread ? t("thread.markRead") : t("thread.markUnread")} kbd="u" onClick={vm.toggleRead}>
                  {unread ? <MailOpen /> : <Mail />}
                </Action>
                {canDelete && (
                  <Action label={t("thread.delete")} onClick={() => setConfirmDelete(true)}>
                    <Trash2 />
                  </Action>
                )}
                <Action label={t("context.toggle")} kbd="i" pressed={contextShown} onClick={toggleContext}>
                  <PanelRight />
                </Action>
                {/* Phones have no j/k and little room: the subject gets it (Voltar is there). */}
                <span className="contents max-sm:hidden">
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
                  <Action label={t("thread.prev")} kbd="k" onClick={onPrev} disabled={!onPrev}>
                    <ChevronLeft />
                  </Action>
                  <Action label={t("thread.next")} kbd="j" onClick={onNext} disabled={!onNext}>
                    <ChevronRight />
                  </Action>
                </span>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
              {th.number > 0 && <span className="font-mono tabular-nums">#{th.number}</span>}
              <span className="min-w-0 truncate">{contactOf(th)}</span>
              <StatusMenu status={th.status} onPick={(s) => actions.setStatus(target, s)} />
              {!personal && (
                <AssigneeMenu mailbox={th.mailbox} assignee={th.assignee ?? null} name={th.assigneeName ?? null} onAssign={vm.assign} />
              )}
              {tags.map((x) => (
                <TagChip key={x._id} tag={x} className="h-6" onRemove={() => tagActions.toggle([{ threadId, tags: th.tags ?? [] }], x)} />
              ))}
              <span className="ml-auto flex min-w-0 items-center">
                <PresenceBadge rows={others_} />
              </span>
            </div>
          </header>
          {snoozedUntil && <SnoozedBanner until={snoozedUntil} onResume={() => snoozer.unsnooze(threadId, snoozedUntil)} />}
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

          <ReaderGrows value={readerGrows}>
            <ol
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
                // Dragging the scrollbar fires none of the input events above: a scroll away from where the anchoring
                // put it is the reader's.
                // (Compared with where the anchor is now, not where it was: the browser's own scroll anchoring may have
                // moved it while frames above grew.)
                if (anchored.current) {
                  const last = el.lastElementChild as HTMLElement | null;
                  const target = last ? Math.min(Math.max(0, last.offsetTop - 8), el.scrollHeight - el.clientHeight) : 0;
                  if (Math.abs(el.scrollTop - target) > 2) anchored.current = false;
                }
              }}
              className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4"
              aria-label={th.subject}
            >
              {folds.map((f) => {
                if (f.kind === "fold")
                  return (
                    <li key="fold" className="border-b">
                      <button
                        type="button"
                        onClick={() => {
                          readerGrows();
                          setShowAll(true);
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-ui text-muted-foreground hover:bg-accent/50 sm:px-6"
                      >
                        <span className="grid size-6 place-items-center text-muted-foreground">
                          <ChevronsUpDown className="size-4" aria-hidden="true" />
                        </span>
                        {t(plural(locale, "thread.older", f.count), { count: f.count })}
                      </button>
                    </li>
                  );
                const item = vm.items[f.index]!;
                const m = item.message;
                const open = isOpen(m._id);
                const lines: ActivityEntry[] = after[f.index] ?? [];
                return (
                  <Fragment key={m._id}>
                    <li className={cn(m.direction !== "note" && "border-b last:border-b-0")}>
                      {open ? (
                        <MessageBlock
                          item={item}
                          scheduled={
                            isScheduled(m) && !item.pending && m.emailId
                              ? { busy: busyEmail === m.emailId, onEdit: () => cancelSend(m, true), onCancel: () => cancelSend(m, false) }
                              : undefined
                          }
                          urls={vm.attachmentUrls}
                          onCollapse={m._id === lastId && count === 1 ? undefined : () => toggle(m._id)}
                          onForward={item.pending || m.direction === "note" ? undefined : () => forward(m)}
                        />
                      ) : (
                        <CollapsedMessage item={item} onExpand={() => toggle(m._id)} />
                      )}
                    </li>
                    {lines.map((e) => (
                      <li key={e._id} className="border-b">
                        <ActivityLine entry={e} inline />
                      </li>
                    ))}
                  </Fragment>
                );
              })}
              {scheduled.map((x) => (
                <li key={x.id} className="border-t">
                  <ScheduledSend item={x} />
                </li>
              ))}
            </ol>
          </ReaderGrows>

          <Composer
            key={threadId}
            ref={composerRef}
            onActivity={setReplying}
            threadId={threadId}
            mailbox={th.mailbox}
            mailboxLabel={boxes.find((b) => b.name === th.mailbox)?.displayName ?? th.mailbox}
            contact={{ name: contactOf(th), email: th.contact }}
            number={th.number}
            disabled={!vm.canReply}
            notes={!personal}
            others={others}
            quoteHeader={lastInbound ? quoteHeader(lastInbound.at, displayAddress(lastInbound.from), locale) : undefined}
          />
        </div>
        {contextShown && (
          <ContextPanel
            thread={th}
            items={vm.items}
            urls={vm.attachmentUrls}
            overlay={!roomy}
            activity={activity.entries}
            onClose={toggleContext}
            onOpenThread={(id) => onOpenThread?.(id)}
          />
        )}
      </div>
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

function Action({
  label,
  kbd,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  kbd?: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-keyshortcuts={kbd}
          aria-pressed={pressed}
          onClick={onClick}
          disabled={disabled}
          className={cn("text-muted-foreground hover:text-foreground", pressed && "bg-accent text-foreground")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        {kbd && <Kbd className="border-background/20 bg-background/15 text-background">{kbd}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

const STATUS_ICON: Record<ThreadStatus, typeof Clock> = { open: CircleDot, waiting: Clock, closed: Archive, spam: ShieldAlert };
const STATUS_TONE: Record<ThreadStatus, string> = {
  open: "text-status-open",
  waiting: "text-status-waiting",
  closed: "text-status-closed",
  spam: "text-status-spam",
};
const STATUSES: ThreadStatus[] = ["open", "waiting", "closed", "spam"];

/** The status as a small pill that opens the list of statuses. */
function StatusMenu({ status, onPick }: { status: ThreadStatus; onPick: (s: ThreadStatus) => void }) {
  const { t } = useI18n();
  const Icon = STATUS_ICON[status];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${t("thread.status")}: ${t(`status.${status}`)}`}
        className="pressable inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium text-foreground hover:bg-accent data-[state=open]:bg-accent"
      >
        <Icon className={cn("size-3.5", STATUS_TONE[status])} aria-hidden="true" />
        {t(`status.${status}`)}
        <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("thread.status")}</DropdownMenuLabel>
        {STATUSES.map((s) => {
          const I = STATUS_ICON[s];
          return (
            <DropdownMenuItem key={s} onSelect={() => s !== status && onPick(s)}>
              <I className={STATUS_TONE[s]} aria-hidden="true" />
              <span className="flex-1">{t(`status.${s}`)}</span>
              {s === status && <Check aria-label="✓" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The assignee as a pill (mini monogram and name, or "Sem responsável") that opens the members of the mailbox. */
function AssigneeMenu({
  mailbox,
  assignee,
  name,
  onAssign,
}: {
  mailbox: string;
  assignee: string | null;
  name: string | null;
  onAssign: (userId: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${t("thread.assign")}: ${name ?? t("thread.unassigned")}`}
        className="pressable inline-flex h-6 max-w-48 min-w-0 items-center gap-1.5 rounded-full border pr-2 pl-1 text-xs font-medium text-foreground hover:bg-accent data-[state=open]:bg-accent"
      >
        {name ? (
          <Avatar name={name} className="size-4" />
        ) : (
          <UserRound className="ml-0.5 size-3.5 text-muted-foreground" aria-hidden="true" />
        )}
        <span className={cn("truncate", !name && "text-muted-foreground")}>{name ?? t("thread.unassigned")}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <AssignItems mailboxes={[mailbox]} current={assignee} onAssign={onAssign} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Who wrote a message, as the conversation names them: the member for a reply, the sender for mail received. */
function authorOf(m: Message): string {
  return m.direction !== "inbound" && m.author ? m.author : displayAddress(m.from);
}

/** An older message as one line: who, a preview, when. Opens on click. */
function CollapsedMessage({ item, onExpand }: { item: MessageItem; onExpand: () => void }) {
  const { t, locale } = useI18n();
  const now = useNow();
  const m = item.message;
  const note = m.direction === "note";
  const name = authorOf(m);
  return (
    <button
      type="button"
      aria-expanded={false}
      aria-label={`${t("thread.expand")}: ${name}`}
      onClick={onExpand}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-(--motion-hover) hover:bg-accent/50 sm:px-6",
        note && "my-1 rounded-lg bg-note/60 text-note-foreground hover:bg-note sm:mx-0",
      )}
    >
      {note ? <StickyNote className="size-4 shrink-0" aria-hidden="true" /> : <Avatar name={name} className="size-6" />}
      <span className="flex w-28 min-w-0 shrink-0 items-center gap-1 truncate text-ui font-medium sm:w-36">
        <span className="truncate">{note ? t("thread.note") : name}</span>
        {m.direction === "outbound" && <CornerUpRight className="size-3 shrink-0 text-primary" aria-label={t("thread.sentBy")} />}
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-ui", note ? "opacity-80" : "text-muted-foreground")}>
        {snippetWithoutQuote(m.snippet || m.text)}
      </span>
      <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={new Date(m.at).toISOString()}>
        {item.pending ? t("thread.sending") : formatWhen(m.at, now, locale)}
      </time>
    </button>
  );
}

/** One open message: the header row, then the body as the sender wrote it (HTML on white paper, or text). */
function MessageBlock({
  item,
  scheduled,
  urls,
  onCollapse,
  onForward,
}: {
  item: MessageItem;
  /** A scheduled send still waiting: its bar (Editar, Cancelar envio) replaces the delivery marker. */
  scheduled?: { busy: boolean; onEdit: () => void; onCancel: () => void };
  urls: Record<string, string | null>;
  onCollapse?: () => void;
  onForward?: () => void;
}) {
  const { t, locale } = useI18n();
  const m = item.message;
  const name = authorOf(m);
  const files = m.attachments.filter((a) => !(a.inline && a.contentId && item.cid[a.contentId.replace(/^<|>$/g, "")]));

  if (m.direction === "note") {
    const noteHead = (
      <>
        <StickyNote className="size-3.5" aria-hidden="true" />
        <span className="font-medium">{t("thread.note")}</span>
        {m.author && <span className="min-w-0 truncate">{m.author}</span>}
        <span className="ml-auto shrink-0 opacity-80">{item.pending ? t("thread.sending") : formatFull(m.at, locale)}</span>
      </>
    );
    return (
      <article className="mx-4 my-3 rounded-lg bg-note px-4 py-3 text-note-foreground sm:mx-6" aria-label={t("thread.note")}>
        {onCollapse ? (
          <button
            type="button"
            aria-expanded={true}
            aria-label={`${t("thread.collapse")}: ${t("thread.note")}`}
            onClick={onCollapse}
            className="-m-1 mb-0.5 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-md p-1 text-left text-xs"
          >
            {noteHead}
          </button>
        ) : (
          <header className="mb-1.5 flex items-center gap-2 text-xs">{noteHead}</header>
        )}
        <MessageText text={m.text} />
      </article>
    );
  }

  const outbound = m.direction === "outbound";
  const head = (
    <>
      <Avatar name={name} className="size-8" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="truncate font-medium">{name}</span>
          {outbound && (
            <span className="inline-flex shrink-0 self-center text-primary" title={t("thread.sentBy")}>
              <CornerUpRight className="size-3.5" aria-hidden="true" />
              <span className="sr-only">{t("thread.sentBy")}</span>
            </span>
          )}
          <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{outbound ? m.fromEmail : m.from.email}</span>
        </span>
        {m.to.length > 0 && (
          <span className="block truncate text-xs text-muted-foreground">
            {t("thread.to", { to: m.to.map(displayAddress).join(", ") })}
          </span>
        )}
        {!!m.bcc?.length && (
          <span className="block truncate text-xs text-muted-foreground">
            {t("schedule.noBcc", { list: m.bcc.map(displayAddress).join(", ") })}
          </span>
        )}
      </span>
    </>
  );
  return (
    <article className={cn("px-4 pt-3.5 pb-4 sm:px-6", item.pending && "opacity-75")}>
      <header className="flex items-start gap-3">
        {onCollapse ? (
          <button
            type="button"
            aria-expanded={true}
            aria-label={`${t("thread.collapse")}: ${name}`}
            onClick={onCollapse}
            className="-m-1 flex min-w-0 flex-1 items-start gap-3 rounded-md p-1 text-left"
          >
            {head}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-3">{head}</div>
        )}
        <div className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
          <time className="text-xs text-muted-foreground tabular-nums" dateTime={new Date(m.at).toISOString()}>
            {item.pending ? t("thread.sending") : formatFull(m.at, locale)}
          </time>
          {!item.pending && !isScheduled(m) && <DeliveryMarker message={m} />}
        </div>
        {onForward && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="-mt-1 -mr-2 text-muted-foreground"
                aria-label={t("thread.forward")}
                onClick={onForward}
              >
                <Forward aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("thread.forward")}</TooltipContent>
          </Tooltip>
        )}
      </header>
      <div className="mt-3">
        {isScheduled(m) && (
          <ScheduledBar
            at={m.scheduledFor}
            busy={!scheduled || scheduled.busy}
            onEdit={scheduled?.onEdit ?? (() => {})}
            onCancel={scheduled?.onCancel ?? (() => {})}
          />
        )}
        {m.html && !item.pending ? (
          <HtmlBody html={m.html} cid={item.cid} title={t("thread.messageFrame", { from: name })} />
        ) : (
          <MessageText text={m.text} />
        )}
        {files.length > 0 && <Files files={files} urls={urls} className="mt-3" />}
      </div>
    </article>
  );
}

/** Tells the conversation the reader opened something inside a message (a quote): see `readerGrows`. */
const ReaderGrowsContext = createContext<() => void>(() => {});
const ReaderGrows = ReaderGrowsContext.Provider;

/** A send waiting out its undo window: what goes, when, and "Desfazer" (it never reached the server). */
function ScheduledSend({ item }: { item: Scheduled }) {
  const { t } = useI18n();
  const now = useNow(1000);
  const left = Math.max(0, Math.ceil((item.sendAt - now) / 1000));
  const note = item.kind === "note";
  return (
    <article className={cn("px-4 py-3.5 sm:px-6", note && "mx-4 my-3 rounded-lg bg-note px-4 text-note-foreground sm:mx-6")}>
      <header className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="size-3.5" aria-hidden="true" />
        <span className="tabular-nums" aria-live="polite">
          {t("send.scheduledShort", { seconds: left })}
        </span>
        <Button variant="outline" size="xs" className="ml-auto" onClick={() => undoSend(item.id)}>
          {t("common.undo")}
        </Button>
      </header>
      <p className="line-clamp-3 text-sm whitespace-pre-wrap opacity-70 [overflow-wrap:anywhere]">{item.text}</p>
    </article>
  );
}

/** "•••": shows or hides the quoted part of a message. */
function QuoteToggle({ open, onToggle: flip }: { open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const grows = useContext(ReaderGrowsContext);
  const onToggle = () => {
    grows();
    flip();
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? t("thread.hideQuote") : t("thread.showQuote")}
          onClick={onToggle}
          className="pressable my-2 inline-flex h-5 items-center rounded-full bg-muted px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Ellipsis className="size-4" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{open ? t("thread.hideQuote") : t("thread.showQuote")}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Like plain text: the body's frame stays as it is (no reload, same height, same scroll) and the quote opens in a
 * frame of its own under "•••", so the toggle stays where it was clicked. Loading images loads them in both.
 */
function HtmlBody({ html, cid, title }: { html: string; cid: Record<string, string>; title: string }) {
  const { t } = useI18n();
  const split = useMemo(() => splitQuotedHtml(html), [html]);
  const [quote, setQuote] = useState(false);
  const [load, setLoad] = useState(false);
  const images = useMemo(() => ({ load, onLoad: () => setLoad(true) }), [load]);
  if (!split) return <EmailFrame html={html} cid={cid} title={title} images={images} />;
  return (
    <>
      <EmailFrame html={split.body} cid={cid} title={title} images={images} />
      <QuoteToggle open={quote} onToggle={() => setQuote((q) => !q)} />
      {quote && <EmailFrame html={split.quote} cid={cid} title={`${title}: ${t("thread.quoted")}`} images={images} />}
    </>
  );
}

function MessageText({ text }: { text: string }) {
  const split = useMemo(() => splitQuotedText(text), [text]);
  const [quote, setQuote] = useState(false);
  if (!split) return <PlainText text={text} />;
  return (
    <>
      <PlainText text={split.body} />
      <QuoteToggle open={quote} onToggle={() => setQuote((q) => !q)} />
      {quote && <PlainText text={split.quote} className="text-muted-foreground" />}
    </>
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

function PlainText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap", className)}>
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

export type { Message };
