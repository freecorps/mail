// Mailboxes: every address with its kind (personal or shared), who has access, retention and auto-reply; create and
// edit. A personal mailbox shows its owner and nothing of its mail.
import { useId, useState } from "react";
import { Lock, Pencil, Plus } from "lucide-react";
import { useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/context";
import { api, type MailboxRow } from "@/lib/api";
import { Card, Empty, Failure, Field, Loading, Pill, SectionHeader } from "./parts";
import { useLive, useRun } from "./hooks";

export function Mailboxes() {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale);
  const list = useLive(useQuerySnapshot(api.console.mailboxes, {}));
  const [editing, setEditing] = useState<MailboxRow | "new" | null>(null);
  const days = (n?: number) => (n ? t("admin.mailboxes.days", { days: nf.format(n) }) : t("admin.mailboxes.forever"));
  return (
    <section>
      <SectionHeader
        title={t("admin.section.mailboxes")}
        intro={t("admin.mailboxes.intro")}
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            {t("admin.mailboxes.new")}
          </Button>
        }
      />
      {list.state === "error" ? (
        <Failure message={list.message} />
      ) : list.state === "loading" ? (
        <Loading />
      ) : !list.value.length ? (
        <Empty>{t("admin.mailboxes.new")}</Empty>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {list.value.map((b) => (
            <li key={b.name}>
              <Card className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p dir="auto" className="truncate font-medium">
                      {b.displayName ?? b.name}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{b.address}</p>
                  </div>
                  {!b.owner && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("admin.mailboxes.edit", { name: b.name })}
                      onClick={() => setEditing(b)}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {b.owner ? (
                    <Pill>
                      <Lock className="size-3" aria-hidden="true" />
                      {t("admin.mailboxes.personal", { owner: b.ownerName ?? b.owner })}
                    </Pill>
                  ) : (
                    <Pill tone="accent">{t("admin.mailboxes.shared")}</Pill>
                  )}
                  {b.catchAll && <Pill>{t("admin.mailboxes.catchAll")}</Pill>}
                  {b.autoReply && <Pill>{t("admin.mailboxes.autoReplyOn")}</Pill>}
                </div>
                {!b.owner && (
                  <dl className="mt-auto space-y-1 text-xs text-muted-foreground">
                    {b.counts && (
                      <dd>{t("admin.mailboxes.counts", { threads: nf.format(b.counts.threads), unread: nf.format(b.counts.unread) })}</dd>
                    )}
                    <dd className="truncate">
                      {b.granted.length
                        ? t("admin.mailboxes.access", { names: b.granted.map((g) => g.name ?? g.userId).join(", ") })
                        : t("admin.mailboxes.accessAdmins")}
                    </dd>
                    <dd>
                      {t("admin.mailboxes.retentionSummary", { closed: days(b.retention?.closedDays), spam: days(b.retention?.spamDays) })}
                    </dd>
                  </dl>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <MailboxDialog
          key={editing === "new" ? "new" : editing.name}
          box={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

const numOrUndef = (s: string) => {
  const n = Number(s);
  return s.trim() && Number.isInteger(n) && n > 0 ? n : undefined;
};

function MailboxDialog({ box, onClose }: { box: MailboxRow | null; onClose: () => void }) {
  const { t } = useI18n();
  const save = useMutation(api.console.saveMailbox);
  const { run, busy } = useRun();
  const [name, setName] = useState(box?.name ?? "");
  const [address, setAddress] = useState(box?.address ?? "");
  const [displayName, setDisplayName] = useState(box?.displayName ?? "");
  const [closed, setClosed] = useState(box?.retention?.closedDays ? String(box.retention.closedDays) : "");
  const [spam, setSpam] = useState(box?.retention?.spamDays ? String(box.retention.spamDays) : "");
  const [auto, setAuto] = useState(!!box?.autoReply);
  const [subject, setSubject] = useState(box?.autoReply?.subject ?? "Recebemos sua mensagem [#{{number}}]");
  const [text, setText] = useState(box?.autoReply?.text ?? "");
  const ids = {
    name: useId(),
    address: useId(),
    display: useId(),
    closed: useId(),
    spam: useId(),
    auto: useId(),
    subject: useId(),
    text: useId(),
  };
  const isNew = !box;
  const autoChanged =
    auto !== !!box?.autoReply || (auto && (subject !== (box?.autoReply?.subject ?? "") || text !== (box?.autoReply?.text ?? "")));
  const domain = address.includes("@") ? address.slice(address.lastIndexOf("@") + 1) : "";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const c = numOrUndef(closed);
            const s = numOrUndef(spam);
            void run(
              () =>
                save({
                  name: name.trim(),
                  address: address.trim(),
                  displayName: displayName.trim() || null,
                  retention: c || s ? { ...(c ? { closedDays: c } : {}), ...(s ? { spamDays: s } : {}) } : null,
                  // Unchanged: not sent, so the stored one (an HTML auto-reply set by the API, too) is kept.
                  ...(autoChanged ? { autoReply: auto && text.trim() ? { subject: subject.trim(), text } : null } : {}),
                }),
              isNew ? `${t("admin.mailboxes.saved")}. ${t("admin.mailboxes.routing", { domain })}` : t("admin.mailboxes.saved"),
            ).then((r) => r && onClose());
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {isNew ? t("admin.mailboxes.newTitle") : t("admin.mailboxes.edit", { name: box.displayName ?? box.name })}
            </DialogTitle>
            {isNew && <DialogDescription>{t("admin.mailboxes.intro")}</DialogDescription>}
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("admin.mailboxes.name")} htmlFor={ids.name} hint={isNew ? t("admin.mailboxes.nameHint") : undefined}>
              <Input
                id={ids.name}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isNew}
                required
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            <Field label={t("admin.mailboxes.address")} htmlFor={ids.address}>
              <Input
                id={ids.address}
                type="email"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                autoComplete="off"
              />
            </Field>
          </div>
          <Field label={t("admin.mailboxes.displayName")} htmlFor={ids.display}>
            <Input id={ids.display} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="off" />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t("admin.mailboxes.retention")}</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("admin.mailboxes.closedDays")} htmlFor={ids.closed}>
                <Input
                  id={ids.closed}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={closed}
                  onChange={(e) => setClosed(e.target.value)}
                  placeholder="∞"
                />
              </Field>
              <Field label={t("admin.mailboxes.spamDays")} htmlFor={ids.spam}>
                <Input
                  id={ids.spam}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={spam}
                  onChange={(e) => setSpam(e.target.value)}
                  placeholder="∞"
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">{t("admin.mailboxes.retentionHint")}</p>
          </fieldset>
          <fieldset className="grid gap-3">
            <label htmlFor={ids.auto} className="flex items-center justify-between gap-3 text-sm font-medium">
              {t("admin.mailboxes.autoReply")}
              <Switch id={ids.auto} checked={auto} onCheckedChange={setAuto} />
            </label>
            {auto && (
              <>
                <Field label={t("admin.mailboxes.autoReplySubject")} htmlFor={ids.subject}>
                  <Input id={ids.subject} value={subject} onChange={(e) => setSubject(e.target.value)} />
                </Field>
                <Field label={t("admin.mailboxes.autoReplyText")} htmlFor={ids.text} hint={t("admin.mailboxes.autoReplyHint")}>
                  <Textarea id={ids.text} rows={5} value={text} onChange={(e) => setText(e.target.value)} required />
                </Field>
              </>
            )}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("admin.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
