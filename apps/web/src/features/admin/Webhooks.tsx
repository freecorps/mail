// Webhooks: endpoints with their events and filters, the signing secret (on demand), test, rotate, pause, delete,
// and each one's recent deliveries (send again).
import { useId, useState } from "react";
import { ChevronDown, Plus, Webhook as WebhookIcon } from "lucide-react";
import { useAction, useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/context";
import type { StringKey } from "@/i18n/strings";
import { api, WEBHOOK_EVENTS, type WebhookEventType, type WebhookRow } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { useNow } from "@/lib/now";
import { cn } from "@/lib/utils";
import { useLive, useRun } from "./hooks";
import { Card, Confirm, CopyButton, Empty, Failure, Field, Loading, Pill, SectionHeader, type Tone } from "./parts";

const ALL = "__all__";
const eventLabel = (t: (k: StringKey) => string, e: string) => {
  const k = `admin.webhooks.event.${e}` as StringKey;
  return t(k) === k ? e : t(k);
};

export function Webhooks() {
  const { t } = useI18n();
  const list = useLive(useQuerySnapshot(api.console.webhooks, {}));
  const [editing, setEditing] = useState<WebhookRow | "new" | null>(null);
  // The secret to show: just made (create, rotate), or read on demand by the webhook's id.
  const [secret, setSecret] = useState<{ secret: string } | { id: string } | null>(null);
  return (
    <section>
      <SectionHeader
        title={t("admin.section.webhooks")}
        intro={t("admin.webhooks.intro")}
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            {t("admin.webhooks.new")}
          </Button>
        }
      />
      {list.state === "error" ? (
        <Failure message={list.message} />
      ) : list.state === "loading" ? (
        <Loading />
      ) : !list.value.length ? (
        <Empty>{t("admin.webhooks.empty")}</Empty>
      ) : (
        <ul className="space-y-3">
          {list.value.map((w) => (
            <WebhookItem
              key={w.id}
              w={w}
              onEdit={() => setEditing(w)}
              onShowSecret={() => setSecret({ id: w.id })}
              onRotated={(s) => setSecret({ secret: s })}
            />
          ))}
        </ul>
      )}
      {editing && (
        <WebhookDialog
          key={editing === "new" ? "new" : editing.id}
          w={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={(s) => setSecret({ secret: s })}
        />
      )}
      {secret && <SecretDialog source={secret} onClose={() => setSecret(null)} />}
    </section>
  );
}

function WebhookItem(p: { w: WebhookRow; onEdit: () => void; onShowSecret: () => void; onRotated: (secret: string) => void }) {
  const { w, onEdit } = p;
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<"rotate" | "remove" | null>(null);
  const update = useMutation(api.console.updateWebhook);
  const remove = useMutation(api.console.deleteWebhook);
  const test = useMutation(api.console.testWebhook);
  const rotate = useAction(api.console.rotateWebhookSecret);
  const { run } = useRun();
  const panel = useId();
  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panel}
            onClick={() => setOpen(!open)}
            className="flex min-w-40 flex-1 items-center gap-2 text-left"
          >
            <ChevronDown
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
              aria-hidden="true"
            />
            <WebhookIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate font-mono text-sm">{w.endpoint}</span>
              {w.description && <span className="block truncate text-xs text-muted-foreground">{w.description}</span>}
            </span>
          </button>
          {w.failures > 0 && <Pill tone="bad">{t("admin.webhooks.failing", { count: w.failures })}</Pill>}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {w.enabled ? t("admin.webhooks.enabled") : t("admin.webhooks.disabled")}
            <Switch
              checked={w.enabled}
              onCheckedChange={(enabled) => void run(() => update({ id: w.id, enabled }))}
              aria-label={t("admin.webhooks.enabled")}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5 px-4 pb-3 pl-14">
          {w.events.map((e) => (
            <Pill key={e} tone="accent">
              {eventLabel(t, e)}
            </Pill>
          ))}
          {w.project && <Pill>{w.project}</Pill>}
          {w.mailboxes.map((m) => (
            <Pill key={m}>{m}</Pill>
          ))}
        </div>
        {open && (
          <div id={panel} className="space-y-4 border-t px-4 py-4">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void run(() => test({ id: w.id }), t("admin.webhooks.tested"))}>
                {t("admin.webhooks.test")}
              </Button>
              <Button size="sm" variant="outline" onClick={p.onShowSecret}>
                {t("admin.webhooks.showSecret")}
              </Button>
              <Button size="sm" variant="outline" onClick={onEdit}>
                {t("admin.webhooks.edit")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm("rotate")}>
                {t("admin.webhooks.rotate")}
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirm("remove")}>
                {t("admin.webhooks.remove")}
              </Button>
            </div>
            <Deliveries id={w.id} />
          </div>
        )}
      </Card>
      <Confirm
        open={confirm === "rotate"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("admin.webhooks.rotateTitle")}
        body={t("admin.webhooks.rotateBody")}
        action={t("admin.webhooks.rotate")}
        onConfirm={() => {
          setConfirm(null);
          void run(() => rotate({ id: w.id }), t("admin.webhooks.rotated")).then((r) => r && p.onRotated(r.secret));
        }}
      />
      <Confirm
        open={confirm === "remove"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("admin.webhooks.removeTitle")}
        body={t("admin.webhooks.removeBody")}
        action={t("admin.webhooks.remove")}
        onConfirm={() => {
          setConfirm(null);
          void run(() => remove({ id: w.id }), t("admin.webhooks.removed"));
        }}
      />
    </li>
  );
}

const DELIVERY_TONE: Record<string, Tone> = { succeeded: "ok", pending: "warn", failed: "bad" };

function Deliveries({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const now = useNow();
  const list = useLive(useQuerySnapshot(api.console.webhookDeliveries, { id }));
  const redeliver = useMutation(api.console.redeliverWebhook);
  const { run } = useRun();
  return (
    <div>
      <h4 className="pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("admin.webhooks.deliveries")}</h4>
      {list.state === "error" ? (
        <Failure message={list.message} />
      ) : list.state === "loading" ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : !list.value.length ? (
        <p className="text-sm text-muted-foreground">{t("admin.webhooks.noDeliveries")}</p>
      ) : (
        <ul className="divide-y rounded-md border text-xs">
          {list.value.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <Pill tone={DELIVERY_TONE[d.status] ?? "muted"}>{t(`admin.webhooks.status.${d.status}` as StringKey)}</Pill>
              <span className="font-medium">{d.type === "webhook.test" ? t("admin.webhooks.test") : eventLabel(t, d.type)}</span>
              <span className="text-muted-foreground tabular-nums">{formatWhen(Date.parse(d.created_at), now, locale)}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {t("admin.webhooks.attempts", { count: d.attempts })}
                {d.last_status !== null ? ` · HTTP ${d.last_status}` : ""}
                {d.duration_ms !== null ? ` · ${d.duration_ms} ms` : ""}
                {d.last_error && d.status !== "succeeded" ? ` · ${d.last_error}` : ""}
                {d.next_attempt_at
                  ? ` · ${t("admin.webhooks.next", { when: formatWhen(Date.parse(d.next_attempt_at), now, locale) })}`
                  : ""}
              </span>
              {d.status !== "succeeded" && (
                <Button size="xs" variant="outline" onClick={() => void run(() => redeliver({ id: d.id }), t("admin.webhooks.retried"))}>
                  {t("admin.webhooks.retry")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WebhookDialog({ w, onClose, onCreated }: { w: WebhookRow | null; onClose: () => void; onCreated: (secret: string) => void }) {
  const { t } = useI18n();
  const create = useAction(api.console.createWebhook);
  const update = useMutation(api.console.updateWebhook);
  const projects = useQuerySnapshot(api.console.projects, {});
  const boxes = useQuerySnapshot(api.console.mailboxes, {});
  const shared = (boxes.value ?? []).filter((b) => !b.owner);
  const { run, busy } = useRun();
  const [endpoint, setEndpoint] = useState(w?.endpoint ?? "https://");
  const [description, setDescription] = useState(w?.description ?? "");
  const [events, setEvents] = useState<Set<WebhookEventType>>(new Set(w?.events ?? ["email.received"]));
  const [project, setProject] = useState(w?.project ?? ALL);
  const [mailboxes, setMailboxes] = useState(new Set(w?.mailboxes ?? []));
  const ids = { endpoint: useId(), description: useId(), project: useId() };
  const toggle = <T,>(set: Set<T>, x: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(x);
    else next.delete(x);
    return next;
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fields = {
              endpoint: endpoint.trim(),
              events: [...events],
              description: description.trim() || null,
              project: project === ALL ? null : project,
              mailboxes: mailboxes.size ? [...mailboxes] : null,
            };
            if (w) void run(() => update({ id: w.id, ...fields }), t("admin.webhooks.saved")).then((r) => r && onClose());
            else
              void run(() => create(fields)).then((r) => {
                if (!r) return;
                onClose();
                onCreated(r.secret);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{w ? t("admin.webhooks.editTitle") : t("admin.webhooks.new")}</DialogTitle>
            {!w && <DialogDescription>{t("admin.webhooks.intro")}</DialogDescription>}
          </DialogHeader>
          <Field label={t("admin.webhooks.endpoint")} htmlFor={ids.endpoint}>
            <Input
              id={ids.endpoint}
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              required
              autoComplete="off"
              className="font-mono"
            />
          </Field>
          <Field label={t("admin.webhooks.description")} htmlFor={ids.description}>
            <Input
              id={ids.description}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              autoComplete="off"
            />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="pb-1 text-sm font-medium">{t("admin.webhooks.events")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-2.5 text-sm">
                  <Checkbox checked={events.has(e)} onCheckedChange={(v) => setEvents(toggle(events, e, v === true))} />
                  {eventLabel(t, e)}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={t("admin.webhooks.project")} htmlFor={ids.project} hint={t("admin.webhooks.projectHint")}>
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger id={ids.project} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("admin.webhooks.projectAll")}</SelectItem>
                {(projects.value ?? []).map((p) => (
                  <SelectItem key={p} value={p}>
                    <span className="font-mono text-xs">{p}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {events.has("email.received") && project === ALL && (
            <fieldset className="grid gap-2">
              <legend className="pb-1 text-sm font-medium">{t("admin.webhooks.mailboxes")}</legend>
              {shared.map((b) => (
                <label key={b.name} className="flex items-center gap-2.5 text-sm">
                  <Checkbox checked={mailboxes.has(b.name)} onCheckedChange={(v) => setMailboxes(toggle(mailboxes, b.name, v === true))} />
                  {b.displayName ?? b.name}
                  <span className="font-mono text-xs text-muted-foreground">{b.address}</span>
                </label>
              ))}
              <p className="text-xs text-muted-foreground">{t("admin.webhooks.mailboxesHint")}</p>
            </fieldset>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !events.size}>
              {w ? t("admin.save") : t("admin.webhooks.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SecretDialog({ source, onClose }: { source: { secret: string } | { id: string }; onClose: () => void }) {
  const { t } = useI18n();
  const read = useQuerySnapshot(api.console.webhookSecret, "id" in source ? { id: source.id } : "skip");
  const secret = "secret" in source ? source.secret : (read.value ?? null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.webhooks.secretTitle")}</DialogTitle>
          <DialogDescription>{t("admin.webhooks.secretBody")}</DialogDescription>
        </DialogHeader>
        {read.status === "error" ? (
          <Failure message={read.error?.message ?? ""} />
        ) : secret ? (
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={secret}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
              aria-label={t("admin.webhooks.secretTitle")}
            />
            <CopyButton value={secret} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        <DialogFooter>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
