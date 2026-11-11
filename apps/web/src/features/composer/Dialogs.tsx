// The composer's settings: signatures (the default and one per mailbox) and the saved replies of a mailbox. Opened
// from the account menu, the signature line, the saved replies button and "/" (model/dock: `openComposerDialog`).
import { useId, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { COMPOSER_LIMITS, SAVED_REPLY_VARIABLES } from "@freecorps/mail-email-html/compose";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/context";
import { api, type Mailbox, type SavedReply } from "@/lib/api";
import { cn } from "@/lib/utils";
import { openComposerDialog, useComposerDialog } from "@/model/dock";
import { Confirm } from "../admin/parts";

export function ComposerDialogs({ mailboxes }: { mailboxes: Mailbox[] }) {
  const d = useComposerDialog();
  const close = (open: boolean) => !open && openComposerDialog(null);
  return (
    <>
      <SignatureDialog
        key={d?.kind === "signature" ? `sig:${d.mailbox ?? ""}` : "sig"}
        open={d?.kind === "signature"}
        mailbox={d?.kind === "signature" ? d.mailbox : null}
        mailboxes={mailboxes}
        onOpenChange={close}
      />
      <SavedRepliesDialog
        key={d?.kind === "saved" ? `saved:${d.mailbox}` : "saved"}
        open={d?.kind === "saved"}
        mailbox={d?.kind === "saved" ? d.mailbox : (mailboxes[0]?.name ?? "")}
        mailboxes={mailboxes}
        onOpenChange={close}
      />
    </>
  );
}

const DEFAULT = "\u0000default";

function SignatureDialog({
  open,
  mailbox,
  mailboxes,
  onOpenChange,
}: {
  open: boolean;
  mailbox: string | null;
  mailboxes: Mailbox[];
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const ids = { scope: useId(), text: useId() };
  const me = useQuerySnapshot(api.inbox.me, {}).value;
  const list = useQuerySnapshot(api.inbox.signatures, open ? {} : "skip");
  const setSig = useMutation(api.inbox.setSignature);
  const delSig = useMutation(api.inbox.deleteSignature);
  const [scope, setScope] = useState(mailbox ?? DEFAULT);
  const current = list.value?.find((s) => (scope === DEFAULT ? !s.mailbox : s.mailbox === scope)) ?? null;
  const label = (name: string) => mailboxes.find((b) => b.name === name)?.displayName ?? name;
  // A first signature starts from "Nome / Nome da caixa" (the plan's suggestion), not saved until the member saves.
  const suggestion = [me?.name ?? "", scope === DEFAULT ? "" : label(scope)].filter(Boolean).join("\n");
  const [text, setText] = useState<string | null>(null);
  // Until the signatures are read, nothing shows and nothing saves: a save then would write the suggestion over a
  // signature that exists.
  const loading = list.value === undefined;
  const value = loading ? "" : (text ?? current?.text ?? suggestion);
  const [busy, setBusy] = useState(false);

  const save = () => {
    if (loading || !value.trim()) return;
    setBusy(true);
    setSig({ mailbox: scope === DEFAULT ? null : scope, text: value.trim() })
      .then(() => {
        toast.success(t("signature.saved"));
        setText(null);
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false));
  };
  const remove = () => {
    setBusy(true);
    delSig({ mailbox: scope === DEFAULT ? null : scope })
      .then(() => {
        toast(t("signature.removed"));
        setText(null);
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("signature.menu")}</DialogTitle>
          <DialogDescription>{t("signature.hint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={ids.scope}>{t("saved.mailbox")}</Label>
            <select
              id={ids.scope}
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setText(null);
              }}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs dark:bg-input/30"
            >
              <option value={DEFAULT}>{t("signature.default")}</option>
              {mailboxes.map((b) => (
                <option key={b.name} value={b.name}>
                  {label(b.name)}
                  {list.value?.some((s) => s.mailbox === b.name) ? "" : ` · ${t("signature.usesDefault")}`}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.text}>{t("signature.label")}</Label>
            <Textarea
              id={ids.text}
              value={value}
              maxLength={COMPOSER_LIMITS.signatureText}
              onChange={(e) => setText(e.target.value)}
              disabled={loading}
              aria-busy={loading || undefined}
              className="min-h-28 font-sans"
            />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          {current ? (
            <Button variant="ghost" className="text-destructive" onClick={remove} disabled={busy}>
              {t("signature.remove")}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save} disabled={loading || busy || !value.trim() || (current?.text === value && text === null)}>
            {t("signature.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SavedRepliesDialog({
  open,
  mailbox,
  mailboxes,
  onOpenChange,
}: {
  open: boolean;
  mailbox: string;
  mailboxes: Mailbox[];
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const ids = { box: useId(), title: useId(), body: useId() };
  const me = useQuerySnapshot(api.inbox.me, {}).value;
  const [box, setBox] = useState(mailbox);
  const list = useQuerySnapshot(api.inbox.savedReplies, open && box ? { mailbox: box } : "skip");
  const replies = useMemo(() => list.value ?? [], [list.value]);
  const saveM = useMutation(api.inbox.saveSavedReply);
  const delM = useMutation(api.inbox.deleteSavedReply);
  const [draft, setEditing] = useState<{ id: string | null; title: string; text: string } | null>(null);
  const [confirm, setConfirm] = useState<SavedReply | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const canEdit = (r: SavedReply) => !!me && (r.createdBy === me.userId || (me.member && me.admin));
  // Nothing picked yet: the first reply shows.
  const first = replies[0];
  const editing = draft ?? (first ? { id: first._id, title: first.title, text: first.text } : null);
  const selected = editing?.id ? (replies.find((r) => r._id === editing.id) ?? null) : null;
  const readOnly = !!selected && !canEdit(selected);

  const insertVar = (v: string) => {
    if (!editing || readOnly) return;
    const el = area.current;
    const token = `{${v}}`;
    const at = el?.selectionStart ?? editing.text.length;
    const end = el?.selectionEnd ?? at;
    setEditing({ ...editing, text: editing.text.slice(0, at) + token + editing.text.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  const save = () => {
    if (!editing || !editing.title.trim() || !editing.text.trim()) return;
    setBusy(true);
    saveM({ ...(editing.id ? { id: editing.id } : {}), mailbox: box, title: editing.title.trim(), text: editing.text })
      .then((r) => {
        toast.success(t("saved.saved"));
        setEditing({ ...editing, id: r.id });
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("saved.title")}</DialogTitle>
          <DialogDescription>{t("saved.insert")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="min-w-0 space-y-2">
            <select
              id={ids.box}
              aria-label={t("saved.mailbox")}
              value={box}
              onChange={(e) => {
                setBox(e.target.value);
                setEditing(null);
              }}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs dark:bg-input/30"
            >
              {mailboxes.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.displayName ?? b.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => setEditing({ id: null, title: "", text: "" })}
            >
              <Plus aria-hidden="true" />
              {t("saved.new")}
            </Button>
            <ul className="max-h-72 space-y-px overflow-y-auto">
              {replies.map((r) => (
                <li key={r._id}>
                  <button
                    type="button"
                    onClick={() => setEditing({ id: r._id, title: r.title, text: r.text })}
                    aria-current={editing?.id === r._id || undefined}
                    className={cn(
                      "flex w-full flex-col rounded-md px-2 py-1.5 text-left",
                      editing?.id === r._id ? "bg-selected" : "hover:bg-accent",
                    )}
                  >
                    <span className="truncate text-ui font-medium">{r.title}</span>
                    <span className="truncate text-xs text-muted-foreground">{r.text.replace(/\s+/g, " ")}</span>
                  </button>
                </li>
              ))}
              {list.status !== "loading" && !replies.length && (
                <li className="px-2 py-1.5 text-ui text-muted-foreground">{t("saved.empty")}</li>
              )}
            </ul>
          </div>
          {editing && (
            <div className="min-w-0 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor={ids.title}>{t("saved.titleLabel")}</Label>
                <Input
                  id={ids.title}
                  value={editing.title}
                  readOnly={readOnly}
                  maxLength={COMPOSER_LIMITS.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={ids.body}>{t("saved.bodyLabel")}</Label>
                <Textarea
                  ref={area}
                  id={ids.body}
                  value={editing.text}
                  readOnly={readOnly}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                  className="min-h-40"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{t("saved.variables")}</p>
                <div className="flex flex-wrap gap-1">
                  {SAVED_REPLY_VARIABLES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      disabled={readOnly}
                      onClick={() => insertVar(v)}
                      title={t(`saved.var.${v}`)}
                      className="pressable inline-flex h-6 items-center rounded-full border px-2 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
              </div>
              {!readOnly && (
                <div className="flex justify-between gap-2">
                  {selected ? (
                    <Button variant="ghost" className="text-destructive" onClick={() => setConfirm(selected)} disabled={busy}>
                      {t("saved.delete")}
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button onClick={save} disabled={busy || !editing.title.trim() || !editing.text.trim()}>
                    {t("signature.save")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        <Confirm
          open={!!confirm}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={t("saved.deleteTitle", { title: confirm?.title ?? "" })}
          body={t("saved.deleteBody")}
          action={t("saved.delete")}
          onConfirm={() => {
            const r = confirm;
            setConfirm(null);
            if (!r) return;
            delM({ id: r._id })
              .then(() => {
                toast(t("saved.deleted"));
                setEditing(null);
              })
              .catch((e: Error) => toast.error(e.message));
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
