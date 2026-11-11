// Reply / internal note under the conversation (notes only in a shared mailbox: in a personal one nobody else reads
// them). A rich editor (lazy), files by drop, paste or the clip, the signature with a switch per message, saved
// replies on "/" or the button. The draft lives on the server (autosaved, restored on open). Sending waits out the
// undo window (Ajustes), then runs optimistically: the message shows with "Enviando…"; on failure it comes back.
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Send, StickyNote } from "lucide-react";
import { useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { toast } from "sonner";
import { Kbd } from "@/components/Kbd";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/context";
import { api, type AttachmentArg, type SaveDraftArgs } from "@/lib/api";
import { keepUndone, restoreSend, subscribeUndone, takeUndone, type UndoneSend } from "@/model/undone";
import { htmlIsEmpty, textToHtml } from "@/lib/editorText";
import { undoSendMs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { openComposerDialog } from "@/model/dock";
import { holdForSend, useAutosave, useHeldDrafts } from "@/model/drafts";
import { schedule, undoSend } from "@/model/outbox";
import { composerMode } from "@/model/threads";
import { filesOf, useUploads } from "@/model/uploads";
import { useMeName } from "@/model/me";
import { LazyEditor, type RichEditorHandle } from "./editor/LazyEditor";
import { savedReplyHtml, useSavedReplies } from "@/model/savedReplies";
import { AttachButton, AttachmentTiles, DraftStatus, SavedRepliesButton, SignatureLine } from "./composer/parts";
import { RecipientInput } from "./composer/RecipientInput";
import { SendLaterButton } from "./composer/SendLater";
import { contactsFrom, invalidChips } from "@/model/recipients";
import { isLinkRefusal, pickSendAt, sendLaterCheck } from "@/model/schedule";
import { formatAt } from "@/lib/when";

export type ComposerMode = "reply" | "note";
export interface ComposerHandle {
  focus: (mode: ComposerMode) => void;
  /** A canceled scheduled reply back in the box ("Editar"): its body, copies and files, as a reply. */
  load: (c: { html: string; cc: string[]; bcc: string[]; attachments: AttachmentArg[] }) => void;
}

type Body = { html: string; text: string; empty: boolean };
const EMPTY: Body = { html: "", text: "", empty: true };

export function Composer({
  ref,
  ...p
}: {
  ref?: Ref<ComposerHandle>;
  threadId: string;
  mailbox: string;
  mailboxLabel: string;
  contact: { name: string; email: string };
  number: number;
  disabled: boolean;
  /** Everyone else on the latest message received: "Reply all" copies them (shown only when there is someone). */
  others?: string[];
  /** A personal mailbox: replies only, no internal notes. */
  notes?: boolean;
  /** The localized attribution line over the quoted message ("Em 5 de nov. de 2026 às 10:12, Marina escreveu:"). */
  quoteHeader?: string;
  /** The member is writing here (focus inside the box, or something in it): presence says "respondendo". */
  onActivity?: (replying: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const cancelScheduled = useMutation(api.inbox.cancelScheduled);
  const reply = useMutation(api.inbox.reply);
  const note = useMutation(api.inbox.note);
  const saveDraft = useMutation(api.inbox.saveDraft);
  const [picked, setMode] = useState<ComposerMode>("reply");
  const mode = composerMode(picked, p.notes);
  const editor = useRef<RichEditorHandle>(null);
  const [body, setBody] = useState<Body>(EMPTY);
  const bodyNow = useRef(body);
  useEffect(() => {
    bodyNow.current = body;
  });
  const [all, setAll] = useState(false);
  // Blind copies of a reply (never the conversation's contact: Ember drops those), shown with "Cco".
  const [bcc, setBcc] = useState<string[]>([]);
  const [showBcc, setShowBcc] = useState(false);
  // Cco addresses that are not a recipient: named under the field (which is marked invalid), and nothing is sent.
  const [bccError, setBccError] = useState<string | null>(null);
  const recent = useQuerySnapshot(api.inbox.recent, showBcc ? { threads: 100 } : "skip");
  const contacts = useMemo(() => contactsFrom(recent.value, [p.mailbox]), [recent.value, p.mailbox]);
  const [focused, setFocused] = useState(false);
  // Focus anywhere in the box (editor, Cco, buttons) counts as replying, for presence.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const inn = () => setFocused(true);
    const out = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) setFocused(false);
    };
    el.addEventListener("focusin", inn);
    el.addEventListener("focusout", out);
    return () => {
      el.removeEventListener("focusin", inn);
      el.removeEventListener("focusout", out);
    };
  }, [p.disabled]);
  const [signature, setSignature] = useState(true);
  const [dragging, setDragging] = useState(false);
  const others = p.others ?? [];
  const uploads = useUploads();
  const filesNow = useRef(0);
  useEffect(() => {
    filesNow.current = uploads.items.length;
  });
  const autosave = useAutosave();
  // A send leaves once: set before anything waits, so a second click or ⌘Enter while the box is being cleared does not
  // schedule the same message again. New content in the box (typed, or a send coming back) frees it.
  const sending = useRef(false);
  const me = useMeName();
  const saved = useSavedReplies(p.mailbox, {
    nome: p.contact.name,
    email: p.contact.email,
    caixa: p.mailboxLabel,
    agente: me,
    numero: p.number || null,
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Whether the box can take an undone send back in place (mounted, and not turned off for spam).
  const disabledNow = useRef(p.disabled);
  disabledNow.current = p.disabled;

  useImperativeHandle(ref, () => ({
    focus(m) {
      setMode(m);
      editor.current?.focus();
    },
    load(c) {
      armed.current = true;
      sending.current = false;
      setMode("reply");
      setAll(c.cc.length > 0);
      setBcc(c.bcc);
      setShowBcc(c.bcc.length > 0);
      uploads.restore(c.attachments);
      editor.current?.setContent(c.html);
      editor.current?.focus();
    },
  }));

  const kind = useRef<ComposerMode>("reply");
  // The member's draft on this conversation comes back once, when the composer opens.
  const drafts = useQuerySnapshot(api.inbox.drafts, { threadId: p.threadId });
  // A draft a send still holds (opened again during its undo window) is not this box's: it waits until the send is
  // undone or fails (then it comes back here), or goes with it.
  const held = useHeldDrafts();
  const heldHere = !!drafts.value?.some((x) => held.has(x._id));
  const restored = useRef(false);
  // Autosave starts with the first edit (or the restored draft landing in the editor, which it does not re-save):
  // until then an empty box says nothing about the draft on the server.
  const armed = useRef(false);
  const restoring = useRef(false);
  const skipOnce = useRef(false);
  // An undone (or failed) send that came back while this conversation's box was gone or off: it wins over the draft
  // on the server (whose write-back may still be on its way), once the box can show it. Taken when the box opens or
  // turns back on, and whenever one is kept for this conversation while the box is open (an undo that settled after
  // the box came back): the order of the two never matters.
  const takeKept = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    takeKept.current = () => {
      const u = takeUndone(p.threadId);
      if (u) putBack(u);
    };
  });
  useEffect(() => {
    if (p.disabled) return;
    takeKept.current();
    return subscribeUndone((threadId) => {
      if (threadId === p.threadId) takeKept.current();
    });
  }, [p.disabled, p.threadId]);
  const putBack = (u: UndoneSend) => {
    restored.current = true;
    autosave.cancel();
    kind.current = u.mode;
    setMode(u.mode);
    setAll(u.all);
    setSignature(u.signature);
    setBcc(u.bcc ?? []);
    setShowBcc(!!u.bcc?.length);
    if (u.mode === "reply") uploads.restore(u.files);
    if (editor.current) {
      restoring.current = true;
      editor.current.setContent(u.html);
    } else setBody({ html: u.html, text: u.text, empty: !u.text.trim() });
  };
  useEffect(() => {
    if (restored.current) return;
    // Turned off (spam): the box has no editor to take the draft; it is restored when the box turns back on.
    if (p.disabled) return;
    // The drafts cannot be read: nothing to restore, and the box saves as usual.
    if (drafts.status === "error") restored.current = true;
    if (drafts.status !== "success" || !drafts.value) return;
    const d = drafts.value.find((x) => x.kind === "reply") ?? (p.notes === false ? undefined : drafts.value.find((x) => x.kind === "note"));
    if (d && held.has(d._id)) return;
    restored.current = true;
    if (!d) return;
    // Released while the member already put something new here (text or files): that stays (and replaces the draft).
    if (armed.current && (!bodyNow.current.empty || filesNow.current > 0)) return;
    // Whatever the box queued before the draft landed (an empty box asking to delete) is older than the draft.
    autosave.cancel();
    autosave.adopt(d._id);
    // The draft decides the mode (a toggle before it landed would otherwise move it to the other kind, deleting it).
    kind.current = d.kind === "note" ? "note" : "reply";
    setMode(kind.current);
    if (d.cc.length) setAll(true);
    if (d.bcc?.length) {
      setBcc(d.bcc);
      setShowBcc(true);
    }
    uploads.restore(d.attachments);
    const html = d.bodyHtml && !htmlIsEmpty(d.bodyHtml) ? d.bodyHtml : textToHtml(d.text);
    // The editor loads lazily: not there yet, it starts from the body (its initial HTML) instead.
    if (editor.current) {
      restoring.current = true;
      editor.current.setContent(html);
    } else setBody({ html, text: d.text, empty: !d.text.trim() });
  }, [drafts.status, drafts.value, held, autosave, uploads, p.notes, p.disabled]);

  // Autosave: what the box holds now, a second after the last change (an empty box removes the draft).
  const ready = uploads.ready;
  useEffect(() => {
    if (!armed.current) return;
    // Nothing is saved before the draft on the server has been looked at, nor while it is still landing in the editor
    // (the editor loads lazily): the box looks empty then, and an empty box asks to delete the draft.
    if (!restored.current || restoring.current) return;
    // A save now would replace the draft a send holds (one reply and one note draft per conversation): wait for it.
    if (heldHere) return;
    if (skipOnce.current) {
      skipOnce.current = false;
      return;
    }
    // A note carries no files: the reply's leftover ones do not make an empty note box worth a draft.
    const empty = body.empty && (mode === "note" || !ready.length);
    if (kind.current !== mode) {
      // Switching between reply and note moves the draft to the other kind.
      kind.current = mode;
      autosave.update(null);
      autosave.flush();
    }
    if (empty) return autosave.update(null);
    const args: SaveDraftArgs =
      mode === "note"
        ? { kind: "note", threadId: p.threadId, text: body.text }
        : {
            kind: "reply",
            threadId: p.threadId,
            text: body.text,
            bodyHtml: body.html,
            ...(all && others.length ? { cc: others } : {}),
            ...(bcc.length ? { bcc } : {}),
            ...(ready.length ? { attachments: ready } : {}),
          };
    autosave.update(args);
    // `others` is derived from the thread; a change of it alone is not an edit.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [body, ready, all, bcc, mode, p.threadId, autosave, heldHere]);

  const addFiles = (files: File[]) => {
    if (mode === "note") return toast(t("composer.noAttachInNote"));
    armed.current = true;
    uploads.add(files, (name) => t("composer.tooLarge", { name }), t("composer.tooMany"));
  };

  // Files dragged over the box: a quiet outline says where they go.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let depth = 0;
    const has = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const enter = (e: DragEvent) => {
      if (!has(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (has(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      const files = filesOf(e.dataTransfer);
      // The editor takes drops inside its text itself; this catches the rest of the box.
      if (files.length && !e.defaultPrevented) {
        e.preventDefault();
        addFilesRef.current(files);
      }
    };
    el.addEventListener("dragenter", enter);
    el.addEventListener("dragleave", leave);
    el.addEventListener("dragover", over);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragenter", enter);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("dragover", over);
      el.removeEventListener("drop", drop);
    };
  }, [p.disabled]);
  const addFilesRef = useRef(addFiles);
  useEffect(() => {
    addFilesRef.current = addFiles;
  });

  if (p.disabled) return <p className="border-t px-6 py-4 text-sm text-muted-foreground">{t("thread.spamNoReply")}</p>;

  // Files whose size is known (fresh uploads; a restored draft's are not): "Enviar mais tarde" is blocked past 10 MB.
  const laterCheck = sendLaterCheck(uploads.items.filter((x) => x.status !== "failed").map((x) => x.size));

  // A note takes no files: uploads still running from the reply never hold it back.
  const waitingFiles = mode === "reply" && uploads.busy;
  const canSend = !body.empty && !waitingFiles;
  /** `at`: a scheduled send (no undo window: it waits on the server, where "Cancelar envio" takes it back). */
  const send = (at?: number) => {
    if (body.empty || sending.current) return;
    if (at !== undefined && mode !== "reply") return;
    if (waitingFiles) return void toast(t("composer.waitUploads"));
    // Cco is checked as the compose windows check theirs (each chip one recipient): a bad one stays, named, and
    // nothing leaves.
    const badBcc = mode === "reply" ? invalidChips(bcc) : [];
    if (badBcc.length) {
      setShowBcc(true);
      return setBccError(t("compose.invalidList", { list: badBcc.join(", ") }));
    }
    setBccError(null);
    sending.current = true;
    const m = mode;
    const { html, text } = body;
    const files: AttachmentArg[] = m === "reply" ? ready : [];
    const cc = m === "reply" && all && others.length ? others : undefined;
    const blind = m === "reply" && bcc.length ? bcc : undefined;
    const sig = signature;
    // The draft the send consumes: the one known now, or the one a save already on its way creates (else it would
    // outlive the send). Held until the send is confirmed, undone or fails.
    const hold = holdForSend(autosave.id(), autosave.forget());
    const draft = hold.draft;
    editor.current?.clear();
    // A note takes no files: the reply's uploads (ready or still going) and its Cco stay for the reply. A reply takes
    // them along: the next message starts without them (an undo or a failure puts them back).
    if (m === "reply") {
      uploads.clear();
      setBcc([]);
      setShowBcc(false);
    }
    // What was sent, as its draft: an undo or a failure after this composer is gone writes it back, so the text
    // comes back when the conversation opens again (the pending save was dropped by the send, and the server draft
    // may predate the last keystrokes).
    const snapshot: SaveDraftArgs =
      m === "note"
        ? { kind: "note", threadId: p.threadId, text }
        : {
            kind: "reply",
            threadId: p.threadId,
            text,
            bodyHtml: html,
            ...(cc ? { cc } : {}),
            ...(blind ? { bcc: blind } : {}),
            ...(files.length ? { attachments: files } : {}),
          };
    // `adopt`: the draft is still on the server (an undone or failed send); a canceled scheduled send consumed it, so
    // the box starts a new one (and a write-back creates one).
    const restore = (adopt = true) =>
      restoreSend({
        draft: draft.then((id) => (adopt ? id : null)),
        // Decided again when the draft is known: the box may go (another conversation, spam) while it is on its way.
        here: () => mounted.current && !disabledNow.current,
        showHere: () => {
          sending.current = false;
          setMode(m);
          setAll(!!cc);
          setSignature(sig);
          if (blind) {
            setBcc(blind);
            setShowBcc(true);
          }
          // A note had no files: the reply's uploads, left alone by the send, stay as they are (restore replaces the
          // list).
          if (m === "reply") uploads.restore(files);
          editor.current?.setContent(html);
        },
        // The box is gone or off: what was sent waits in memory for it (read on its next mount or when it turns back
        // on), and is written back as the draft for a later visit (or another device).
        keep: () => keepUndone(p.threadId, { mode: m, html, text, all: !!cc, signature: sig, files, bcc: blind ?? [] }),
        adopt: (id) => autosave.adopt(id),
        writeBack: (id) => saveDraft({ ...snapshot, ...(id ? { id } : {}) }),
        release: () => hold.release(),
      });
    const quoteHeader = p.quoteHeader;
    const run = () =>
      void draft
        .then((draftId): Promise<unknown> =>
          m === "reply"
            ? reply({
                threadId: p.threadId,
                text,
                bodyHtml: html,
                signature: sig,
                ...(cc ? { cc } : {}),
                ...(blind ? { bcc: blind } : {}),
                ...(files.length ? { attachments: files } : {}),
                ...(quoteHeader ? { quoteHeader } : {}),
                ...(draftId ? { draftId } : {}),
                ...(at !== undefined ? { sendAt: at } : {}),
              })
            : note({ threadId: p.threadId, text, ...(draftId ? { draftId } : {}) }),
        )
        .then((r) => {
          // Confirmed: the server deleted the draft with the send, so the hold goes.
          hold.release();
          if (at === undefined) return void toast.success(m === "reply" ? t("thread.sent") : t("thread.noteSaved"));
          // Scheduled: Desfazer cancels it on the server and puts it back here.
          const emailId = (r as { emailId?: string } | undefined)?.emailId;
          toast.success(t("schedule.done", { when: formatAt(at, Date.now(), locale) }), {
            ...(emailId
              ? {
                  action: {
                    label: t("common.undo"),
                    onClick: () =>
                      void cancelScheduled({ emailId })
                        .then((c) => {
                          if (!c.ok) return void toast(t("schedule.gone"));
                          // As an undone send: back in this box, or (the box gone or off) kept for it and written
                          // back as a new draft (the scheduled send consumed the old one).
                          restore(false);
                          toast(t("schedule.editing"));
                        })
                        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e))),
                  },
                }
              : {}),
          });
        })
        .catch((e: unknown) => {
          restore();
          toast.error(
            isLinkRefusal(e) ? t("schedule.blocked") : t("thread.failed", { message: e instanceof Error ? e.message : String(e) }),
          );
        });
    if (at !== undefined) return run();
    const delay = undoSendMs();
    const id = schedule({ threadId: p.threadId, kind: m, text }, delay, run, () => {
      restore();
      toast(t("send.undone"));
    });
    if (id)
      toast(t("send.scheduled", { seconds: delay / 1000 }), {
        id,
        duration: delay,
        action: { label: t("common.undo"), onClick: () => undoSend(id) },
      });
  };

  const isNote = mode === "note";
  const later = () =>
    !isNote &&
    !body.empty &&
    pickSendAt(
      laterCheck,
      (at) => send(at),
      () => toast(t("schedule.blocked")),
    );
  return (
    <form
      className="border-t bg-background px-4 pt-3 pb-4 sm:px-6"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      ref={formRef}
    >
      <ReportActivity on={!isNote && (focused || !body.empty)} report={p.onActivity} />
      <div
        ref={box}
        className={cn(
          "relative rounded-lg border bg-card shadow-xs transition-colors duration-150 focus-within:border-ring/60 focus-within:ring-[3px] focus-within:ring-ring/15",
          isNote && "border-note-border bg-note",
          dragging && "border-primary ring-[3px] ring-primary/20",
        )}
      >
        <LazyEditor
          handle={editor}
          // Remounted (the thread left spam, a lazy load): it starts from what was written, not blank.
          initialHtml={body.html}
          label={isNote ? t("thread.note") : t("thread.replyMode")}
          placeholder={isNote ? t("thread.notePlaceholder") : t("thread.replyPlaceholder", { name: p.contact.name })}
          onChange={(v) => {
            if (restoring.current) {
              restoring.current = false;
              skipOnce.current = true;
            }
            armed.current = true;
            if (!v.empty) sending.current = false;
            setBody(v);
          }}
          onSubmit={() => send()}
          onSubmitLater={isNote ? undefined : later}
          // A note takes no files: the editor then handles a paste as usual (its text, its image) instead of taking it.
          onFiles={isNote ? undefined : addFiles}
          slash={saved.slash}
          onManageSlash={() => openComposerDialog({ kind: "saved", mailbox: p.mailbox })}
          className="max-h-72 overflow-y-auto"
        />
        {dragging && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-lg bg-background/80 text-ui font-medium text-primary">
            {t("composer.drop")}
          </div>
        )}
        {/* A note takes no files: the reply's tiles hide (they stay for the reply, if the mode switches back). */}
        {!isNote && (
          <AttachmentTiles
            items={uploads.items}
            onRemove={(id) => {
              armed.current = true;
              uploads.remove(id);
            }}
            className="px-3 pb-2"
          />
        )}
        {!isNote && showBcc && (
          <div className="flex min-w-0 items-center gap-2 border-t px-3 py-1" title={t("composer.bccHint")}>
            <label htmlFor={`bcc-${p.threadId}`} className="w-8 shrink-0 text-ui text-muted-foreground">
              {t("composer.bcc")}
            </label>
            <RecipientInput
              id={`bcc-${p.threadId}`}
              label={t("composer.bcc")}
              value={bcc}
              onChange={(next) => {
                armed.current = true;
                setBccError(null);
                setBcc(next);
              }}
              contacts={contacts}
              invalid={!!bccError}
              focusOnMount={!bcc.length}
            />
          </div>
        )}
        {!isNote && bccError && (
          <p role="alert" className="px-3.5 pb-1 text-ui text-destructive">
            {bccError}
          </p>
        )}
        {!isNote && <SignatureLine mailbox={p.mailbox} on={signature} onToggle={setSignature} className="pb-2" />}
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-1">
            {p.notes !== false && (
              <ToggleGroup
                type="single"
                size="sm"
                value={mode}
                onValueChange={(v) => {
                  if (!v) return;
                  armed.current = true;
                  setMode(v as ComposerMode);
                }}
                aria-label={t("thread.replyMode")}
              >
                <ToggleGroupItem value="reply" className="gap-1.5 px-2.5 text-xs">
                  <Send className="size-3.5" aria-hidden="true" />
                  {t("thread.replyMode")}
                  <Kbd className="ml-0.5 h-4 min-w-4">r</Kbd>
                </ToggleGroupItem>
                <ToggleGroupItem value="note" className="gap-1.5 px-2.5 text-xs">
                  <StickyNote className="size-3.5" aria-hidden="true" />
                  {t("thread.noteMode")}
                  <Kbd className="ml-0.5 h-4 min-w-4">n</Kbd>
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            <SavedRepliesButton
              mailbox={p.mailbox}
              replies={saved.replies}
              onPick={(r) =>
                editor.current?.insertHtml(
                  savedReplyHtml(r, {
                    nome: p.contact.name,
                    email: p.contact.email,
                    caixa: p.mailboxLabel,
                    agente: me,
                    numero: p.number || null,
                  }),
                )
              }
            />
            <AttachButton onFiles={addFiles} disabled={isNote} />
          </div>
          <div className="flex items-center gap-3">
            {!isNote && !showBcc && (
              <button
                type="button"
                onClick={() => setShowBcc(true)}
                title={t("composer.bccHint")}
                aria-label={t("composer.bccAdd")}
                className="h-6 rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {t("composer.bcc")}
              </button>
            )}
            {!isNote && others.length > 0 && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
                title={t("thread.replyAllHint", { list: others.join(", ") })}
              >
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={all}
                  onChange={(e) => {
                    armed.current = true;
                    setAll(e.target.checked);
                  }}
                />
                {t("thread.replyAll")}
              </label>
            )}
            {autosave.failed ? (
              <DraftStatus failed onRetry={autosave.retry} />
            ) : (
              <span className="hidden text-xs text-muted-foreground sm:inline">{t("thread.sendHint")}</span>
            )}
            {isNote ? (
              <Button type="submit" size="sm" disabled={!canSend}>
                {t("thread.addNote")}
              </Button>
            ) : (
              <span className="flex">
                <Button type="submit" size="sm" disabled={!canSend} className="rounded-r-none">
                  {t("thread.send")}
                </Button>
                <SendLaterButton check={laterCheck} disabled={!canSend} onPick={(at) => send(at)} />
              </span>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

/** Tells the conversation whether the member is replying (for presence), only when it changes. */
function ReportActivity({ on, report }: { on: boolean; report?: (replying: boolean) => void }) {
  useEffect(() => {
    report?.(on);
  }, [on, report]);
  useEffect(() => () => report?.(false), [report]);
  return null;
}
