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
import { useAutosave } from "@/model/drafts";
import { useMeName } from "@/model/me";
import { schedule, undoSend } from "@/model/outbox";
import { contactsFrom, toChips, type Contact } from "@/model/recipients";
import { useUploads } from "@/model/uploads";
import { LazyEditor, type RichEditorHandle } from "./editor/LazyEditor";
import { savedReplyHtml, useSavedReplies } from "@/model/savedReplies";
import { AttachButton, AttachmentTiles, SavedRepliesButton, SignatureLine } from "./composer/parts";
import { RecipientInput } from "./composer/RecipientInput";

/**
 * Cco waits for Ember to take `bcc` on sends (drafts already store it). Flip this, pass `bcc` in `send()` and the
 * field below shows; nothing else changes.
 */
const BCC_ENABLED = false;

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
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-row-reverse items-end gap-3 px-4">
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

function initial(seed: Seed, fallback: string): Fields & { draftId: string | null; signature: boolean } {
  const r = seed.restore;
  if (r)
    return {
      mailbox: r.mailbox,
      to: r.to,
      cc: r.cc,
      subject: r.subject,
      html: r.html,
      text: "",
      draftId: r.draftId,
      signature: r.signature,
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
    };
  return { mailbox: seed.mailbox ?? fallback, to: [], cc: [], subject: "", html: "", text: "", draftId: null, signature: true };
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
  const { t } = useI18n();
  const ids = { from: useId(), to: useId(), cc: useId(), bcc: useId(), subject: useId(), error: useId() };
  const fwd = w.seed.kind === "forward" ? w.seed.forward : null;
  const [start] = useState(() => initial(w.seed, defaultMailbox ?? mailboxes[0]?.name ?? ""));
  const [fields, setFields] = useState<Fields>(start);
  const [empty, setEmpty] = useState(htmlIsEmpty(start.html));
  const [showCc, setShowCc] = useState(start.cc.length > 0);
  const [bcc, setBcc] = useState<string[]>([]);
  const [signature, setSignature] = useState(start.signature);
  const [error, setError] = useState<{ message: string; field: "to" | "text" | null } | null>(null);
  const editor = useRef<RichEditorHandle>(null);
  const uploads = useUploads();
  const autosave = useAutosave(start.draftId);
  const armed = useRef(false);
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

  const send = () => {
    const to = toChips(fields.to.join(","));
    const cc = toChips(fields.cc.join(","));
    const bad = [...to, ...cc].filter((c) => !c.valid).map((c) => c.value);
    if (bad.length) return setError({ message: t("compose.invalidList", { list: bad.join(", ") }), field: "to" });
    if (!to.length) return setError({ message: t("compose.invalidTo"), field: "to" });
    if (empty || !fields.text.trim()) return setError({ message: t("compose.empty"), field: "text" });
    if (uploads.busy) return setError({ message: t("composer.waitUploads"), field: null });
    setError(null);
    const files = ready;
    const draftId = autosave.id();
    const restore: Restore = {
      mailbox: fields.mailbox,
      to: fields.to,
      cc: fields.cc,
      subject: fields.subject,
      html: fields.html,
      attachments: files,
      signature,
      draftId,
      ...(fwd ? { forward: fwd } : {}),
    };
    const reopen = () => openWindow(fwd ? { kind: "forward", forward: fwd, restore } : { kind: "compose", restore });
    autosave.forget();
    closeWindow(w.key);
    const extras = {
      ...(fields.cc.length ? { cc: fields.cc } : {}),
      subject: fields.subject.trim(),
      text: fields.text,
      bodyHtml: fields.html,
      signature,
      ...(files.length ? { attachments: files } : {}),
      ...(draftId ? { draftId } : {}),
    };
    const run = () =>
      void (
        fwd
          ? forward({ threadId: fwd.threadId, messageId: fwd.messageId, to: fields.to, ...extras })
          : compose({ mailbox: fields.mailbox, to: fields.to, ...extras })
      )
        .then((r) =>
          toast.success(fwd ? t("forward.sent") : t("compose.sent"), {
            action: { label: `#${r.number}`, onClick: () => onOpenThread(r.threadId) },
          }),
        )
        .catch((e: unknown) => {
          reopen();
          toast.error(t("thread.failed", { message: e instanceof Error ? e.message : String(e) }));
        });
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
    const id = autosave.id();
    autosave.forget();
    closeWindow(w.key);
    if (id) void deleteDraft({ id }).catch(() => {});
    toast(t("compose.discarded"));
  };

  // Esc in the window minimizes it (a field's own Esc, such as closing suggestions, comes first).
  const section = useRef<HTMLElement>(null);
  const minimized = w.minimized;
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
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
              contacts={contacts}
              invalid={error?.field === "to"}
              focusOnMount={!start.to.length}
              trailing={
                !showCc && (
                  <button
                    type="button"
                    onClick={() => setShowCc(true)}
                    className="h-7 shrink-0 px-1.5 text-ui text-muted-foreground hover:text-foreground"
                  >
                    {t("compose.cc")}
                  </button>
                )
              }
            />
          </Row>
          {showCc && (
            <Row label={t("compose.cc")} htmlFor={ids.cc}>
              <RecipientInput id={ids.cc} label={t("compose.cc")} value={fields.cc} onChange={(cc) => set({ cc })} contacts={contacts} />
            </Row>
          )}
          {BCC_ENABLED && (
            <Row label={t("compose.bcc")} htmlFor={ids.bcc}>
              <RecipientInput id={ids.bcc} label={t("compose.bcc")} value={bcc} onChange={setBcc} contacts={contacts} />
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
            initialHtml={start.html}
            label={t("compose.body")}
            placeholder={t("compose.body")}
            onChange={(v) => {
              armed.current = true;
              setEmpty(v.empty);
              setFields((f) => ({ ...f, html: v.html, text: v.text }));
            }}
            onSubmit={send}
            onFiles={addFiles}
            slash={saved.slash}
            onManageSlash={fields.mailbox ? () => openComposerDialog({ kind: "saved", mailbox: fields.mailbox }) : undefined}
            className="min-h-40"
          />
          {fwd && fwd.files.length > 0 && (
            <p className="px-3.5 pb-2 text-xs text-muted-foreground">{t("forward.files", { list: fwd.files.join(", ") })}</p>
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
          <Button type="submit" size="sm" disabled={uploads.busy}>
            {t("compose.send")}
          </Button>
          <span className="hidden px-1.5 text-xs text-muted-foreground sm:inline">{t("thread.sendHint")}</span>
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
