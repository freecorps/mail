// People: access requests (grant or decline) and members (shared mailboxes, admin, remove). Personal mailboxes are
// never granted: only their owner reads them.
import { useId, useState } from "react";
import { Check, Lock, Shield, UserPlus } from "lucide-react";
import { useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/context";
import { api, type MemberRow } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { useNow } from "@/lib/now";
import { Card, Confirm, Empty, Failure, Field, Loading, Pill, SectionHeader } from "./parts";
import { useLive, useRun } from "./hooks";

type Editing = { userId: string; name: string | null; mailboxes: string[]; admin: boolean; isNew: boolean; label: string };

export function Members() {
  const { t, locale } = useI18n();
  const now = useNow();
  const data = useLive(useQuerySnapshot(api.console.members, {}));
  const boxes = useQuerySnapshot(api.console.mailboxes, {});
  const shared = (boxes.value ?? []).filter((b) => !b.owner);
  const dismiss = useMutation(api.console.dismissRequest);
  const remove = useMutation(api.console.removeMember);
  const { run } = useRun();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const label = (m: { name: string | null; userId: string }) => m.name ?? m.userId;

  if (data.state === "error") return <Failure message={data.message} />;
  if (boxes.status === "error") return <Failure message={boxes.error?.message ?? ""} />;
  // The grant dialog lists the shared mailboxes: both must be loaded before it can open.
  if (data.state === "loading" || boxes.value === undefined) return <Loading />;
  const { me, members, requests } = data.value;
  return (
    <div className="space-y-10">
      <section>
        <SectionHeader title={t("admin.members.requests")} />
        {!requests.length ? (
          <Empty>{t("admin.members.requestsEmpty")}</Empty>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => (
              <li key={r.userId}>
                <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar name={r.name ?? r.email ?? r.userId} seed={r.userId} className="size-8" />
                  <div className="min-w-40 flex-1">
                    <p className="truncate text-sm font-medium">{r.name ?? r.email ?? r.userId}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.email ? `${r.email} · ` : ""}
                      {t("admin.members.requestedAt", { when: formatWhen(r.requestedAt, now, locale) })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void run(() => dismiss({ userId: r.userId }), t("admin.members.dismissed"))}
                  >
                    {t("admin.members.dismiss")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      setEditing({
                        userId: r.userId,
                        name: r.name,
                        mailboxes: [],
                        admin: false,
                        isNew: true,
                        label: r.name ?? r.email ?? r.userId,
                      })
                    }
                  >
                    <UserPlus aria-hidden="true" />
                    {t("admin.members.grant")}
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader title={t("admin.members.title")} />
        <ul className="divide-y rounded-lg border bg-card">
          {members.map((m) => {
            const mine = m.userId === me;
            return (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={label(m)} seed={m.userId} className="size-8" />
                <div className="min-w-40 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {label(m)}
                    {mine && <span className="text-xs font-normal text-muted-foreground">({t("admin.members.you")})</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {m.admin && (
                      <Pill tone="accent">
                        <Shield className="size-3" aria-hidden="true" />
                        {t("admin.members.admin")}
                      </Pill>
                    )}
                    {m.personalMailbox && (
                      <Pill>
                        <Lock className="size-3" aria-hidden="true" />
                        {t("admin.members.personal", { name: m.personalMailbox })}
                      </Pill>
                    )}
                    {m.admin ? (
                      <Pill>{t("admin.members.allShared")}</Pill>
                    ) : m.mailboxes.length ? (
                      m.mailboxes.map((b) => <Pill key={b}>{b}</Pill>)
                    ) : (
                      !m.personalMailbox && <Pill>{t("admin.members.noMailboxes")}</Pill>
                    )}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ ...m, isNew: false, label: label(m) })}>
                  {t("admin.members.edit")}
                </Button>
                {!mine && !m.personalMailbox && (
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRemoving(m)}>
                    {t("admin.members.remove")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {editing && (
        <MemberDialog
          key={editing.userId}
          editing={editing}
          self={editing.userId === me}
          shared={shared.map((b) => ({ name: b.name, label: b.displayName ?? b.name }))}
          onClose={() => setEditing(null)}
        />
      )}
      <Confirm
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("admin.members.removeTitle", { name: removing ? label(removing) : "" })}
        body={t("admin.members.removeBody")}
        action={t("admin.members.remove")}
        onConfirm={() => {
          const m = removing;
          setRemoving(null);
          if (m) void run(() => remove({ userId: m.userId }), t("admin.members.removed"));
        }}
      />
    </div>
  );
}

function MemberDialog(p: { editing: Editing; self: boolean; shared: Array<{ name: string; label: string }>; onClose: () => void }) {
  const { t } = useI18n();
  const save = useMutation(api.console.saveMember);
  const { run, busy } = useRun();
  const [name, setName] = useState(p.editing.name ?? "");
  const [picked, setPicked] = useState(new Set(p.editing.mailboxes));
  const [admin, setAdmin] = useState(p.editing.admin);
  const ids = { name: useId(), admin: useId() };
  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                save({
                  userId: p.editing.userId,
                  name: name.trim() || null,
                  mailboxes: [...picked],
                  ...(p.self ? {} : { admin }),
                }),
              t("admin.members.saved"),
            ).then((r) => r && p.onClose());
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {p.editing.isNew
                ? t("admin.members.grantTitle", { name: p.editing.label })
                : t("admin.members.editTitle", { name: p.editing.label })}
            </DialogTitle>
          </DialogHeader>
          <Field label={t("admin.members.name")} htmlFor={ids.name}>
            <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="pb-1 text-sm font-medium">{t("admin.members.mailboxes")}</legend>
            {p.shared.map((b) => {
              const on = admin || picked.has(b.name);
              return (
                <label key={b.name} className="flex items-center gap-2.5 text-sm">
                  <Checkbox
                    checked={on}
                    disabled={admin}
                    onCheckedChange={(v) => {
                      const next = new Set(picked);
                      if (v === true) next.add(b.name);
                      else next.delete(b.name);
                      setPicked(next);
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{b.label}</span>
                  {on && admin && <Check className="size-3.5 text-muted-foreground" aria-hidden="true" />}
                </label>
              );
            })}
          </fieldset>
          <label htmlFor={ids.admin} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5">
            <span>
              <span className="block text-sm font-medium">{t("admin.members.admin")}</span>
              <span className="block text-xs text-muted-foreground">{t("admin.members.adminHint")}</span>
            </span>
            <Switch id={ids.admin} checked={admin} onCheckedChange={setAdmin} disabled={p.self} />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={p.onClose}>
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
