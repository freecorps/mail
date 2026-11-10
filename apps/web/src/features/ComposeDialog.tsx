// New conversation from a mailbox, or a message forwarded from a thread (`forward`: from the thread's mailbox, its
// subject and quoted text prefilled, its files going along). Optimistic: the dialog closes at once and the thread
// shows at the top of the list ("waiting"); on failure the dialog comes back with the draft.
import { useId, useRef, useState } from "react";
import { useMutation } from "@freecorps/ember-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/context";
import { api, type Mailbox } from "@/lib/api";
import { checkCompose, composeErrorField } from "@/model/compose";

const EMPTY = { to: "", cc: "", subject: "", text: "" };

/** A message to forward: where it is, and what the dialog starts from. */
export interface ForwardSource {
  threadId: string;
  messageId: string;
  mailbox: string;
  subject: string;
  text: string;
  /** Names of the original's files, which go along. */
  files: string[];
}

export function ComposeDialog(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mailboxes: Mailbox[];
  defaultMailbox: string | null;
  onSent: (threadId: string) => void;
  forward?: ForwardSource | null;
}) {
  const { t } = useI18n();
  const compose = useMutation(api.inbox.compose);
  const forwardM = useMutation(api.inbox.forward);
  const fwd = p.forward ?? null;
  // Forwarding starts from the message: mounted open (keyed per message), the draft is the message's from the start.
  const [draft, setDraft] = useState(() => (p.forward ? { ...EMPTY, subject: p.forward.subject, text: p.forward.text } : EMPTY));
  const [from, setFrom] = useState<string | null>(null);
  const [showCc, setShowCc] = useState(false);
  // `field` is the input the error is about (gets aria-invalid); server failures belong to no field.
  const [error, setErrorState] = useState<{ message: string; field: "to" | "text" | null } | null>(null);
  const setError = (message: string | null, field: "to" | "text" | null = null) => setErrorState(message ? { message, field } : null);
  // One send per draft: the dialog closes optimistically, but a second Enter/click can land before it unmounts.
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const ids = { from: useId(), to: useId(), cc: useId(), subject: useId(), text: useId(), error: useId() };
  const mailbox = fwd?.mailbox ?? from ?? p.defaultMailbox ?? p.mailboxes[0]?.name ?? "";
  // The From choice is per message: closing the dialog forgets it, so the next one starts from the current mailbox.
  const [wasOpen, setWasOpen] = useState(p.open);
  if (p.open !== wasOpen) {
    setWasOpen(p.open);
    if (!p.open) setFrom(null);
    // Forwarding starts from the message (unless a failed send brought its draft back).
    else if (fwd && draft === EMPTY) setDraft({ ...EMPTY, subject: fwd.subject, text: fwd.text });
  }
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  function submit() {
    if (sending.current) return;
    const c = checkCompose({ mailbox, ...draft });
    if (!c.ok) {
      setError(
        c.error === "invalidList"
          ? t("compose.invalidList", { list: c.invalid.join(", ") })
          : c.error === "invalidTo"
            ? t("compose.invalidTo")
            : t("compose.empty"),
        composeErrorField(c.error),
      );
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(null);
    const saved = draft;
    setDraft(EMPTY);
    p.onOpenChange(false);
    const sent = fwd
      ? forwardM({
          threadId: fwd.threadId,
          messageId: fwd.messageId,
          to: c.args.to,
          ...(c.args.cc ? { cc: c.args.cc } : {}),
          subject: c.args.subject,
          text: c.args.text,
        })
      : compose(c.args);
    sent
      .then((r) =>
        toast.success(fwd ? t("forward.sent") : t("compose.sent"), {
          action: { label: "#" + r.number, onClick: () => p.onSent(r.threadId) },
        }),
      )
      .catch((e: unknown) => {
        setDraft(saved);
        setFrom(c.args.mailbox);
        setError(e instanceof Error ? e.message : String(e));
        p.onOpenChange(true);
      })
      .finally(() => {
        sending.current = false;
        setBusy(false);
      });
  }

  const sendOnCmdEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{fwd ? t("forward.title") : t("compose.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("thread.sendHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          aria-describedby={error ? ids.error : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Row label={t("compose.from")} id={ids.from}>
            <select
              id={ids.from}
              value={mailbox}
              // A forward goes from the thread's own mailbox.
              disabled={!!fwd}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs dark:bg-input/30"
            >
              {p.mailboxes.map((b) => (
                <option key={b.name} value={b.name}>
                  {(b.displayName ?? b.name) + " <" + b.address + ">"}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("compose.to")} id={ids.to}>
            <div className="flex gap-2">
              <Input
                id={ids.to}
                value={draft.to}
                onChange={set("to")}
                placeholder={t("compose.toHint")}
                autoComplete="off"
                required
                aria-invalid={error?.field === "to" || undefined}
              />
              {!showCc && (
                <Button type="button" variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={() => setShowCc(true)}>
                  {t("compose.cc")}
                </Button>
              )}
            </div>
          </Row>
          {showCc && (
            <Row label={t("compose.cc")} id={ids.cc}>
              <Input id={ids.cc} value={draft.cc} onChange={set("cc")} autoComplete="off" />
            </Row>
          )}
          <Row label={t("compose.subject")} id={ids.subject}>
            <Input id={ids.subject} value={draft.subject} onChange={set("subject")} />
          </Row>
          <div>
            <Label htmlFor={ids.text} className="sr-only">
              {t("compose.body")}
            </Label>
            <Textarea
              onKeyDown={sendOnCmdEnter}
              id={ids.text}
              value={draft.text}
              onChange={set("text")}
              placeholder={t("compose.body")}
              className="min-h-48 resize-y"
              required
              aria-invalid={error?.field === "text" || undefined}
            />
          </div>
          {fwd && fwd.files.length > 0 && (
            <p className="text-xs text-muted-foreground">{t("forward.files", { list: fwd.files.join(", ") })}</p>
          )}
          {error && (
            <p id={ids.error} role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          )}
          <DialogFooter className="items-center sm:justify-between">
            <span className="hidden text-xs text-muted-foreground sm:inline">{t("thread.sendHint")}</span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => p.onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("compose.send")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
      <Label htmlFor={id} className="text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
