// "Nova mensagem" as windows docked bottom right (up to three, each minimizable, each with its own draft), replacing
// the modal dialog: the inbox stays usable while writing. Forwarding opens one too. On phones a window fills the screen.
// Sends wait out the undo window; an undone or failed send opens its window again with everything in it.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Trash2, X } from "lucide-react";
import { useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import { api, type Mailbox, type SaveDraftArgs } from "@/lib/api";
import { htmlIsEmpty, textToHtml } from "@/lib/editorText";
import { undoSendMs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import {
  closeWindow,
  minimizeWindow,
  openComposerDialog,
  openWindow,
  useDock,
  type DockWindow,
  type Restore,
  type Seed,
} from "@/model/dock";
import { holdForSend, useAutosave } from "@/model/drafts";
import { forwardedFiles } from "@/model/forward";
import { useMeName } from "@/model/me";
import { schedule, undoSend } from "@/model/outbox";
import { chipEmail, chipOf, contactsFrom, toChips, type Contact } from "@/model/recipients";
import { useUploads } from "@/model/uploads";
import { LazyEditor, type RichEditorHandle } from "./editor/LazyEditor";
import { savedReplyHtml, useSavedReplies } from "@/model/savedReplies";
import { AttachButton, AttachmentTiles, DraftStatus, SavedRepliesButton, SignatureLine } from "./composer/parts";
import { RecipientInput } from "./composer/RecipientInput";
import { SendLaterButton } from "./composer/SendLater";
import { formatAt } from "@/lib/when";
import { isLinkRefusal, pickSendAt, sendLaterCheck } from "@/model/schedule";

export function ComposeDock({
  mailboxes,
  defaultMailbox,
  onOpenThread,
}: {
  mailboxes: Mailbox[];
  defaultMailbox: string | null;
  onOpenThread: (threadId: string) => void;
}) {
  const windows = useDock();
  const recent = useQuerySnapshot(api.inbox.recent, windows.length ? { threads: 100 } : "skip");
  const contacts = useMemo(
    () =>
      contactsFrom(
        recent.value,
        mailboxes.map((b) => b.address),
      ),
    [recent.value, mailboxes],
  );
  if (!windows.length) return null;
  return (
    // Clear of the home indicator and a landscape notch (`viewport-fit=cover`): docked and minimized windows stay
    // reachable. A phone's open window covers the screen and pads itself.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-row-reverse items-end gap-3 pr-[calc(1rem+env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pl-[calc(1rem+env(safe-area-inset-left))]">
      {windows.map((w) => (
        <ComposeWindow
          key={w.key}
          w={w}
          mailboxes={mailboxes}
          defaultMailbox={defaultMailbox}
          contacts={contacts}
          onOpenThread={onOpenThread}
        />
      ))}
    </div>
  );
}

type Fields = { mailbox: string; to: string[]; cc: string[]; subject: string; html: string; text: string };

function initial(seed: Seed, fallback: string): Fields & { draftId: string | null; signature: boolean; bcc: string[] } {
  const r = seed.restore;
  if (r)
    return {
      mailbox: r.mailbox,
      to: r.to,
      cc: r.cc,
      subject: r.subject,
      html: r.html,
      text: r.text,
      draftId: r.draftId,
      signature: r.signature,
      bcc: r.bcc,
    };
  const d = seed.draft;
  if (d)
    return {
      mailbox: d.mailbox,
      to: d.to,
      cc: d.cc,
      subject: d.subject,
      html: d.bodyHtml && !htmlIsEmpty(d.bodyHtml) ? d.bodyHtml : textToHtml(d.text),
      text: d.text,
      draftId: d._id,
      signature: true,
      bcc: d.bcc ?? [],
    };
  if (seed.kind === "forward")
    return {
      mailbox: seed.forward.mailbox,
      to: [],
      cc: [],
      subject: seed.forward.subject,
      html: `<p></p>${textToHtml(seed.forward.text.replace(/^\n+/, ""))}`,
      text: seed.forward.text,
      draftId: null,
      signature: true,
      bcc: [],
    };
  return { mailbox: seed.mailbox ?? fallback, to: [], cc: [], subject: "", html: "", text: "", draftId: null, signature: true, bcc: [] };
}

function ComposeWindow({
  w,
  mailboxes,
  defaultMailbox,
  contacts,
  onOpenThread,
}: {
  w: DockWindow;
  mailboxes: Mailbox[];
  defaultMailbox: string | null;
  contacts: readonly Contact[];
  onOpenThread: (threadId: string) => void;
}) {
  const { t, locale } = useI18n();
  const ids = { from: useId(), to: useId(), cc: useId(), bcc: useId(), subject: useId(), error: useId() };
  const cancelScheduled = useMutation(api.inbox.cancelScheduled);
  const fwd = w.seed.kind === "forward" ? w.seed.forward : null;
  // A forward reopened from ⌘K (a saved draft) does not know the original's files: read them from the conversation.
  const fwdThread = useQuerySnapshot(api.inbox.thread, fwd && !fwd.files.length && fwd.threadId ? { threadId: fwd.threadId } : "skip");
  const fwdFiles = useMemo(() => {
    if (!fwd) return [];
    if (fwd.files.length) return fwd.files;
    const m = fwdThread.value?.messages.find((x) => x._id === fwd.messageId);
    return m ? forwardedFiles(m.attachments).map((a) => a.filename) : [];
  }, [fwd, fwdThread.value]);
  // The original's files count toward what a scheduled send takes (unknown size: the server decides).
  const fwdSizes = useMemo((): Array<number | undefined> => {
    if (!fwd) return [];
    if (fwd.sizes) return fwd.sizes;
    const m = fwdThread.value?.messages.find((x) => x._id === fwd.messageId);
    return m ? forwardedFiles(m.attachments).map((a) => a.size) : fwd.files.map(() => undefined);
  }, [fwd, fwdThread.value]);
  const [start] = useState(() => initial(w.seed, defaultMailbox ?? mailboxes[0]?.name ?? ""));
  const [fields, setFields] = useState<Fields>(start);
  const [empty, setEmpty] = useState(htmlIsEmpty(start.html));
  const [showCc, setShowCc] = useState(start.cc.length > 0);
  const [bcc, setBcc] = useState<string[]>(start.bcc);
  const [showBcc, setShowBcc] = useState(start.bcc.length > 0);
  const [signature, setSignature] = useState(start.signature);
  const [error, setError] = useState<{ message: string; field: "to" | "text" | null } | null>(null);
  const editor = useRef<RichEditorHandle>(null);
  const uploads = useUploads();
  const autosave = useAutosave(start.draftId);
  const armed = useRef(false);
  const sending = useRef(false);
  const deleteDraft = useMutation(api.inbox.deleteDraft);
  const compose = useMutation(api.inbox.compose);
  const forward = useMutation(api.inbox.forward);
  const me = useMeName();
  const box = mailboxes.find((b) => b.name === fields.mailbox);
  const saved = useSavedReplies(fields.mailbox || null, { caixa: box?.displayName ?? fields.mailbox, agente: me });

  // Files of a restored draft or send come back once.
  const restoredFiles = useRef(false);
  useEffect(() => {
    if (restoredFiles.current) return;
    restoredFiles.current = true;
    const files = w.seed.restore?.attachments ?? w.seed.draft?.attachments ?? [];
    if (files.length) uploads.restore(files);
  }, [w.seed, uploads]);

  const set = (patch: Partial<Fields>) => {
    armed.current = true;
    setFields((f) => ({ ...f, ...patch }));
  };

  // Autosave, a second after the last change; a window with nothing in it holds no draft.
  const ready = uploads.ready;
  useEffect(() => {
    if (!armed.current) return;
    const blank =
      empty && !fields.to.length && !fields.cc.length && (!fields.subject.trim() || fields.subject === fwd?.subject) && !ready.length;
    if (blank) return autosave.update(null);
    const common = {
      to: fields.to,
      cc: fields.cc,
      bcc,
      subject: fields.subject,
      text: fields.text,
      bodyHtml: fields.html,
      ...(ready.length ? { attachments: ready } : {}),
    };
    const args: SaveDraftArgs = fwd
      ? { kind: "forward", threadId: fwd.threadId, messageId: fwd.messageId, ...common }
      : { kind: "compose", mailbox: fields.mailbox, ...common };
    autosave.update(args);
  }, [fields, empty, bcc, ready, fwd, autosave]);

  const addFiles = (files: File[]) => {
    armed.current = true;
    uploads.add(files, (name) => t("composer.tooLarge", { name }), t("composer.tooMany"));
  };

  // What is still typed in each recipients row (not a chip yet): a send takes it along, as leaving the field would.
  const pending = useRef({ to: "", cc: "", bcc: "" });
  const withPending = (chips: string[], typed: string) => {
    const have = new Set(chips.map(chipEmail));
    const more = toChips(typed)
      .map((c) => c.value)
      .filter((v) => !have.has(chipEmail(v)) && (have.add(chipEmail(v)), true));
    return more.length ? [...chips, ...more] : chips;
  };

  const laterCheck = sendLaterCheck([...uploads.items.filter((x) => x.status !== "failed").map((x) => x.size), ...fwdSizes]);

  /** `at`: a scheduled send (no undo window: it waits on the server; Desfazer in the toast cancels it there). */
  const send = (at?: number) => {
    const toList = withPending(fields.to, pending.current.to);
    const ccList = withPending(fields.cc, pending.current.cc);
    const bccList = withPending(bcc, pending.current.bcc);
    // Each chip is one recipient already (joining and splitting again would cut a name with a comma).
    const to = toList.map(chipOf);
    const cc = ccList.map(chipOf);
    const blind = bccList.map(chipOf);
    const bad = [...to, ...cc, ...blind].filter((c) => !c.valid).map((c) => c.value);
    if (bad.length) return setError({ message: t("compose.invalidList", { list: bad.join(", ") }), field: "to" });
    if (!to.length) return setError({ message: t("compose.invalidTo"), field: "to" });
    if (empty || !fields.text.trim()) return setError({ message: t("compose.empty"), field: "text" });
    if (uploads.busy) return setError({ message: t("composer.waitUploads"), field: null });
    if (at !== undefined && !laterCheck.ok) return setError({ message: t("schedule.blocked"), field: null });
    // Once per window: a second click or ⌘Enter before the window goes would schedule the same message again. (An
    // undone or failed send comes back in a new window, with its own.)
    if (sending.current) return;
    sending.current = true;
    setError(null);
    const files = ready;
    // The draft the send consumes: the one known now, or the one a save already on its way creates. Held (⌘K does not
    // offer it) until the send is confirmed, undone or fails.
    const hold = holdForSend(autosave.id(), autosave.forget());
    const draft = hold.draft;
    // An undone or failed send comes back in a window, even with three open (else its text would be lost). A
    // canceled scheduled send consumed its draft (`consumed`): it comes back without one.
    const reopen = (consumed = false) =>
      void draft.then((known) => {
        const draftId = consumed ? null : known;
        hold.release();
        const restore: Restore = {
          mailbox: fields.mailbox,
          to: toList,
          cc: ccList,
          bcc: bccList,
          subject: fields.subject,
          html: fields.html,
          text: fields.text,
          attachments: files,
          signature,
          draftId,
          ...(fwd ? { forward: fwd } : {}),
        };
        openWindow(fwd ? { kind: "forward", forward: fwd, restore } : { kind: "compose", restore }, { always: true });
      });
    closeWindow(w.key);
    const extras = {
      ...(ccList.length ? { cc: ccList } : {}),
      ...(bccList.length ? { bcc: bccList } : {}),
      ...(at !== undefined ? { sendAt: at } : {}),
      subject: fields.subject.trim(),
      text: fields.text,
      bodyHtml: fields.html,
      signature,
      ...(files.length ? { attachments: files } : {}),
    };
    const run = () =>
      void draft
        .then((draftId) =>
          fwd
            ? forward({ threadId: fwd.threadId, messageId: fwd.messageId, to: toList, ...extras, ...(draftId ? { draftId } : {}) })
            : compose({ mailbox: fields.mailbox, to: toList, ...extras, ...(draftId ? { draftId } : {}) }),
        )
        .then((r) => {
          // Confirmed: the server deleted the draft with the send, so the hold goes.
          hold.release();
          if (at === undefined)
            return void toast.success(fwd ? t("forward.sent") : t("compose.sent"), {
              action: { label: `#${r.number}`, onClick: () => onOpenThread(r.threadId) },
            });
          toast.success(t("schedule.done", { when: formatAt(at, Date.now(), locale) }), {
            action: {
              label: t("common.undo"),
              onClick: () =>
                void cancelScheduled({ emailId: r.emailId })
                  .then((c) => {
                    if (!c.ok) return void toast(t("schedule.gone"));
                    reopen(true);
                    toast(t("schedule.editing"));
                  })
                  .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e))),
            },
          });
        })
        .catch((e: unknown) => {
          reopen();
          toast.error(
            isLinkRefusal(e) ? t("schedule.blocked") : t("thread.failed", { message: e instanceof Error ? e.message : String(e) }),
          );
        });
    if (at !== undefined) return run();
    const delay = undoSendMs();
    const id = schedule({ threadId: null, kind: fwd ? "forward" : "compose", text: fields.text }, delay, run, () => {
      reopen();
      toast(t("send.undone"));
    });
    if (id)
      toast(t("send.scheduled", { seconds: delay / 1000 }), {
        id,
        duration: delay,
        action: { label: t("common.undo"), onClick: () => undoSend(id) },
      });
  };

  const discard = () => {
    // Also the draft a save already on its way creates.
    void autosave.forget().then((id) => {
      if (id) void deleteDraft({ id }).catch(() => {});
    });
    closeWindow(w.key);
    toast(t("compose.discarded"));
  };

  // Esc in the window minimizes it. A field's own Esc comes first: this listener is native, so it runs before the
  // field's React handler; a recipient field with its suggestions open keeps the key (it closes them), and a key the
  // editor took is `defaultPrevented`. Menus the window opens are portaled outside it and close themselves.
  const section = useRef<HTMLElement>(null);
  const minimized = w.minimized;
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('[role="combobox"][aria-expanded="true"]')) return;
      e.stopPropagation();
      minimizeWindow(w.key, true);
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [w.key, minimized]);

  const title = fields.subject.trim() || (fwd ? t("forward.title") : t("compose.title"));
  if (w.minimized)
    return (
      <section
        data-compose-window
        aria-label={title}
        className="pointer-events-auto flex h-10 w-64 max-w-[calc(100vw-2rem)] items-center gap-1 rounded-t-lg border border-b-0 bg-popover pl-3 shadow-overlay"
      >
        <button
          type="button"
          onClick={() => minimizeWindow(w.key, false)}
          className="min-w-0 flex-1 truncate text-left text-ui font-medium"
        >
          {title}
        </button>
        <WindowButton label={t("compose.restore")} onClick={() => minimizeWindow(w.key, false)}>
          <Maximize2 />
        </WindowButton>
        <WindowButton label={t("compose.close")} onClick={() => closeWindow(w.key)}>
          <X />
        </WindowButton>
      </section>
    );

  return (
    <section
      ref={section}
      data-compose-window
      aria-label={title}
      aria-describedby={error ? ids.error : undefined}
      className={cn(
        "pointer-events-auto flex h-[min(36rem,calc(100dvh-3rem))] w-[34rem] max-w-full min-w-0 shrink flex-col rounded-t-lg border border-b-0 bg-popover text-popover-foreground shadow-overlay",
        "animate-in duration-(--motion-modal) ease-out fade-in slide-in-from-bottom-2",
        "max-sm:fixed max-sm:inset-0 max-sm:h-dvh max-sm:w-full max-sm:rounded-none max-sm:border-0",
      )}
    >
      <header className="flex h-10 shrink-0 items-center gap-1 border-b pr-1 pl-3 max-sm:pt-[env(safe-area-inset-top)]">
        <h2 className="min-w-0 flex-1 truncate text-ui font-medium">{title}</h2>
        <WindowButton label={t("compose.minimize")} onClick={() => minimizeWindow(w.key, true)}>
          <Minus />
        </WindowButton>
        <WindowButton label={t("compose.close")} onClick={() => closeWindow(w.key)}>
          <X />
        </WindowButton>
      </header>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="divide-y border-b px-3">
          <Row label={t("compose.from")} htmlFor={ids.from}>
            <select
              id={ids.from}
              value={fields.mailbox}
              // A forward goes from the thread's own mailbox.
              disabled={!!fwd}
              onChange={(e) => set({ mailbox: e.target.value })}
              className="h-9 w-full min-w-0 truncate bg-transparent text-sm outline-none disabled:opacity-70"
            >
              {mailboxes.map((b) => (
                <option key={b.name} value={b.name}>
                  {(b.displayName ?? b.name) + " <" + b.address + ">"}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("compose.to")} htmlFor={ids.to}>
            <RecipientInput
              id={ids.to}
              label={t("compose.to")}
              value={fields.to}
              onChange={(to) => set({ to })}
              onPending={(v) => void (pending.current.to = v)}
              contacts={contacts}
              invalid={error?.field === "to"}
              focusOnMount={!start.to.length}
              trailing={
                (!showCc || !showBcc) && (
                  <span className="flex shrink-0">
                    {!showCc && (
                      <button
                        type="button"
                        onClick={() => setShowCc(true)}
                        className="h-7 px-1.5 text-ui text-muted-foreground hover:text-foreground"
                      >
                        {t("compose.cc")}
                      </button>
                    )}
                    {!showBcc && (
                      <button
                        type="button"
                        onClick={() => setShowBcc(true)}
                        title={t("composer.bccHint")}
                        aria-label={t("composer.bccAdd")}
                        className="h-7 px-1.5 text-ui text-muted-foreground hover:text-foreground"
                      >
                        {t("compose.bcc")}
                      </button>
                    )}
                  </span>
                )
              }
            />
          </Row>
          {showCc && (
            <Row label={t("compose.cc")} htmlFor={ids.cc}>
              <RecipientInput
                id={ids.cc}
                label={t("compose.cc")}
                value={fields.cc}
                onChange={(cc) => set({ cc })}
                onPending={(v) => void (pending.current.cc = v)}
                contacts={contacts}
              />
            </Row>
          )}
          {showBcc && (
            <Row label={t("compose.bcc")} htmlFor={ids.bcc}>
              <RecipientInput
                id={ids.bcc}
                label={t("compose.bcc")}
                value={bcc}
                onChange={(next) => {
                  armed.current = true;
                  setBcc(next);
                }}
                onPending={(v) => void (pending.current.bcc = v)}
                contacts={contacts}
                invalid={error?.field === "to" && bcc.some((x) => !chipOf(x).valid)}
                focusOnMount={!bcc.length}
              />
            </Row>
          )}
          <Row label={t("compose.subject")} htmlFor={ids.subject}>
            <Input
              id={ids.subject}
              value={fields.subject}
              onChange={(e) => set({ subject: e.target.value })}
              className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </Row>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LazyEditor
            handle={editor}
            // The body as it is now: the editor is built again when a minimized window comes back.
            initialHtml={fields.html}
            label={t("compose.body")}
            placeholder={t("compose.body")}
            onChange={(v) => {
              armed.current = true;
              setEmpty(v.empty);
              setFields((f) => ({ ...f, html: v.html, text: v.text }));
            }}
            onSubmit={() => send()}
            onSubmitLater={() =>
              pickSendAt(
                laterCheck,
                (at) => send(at),
                () => setError({ message: t("schedule.blocked"), field: null }),
              )
            }
            onFiles={addFiles}
            slash={saved.slash}
            onManageSlash={fields.mailbox ? () => openComposerDialog({ kind: "saved", mailbox: fields.mailbox }) : undefined}
            className="min-h-40"
          />
          {fwdFiles.length > 0 && (
            <p className="px-3.5 pb-2 text-xs text-muted-foreground">{t("forward.files", { list: fwdFiles.join(", ") })}</p>
          )}
          <AttachmentTiles
            items={uploads.items}
            onRemove={(id) => {
              armed.current = true;
              uploads.remove(id);
            }}
            className="px-3 pb-2"
          />
          {fields.mailbox && <SignatureLine mailbox={fields.mailbox} on={signature} onToggle={setSignature} className="pb-3" />}
        </div>
        {error && (
          <p id={ids.error} role="alert" className="px-3.5 pb-1 text-ui text-destructive">
            {error.message}
          </p>
        )}
        <footer className="flex items-center gap-1 border-t px-2 py-2 max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <span className="flex">
            <Button type="submit" size="sm" disabled={uploads.busy} className="rounded-r-none">
              {t("compose.send")}
            </Button>
            <SendLaterButton check={laterCheck} disabled={uploads.busy} onPick={(at) => send(at)} />
          </span>
          {autosave.failed ? (
            <DraftStatus failed onRetry={autosave.retry} />
          ) : (
            <span className="hidden px-1.5 text-xs text-muted-foreground sm:inline">{t("thread.sendHint")}</span>
          )}
          <span className="flex-1" />
          {fields.mailbox && (
            <SavedRepliesButton
              mailbox={fields.mailbox}
              replies={saved.replies}
              onPick={(r) => editor.current?.insertHtml(savedReplyHtml(r, { caixa: box?.displayName ?? fields.mailbox, agente: me }))}
            />
          )}
          <AttachButton onFiles={addFiles} />
          <WindowButton label={t("compose.discard")} onClick={discard}>
            <Trash2 />
          </WindowButton>
        </footer>
      </form>
    </section>
  );
}

function Row({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={htmlFor} className="w-14 shrink-0 text-ui text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function WindowButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
