// Reply / internal note under the conversation (notes only in a shared mailbox: in a personal one nobody else reads
// them). A rich editor (lazy), files by drop, paste or the clip, the signature with a switch per message, saved
// replies on "/" or the button. The draft lives on the server (autosaved, restored on open). Sending waits out the
// undo window (Ajustes), then runs optimistically: the message shows with "Enviando…"; on failure it comes back.
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Send, StickyNote } from "lucide-react";
import { useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { toast } from "sonner";
import { Kbd } from "@/components/Kbd";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/context";
import { api, type AttachmentArg, type SaveDraftArgs } from "@/lib/api";
import { htmlIsEmpty, textToHtml } from "@/lib/editorText";
import { undoSendMs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { openComposerDialog } from "@/model/dock";
import { useAutosave } from "@/model/drafts";
import { schedule, undoSend } from "@/model/outbox";
import { composerMode } from "@/model/threads";
import { filesOf, useUploads } from "@/model/uploads";
import { useMeName } from "@/model/me";
import { LazyEditor, type RichEditorHandle } from "./editor/LazyEditor";
import { savedReplyHtml, useSavedReplies } from "@/model/savedReplies";
import { AttachButton, AttachmentTiles, SavedRepliesButton, SignatureLine } from "./composer/parts";

export type ComposerMode = "reply" | "note";
export interface ComposerHandle {
  focus: (mode: ComposerMode) => void;
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
}) {
  const { t } = useI18n();
  const reply = useMutation(api.inbox.reply);
  const note = useMutation(api.inbox.note);
  const [picked, setMode] = useState<ComposerMode>("reply");
  const mode = composerMode(picked, p.notes);
  const editor = useRef<RichEditorHandle>(null);
  const [body, setBody] = useState<Body>(EMPTY);
  const [all, setAll] = useState(false);
  const [signature, setSignature] = useState(true);
  const [dragging, setDragging] = useState(false);
  const others = p.others ?? [];
  const uploads = useUploads();
  const autosave = useAutosave();
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

  useImperativeHandle(ref, () => ({
    focus(m) {
      setMode(m);
      editor.current?.focus();
    },
  }));

  const kind = useRef<ComposerMode>("reply");
  // The member's draft on this conversation comes back once, when the composer opens.
  const drafts = useQuerySnapshot(api.inbox.drafts, { threadId: p.threadId });
  const restored = useRef(false);
  // Autosave starts with the first edit (or the restored draft landing in the editor, which it does not re-save):
  // until then an empty box says nothing about the draft on the server.
  const armed = useRef(false);
  const restoring = useRef(false);
  const skipOnce = useRef(false);
  useEffect(() => {
    if (restored.current || drafts.status !== "success" || !drafts.value) return;
    restored.current = true;
    const d = drafts.value.find((x) => x.kind === "reply") ?? (p.notes === false ? undefined : drafts.value.find((x) => x.kind === "note"));
    if (!d) return;
    autosave.adopt(d._id);
    kind.current = d.kind === "note" ? "note" : "reply";
    if (d.kind === "note") setMode("note");
    if (d.cc.length) setAll(true);
    uploads.restore(d.attachments);
    restoring.current = true;
    editor.current?.setContent(d.bodyHtml && !htmlIsEmpty(d.bodyHtml) ? d.bodyHtml : textToHtml(d.text));
  }, [drafts.status, drafts.value, autosave, uploads, p.notes]);

  // Autosave: what the box holds now, a second after the last change (an empty box removes the draft).
  const ready = uploads.ready;
  useEffect(() => {
    if (!armed.current) return;
    if (skipOnce.current) {
      skipOnce.current = false;
      return;
    }
    const empty = body.empty && !ready.length;
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
            ...(ready.length ? { attachments: ready } : {}),
          };
    autosave.update(args);
    // `others` is derived from the thread; a change of it alone is not an edit.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [body, ready, all, mode, p.threadId, autosave]);

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

  const canSend = !body.empty && !uploads.busy;
  const send = () => {
    if (body.empty) return;
    if (uploads.busy) return void toast(t("composer.waitUploads"));
    const m = mode;
    const { html, text } = body;
    const files: AttachmentArg[] = m === "reply" ? ready : [];
    const cc = m === "reply" && all && others.length ? others : undefined;
    const draftId = autosave.id() ?? undefined;
    const sig = signature;
    autosave.forget();
    editor.current?.clear();
    uploads.clear();
    const restore = () => {
      if (!mounted.current) return; // the draft is still on the server: it comes back when the conversation opens
      setMode(m);
      setSignature(sig);
      uploads.restore(files);
      if (draftId) autosave.adopt(draftId);
      editor.current?.setContent(html);
    };
    const run = () =>
      void (
        m === "reply"
          ? reply({
              threadId: p.threadId,
              text,
              bodyHtml: html,
              signature: sig,
              ...(cc ? { cc } : {}),
              ...(files.length ? { attachments: files } : {}),
              ...(p.quoteHeader ? { quoteHeader: p.quoteHeader } : {}),
              ...(draftId ? { draftId } : {}),
            })
          : note({ threadId: p.threadId, text, ...(draftId ? { draftId } : {}) })
      )
        .then(() => toast.success(m === "reply" ? t("thread.sent") : t("thread.noteSaved")))
        .catch((e: unknown) => {
          restore();
          toast.error(t("thread.failed", { message: e instanceof Error ? e.message : String(e) }));
        });
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
  return (
    <form
      className="border-t bg-background px-4 pt-3 pb-4 sm:px-6"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
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
          label={isNote ? t("thread.note") : t("thread.replyMode")}
          placeholder={isNote ? t("thread.notePlaceholder") : t("thread.replyPlaceholder", { name: p.contact.name })}
          onChange={(v) => {
            if (restoring.current) {
              restoring.current = false;
              skipOnce.current = true;
            }
            armed.current = true;
            setBody(v);
          }}
          onSubmit={send}
          onFiles={addFiles}
          slash={saved.slash}
          onManageSlash={() => openComposerDialog({ kind: "saved", mailbox: p.mailbox })}
          className="max-h-72 overflow-y-auto"
        />
        {dragging && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-lg bg-background/80 text-ui font-medium text-primary">
            {t("composer.drop")}
          </div>
        )}
        <AttachmentTiles
          items={uploads.items}
          onRemove={(id) => {
            armed.current = true;
            uploads.remove(id);
          }}
          className="px-3 pb-2"
        />
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
            <span className="hidden text-xs text-muted-foreground sm:inline">{t("thread.sendHint")}</span>
            <Button type="submit" size="sm" disabled={!canSend}>
              {isNote ? t("thread.addNote") : t("thread.send")}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
